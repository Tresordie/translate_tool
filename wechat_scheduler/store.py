"""JSON 文件持久化：任务与发送历史。加锁 + 原子写（tmp → os.replace）。"""

import json
import os
import threading
import time
import uuid

HISTORY_CAP = 500
SUMMARY_CAP = 100


class JsonStore:
    """单文件 JSON 存储，内部结构固定为 {"items": [...]}。"""

    def __init__(self, path, key):
        self.path = path
        self.key = key
        self.lock = threading.Lock()
        self._items = []
        self._load()

    def _load(self):
        try:
            with open(self.path, "r", encoding="utf-8") as f:
                data = json.load(f)
            items = data.get(self.key)
            if isinstance(items, list):
                self._items = items
        except FileNotFoundError:
            pass
        except (ValueError, OSError) as e:
            # 文件损坏：备份后从空开始，不让服务起不来
            try:
                bad = self.path + ".corrupt-" + time.strftime("%Y%m%d%H%M%S")
                os.replace(self.path, bad)
                print("[wx-schedule] WARN %s 解析失败(%s)，已备份为 %s" % (self.path, e, bad), flush=True)
            except OSError:
                print("[wx-schedule] WARN %s 解析失败(%s)，忽略" % (self.path, e), flush=True)
            self._items = []

    def _save_locked(self):
        tmp = self.path + ".tmp"
        os.makedirs(os.path.dirname(self.path), exist_ok=True)
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump({self.key: self._items}, f, ensure_ascii=False, indent=1)
        os.replace(tmp, self.path)

    def all(self):
        with self.lock:
            return [dict(x) for x in self._items]

    def mutate(self, fn):
        """fn(items) -> result；持锁执行修改并落盘。"""
        with self.lock:
            result = fn(self._items)
            self._save_locked()
            return result


class TaskStore:
    def __init__(self, data_dir):
        self.tasks = JsonStore(os.path.join(data_dir, "tasks.json"), "tasks")
        self.history = JsonStore(os.path.join(data_dir, "history.json"), "entries")
        self.summaries = JsonStore(os.path.join(data_dir, "summaries.json"), "items")
        self._ensure_history_ids()

    def _ensure_history_ids(self):
        """历史条目补 id（旧数据迁移），供单条删除定位。"""
        def fn(entries):
            changed = False
            for e in entries:
                if not e.get("id"):
                    e["id"] = "h_" + uuid.uuid4().hex[:8]
                    changed = True
            return changed
        self.history.mutate(fn)

    def list(self):
        items = self.tasks.all()
        items.sort(key=lambda t: (t.get("created_at") or "", t.get("id") or ""))
        return items

    def get(self, task_id):
        for t in self.tasks.all():
            if t.get("id") == task_id:
                return t
        return None

    def add(self, task):
        self.tasks.mutate(lambda items: items.append(task))
        return task

    def update(self, task_id, patch):
        """浅合并 patch 到目标任务；返回更新后的任务或 None。"""
        def fn(items):
            for i, t in enumerate(items):
                if t.get("id") == task_id:
                    merged = dict(t)
                    merged.update(patch)
                    items[i] = merged
                    return dict(merged)
            return None
        return self.tasks.mutate(fn)

    def remove(self, task_id):
        def fn(items):
            before = len(items)
            items[:] = [t for t in items if t.get("id") != task_id]
            return len(items) < before
        return self.tasks.mutate(fn)

    def append_history(self, entry):
        if not entry.get("id"):
            entry["id"] = "h_" + uuid.uuid4().hex[:8]
        def fn(entries):
            entries.append(entry)
            if len(entries) > HISTORY_CAP:
                del entries[: len(entries) - HISTORY_CAP]
        self.history.mutate(fn)

    def remove_history(self, entry_id):
        def fn(entries):
            before = len(entries)
            entries[:] = [e for e in entries if e.get("id") != entry_id]
            return len(entries) < before
        return self.history.mutate(fn)

    def clear_history(self):
        def fn(entries):
            n = len(entries)
            entries.clear()
            return n
        return self.history.mutate(fn) > 0

    def list_history(self, limit=50):
        entries = self.history.all()
        entries.reverse()  # 新 → 旧
        return entries[:limit]

    # ---- 总结记录（聊天记录 AI 总结的历史）----
    def add_summary(self, item):
        if not item.get("id"):
            item["id"] = "s_" + uuid.uuid4().hex[:8]
        def fn(items):
            items.append(item)
            if len(items) > SUMMARY_CAP:
                del items[: len(items) - SUMMARY_CAP]
        self.summaries.mutate(fn)
        return item

    def list_summaries(self, limit=30):
        items = self.summaries.all()
        items.reverse()  # 新 → 旧
        return items[:limit]

    def remove_summary(self, item_id):
        def fn(items):
            before = len(items)
            items[:] = [i for i in items if i.get("id") != item_id]
            return len(items) < before
        return self.summaries.mutate(fn)

    def clear_summaries(self):
        def fn(items):
            n = len(items)
            items.clear()
            return n
        return self.summaries.mutate(fn) > 0

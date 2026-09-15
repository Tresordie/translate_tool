"""LinguaFlow 微信定时消息 · 本机服务（纯 Python 标准库，默认通道零 pip 依赖）。

职责：
  1. 定时调度线程——到点驱动 PC 微信（默认 psauto：系统 PowerShell UIA/键盘驱动，
     移植自真机打磨的 wxtimer，含剪贴板回读校验/前台断言/锁屏识别等安全层）向指定
     联系人/群发送文字+文件；支持 once/daily/weekly/monthly/yearly 与 {target}{date}{time}{note} 占位符。
  2. 关机补发：错过的任务重启后自动补发（加【补发】前缀）；超出补发窗口（默认 240 分钟）
     或同一时间点连续失败 5 次则放弃并留痕，绝不轰炸收件人。
  3. REST API（/api/*，带 CORS）+ 静态托管项目页面——电脑/手机局域网共用同一份任务数据。

启动（在本目录）：
  python server.py                    # 默认 psauto 通道（仅需 PC 微信已登录，无 pip 依赖）
  python server.py --sender wechatauto  # 可选通道（需 pip install wechatauto-replica，可读联系人列表）
  python server.py --mock             # 演示/联调模式（不依赖微信）
  python server.py --port 8765 --token abc

接口与调度模型见文件底部 API_DOC 与 README.md / USAGE.md。
"""

import argparse
import json
import mimetypes
import os
import re
import socket
import sys
import threading
import time
import uuid
from datetime import datetime
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse, unquote

# 保证任何启动方式（含 embeddable Python）都能 import 同目录模块
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from scheduler_logic import (  # noqa: E402
    fmt_dt, next_occurrence, parse_dt, schedule_text, validate_schedule,
)
from store import TaskStore  # noqa: E402
from sync import SyncHub, autostart_disable, autostart_enable, autostart_status, list_dirs  # noqa: E402
from wx_reader import ReaderError, read_messages  # noqa: E402
from wx_sender import create_sender, default_sender  # noqa: E402

try:
    import msvcrt  # Windows：发送互斥锁
except ImportError:
    msvcrt = None
try:
    import fcntl  # Linux/macOS：发送互斥锁
except ImportError:
    fcntl = None

SERVICE_VERSION = "0.33.0"
HERE = Path(__file__).resolve().parent
CATCH_UP_MINUTES_DEFAULT = 240   # 补发窗口：计划点滞后超过该分钟数则放弃补发
MAX_RETRY_PER_SLOT = 5           # 同一计划点连续失败上限，达到即放弃并推进
TICK_INTERVAL = 1.0
MAX_CONTENT_LEN = 5000

ARGS = None
STORE = None
SENDER = None
SYNC = None


# ---------------------------------------------------------------- 工具

def now():
    return datetime.now()


def log(msg):
    print("[wx-schedule %s] %s" % (time.strftime("%H:%M:%S"), msg), flush=True)


def lan_ip():
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))
        ip = s.getsockname()[0]
        s.close()
        return ip
    except OSError:
        return None


def task_catch_up(task):
    try:
        return max(0, int((task.get("options") or {}).get("catch_up_minutes", CATCH_UP_MINUTES_DEFAULT)))
    except (TypeError, ValueError):
        return CATCH_UP_MINUTES_DEFAULT


def render_content(task, slot):
    """轻量占位符替换（不用 str.format，避免消息里的大括号炸掉）。"""
    out = task["content"]
    receiver = task.get("receiver") or {}
    for key, value in {
        "{target}": receiver.get("name") or receiver.get("wxid") or "",
        "{date}": slot.strftime("%Y-%m-%d"),
        "{time}": slot.strftime("%H:%M"),
        "{note}": task.get("note") or "",
    }.items():
        out = out.replace(key, value)
    return out


def resolve_files(task):
    """附件路径解析（相对路径按服务目录）。返回 (绝对路径列表, 缺失列表)。"""
    out, missing = [], []
    for p in task.get("files") or []:
        fp = Path(p)
        if not fp.is_absolute():
            fp = HERE / p
        (out if fp.exists() else missing).append(str(fp) if fp.exists() else p)
    return out, missing


class SendLock:
    """data/.send.lock 互斥：同一时刻只允许一个进程操作微信。Windows msvcrt / POSIX fcntl。"""

    def __init__(self):
        self._fh = None

    def __enter__(self):
        try:
            (HERE / "data").mkdir(parents=True, exist_ok=True)
            self._fh = open(HERE / "data" / ".send.lock", "a+b")
            if msvcrt:
                msvcrt.locking(self._fh.fileno(), msvcrt.LK_NBLCK, 1)
            elif fcntl:
                fcntl.flock(self._fh.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
            return True
        except OSError:
            self.close()
            return False

    def __exit__(self, *exc):
        self.close()
        return False

    def close(self):
        if self._fh:
            try:
                if msvcrt:
                    msvcrt.locking(self._fh.fileno(), msvcrt.LK_UNLCK, 1)
                elif fcntl:
                    fcntl.flock(self._fh.fileno(), fcntl.LOCK_UN)
            except OSError:
                pass
            try:
                self._fh.close()
            except OSError:
                pass
            self._fh = None


def attempt_send(task, content, extra_options=None):
    """占位符渲染 → 附件校验 → 发送锁内执行 SENDER.send。返回 (ok, error, files)。"""
    files, missing = resolve_files(task)
    if missing:
        return False, "以下文件不存在：" + "、".join(missing), files
    job = dict(task)
    if extra_options:
        job["options"] = {**(task.get("options") or {}), **extra_options}
    with SendLock() as locked:
        if not locked:
            return None, "另一发送进程正在操作微信，本轮跳过", files  # ok=None 表示未执行
        return SENDER.send(job, content) + (files,)


def advance_patch(task, t_now, ok, err, catchup=False, manual=False, sent_count=None):
    """发送后的任务字段推进。"""
    sched = task.get("schedule") or {}
    patch = {
        "last_result": {"time": fmt_dt(t_now), "ok": bool(ok), "error": err, "catchup": bool(catchup), "manual": bool(manual)},
        "updated_at": fmt_dt(t_now),
    }
    if sent_count is not None:
        patch["sent_count"] = sent_count
    retry = task.get("retry") or {}
    if ok:
        patch["retry"] = {"slot": None, "count": 0}
    else:
        count = (int(retry.get("count") or 0) + 1) if retry.get("slot") == task.get("next_fire") else 1
        patch["retry"] = {"slot": task.get("next_fire"), "count": count}
    if sched.get("type") == "once":
        if ok:
            patch.update({"enabled": False, "next_fire": None})
        # 失败保持启用与原 next_fire，由 retry 计数控制放弃；
        # 放弃路径（超窗/连败上限）以 ok=True 调用本函数，会走上面的停用分支
    else:
        nxt = next_occurrence(sched, t_now)
        patch["next_fire"] = fmt_dt(nxt) if nxt else None
        if nxt is None:
            patch["enabled"] = False
    return patch


def record(task, t_now, content, ok, err, catchup=False, manual=False, dry_run=False, skipped=False, files=None):
    STORE.append_history({
        "time": fmt_dt(t_now),
        "task_id": task["id"],
        "task_name": task.get("name") or (task.get("receiver") or {}).get("name") or (task.get("receiver") or {}).get("wxid") or "",
        "receiver_wxid": (task.get("receiver") or {}).get("wxid") or "",
        "receiver_name": (task.get("receiver") or {}).get("name") or "",
        "content": content,
        "ok": bool(ok),
        "error": err,
        "catchup": bool(catchup),
        "manual": bool(manual),
        "dry_run": bool(dry_run),
        "skipped": bool(skipped),
        "files": files or [],
    })
    SYNC.schedule_backup()


def scheduler_loop():
    """秒级扫描：next_fire <= now 且启用的任务 → 发送/补发/放弃。

    电脑关机期间错过的任务在重启后由本循环自然命中：滞后 ≤ 补发窗口 → 补发；
    超出窗口或同一计划点连续失败达上限 → 放弃留痕并推进，绝不无限重试。
    """
    while True:
        try:
            t_now = now()
            for task in STORE.list():
                if not task.get("enabled"):
                    continue
                sched = task.get("schedule") or {}
                nf = task.get("next_fire")
                try:
                    nf_dt = parse_dt(nf) if nf else None
                except (TypeError, ValueError):
                    nf_dt = None
                if nf_dt is None:
                    nxt = next_occurrence(sched, t_now) if sched else None
                    if nxt is None:
                        STORE.update(task["id"], {"enabled": False, "updated_at": fmt_dt(t_now)})
                    else:
                        STORE.update(task["id"], {"next_fire": fmt_dt(nxt), "updated_at": fmt_dt(t_now)})
                    continue
                if nf_dt > t_now:
                    continue
                if not SENDER.status()["connected"]:
                    continue  # 等通道恢复，滞后由下一次 tick 处理
                lag_min = (t_now - nf_dt).total_seconds() / 60.0
                catch_window = task_catch_up(task)
                if lag_min > catch_window:
                    reason = "计划时间 %s 距当前超过补发窗口 %d 分钟，放弃补发" % (nf, catch_window)
                    log("跳过 %s：%s" % (task["id"], reason))
                    record(task, t_now, task.get("content", ""), False, reason, skipped=True)
                    STORE.update(task["id"], advance_patch(dict(task, next_fire=nf), t_now, True, None))
                    continue
                retry = task.get("retry") or {}
                if retry.get("slot") == nf and int(retry.get("count") or 0) >= MAX_RETRY_PER_SLOT:
                    reason = "%s 连续失败 %s 次，放弃该时间点" % (nf, retry.get("count"))
                    log("跳过 %s：%s" % (task["id"], reason))
                    record(task, t_now, task.get("content", ""), False, reason, skipped=True)
                    STORE.update(task["id"], advance_patch(dict(task, next_fire=nf), t_now, True, None))
                    continue
                catchup = lag_min * 60 > 90
                content = render_content(task, nf_dt)
                if catchup:
                    content = "【补发】\n" + content
                ok, err, files = attempt_send(task, content)
                if ok is None:  # 锁被占，本轮不消耗
                    log(err)
                    continue
                record(task, t_now, content, ok, err, catchup=catchup, files=files)
                log("发送 %s -> %s：%s%s" % (
                    "补发" if catchup else "定时",
                    (task.get("receiver") or {}).get("name") or (task.get("receiver") or {}).get("wxid"),
                    "成功" if ok else "失败(%s)" % err, "（任务「%s」）" % task.get("name", "")))
                sent_count = int(task.get("sent_count") or 0) + (1 if ok else 0)
                STORE.update(task["id"], advance_patch(dict(task, next_fire=nf), t_now, ok, err,
                                                        catchup=catchup, sent_count=sent_count))
        except Exception as e:  # 调度线程绝不因单次异常退出
            log("调度循环异常：%s" % e)
        time.sleep(TICK_INTERVAL)


def validate_task_payload(body, existing=None, t_now=None):
    """校验/归一化任务字段。返回 (patch_dict, 错误信息)。"""
    t_now = t_now or now()
    patch = {}
    if "name" in body or existing is None:
        patch["name"] = str(body.get("name") or "").strip()[:60]
    if "receiver" in body or existing is None:
        rec = body.get("receiver")
        if not isinstance(rec, dict) or not str(rec.get("wxid") or rec.get("name") or "").strip():
            return None, "请选择接收人（wxid 或会话名称不能为空）"
        patch["receiver"] = {"wxid": str(rec.get("wxid") or "").strip(),
                             "name": str(rec.get("name") or "").strip()[:60]}
    if "content" in body or existing is None:
        content = str(body.get("content") or "").strip()
        if not content:
            return None, "消息内容不能为空"
        if len(content) > MAX_CONTENT_LEN:
            return None, "消息内容过长（最多 %d 字）" % MAX_CONTENT_LEN
        patch["content"] = content
    if "note" in body or existing is None:
        patch["note"] = str(body.get("note") or "").strip()[:200]
    if "files" in body or existing is None:
        files = body.get("files") or []
        if not isinstance(files, list) or len(files) > 10:
            return None, "附件最多 10 个"
        norm = []
        for f in files:
            f = str(f or "").strip()
            if not f:
                continue
            if len(f) > 500:
                return None, "附件路径过长"
            norm.append(f)
        patch["files"] = norm
    if "options" in body or existing is None:
        opts = body.get("options")
        if opts is None:
            opts = {}
        if not isinstance(opts, dict):
            return None, "options 需为对象"
        try:
            if len(json.dumps(opts, ensure_ascii=False)) > 4000:
                return None, "options 过大"
        except (TypeError, ValueError):
            return None, "options 需为 JSON 对象"
        patch["options"] = opts
    if "schedule" in body:
        sched = body["schedule"]
        err = validate_schedule(sched, t_now)  # once 类型会校验必须晚于当前时间
        if err:
            return None, err
        patch["schedule"] = sched
        patch["next_fire"] = fmt_dt(next_occurrence(sched, t_now))
    elif existing is None:
        return None, "缺少调度规则"
    if "enabled" in body or existing is None:
        enabled = bool(body.get("enabled", True))
        patch["enabled"] = enabled
        if enabled and existing is not None and "schedule" not in patch:
            sched = (existing or {}).get("schedule") or patch.get("schedule")
            if sched:
                nxt = next_occurrence(sched, t_now)
                if nxt is None:
                    if sched.get("type") == "once":
                        return None, "一次性任务的发送时间已过，请点「编辑」改时间后再保存"
                    patch["enabled"] = False
                else:
                    patch["next_fire"] = fmt_dt(nxt)
    patch["updated_at"] = fmt_dt(t_now)
    return patch, None


# ---------------------------------------------------------------- HTTP

class Handler(BaseHTTPRequestHandler):
    def log_message(self, fmt, *args):  # 静音默认访问日志
        pass

    # ---- 基础应答 ----
    def _send(self, status, body=b"", ctype="application/json; charset=utf-8", extra=None):
        self.send_response(status)
        self.send_header("Content-Type", ctype)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, X-Api-Token")
        self.send_header("Access-Control-Max-Age", "600")
        self.send_header("Cache-Control", "no-store")
        for k, v in (extra or {}).items():
            self.send_header(k, v)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        if self.command != "HEAD" and body:
            self.wfile.write(body)

    def _json(self, obj, status=200):
        self._send(status, json.dumps(obj, ensure_ascii=False).encode("utf-8"))

    def _read_json(self):
        length = int(self.headers.get("Content-Length") or 0)
        if length <= 0 or length > 1_000_000:
            return None, "请求体为空或过大"
        try:
            return json.loads(self.rfile.read(length).decode("utf-8")), None
        except (ValueError, UnicodeDecodeError) as e:
            return None, "JSON 解析失败：%s" % e

    def _authed(self):
        token = (ARGS.token or "").strip()
        if not token:
            return True
        return (self.headers.get("X-Api-Token") or "") == token

    # ---- 路由 ----
    def do_OPTIONS(self):
        self._send(204)

    def do_GET(self):
        path = urlparse(self.path).path
        if path.startswith("/api/"):
            return self._api_get(path, urlparse(self.path).query)
        return self._static(path)

    def do_HEAD(self):
        self.do_GET()

    def do_POST(self):
        path = urlparse(self.path).path
        if not path.startswith("/api/"):
            return self._json({"ok": False, "error": "not found"}, 404)
        if not self._authed():
            return self._json({"ok": False, "error": "访问口令错误（X-Api-Token）"}, 401)
        m = re.match(r"^/api/tasks/([\w-]+)/(run|dryrun)$", path)
        if m:
            return self._run_task(m.group(1), dry_run=m.group(2) == "dryrun")
        if path == "/api/probe":
            return self._probe()
        if path == "/api/backup":
            ok, err = SYNC.write_backup()
            return self._json({"ok": ok, "error": err, "settings": SYNC.get_settings()})
        if path == "/api/browser-data":
            body, err = self._read_json()
            if err:
                return self._json({"ok": False, "error": err}, 400)
            state = (body or {}).get("state")
            if not isinstance(state, dict):
                return self._json({"ok": False, "error": "state 需为对象"}, 400)
            SYNC.put_browser_state(state)
            return self._json({"ok": True})
        if path == "/api/restore":
            body, err = self._read_json()
            if err:
                return self._json({"ok": False, "error": err}, 400)
            body = body or {}
            try:
                if body.get("bundle") is not None:
                    bundle = body["bundle"]
                else:
                    bundle = SYNC.read_bundle(str(body.get("name") or "latest.json"))
                browser_state = SYNC.apply_bundle(bundle)
            except (ValueError, OSError, json.JSONDecodeError) as e:
                return self._json({"ok": False, "error": str(e)}, 400)
            SYNC.schedule_backup()
            log("已从备份恢复（来源：%s）" % ("上传文件" if body.get("bundle") is not None else body.get("name") or "latest.json"))
            return self._json({"ok": True, "browser_state": browser_state})
        if path == "/api/autostart":
            body, err = self._read_json()
            if err:
                return self._json({"ok": False, "error": err}, 400)
            enable = bool((body or {}).get("enable", True))
            ok, err = autostart_enable() if enable else autostart_disable()
            log("开机自启%s%s" % ("注册" if enable else "取消", "成功" if ok else "失败：%s" % err))
            return self._json({"ok": ok, "error": err, **autostart_status()})
        if path == "/api/summaries":
            body, err = self._read_json()
            if err:
                return self._json({"ok": False, "error": err}, 400)
            body = body or {}
            result = str(body.get("result") or "").strip()
            if not result:
                return self._json({"ok": False, "error": "总结结果不能为空"}, 400)
            item = {
                "id": "s_" + uuid.uuid4().hex[:8],
                "created_at": fmt_dt(now()),
                "display": str(body.get("display") or "")[:60],
                "window": str(body.get("window") or "")[:80],
                "count": int(body.get("count") or 0),
                "result": result[:20000],
            }
            STORE.add_summary(item)
            log("保存总结记录 %s（%s · %d 条）" % (item["id"], item["display"], item["count"]))
            SYNC.schedule_backup()
            return self._json({"ok": True, "item": item})
        if path == "/api/tasks":
            body, err = self._read_json()
            if err:
                return self._json({"ok": False, "error": err}, 400)
            patch, err = validate_task_payload(body or {})
            if err:
                return self._json({"ok": False, "error": err}, 400)
            task = {"id": "t_" + uuid.uuid4().hex[:8], "created_at": fmt_dt(now()),
                    "sent_count": 0, "retry": {"slot": None, "count": 0}}
            task.update(patch)
            if not task.get("name"):
                task["name"] = task["receiver"].get("name") or task["receiver"]["wxid"]
            STORE.add(task)
            log("新建任务 %s（%s · %s）" % (task["id"], task["name"], schedule_text(task["schedule"])))
            SYNC.schedule_backup()
            return self._json({"ok": True, "task": task})
        return self._json({"ok": False, "error": "not found"}, 404)

    def do_PUT(self):
        path = urlparse(self.path).path
        if path == "/api/settings":
            if not self._authed():
                return self._json({"ok": False, "error": "访问口令错误（X-Api-Token）"}, 401)
            body, err = self._read_json()
            if err:
                return self._json({"ok": False, "error": err}, 400)
            ok, err = SYNC.set_settings(body or {})
            if not ok:
                return self._json({"ok": False, "error": err}, 400)
            if (body or {}).get("drive_path") and (body or {}).get("test"):
                ok2, err2 = SYNC.write_backup()
                if not ok2:
                    return self._json({"ok": True, "settings": SYNC.get_settings(),
                                       "test_error": err2}, 200)
            return self._json({"ok": True, "settings": SYNC.get_settings()})
        m = re.match(r"^/api/tasks/([\w-]+)$", path)
        if not m:
            return self._json({"ok": False, "error": "not found"}, 404)
        if not self._authed():
            return self._json({"ok": False, "error": "访问口令错误（X-Api-Token）"}, 401)
        existing = STORE.get(m.group(1))
        if not existing:
            return self._json({"ok": False, "error": "任务不存在"}, 404)
        body, err = self._read_json()
        if err:
            return self._json({"ok": False, "error": err}, 400)
        patch, err = validate_task_payload(body or {}, existing=existing)
        if err:
            return self._json({"ok": False, "error": err}, 400)
        task = STORE.update(existing["id"], patch)
        log("更新任务 %s" % task["id"])
        SYNC.schedule_backup()
        return self._json({"ok": True, "task": task})

    def do_DELETE(self):
        path = urlparse(self.path).path
        if path == "/api/history":
            if not self._authed():
                return self._json({"ok": False, "error": "访问口令错误（X-Api-Token）"}, 401)
            STORE.clear_history()
            log("清空发送历史")
            SYNC.schedule_backup()
            return self._json({"ok": True})
        m = re.match(r"^/api/history/([\w-]+)$", path)
        if m:
            if not self._authed():
                return self._json({"ok": False, "error": "访问口令错误（X-Api-Token）"}, 401)
            if not STORE.remove_history(m.group(1)):
                return self._json({"ok": False, "error": "记录不存在"}, 404)
            SYNC.schedule_backup()
            return self._json({"ok": True})
        if path == "/api/summaries":
            if not self._authed():
                return self._json({"ok": False, "error": "访问口令错误（X-Api-Token）"}, 401)
            STORE.clear_summaries()
            log("清空总结记录")
            SYNC.schedule_backup()
            return self._json({"ok": True})
        m = re.match(r"^/api/summaries/([\w-]+)$", path)
        if m:
            if not self._authed():
                return self._json({"ok": False, "error": "访问口令错误（X-Api-Token）"}, 401)
            if not STORE.remove_summary(m.group(1)):
                return self._json({"ok": False, "error": "记录不存在"}, 404)
            SYNC.schedule_backup()
            return self._json({"ok": True})
        m = re.match(r"^/api/tasks/([\w-]+)$", path)
        if not m:
            return self._json({"ok": False, "error": "not found"}, 404)
        if not self._authed():
            return self._json({"ok": False, "error": "访问口令错误（X-Api-Token）"}, 401)
        if not STORE.remove(m.group(1)):
            return self._json({"ok": False, "error": "任务不存在"}, 404)
        log("删除任务 %s" % m.group(1))
        SYNC.schedule_backup()
        return self._json({"ok": True})

    # ---- API GET ----
    def _api_get(self, path, query):
        if not self._authed():
            return self._json({"ok": False, "error": "访问口令错误（X-Api-Token）"}, 401)
        if path == "/api/status":
            tasks = STORE.list()
            enabled = [t for t in tasks if t.get("enabled") and t.get("next_fire")]
            next_soon = min((t["next_fire"] for t in enabled), default=None)
            return self._json({
                "ok": True, "version": SERVICE_VERSION,
                "service": "linguaflow-wx-scheduler",
                "server_time": fmt_dt(now()),
                "wechat": SENDER.status(),
                "platform": sys.platform,
                "reader_available": sys.platform.startswith(("win", "cygwin", "msys")),
                "tasks": {"total": len(tasks), "enabled": sum(1 for t in tasks if t.get("enabled"))},
                "next_fire": next_soon,
            })
        if path == "/api/doctor":
            if not hasattr(SENDER, "doctor"):
                return self._json({"ok": False, "error": "当前通道不支持环境体检"})
            res = SENDER.doctor()
            return self._json({"ok": res.ok, "code": res.code, "code_text": res.code_text,
                               "detail": res.detail, "data": res.inner})
        if path == "/api/contacts":
            try:
                return self._json({"ok": True, "contacts": SENDER.contacts()})
            except Exception as e:
                return self._json({"ok": False, "error": "获取联系人失败：%s" % e}, 502)
        if path == "/api/messages":
            q = parse_qs(query or "")
            target = (q.get("target") or [""])[0]
            try:
                end_dt = parse_dt(q["end"][0]) if (q.get("end") or [""])[0] else now()
                if (q.get("start") or [""])[0]:
                    start_dt = parse_dt(q["start"][0])
                else:
                    from datetime import timedelta
                    hours = float((q.get("hours") or ["24"])[0])
                    start_dt = end_dt - timedelta(hours=hours)
            except (TypeError, ValueError):
                return self._json({"ok": False, "error": "时间格式应为 YYYY-MM-DDTHH:MM"}, 400)
            if start_dt >= end_dt:
                return self._json({"ok": False, "error": "开始时间需早于结束时间"}, 400)
            try:
                msgs, scanned, disp = read_messages(target, int(start_dt.timestamp()), int(end_dt.timestamp()))
            except ReaderError as e:
                return self._json({"ok": False, "error": str(e)}, 502)
            log("读取聊天记录 %s %s~%s：命中 %d 条（扫描 %d）" % (disp, fmt_dt(start_dt), fmt_dt(end_dt), len(msgs), scanned))
            return self._json({"ok": True, "messages": msgs, "scanned": scanned, "display": disp,
                               "window": {"start": fmt_dt(start_dt), "end": fmt_dt(end_dt)}})
        if path == "/api/listdir":
            q = parse_qs(query or "")
            info = list_dirs(str((q.get("path") or [""])[0]))
            return self._json({"ok": True, **info})
        if path == "/api/summaries":
            limit = 30
            m = re.search(r"limit=(\d+)", query or "")
            if m:
                limit = max(1, min(100, int(m.group(1))))
            return self._json({"ok": True, "items": STORE.list_summaries(limit)})
        if path == "/api/settings":
            return self._json({"ok": True, "settings": SYNC.get_settings()})
        if path == "/api/backup/status":
            return self._json({"ok": True, "settings": SYNC.get_settings(), "snapshots": SYNC.list_snapshots()})
        if path == "/api/backup/snapshot":
            name = (parse_qs(query or "").get("name") or ["latest.json"])[0]
            try:
                return self._json({"ok": True, "bundle": SYNC.read_bundle(name)})
            except (ValueError, OSError, json.JSONDecodeError) as e:
                return self._json({"ok": False, "error": str(e)}, 404)
        if path == "/api/browser-data":
            return self._json({"ok": True, "state": SYNC.browser or {}})
        if path == "/api/autostart":
            return self._json({"ok": True, **autostart_status()})
        if path == "/api/tasks":
            return self._json({"ok": True, "tasks": STORE.list()})
        if path == "/api/history":
            limit = 50
            m = re.search(r"limit=(\d+)", query or "")
            if m:
                limit = max(1, min(500, int(m.group(1))))
            return self._json({"ok": True, "entries": STORE.list_history(limit)})
        return self._json({"ok": False, "error": "not found"}, 404)

    # ---- 立即发送 / 演练 / 探针 ----
    def _run_task(self, task_id, dry_run=False):
        task = STORE.get(task_id)
        if not task:
            return self._json({"ok": False, "error": "任务不存在"}, 404)
        if dry_run:
            if not hasattr(SENDER, "doctor"):
                return self._json({"ok": False, "error": "当前通道不支持演练（dry-run）"}, 400)
            ok, err, files = attempt_send(task, render_content(task, now()), extra_options={"dry_run": True})
            record(task, now(), render_content(task, now()), ok, err, dry_run=True, files=files)
            return self._json({"ok": bool(ok), "error": err, "dry_run": True})
        ok, err, files = attempt_send(task, render_content(task, now()))
        if ok:
            STORE.update(task_id, {"sent_count": int(task.get("sent_count") or 0) + 1})
        record(task, now(), render_content(task, now()), ok, err, manual=True, files=files)
        log("手动发送 %s -> %s：%s" % (task_id, task["receiver"].get("name") or task["receiver"]["wxid"],
                                       "成功" if ok else "失败(%s)" % err))
        return self._json({"ok": bool(ok), "error": err})

    def _probe(self):
        if not hasattr(SENDER, "probe"):
            return self._json({"ok": False, "error": "当前通道不支持探针"})
        body, err = self._read_json()
        if err:
            return self._json({"ok": False, "error": err}, 400)
        res = SENDER.probe(target=str((body or {}).get("target") or ""))
        return self._json({"ok": res.ok, "code": res.code, "code_text": res.code_text, "detail": res.detail})

    # ---- 静态文件 ----
    def _static(self, path):
        root = os.path.realpath(ARGS.static_dir)
        rel = unquote(path).lstrip("/") or "index.html"
        full = os.path.realpath(os.path.join(root, rel))
        if not full.startswith(root + os.sep) and full != root:
            return self._json({"ok": False, "error": "forbidden"}, 403)
        if os.path.isdir(full):
            full = os.path.join(full, "index.html")
        if not os.path.isfile(full):
            return self._send(404, "404 Not Found".encode(), "text/plain; charset=utf-8")
        ctype = mimetypes.guess_type(full)[0] or "application/octet-stream"
        if ctype.startswith("text/") or ctype in ("application/javascript", "application/json"):
            ctype += "; charset=utf-8"
        with open(full, "rb") as f:
            self._send(200, f.read(), ctype)


# ---------------------------------------------------------------- 入口

API_DOC = """
REST API（均带 CORS；设置 --token 后 /api/* 需请求头 X-Api-Token）：
  GET    /api/status             服务与通道状态
  GET    /api/doctor             环境体检（psauto：微信窗口/锁屏/语言模式/定位模式 uia|keyboard）
  POST   /api/probe              搜索框链路探针 {target}（不发送消息）
  GET    /api/contacts           联系人/会话列表（需 wechatauto-replica；否则手填名称）
  GET    /api/tasks              任务列表
  POST   /api/tasks              新建任务 {name, receiver:{wxid,name}, content, note, files:[路径], options:{}, schedule, enabled}
  PUT    /api/tasks/<id>         修改任务（局部字段；schedule/enabled 变化自动重算 next_fire）
  DELETE /api/tasks/<id>         删除任务
  POST   /api/tasks/<id>/run     立即发送一次（历史标记「手动」）
  POST   /api/tasks/<id>/dryrun  演练：打开会话+输入框校验，不按回车不发送（仅 psauto）
  GET    /api/history?limit=50   发送历史（新→旧，含补发/手动/演练/放弃标记）
  DELETE /api/history/<id>       删除单条历史；DELETE /api/history 清空全部
  GET    /api/messages           读聊天记录 ?target=wxid或名称&start=&end=（本地 ISO；缺省 hours=24）
                                 需 wechatauto-replica；返回 {messages:[{time,sender_name,type,content}],display,scanned}
  POST   /api/summaries          保存总结记录 {display, window, count, result}
  GET    /api/summaries          总结历史（新→旧）
  DELETE /api/summaries/<id>     删除单条总结；DELETE /api/summaries 清空
  GET/PUT /api/settings          云同步设置 {drive_path, auto_backup, test:true 时保存即试写}
  GET    /api/listdir            服务端目录浏览 ?path=（空=盘符列表；仅目录名，供管理页 Drive 路径选择器）
  POST   /api/backup             立即备份（latest.json + 当日快照，保留 14 份）
  GET    /api/backup/status      最近备份时间/错误 + Drive 内快照列表
  GET    /api/backup/snapshot    ?name=latest.json|backup-YYYY-MM-DD.json 读取备份包
  POST/GET /api/browser-data     页面推送/拉取浏览器全量键值（服务端强制剥离 apiKey/token）
  POST   /api/restore            {source:'drive',name} 或 {bundle}：恢复微信数据并返回 browser_state 供页面写回
  GET/POST /api/autostart        开机自启状态 / {enable:true|false} 注册/删除计划任务
schedule：{"type":"once","at":"YYYY-MM-DDTHH:MM"} | {"type":"daily","time":"HH:MM"}
        | {"type":"weekly","time","weekdays":[1..7]} | {"type":"monthly","time","day":1..31,"clamp":true}
        | {"type":"yearly","time","date":"MM-DD"}   # 1=周一；2-29 只在闰年；monthly 当月无此日 clamp 提前到月末
content 占位符：{target} {date} {time} {note}
options 透传驱动参数（search_click_ax/ay、input_click_ax、input_from_bottom、open_method、
  verify_input、confirm_first_send、confirm_every_send、gap_seconds、files_first、
  catch_up_minutes 等，含义见 USAGE.md）
"""


def main():
    global ARGS, STORE, SENDER, SYNC
    ap = argparse.ArgumentParser(description="LinguaFlow 微信定时消息本机服务（纯标准库，默认通道零 pip 依赖）")
    ap.add_argument("--host", default="0.0.0.0")
    ap.add_argument("--port", type=int, default=8765)
    ap.add_argument("--sender", choices=["psauto", "macauto", "linuxauto", "wechatauto", "mock"],
                    default=default_sender(),
                    help="发送通道（默认按系统自动选）：psauto=Windows PowerShell 驱动（已验证）；"
                         "macauto=macOS osascript / linuxauto=Linux xdotool（均实验性，需真机验证）；"
                         "wechatauto=可选增强（联系人列表）；mock=演示")
    ap.add_argument("--mock", action="store_true", help="等价 --sender mock")
    ap.add_argument("--token", default="", help="API 访问口令；空 = 信任局域网")
    ap.add_argument("--data-dir", default=os.path.join(os.path.dirname(os.path.abspath(__file__)), "data"))
    ap.add_argument("--static-dir", default=os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    ARGS = ap.parse_args()
    sender_name = "mock" if ARGS.mock else ARGS.sender

    STORE = TaskStore(ARGS.data_dir)
    SENDER = create_sender(sender_name)
    SYNC = SyncHub(ARGS.data_dir, STORE)
    log("发送通道：%s；数据目录：%s；静态目录：%s" % (sender_name, ARGS.data_dir, ARGS.static_dir))

    pending = [t for t in STORE.list() if t.get("enabled") and t.get("next_fire") and parse_dt(t["next_fire"]) <= now()]
    if pending:
        log("检测到 %d 个已过期任务（关机期间错过），将在补发窗口内自动补发，超窗则放弃留痕" % len(pending))

    threading.Thread(target=scheduler_loop, daemon=True).start()

    try:
        httpd = ThreadingHTTPServer((ARGS.host, ARGS.port), Handler)
    except OSError as e:
        log("端口 %d 绑定失败（%s）——多半是服务已在运行：直接打开 http://127.0.0.1:%d/ 即可；"
            "确需再起实例请换端口 --port %d" % (ARGS.port, e, ARGS.port, ARGS.port + 1))
        sys.exit(1)
    httpd.daemon_threads = True
    ip = lan_ip()
    log("服务已启动 http://127.0.0.1:%d/  （局域网 http://%s:%d/）" % (ARGS.port, ip or ARGS.host, ARGS.port))
    log("管理页：http://127.0.0.1:%d/wechat_schedule.html" % ARGS.port)
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        log("收到中断，退出")


if __name__ == "__main__":
    main()

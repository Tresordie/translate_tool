"""数据云同步：本地存储 + Google Drive 桌面文件夹镜像（v0.29.0）。

设计（与用户确认）：
  - 服务是唯一枢纽：浏览器各页面把 localStorage/chrome.storage 数据推给 /api/browser-data，
    服务与微信工具数据（tasks/history/summaries）合并成备份包，自动写入
    <drive_path>/LinguaFlow/（Google Drive 桌面客户端负责上云）。
  - 自动备份（数据变化去抖 5s 触发）+ 手动恢复/导入；每日快照 backup-YYYY-MM-DD.json，
    latest.json 始终最新，保留最近 14 份。
  - 安全红线：备份包**永不**包含 API Key / 访问口令（translate_config.apiKey、
    config.apiKey、ws_api_token、hn_tavily_key 等），写入与读取两侧都强制剥离。

依赖仅标准库。
"""

import json
import os
import re
import subprocess
import sys
import threading
import time
from datetime import datetime
from pathlib import Path

HERE = Path(__file__).resolve().parent
SNAPSHOT_KEEP = 14          # 带日期快照保留份数
BACKUP_DEBOUNCE_SEC = 5.0
SUBDIR = "LinguaFlow"       # Drive 目录下的子文件夹，避免污染 Drive 根目录

# 备份包永不携带的敏感键/字段（键名 → 置空字段名；值为 None 表示整个键删除）
SECRET_DROP_KEYS = ("ws_api_token", "hn_tavily_key", "apiConfig")
SECRET_FIELD_KEYS = ("translate_config", "config")   # 对象内的 apiKey 置空

_SNAP_RE = re.compile(r"^backup-\d{4}-\d{2}-\d{2}(-\d{2}-\d{2})?\.json$")


def strip_secrets(state):
    """就地剥离敏感信息（浏览器推送侧与服务写入侧双保险）。"""
    if not isinstance(state, dict):
        return state
    for k in SECRET_DROP_KEYS:
        state.pop(k, None)
    for k in SECRET_FIELD_KEYS:
        v = state.get(k)
        if isinstance(v, str):
            try:
                v = json.loads(v)
            except ValueError:
                continue
        if isinstance(v, dict) and v.get("apiKey"):
            v = dict(v)
            v["apiKey"] = ""
            state[k] = json.dumps(v) if isinstance(state.get(k), str) else v
    return state


class SyncHub:
    """设置 + 浏览器数据 + 备份调度。store 为 TaskStore（微信数据），共用其 JsonStore 原子写。"""

    def __init__(self, data_dir, store):
        self.store = store
        self.data_dir = Path(data_dir)
        self.settings = None  # dict: {drive_path, auto_backup, last_backup_at, last_backup_error}
        self.browser = None   # dict: 浏览器推送的全量键值（已脱密）
        self._lock = threading.Lock()
        self._timer = None
        self._load()

    # ---------- 持久化 ----------
    def _load(self):
        from store import JsonStore
        self._s_store = JsonStore(str(self.data_dir / "settings.json"), "settings")
        self._b_store = JsonStore(str(self.data_dir / "browser_state.json"), "state")
        s = self._s_store.all()
        self.settings = (s[0] if s else {}) or {}
        b = self._b_store.all()
        self.browser = (b[0] if b else {}) or {}

    def _save_settings(self):
        def fn(items):
            if items:
                items[0] = self.settings
            else:
                items.append(self.settings)
        self._s_store.mutate(fn)

    def _save_browser(self):
        def fn(items):
            if items:
                items[0] = self.browser
            else:
                items.append(self.browser)
        self._b_store.mutate(fn)

    # ---------- 设置 ----------
    def get_settings(self):
        return {
            "drive_path": self.settings.get("drive_path", ""),
            "auto_backup": bool(self.settings.get("auto_backup", True)),
            "last_backup_at": self.settings.get("last_backup_at", ""),
            "last_backup_error": self.settings.get("last_backup_error", ""),
            "dir_name": SUBDIR,
        }

    def set_settings(self, patch):
        if "drive_path" in patch:
            p = str(patch["drive_path"] or "").strip()
            if p:
                expanded = os.path.expandvars(os.path.expanduser(p))
                if not os.path.isdir(expanded):
                    return False, "Drive 路径不存在或不是文件夹：%s" % p
                p = expanded
            self.settings["drive_path"] = p
        if "auto_backup" in patch:
            self.settings["auto_backup"] = bool(patch["auto_backup"])
        self._save_settings()
        return True, None

    # ---------- 备份包 ----------
    def collect_bundle(self):
        return {
            "version": 1,
            "exported_at": datetime.now().strftime("%Y-%m-%dT%H:%M:%S"),
            "browser_state": strip_secrets(dict(self.browser or {})),
            "wechat": {
                "tasks": self.store.list(),
                "history": self.store.list_history(500),
                "summaries": self.store.list_summaries(100),
            },
        }

    def drive_root(self):
        p = self.settings.get("drive_path", "")
        return os.path.join(p, SUBDIR) if p else None

    def write_backup(self, force=False):
        """写 Drive（latest + 当日快照 + 清理）。返回 (ok, error)。"""
        root = self.drive_root()
        if not root:
            msg = "未配置 Google Drive 路径"
            self.settings["last_backup_error"] = msg
            self._save_settings()
            return False, msg
        try:
            os.makedirs(root, exist_ok=True)
            bundle = self.collect_bundle()
            text = json.dumps(bundle, ensure_ascii=False, indent=1)
            with open(os.path.join(root, "latest.json"), "w", encoding="utf-8") as f:
                f.write(text)
            now = datetime.now()
            snap = os.path.join(root, "backup-%s.json" % now.strftime("%Y-%m-%d"))
            with open(snap, "w", encoding="utf-8") as f:
                f.write(text)
            self._prune(root)
            self.settings["last_backup_at"] = now.strftime("%Y-%m-%dT%H:%M:%S")
            self.settings["last_backup_error"] = ""
            self._save_settings()
            return True, None
        except OSError as e:
            msg = "写入 Drive 文件夹失败：%s" % e
            self.settings["last_backup_error"] = msg
            self._save_settings()
            return False, msg

    @staticmethod
    def _prune(root):
        snaps = sorted(f for f in os.listdir(root) if _SNAP_RE.match(f))
        for old in snaps[:-SNAPSHOT_KEEP]:
            try:
                os.remove(os.path.join(root, old))
            except OSError:
                pass

    def schedule_backup(self):
        """数据变化后去抖触发自动备份。"""
        if not self.settings.get("auto_backup", True) or not self.drive_root():
            return
        with self._lock:
            if self._timer:
                self._timer.cancel()
            self._timer = threading.Timer(BACKUP_DEBOUNCE_SEC, self._timed_backup)
            self._timer.daemon = True
            self._timer.start()

    def _timed_backup(self):
        try:
            ok, err = self.write_backup()
            print("[wx-schedule] 自动备份%s：%s" % ("成功" if ok else "失败", err or self.drive_root()), flush=True)
        except Exception as e:
            print("[wx-schedule] 自动备份异常：%s" % e, flush=True)

    def list_snapshots(self):
        root = self.drive_root()
        if not root or not os.path.isdir(root):
            return []
        out = []
        for f in sorted(os.listdir(root), reverse=True):
            if f == "latest.json" or _SNAP_RE.match(f):
                try:
                    st = os.stat(os.path.join(root, f))
                    out.append({"name": f, "size": st.st_size,
                                "mtime": datetime.fromtimestamp(st.st_mtime).strftime("%Y-%m-%d %H:%M:%S")})
                except OSError:
                    pass
        return out

    def read_bundle(self, name="latest.json"):
        root = self.drive_root()
        if not root:
            raise ValueError("未配置 Google Drive 路径")
        if not _SNAP_RE.match(name) and name != "latest.json":
            raise ValueError("非法文件名")
        path = os.path.join(root, name)
        if not os.path.isfile(path):
            raise ValueError("备份文件不存在：%s" % name)
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)

    # ---------- 浏览器数据 ----------
    def put_browser_state(self, state):
        self.browser = strip_secrets(dict(state or {}))
        self._save_browser()
        self.schedule_backup()

    # ---------- 恢复 ----------
    def apply_bundle(self, bundle):
        """把备份包写回本地（服务侧数据 + 浏览器数据返回给页面应用）。"""
        if not isinstance(bundle, dict) or "wechat" not in bundle:
            raise ValueError("备份文件格式不正确（缺 wechat 段）")
        wx = bundle.get("wechat") or {}
        if isinstance(wx.get("tasks"), list):
            self.store.tasks.mutate(lambda items: (items.clear(), items.extend(wx["tasks"])))
        if isinstance(wx.get("history"), list):
            self.store.history.mutate(lambda items: (items.clear(), items.extend(wx["history"])))
        if isinstance(wx.get("summaries"), list):
            self.store.summaries.mutate(lambda items: (items.clear(), items.extend(wx["summaries"])))
        self.browser = strip_secrets(dict(bundle.get("browser_state") or {}))
        self._save_browser()
        return strip_secrets(self.browser)


# ---------- 开机自启（A 方案） ----------
TASK_NAME = "LinguaFlowWxScheduler"


def list_dirs(path=""):
    """列目录（供管理页内嵌目录浏览器；原生对话框在部分会话环境不可见，故改为页面内选择）。

    path 为空返回盘符根列表；仅目录名，不读文件内容。
    """
    import string
    if not path:
        roots = [l + ":\\" for l in string.ascii_uppercase if os.path.isdir(l + ":/")]
        return {"path": "", "parent": None, "dirs": roots}
    p = os.path.abspath(path)
    dirs = []
    try:
        for name in sorted(os.listdir(p)):
            if os.path.isdir(os.path.join(p, name)) and not name.startswith(("$", ".")):
                dirs.append(name)
    except OSError:
        pass
    parent = os.path.dirname(p)
    if parent == p:
        parent = ""
    return {"path": p, "parent": parent, "dirs": dirs}


def _vbs_path():
    return HERE / "launch_hidden.vbs"


def _launchd_path():
    return Path.home() / "Library" / "LaunchAgents" / "com.linguaflow.wxscheduler.plist"


def _systemd_unit_path():
    return Path.home() / ".config" / "systemd" / "user" / "linguaflow-wxscheduler.service"


def _os():
    if sys.platform.startswith(("win", "cygwin", "msys")):
        return "windows"
    if sys.platform == "darwin":
        return "macos"
    return "linux"


def autostart_status():
    os_kind = _os()
    try:
        if os_kind == "windows":
            r = subprocess.run(["schtasks", "/Query", "/TN", TASK_NAME],
                               capture_output=True, text=True, encoding="gbk", errors="replace", timeout=15)
            return {"registered": r.returncode == 0, "task": TASK_NAME, "os": os_kind}
        if os_kind == "macos":
            return {"registered": _launchd_path().exists(), "task": "com.linguaflow.wxscheduler", "os": os_kind}
        if _systemd_unit_path().exists():
            r = subprocess.run(["systemctl", "--user", "is-enabled", "linguaflow-wxscheduler.service"],
                               capture_output=True, text=True, timeout=15)
            return {"registered": r.returncode == 0, "task": "linguaflow-wxscheduler", "os": os_kind}
        return {"registered": False, "task": "linguaflow-wxscheduler", "os": os_kind}
    except (OSError, subprocess.TimeoutExpired):
        return {"registered": False, "task": TASK_NAME, "os": os_kind, "error": "自启状态查询不可用"}


def autostart_enable():
    """按 OS 注册登录自启：Windows 计划任务 / macOS launchd / Linux systemd --user。"""
    os_kind = _os()
    py = sys.executable or "python"
    if os_kind == "windows":
        vbs = _vbs_path()
        vbs.write_text(
            "' LinguaFlow 微信定时服务静默启动（开机自启用，勿手动删除）\r\n"
            "Set ws = CreateObject(\"Wscript.Shell\")\r\n"
            "ws.CurrentDirectory = \"%s\"\r\n"
            "ws.Run \"cmd /c \"\"%s\"\" server.py >> wx_scheduler.log 2>&1\", 0, False\r\n"
            % (str(HERE), py),
            encoding="gbk",
        )
        r = subprocess.run(
            ["schtasks", "/Create", "/F", "/TN", TASK_NAME, "/TR", 'wscript.exe "%s"' % str(vbs), "/SC", "ONLOGON"],
            capture_output=True, text=True, encoding="gbk", errors="replace", timeout=30)
        return (r.returncode == 0, None if r.returncode == 0 else (r.stderr or r.stdout or "").strip()[:200])
    if os_kind == "macos":
        _launchd_path().parent.mkdir(parents=True, exist_ok=True)
        _launchd_path().write_text(
            '<?xml version="1.0" encoding="UTF-8"?>\n'
            '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n'
            '<plist version="1.0"><dict>\n'
            '<key>Label</key><string>com.linguaflow.wxscheduler</string>\n'
            '<key>ProgramArguments</key><array>\n'
            '<string>%s</string><string>server.py</string>\n'
            '</array>\n'
            '<key>WorkingDirectory</key><string>%s</string>\n'
            '<key>RunAtLoad</key><true/>\n'
            '<key>StandardOutPath</key><string>%s/wx_scheduler.log</string>\n'
            '<key>StandardErrorPath</key><string>%s/wx_scheduler.log</string>\n'
            '</dict></plist>\n' % (py, str(HERE), str(HERE), str(HERE)),
            encoding="utf-8")
        r = subprocess.run(["launchctl", "load", str(_launchd_path())], capture_output=True, text=True, timeout=30)
        # 已加载时 launchctl 报错但视为成功
        if r.returncode != 0 and "already loaded" not in (r.stderr or "").lower():
            return False, (r.stderr or r.stdout or "").strip()[:200]
        return True, None
    # linux: systemd user unit
    _systemd_unit_path().parent.mkdir(parents=True, exist_ok=True)
    _systemd_unit_path().write_text(
        "[Unit]\nDescription=LinguaFlow WeChat Scheduler\nAfter=default.target\n\n"
        "[Service]\nType=simple\nWorkingDirectory=%s\nExecStart=%s server.py\n"
        "Restart=on-failure\nRestartSec=5\nStandardOutput=append:%s/wx_scheduler.log\n"
        "StandardError=append:%s/wx_scheduler.log\n\n"
        "[Install]\nWantedBy=default.target\n" % (str(HERE), py, str(HERE), str(HERE)),
        encoding="utf-8")
    subprocess.run(["systemctl", "--user", "daemon-reload"], capture_output=True, timeout=30)
    r = subprocess.run(["systemctl", "--user", "enable", "--now", "linguaflow-wxscheduler.service"],
                       capture_output=True, text=True, timeout=30)
    if r.returncode != 0:
        return False, (r.stderr or r.stdout or "").strip()[:200]
    return True, None


def autostart_disable():
    os_kind = _os()
    if os_kind == "windows":
        r = subprocess.run(["schtasks", "/Delete", "/F", "/TN", TASK_NAME],
                           capture_output=True, text=True, encoding="gbk", errors="replace", timeout=30)
    elif os_kind == "macos":
        r = subprocess.run(["launchctl", "unload", str(_launchd_path())], capture_output=True, text=True, timeout=30)
        if r.returncode == 0:
            try:
                _launchd_path().unlink()
            except OSError:
                pass
    else:
        r = subprocess.run(["systemctl", "--user", "disable", "--now", "linguaflow-wxscheduler.service"],
                           capture_output=True, text=True, timeout=30)
        if r.returncode == 0:
            try:
                _systemd_unit_path().unlink()
            except OSError:
                pass
    if r.returncode != 0:
        return False, (r.stderr or r.stdout or "").strip()[:200]
    return True, None

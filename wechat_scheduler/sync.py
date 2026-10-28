"""数据云同步：本地存储 + 同步文件夹镜像 / Git 私有仓库自动双推（v0.30.0）。

设计（与用户确认）：
  - 服务是唯一枢纽：浏览器各页面把 localStorage/chrome.storage 数据推给 /api/browser-data，
    服务与微信工具数据（tasks/history/summaries）合并成备份包，自动写入
    <drive_path>/LinguaFlow/。
  - 通道双模：<drive_path> 指向普通文件夹 = 网盘桌面客户端镜像（坚果云/OneDrive/iCloud 等）；
    指向 Git 仓库克隆目录 = 自动 commit + pull --rebase + push 到**全部**远端
    （Gitee/GitHub 双推互备；拉取线程每 5 分钟保鲜，冲突时本地新备份胜）。
  - Git 首次接入保护：本机从未同步过且仓库已有备份时，自动备份被阻止并提示
    先「从云端恢复」，防止新机器空/默认数据覆盖云端真实备份。
  - 自动备份（数据变化去抖 5s 触发）+ 手动恢复/导入；每日快照 backup-YYYY-MM-DD.json，
    latest.json 始终最新，保留最近 14 份；git 历史额外提供全量版本回溯。
  - 安全红线：备份包**永不**包含 API Key / 访问口令（translate_config.apiKey、
    config.apiKey、ws_api_token、hn_tavily_key 等），写入与读取两侧都强制剥离。

依赖仅标准库（git 模式需本机安装 git；凭据用各 OS 凭据缓存，服务侧命令禁交互）。
"""

import json
import os
import re
import socket
import subprocess
import sys
import threading
import time
from datetime import datetime
from pathlib import Path

HERE = Path(__file__).resolve().parent
SNAPSHOT_KEEP = 14          # 带日期快照保留份数
BACKUP_DEBOUNCE_SEC = 5.0
SUBDIR = "LinguaFlow"       # 同步目录下的子文件夹，避免污染同步根目录
GIT_PUSH_DEBOUNCE = 60.0    # git 推送去抖（秒），避免频繁编辑时每次备份都推送
GIT_PULL_INTERVAL = 300.0   # 后台拉取周期（秒），保持工作区跟随远端
GIT_TIMEOUT = 60            # 单条 git 命令超时（秒）
# git 模式首次接入保护提示（防新机器空数据自动覆盖云端已有备份）
GIT_JOIN_MSG = ("检测到 Git 仓库已有云端备份（本机首次接入）。请先「从云端恢复」；"
                "确认要用本机数据覆盖云端，请点「立即备份」。")

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
        self.settings = None  # dict: {drive_path, auto_backup, last_backup_*, git_auto, git_adopted,
        #                       git_join_mode, last_git_head, last_git_push_at, last_git_error}
        self.browser = None   # dict: 浏览器推送的全量键值（已脱密）
        self._lock = threading.Lock()
        self._timer = None
        self._git_lock = threading.Lock()
        self._git_timer = None
        self._load()
        threading.Thread(target=self._git_pull_loop, daemon=True).start()

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
        dp = self.settings.get("drive_path", "")
        return {
            "drive_path": dp,
            "auto_backup": bool(self.settings.get("auto_backup", True)),
            "last_backup_at": self.settings.get("last_backup_at", ""),
            "last_backup_error": self.settings.get("last_backup_error", ""),
            "git_repo": bool(dp) and os.path.isdir(os.path.join(dp, ".git")),
            "git_auto": bool(self.settings.get("git_auto", True)),
            "git_join_mode": bool(self.settings.get("git_join_mode")),
            "last_git_push_at": self.settings.get("last_git_push_at", ""),
            "last_git_error": self.settings.get("last_git_error", ""),
            "dir_name": SUBDIR,
        }

    def set_settings(self, patch):
        if "drive_path" in patch:
            p = str(patch["drive_path"] or "").strip()
            if p:
                expanded = os.path.expandvars(os.path.expanduser(p))
                if not os.path.isdir(expanded):
                    return False, "同步路径不存在或不是文件夹：%s" % p
                p = expanded
            self.settings["drive_path"] = p
        if "auto_backup" in patch:
            self.settings["auto_backup"] = bool(patch["auto_backup"])
        if "git_auto" in patch:
            self.settings["git_auto"] = bool(patch["git_auto"])
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
        """写同步文件夹（latest + 当日快照 + 清理）并触发 git 双推。返回 (ok, error)。

        force=True（手动「立即备份」/保存试写走 test 之外的显式覆盖）：立即推送 git
        并解除首次接入保护；自动路径受接入保护约束，git 推送去抖 60s。
        """
        root = self.drive_root()
        if not root:
            msg = "未配置同步文件夹路径"
            self.settings["last_backup_error"] = msg
            self._save_settings()
            return False, msg
        git_on = self._git_enabled()
        if force:
            if git_on:
                # 手动覆盖 = 采纳本机血缘：解除首次接入保护（仅 git 模式有意义）
                self.settings["git_join_mode"] = False
                self.settings["git_adopted"] = True
                self._save_settings()
        else:
            join_msg = self._git_join_check(root) if git_on else None
            if join_msg:
                self.settings["last_backup_error"] = join_msg
                self._save_settings()
                return False, join_msg
        try:
            os.makedirs(root, exist_ok=True)
            bundle = self.collect_bundle()
            text = json.dumps(bundle, ensure_ascii=False, indent=1)
            # newline="\n"：统一 LF，跨 Windows/macOS 无换行抖动
            with open(os.path.join(root, "latest.json"), "w", encoding="utf-8", newline="\n") as f:
                f.write(text)
            now = datetime.now()
            snap = os.path.join(root, "backup-%s.json" % now.strftime("%Y-%m-%d"))
            with open(snap, "w", encoding="utf-8", newline="\n") as f:
                f.write(text)
            self._prune(root)
            self.settings["last_backup_at"] = now.strftime("%Y-%m-%dT%H:%M:%S")
            self.settings["last_backup_error"] = ""
            self._save_settings()
            if git_on:
                if force:
                    self.git_sync()
                else:
                    self.schedule_git_push()
            return True, None
        except OSError as e:
            msg = "写入同步文件夹失败：%s" % e
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

    # ---------- Git 仓库自动同步（Gitee/GitHub 等任意远端，支持多远端双推） ----------
    def _git_enabled(self):
        if not self.settings.get("git_auto", True):
            return False
        dp = self.settings.get("drive_path") or ""
        return bool(dp) and os.path.isdir(os.path.join(dp, ".git"))

    def _git(self, *args):
        """在同步仓库目录执行 git；禁交互防挂起，认证依赖系统凭据缓存（GCM/钥匙串）。"""
        env = dict(os.environ, GIT_TERMINAL_PROMPT="0", GCM_INTERACTIVE="never")
        try:
            return subprocess.run(["git"] + list(args), cwd=self.settings.get("drive_path"),
                                  capture_output=True, text=True, encoding="utf-8",
                                  errors="replace", timeout=GIT_TIMEOUT, env=env)
        except (OSError, subprocess.TimeoutExpired) as e:
            return subprocess.CompletedProcess(args, 1, "", str(e))

    def _git_remotes(self):
        r = self._git("remote")
        names = [x for x in (r.stdout or "").split() if x]
        names.sort(key=lambda n: (n != "gitee", n))   # gitee 优先（国内网络更稳）
        return names

    def _git_join_check(self, root):
        """首次接入保护：本机从未同步过（无 adopted 标记）且云端已有备份时阻止自动覆盖。

        新机器加入同步（克隆了含 latest.json 的仓库）时，页面加载即推浏览器数据并触发
        自动备份，会把云端真实数据覆盖成本机空/默认数据；此处强制先「从云端恢复」，
        或手动「立即备份」显式确认覆盖。
        """
        if self.settings.get("git_join_mode"):
            return GIT_JOIN_MSG
        if self.settings.get("git_adopted"):
            return None
        latest = os.path.join(root, "latest.json")
        if not os.path.isfile(latest):
            return None
        try:
            with open(latest, "r", encoding="utf-8") as f:
                remote_at = str((json.load(f) or {}).get("exported_at") or "")
        except (OSError, ValueError):
            return None
        local_at = str(self.settings.get("last_backup_at") or "")
        if local_at and remote_at <= local_at:
            return None   # 云端不比本机新（多半是本机刚写的），照常
        self.settings["git_join_mode"] = True
        self._save_settings()
        return GIT_JOIN_MSG

    def git_sync(self):
        """提交本地变更 → 拉取远端（rebase，冲突本地新备份胜）→ 推送到全部远端。

        全程 best-effort：任一步失败记录错误并继续；返回 (ok, err)。
        """
        if not self._git_enabled():
            return False, ""
        errs = []
        with self._git_lock:
            ga = os.path.join(self.settings["drive_path"], ".gitattributes")
            if not os.path.exists(ga):
                try:
                    with open(ga, "w", encoding="utf-8", newline="\n") as f:
                        f.write("* -text\n")
                except OSError:
                    pass
            self._git("add", "-A")
            self._git("-c", "user.name=LinguaFlow", "-c", "user.email=sync@linguaflow.local",
                      "commit", "-m", "backup %s @ %s" % (datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
                                                          socket.gethostname()))   # 无变更时非零，忽略
            branch = (self._git("rev-parse", "--abbrev-ref", "HEAD").stdout or "").strip()
            remotes = self._git_remotes()
            for rm in remotes:   # 拉取：取第一个成功远端即可
                args = ["pull", "--rebase", "-X", "theirs", rm] + ([branch] if branch else [])
                r = self._git(*args)
                if r.returncode == 0:
                    break
                self._git("rebase", "--abort")   # 清理可能残留的 rebase（无则报错忽略）
            pushed = 0
            for rm in remotes:   # 双推/多推：逐个远端推送，单独记录失败
                r = self._git("push", rm, "HEAD")
                if r.returncode == 0:
                    pushed += 1
                else:
                    out = (r.stderr or r.stdout or "").strip()
                    errs.append("%s：%s" % (rm, (out.splitlines() or ["失败"])[-1][:120]))
            head = self._git("rev-parse", "HEAD")
            changed = False
            if head.returncode == 0:
                hid = head.stdout.strip()
                if self.settings.get("last_git_head") != hid:
                    self.settings["last_git_head"] = hid
                    changed = True
                if not self.settings.get("git_adopted"):
                    self.settings["git_adopted"] = True
                    changed = True
            if pushed:
                self.settings["last_git_push_at"] = datetime.now().strftime("%Y-%m-%dT%H:%M:%S")
                changed = True
            new_err = "；".join(errs)
            if self.settings.get("last_git_error", "") != new_err:
                self.settings["last_git_error"] = new_err
                changed = True
            if changed:
                self._save_settings()
        return (pushed > 0 or not remotes), new_err

    def schedule_git_push(self):
        """备份写盘成功后去抖触发 git 推送。

        已有待发定时器时**不重置**（从首个待发变更起 60s 内必推一次）——
        页面心跳每 60s 触发一次备份，若每次都重置定时器会永远到不了点。
        """
        if not self._git_enabled():
            return
        with self._git_lock:
            if self._git_timer is not None:
                return
            self._git_timer = threading.Timer(GIT_PUSH_DEBOUNCE, self._timed_git)
            self._git_timer.daemon = True
            self._git_timer.start()

    def _timed_git(self):
        with self._git_lock:
            self._git_timer = None
        try:
            ok, err = self.git_sync()
            print("[wx-schedule] git 同步%s：%s" % ("完成" if ok else "异常", err or self.settings.get("drive_path", "")), flush=True)
        except Exception as e:
            print("[wx-schedule] git 同步异常：%s" % e, flush=True)

    def _git_pull_loop(self):
        """后台拉取线程：让本机工作区跟随远端（另一台机器的备份）。"""
        time.sleep(3.0)   # 等服务其余部分就绪
        while True:
            try:
                if self._git_enabled():
                    ok, err = self.git_sync()
                    if err:
                        print("[wx-schedule] git 拉取问题：%s" % err, flush=True)
            except Exception as e:
                print("[wx-schedule] git 拉取异常：%s" % e, flush=True)
            time.sleep(GIT_PULL_INTERVAL)

    def remote_info(self):
        """云端备份时间概要，供「云端有更新」提示（通道无关：git 模式由拉取线程保鲜，
        网盘模式靠桌面客户端同步，两种模式共用同一判断）。"""
        out = {"remote_at": "", "remote_newer": False}
        root = self.drive_root()
        if not root:
            return out
        try:
            with open(os.path.join(root, "latest.json"), "r", encoding="utf-8") as f:
                data = json.load(f)
        except (OSError, ValueError):
            return out
        remote_at = str((data or {}).get("exported_at") or "")
        out["remote_at"] = remote_at
        local_at = str(self.settings.get("last_backup_at") or "")
        out["remote_newer"] = bool(remote_at) and remote_at > local_at
        return out

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
            raise ValueError("未配置同步文件夹路径")
        if not _SNAP_RE.match(name) and name != "latest.json":
            raise ValueError("非法文件名")
        if self._git_enabled():
            self.git_sync()   # 恢复/下载前先同步远端，保证拿到另一台机器的最新备份
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
        if self._git_enabled() and (self.settings.get("git_join_mode") or not self.settings.get("git_adopted")):
            # 恢复 = 采纳云端/文件血缘：解除首次接入保护（仅 git 模式有意义）
            self.settings["git_join_mode"] = False
            self.settings["git_adopted"] = True
            self._save_settings()
        return strip_secrets(self.browser)


# ---------- 开机自启（A 方案） ----------
TASK_NAME = "LinguaFlowWxScheduler"


def list_dirs(path=""):
    """列目录（供管理页内嵌目录浏览器；原生对话框在部分会话环境不可见，故改为页面内选择）。

    path 为空：Windows 返回盘符根列表，POSIX（macOS/Linux）返回用户主目录内容。
    仅目录名，不读文件内容。
    """
    import string
    if not path:
        if os.name != "nt":
            home = str(Path.home())
            try:
                dirs = [n for n in sorted(os.listdir(home))
                        if os.path.isdir(os.path.join(home, n)) and not n.startswith(("$", "."))]
            except OSError:
                dirs = []
            return {"path": home, "parent": os.path.dirname(home) or "/", "dirs": dirs}
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

"""微信发送通道：psauto（默认，零依赖）/ wechatauto（可选）/ mock。

统一协议：
  status() -> {"connected","mock","sender","error"}
  contacts() -> [{"wxid","name","group"}]（失败抛 RuntimeError，页面降级手填）
  send(task, content) -> (ok, error|None)   task 含 receiver/files/options

psauto：系统 PowerShell + UIAutomation/键盘驱动（scripts/WeChatAuto.ps1，移植自
  真机打磨过的 wxtimer 项目）。不注入、不 hook、不装任何 pip 包；带哨兵式剪贴板
  回读校验、前台断言、锁屏/登录窗识别、首次发送倒计时等防护，退出码含义见 ps_driver.CODE_TEXT。
  按「会话名称」搜索定位——微信 4.x 无法核对会话标题，务必给定时对象设唯一前缀备注名。
wechatauto：wechatauto-replica（pip 安装，可选）。额外价值是能读微信本地库提供
  真实联系人列表（/api/contacts 的数据源），发送按名称/DB 校验。
"""

import shutil
import threading
import time

from pathlib import Path

import ps_driver

SEND_MIN_INTERVAL = 1.0      # 两次发送最小间隔（秒），防微信风控
CONTACTS_TTL = 300           # 联系人列表缓存（秒）
_PS_SCRIPT = Path(__file__).resolve().parent / "scripts" / "WeChatAuto.ps1"


class MockSender:
    """--mock 模式：不依赖微信，发送恒成功并打印。"""

    mock = True

    def __init__(self):
        self.sent = []

    def status(self):
        return {"connected": True, "mock": True, "sender": "mock", "error": None}

    def contacts(self):
        return [
            {"wxid": "filehelper", "name": "文件传输助手", "group": False},
            {"wxid": "wxid_mock_friend_01", "name": "测试好友", "group": False},
            {"wxid": "12345678@chatroom", "name": "测试群聊", "group": True},
        ]

    def send(self, task, content):
        who = task["receiver"].get("name") or task["receiver"].get("wxid")
        self.sent.append((time.time(), who, content, task.get("files") or []))
        print("[wx-schedule] MOCK send -> %s: %s (files=%d)" % (
            who, content.replace("\n", "\\n"), len(task.get("files") or [])), flush=True)
        return True, None


class PsAutoSender:
    """默认通道：PowerShell UIA/键盘驱动（零 pip 依赖，真机验证过的安全层）。"""

    mock = False

    def __init__(self):
        self._send_lock = threading.Lock()
        self._last_send = 0.0

    def status(self):
        err = None
        if not _PS_SCRIPT.exists():
            err = "缺少驱动脚本 scripts/WeChatAuto.ps1"
        elif not (shutil.which("powershell.exe") or shutil.which("powershell")):
            err = "未找到 powershell.exe（系统组件，异常环境？）"
        return {"connected": err is None, "mock": False, "sender": "psauto", "error": err}

    def contacts(self):
        # psauto 不读微信库；装了 wechatauto-replica 时借它提供联系人搜索下拉
        try:
            from wechatauto import WeChatDB
        except ImportError:
            raise RuntimeError("未装 wechatauto-replica，无法拉取联系人列表——可直接填写会话名称（建议唯一前缀备注名）")
        db = WeChatDB()
        out = []
        for s in db.get_sessions(limit=200):
            wxid = str(s.get("username") or "")
            if not wxid:
                continue
            try:
                name = db.get_nickname(wxid) or wxid
            except Exception:
                name = wxid
            out.append({"wxid": wxid, "name": name, "group": wxid.endswith("@chatroom")})
        out.sort(key=lambda x: (x["group"], x["name"]))
        return out

    def doctor(self, options=None):
        return ps_driver.doctor(options)

    def probe(self, target, options=None):
        return ps_driver.probe(target=target, options=options)

    def send(self, task, content):
        with self._send_lock:
            wait = SEND_MIN_INTERVAL - (time.time() - self._last_send)
            if wait > 0:
                time.sleep(wait)
            receiver = task["receiver"]
            target = (receiver.get("name") or "").strip() or receiver.get("wxid") or ""
            options = dict(task.get("options") or {})
            # 首次真实发送要求 8 秒倒计时人工确认（sent_count 由服务端在成功发送时累加）
            options.setdefault("confirm_first_send", True)
            if int(task.get("sent_count") or 0) > 0:
                options["confirm_first_send"] = False
            res = ps_driver.send(target, content, list(task.get("files") or []), options)
            self._last_send = time.time()
            if res.ok:
                return True, None
            return False, "code=%s %s%s" % (res.code, res.code_text, ("｜" + res.error) if res.error else "")


class WechatAutoSender:
    """可选通道：wechatauto-replica（UIA 热激活 + OCR 回退 + 本地 DB 读联系人）。"""

    mock = False

    def __init__(self):
        self._send_lock = threading.Lock()
        self._last_send = 0.0
        self._contacts_cache = None
        self._contacts_at = 0.0
        self._error = None
        try:
            import wechatauto.guia  # noqa: F401
        except ImportError:
            self._error = "未安装 wechatauto-replica（pip install wechatauto-replica winsdk pypinyin）"
        except Exception as e:
            self._error = str(e)

    def status(self):
        return {"connected": self._error is None, "mock": False, "sender": "wechatauto", "error": self._error}

    def contacts(self):
        if self._error:
            raise RuntimeError(self._error)
        if self._contacts_cache and time.time() - self._contacts_at < CONTACTS_TTL:
            return self._contacts_cache
        from wechatauto import WeChatDB
        try:
            db = WeChatDB()
            sessions = db.get_sessions(limit=200)
        except Exception as e:
            raise RuntimeError("读取会话列表失败（确认微信 4.x 已登录）：%s" % e)
        out = []
        for s in sessions:
            wxid = str(s.get("username") or "")
            if not wxid:
                continue
            try:
                name = db.get_nickname(wxid) or wxid
            except Exception:
                name = wxid
            out.append({"wxid": wxid, "name": name, "group": wxid.endswith("@chatroom")})
        out.sort(key=lambda x: (x["group"], x["name"]))
        self._contacts_cache = out
        self._contacts_at = time.time()
        return out

    def send(self, task, content):
        if self._error:
            return False, self._error
        with self._send_lock:
            wait = SEND_MIN_INTERVAL - (time.time() - self._last_send)
            if wait > 0:
                time.sleep(wait)
            try:
                from wechatauto.guia import quick_send
                receiver = task["receiver"]
                who = (receiver.get("name") or "").strip() or receiver.get("wxid")
                resp = quick_send(content, who)
                self._last_send = time.time()
                if resp.is_success:
                    return True, None
                return False, str(resp.get("message") or "wechatauto 发送失败")
            except Exception as e:
                self._last_send = time.time()
                return False, str(e)


def default_sender():
    """按操作系统选默认通道：Windows=psauto（已验证）；macOS=macauto / Linux=linuxauto（实验性）。"""
    import sys
    if sys.platform == "darwin":
        return "macauto"
    if sys.platform.startswith("linux"):
        return "linuxauto"
    return "psauto"


def create_sender(name):
    """name: 'psauto' | 'macauto' | 'linuxauto' | 'wechatauto' | 'mock'"""
    if name == "mock":
        return MockSender()
    if name == "wechatauto":
        return WechatAutoSender()
    if name == "macauto":
        from mac_sender import MacAutoSender
        return MacAutoSender()
    if name == "linuxauto":
        from linux_sender import LinuxAutoSender
        return LinuxAutoSender()
    return PsAutoSender()

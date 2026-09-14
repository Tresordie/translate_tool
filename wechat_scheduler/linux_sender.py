"""Linux 微信发送驱动（xdotool，实验性——需在真实 Linux 桌面验证）。

协议与 PsAutoSender 一致：status() / send(task, content)。
原理：xdotool 按窗口类找微信 → 激活 → Ctrl+F 搜索 → 输入会话名 → 回车 →
输入消息 → 回车。文本输入用 xdotool type（自带 Unicode 支持，不依赖剪贴板）。

前置条件：
  1. 官方 Linux 微信客户端（4.x）已安装并登录；
  2. 安装 xdotool（apt install xdotool / pacman -S xdotool）；
  3. 会话类型：X11 或 XWayland 下可用；**纯 Wayland 原生窗口 xdotool 无法注入**
     （需换 ydotool/uinput 方案，未内置）。

⚠️ 微信 4.x 界面自绘，无法核对会话标题——务必用唯一前缀备注名。
"""

import shutil
import subprocess
import threading
import time

SEND_MIN_INTERVAL = 1.0
# 官方 Linux 微信的窗口类/名候选（不同发行版打包有差异，按实测调整）
WINDOW_PATTERNS = ("wechat", "weixin", "WxWorkLauncher")


def _x(args, timeout=20):
    return subprocess.run(["xdotool"] + args, capture_output=True, text=True, timeout=timeout)


class LinuxAutoSender:
    mock = False

    def __init__(self):
        self._send_lock = threading.Lock()
        self._last_send = 0.0

    def status(self):
        err = None
        if not shutil.which("xdotool"):
            err = "未安装 xdotool（apt install xdotool）或非 Linux 桌面环境"
        return {"connected": err is None, "mock": False, "sender": "linuxauto", "error": err}

    def contacts(self):
        raise RuntimeError("Linux 暂无微信本地库读取方案，无法拉取联系人列表——请直接输入会话名称（建议唯一前缀备注名）")

    def _find_window(self):
        for pat in WINDOW_PATTERNS:
            r = _x(["search", "--class", pat])
            ids = [i for i in (r.stdout or "").split() if i.isdigit()]
            if ids:
                return ids[-1]
        return None

    def send(self, task, content):
        with self._send_lock:
            wait = SEND_MIN_INTERVAL - (time.time() - self._last_send)
            if wait > 0:
                time.sleep(wait)
            try:
                return self._send_once(task, content)
            except Exception as e:
                self._last_send = time.time()
                return False, str(e)

    def _send_once(self, task, content):
        receiver = task["receiver"]
        target = (receiver.get("name") or "").strip() or receiver.get("wxid") or ""
        if not target:
            return False, "接收人名称为空"
        win = self._find_window()
        if not win:
            return False, "未找到微信窗口（确认官方 Linux 微信已登录；Wayland 原生窗口需 xdotool 不可用，见 USAGE）"
        _x(["windowactivate", "--sync", win])
        time.sleep(0.6)
        _x(["key", "--window", win, "ctrl+f"])
        time.sleep(0.5)
        _x(["type", "--delay", "30", target])
        time.sleep(1.2)
        _x(["key", "--window", win, "Return"])
        time.sleep(1.0)
        _x(["type", "--delay", "20", content])
        time.sleep(0.3)
        _x(["key", "--window", win, "Return"])
        self._last_send = time.time()
        return True, None

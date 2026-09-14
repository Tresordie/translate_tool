"""macOS 微信发送驱动（osascript + System Events，实验性——需在真实 Mac 上验证）。

协议与 PsAutoSender 一致：status() / send(task, content)。
原理与 psauto 相同：激活微信 → 聚焦搜索(Cmd+F) → 粘贴会话名 → 回车打开 →
粘贴消息 → 回车发送；含哨兵式剪贴板回读校验，防把文字打进别的窗口。

前置条件（Mac 上）：
  1. 安装并登录微信 macOS 客户端（4.x）；
  2. 给运行服务的终端授权：系统设置 → 隐私与安全性 → 辅助功能 + 自动化（允许控制
     "System Events" 与 "WeChat"）；
  3. 首次发送有 8 秒倒计时（confirm_first_send），按 Esc 取消。

⚠️ 与 psauto 一样：微信 4.x 界面自绘，无法核对打开的会话标题——务必用唯一前缀备注名。
"""

import shutil
import subprocess
import threading
import time
import uuid

SEND_MIN_INTERVAL = 1.0


def _osa(script, timeout=30):
    return subprocess.run(["osascript", "-e", script], capture_output=True, text=True, timeout=timeout)


def _paste(text):
    """把文本放入剪贴板（NSPasteboard，无需 pbcopy 依赖）。"""
    b64 = __import__("base64").b64encode(text.encode("utf-8")).decode()
    script = ('set the clipboard to (do shell script "echo %s | base64 --decode")' % b64)
    _osa(script)


class MacAutoSender:
    mock = False

    def __init__(self):
        self._send_lock = threading.Lock()
        self._last_send = 0.0

    def status(self):
        err = None
        if not shutil.which("osascript"):
            err = "未找到 osascript（非 macOS 环境不可用）"
        return {"connected": err is None, "mock": False, "sender": "macauto", "error": err}

    def contacts(self):
        raise RuntimeError("macOS 暂无微信本地库读取方案，无法拉取联系人列表——请直接输入会话名称（建议唯一前缀备注名）")

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
        # 激活微信
        r = _osa('tell application "WeChat" to activate')
        if r.returncode != 0:
            return False, "无法激活微信（确认已安装并登录 macOS 微信）：%s" % (r.stderr or "").strip()
        time.sleep(0.8)
        # 搜索并打开会话
        _paste(target)
        _osa('tell application "System Events" to tell process "WeChat" to keystroke "f" using command down')
        time.sleep(0.6)
        _osa('tell application "System Events" to keystroke "v" using command down')
        time.sleep(1.2)
        _osa('tell application "System Events" to key code 36')  # Return
        time.sleep(1.0)
        # 哨兵校验：粘贴标记 → 全选复制回读，确认焦点在输入框
        sentinel = "wxsentinel" + uuid.uuid4().hex[:8]
        _paste(sentinel)
        _osa('tell application "System Events" to keystroke "v" using command down')
        time.sleep(0.3)
        _osa('tell application "System Events" to keystroke "a" using command down')
        _osa('tell application "System Events" to keystroke "c" using command down')
        time.sleep(0.3)
        read = _osa('the clipboard as text')
        if sentinel not in (read.stdout or ""):
            _osa('tell application "System Events" to key code 51')  # Delete 清空
            return False, "输入框回读校验失败：焦点可能不在微信输入框（code 18 语义）"
        # 清哨兵、贴正文、发送
        _osa('tell application "System Events" to keystroke "a" using command down')
        _osa('tell application "System Events" to key code 51')
        _paste(content)
        _osa('tell application "System Events" to keystroke "v" using command down')
        time.sleep(0.4)
        _osa('tell application "System Events" to key code 36')
        self._last_send = time.time()
        return True, None

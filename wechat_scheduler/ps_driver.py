"""调用 scripts/WeChatAuto.ps1（Windows UIAutomation + 键盘驱动）——移植自 wxtimer。

Python 与 PowerShell 之间用 UTF-8 JSON 作业文件通信，命令行不传任何文本，
绕开中文/多行/引号的所有编码坑。PS 驱动退出码与含义见 CODE_TEXT。

零第三方依赖：只用系统自带的 powershell.exe（Windows PowerShell 5.1，
UIAutomation/WinForms 程序集齐全）+ Python 标准库。
"""

import json
import os
import subprocess
from pathlib import Path

HERE = Path(__file__).resolve().parent
PS_DRIVER = HERE / "scripts" / "WeChatAuto.ps1"
TMP_DIR = HERE / "data" / "tmp"

#: PowerShell 驱动返回 code 含义（与 scripts/WeChatAuto.ps1 约定一致）
CODE_TEXT = {
    0: "成功",
    10: "未找到微信主窗口：请确认 PC 微信已启动并已登录",
    11: "屏幕已锁定/处于登录界面：锁屏时 Windows 不接受任何键盘输入，无法发送",
    12: "PowerShell 受限语言模式或缺少 UIAutomation/WindowsForms 程序集，无法操作微信界面",
    13: "搜索框没有接收到文本：聚焦方式不对（微信 4.x 需校准 options.search_click_ax/ay），或快捷键被改过",
    14: "打开的会话标题与配置目标不一致，已中止发送（仅微信 3.9 的 uia 模式能做此校验）",
    15: "你在确认倒计时中按了 Esc，本次取消",
    16: "发送过程出现异常，详见日志",
    17: "微信窗口无法切到前台（可能被其他程序抢占焦点）",
    18: "输入框回读校验失败：粘贴的内容没落在消息输入框里，已中止且未发送",
    19: "微信停在登录界面：请先在电脑上扫码/确认登录，再重跑",
    -1: "缺少驱动脚本 scripts/WeChatAuto.ps1",
}


class PsResult:
    __slots__ = ("ok", "code", "error", "detail", "data", "stdout")

    def __init__(self, ok, code, error="", detail="", data=None, stdout=""):
        self.ok = ok
        self.code = code
        self.error = error
        self.detail = detail
        self.data = data or {}
        self.stdout = stdout

    @property
    def code_text(self):
        return CODE_TEXT.get(self.code, self.error or "code=%s" % self.code)

    @property
    def inner(self):
        d = self.data.get("data") if isinstance(self.data, dict) else None
        return d if isinstance(d, dict) else {}

    @property
    def mode(self):
        return str(self.inner.get("mode") or "")


def _pwsh():
    # 固定用系统 Windows PowerShell 5.1：UIAutomation/WinForms 程序集齐全
    return ["powershell.exe", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass",
            "-STA", "-File", str(PS_DRIVER)]


def run_driver(command, target="", message="", files=None, options=None, timeout=180):
    """执行一次驱动命令：doctor | probe | send | shot。"""
    if not PS_DRIVER.exists():
        return PsResult(False, -1, error="缺少驱动脚本 %s" % PS_DRIVER)

    job = {"command": command, "target": target, "message": message,
           "files": files or [], "options": options or {}}

    TMP_DIR.mkdir(parents=True, exist_ok=True)
    tag = os.getpid()
    job_file = TMP_DIR / ("job-%d.json" % tag)
    out_file = TMP_DIR / ("result-%d.json" % tag)
    job_file.write_text(json.dumps(job, ensure_ascii=False, indent=2), encoding="utf-8")
    try:
        out_file.unlink()
    except OSError:
        pass

    argv = _pwsh() + ["-JobFile", str(job_file), "-OutFile", str(out_file)]
    try:
        proc = subprocess.run(argv, capture_output=True, text=True, encoding="utf-8",
                              errors="replace", timeout=timeout, cwd=str(HERE))
    except subprocess.TimeoutExpired:
        _rm(job_file, out_file)
        return PsResult(False, 16, error="驱动超时（>%ss）：检查微信是否弹了需要点击的对话框" % timeout)
    except OSError as exc:
        _rm(job_file, out_file)
        return PsResult(False, 12, error="无法启动 powershell.exe：%s" % exc)

    stdout = (proc.stdout or "") + (("\n" + proc.stderr) if proc.stderr else "")
    if not out_file.exists():
        tail = "\n".join(stdout.strip().splitlines()[-8:])
        _rm(job_file, out_file)
        return PsResult(False, int(proc.returncode or 16),
                        error="驱动未写出结果文件（PowerShell 退出码 %s）。输出末尾：\n%s" % (proc.returncode, tail),
                        stdout=stdout)
    try:
        payload = json.loads(out_file.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, UnicodeDecodeError) as exc:
        _rm(job_file, out_file)
        return PsResult(False, 16, error="驱动输出无法解析：%s" % exc, stdout=stdout)

    _rm(job_file, out_file)
    return PsResult(
        ok=bool(payload.get("ok", proc.returncode == 0)),
        code=int(payload.get("code", proc.returncode or 16)),
        error=str(payload.get("error") or ""),
        detail=str(payload.get("detail") or ""),
        data=payload,
        stdout=stdout,
    )


def _rm(*paths):
    for f in paths:
        try:
            f.unlink()
        except OSError:
            pass


def doctor(options=None):
    return run_driver("doctor", options=options or {})


def probe(target="", options=None):
    return run_driver("probe", target=target, options=options or {})


def send(target, message, files, options):
    return run_driver("send", target=target, message=message, files=files, options=options)

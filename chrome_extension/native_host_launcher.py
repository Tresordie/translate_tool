#!/usr/bin/env python3
"""LinguaFlow Native Messaging Host — 一键拉起微信定时服务（Windows）。

Chrome 扩展经 nativeMessaging 调用本宿主：检查 8765 是否已在监听；
未监听则以完全脱离会话的方式静默启动 wechat_scheduler/server.py。
协议：4 字节小端长度前缀 + JSON（与 native_host.py 一致）。
"""

import json
import os
import socket
import struct
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
SCHED_DIR = os.path.abspath(os.path.join(HERE, "..", "wechat_scheduler"))
PORT = 8765


def read_message():
    raw_len = sys.stdin.buffer.read(4)
    if not raw_len or len(raw_len) < 4:
        return None
    msg_len = struct.unpack("<I", raw_len)[0]
    raw = sys.stdin.buffer.read(msg_len)
    try:
        return json.loads(raw.decode("utf-8"))
    except ValueError:
        return None


def send_message(msg):
    data = json.dumps(msg, ensure_ascii=False).encode("utf-8")
    sys.stdout.buffer.write(struct.pack("<I", len(data)))
    sys.stdout.buffer.write(data)
    sys.stdout.buffer.flush()


def port_open():
    try:
        s = socket.create_connection(("127.0.0.1", PORT), timeout=1.0)
        s.close()
        return True
    except OSError:
        return False


def start_scheduler():
    log = open(os.path.join(SCHED_DIR, "wx_scheduler.log"), "a", encoding="utf-8", errors="replace")
    log.write("---- native host 拉起服务 %s ----\n" % subprocess.list2cmdline([sys.executable, "server.py"]))
    log.flush()
    flags = 0x00000008 | 0x00000200  # DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP
    proc = subprocess.Popen(
        [sys.executable, "server.py"], cwd=SCHED_DIR,
        stdout=log, stderr=log, stdin=subprocess.DEVNULL,
        creationflags=flags, close_fds=True,
    )
    return proc.pid


def main():
    msg = read_message() or {}
    if msg.get("action") != "start-scheduler":
        send_message({"ok": False, "error": "unknown action"})
        return
    if port_open():
        send_message({"ok": True, "already_running": True})
        return
    try:
        pid = start_scheduler()
    except OSError as e:
        send_message({"ok": False, "error": str(e)})
        return
    # 等待端口就绪（最长 8s）
    import time
    for _ in range(16):
        time.sleep(0.5)
        if port_open():
            send_message({"ok": True, "pid": pid})
            return
    send_message({"ok": False, "error": "已启动进程 %s 但端口 %d 未就绪，请查看 wx_scheduler.log" % (pid, PORT)})


if __name__ == "__main__":
    main()

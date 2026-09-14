#!/usr/bin/env bash
# =====================================================================
#  LinguaFlow 微信定时消息服务 · 启动脚本（macOS / Linux）
#  自动定位 python3 → 端口检查 → 启动（日志落 wx_scheduler.log）
#  用法：./start_wx_scheduler.sh [--port 8765] [--token abc]
#  首次：chmod +x start_wx_scheduler.sh
# =====================================================================
set -e
cd "$(dirname "$0")"

PY=""
for c in python3 python; do
  if command -v "$c" >/dev/null 2>&1 && "$c" -c "import sys" >/dev/null 2>&1; then PY="$c"; break; fi
done
if [ -z "$PY" ]; then
  echo "[错误] 未找到 python3。macOS: brew install python3；Linux: apt/pacman 安装 python3"
  exit 1
fi
echo "[1/2] Python: $("$PY" --version 2>&1)"

PORT=8765
case " $* " in *" --port "*) PORT=$(echo " $* " | sed 's/.*--port \([0-9]*\).*/\1/') ;; esac
if command -v ss >/dev/null 2>&1 && ss -ltn 2>/dev/null | grep -q ":$PORT "; then
  echo "[提示] 端口 $PORT 已被占用——服务可能已在运行，直接打开 http://127.0.0.1:$PORT/ 即可"
  exit 1
fi
echo "[2/2] 启动服务（Ctrl+C 停止）... 管理页 http://127.0.0.1:$PORT/wechat_schedule.html"
echo "---- $(date '+%F %T') 服务启动 $* ----" >> wx_scheduler.log
exec "$PY" server.py "$@" >> wx_scheduler.log 2>&1

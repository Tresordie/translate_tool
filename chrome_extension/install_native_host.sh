#!/bin/bash
# ============================================================
# LinguaFlow — Install Native Messaging Host for Apple Reminders
# ============================================================
# This script registers the native host so Chrome can execute
# AppleScript directly from the extension (one-click import).
#
# Usage:
#   chmod +x install_native_host.sh
#   ./install_native_host.sh [extension_id]
#
# If extension_id is not provided, you'll be prompted to enter it
# (find it at chrome://extensions after loading the unpacked extension).
# ============================================================

set -e

NATIVE_HOST_NAME="com.linguflow.reminders"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
NATIVE_HOST_PY="$SCRIPT_DIR/native_host.py"
MANIFEST_TEMPLATE="$SCRIPT_DIR/native_host_manifest.json"
MANIFEST_DIR="$HOME/Library/Application Support/Google/Chrome/NativeMessagingHosts"
MANIFEST_FILE="$MANIFEST_DIR/$NATIVE_HOST_NAME.json"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo -e "${GREEN}============================================${NC}"
echo -e "${GREEN}  LinguaFlow Native Host Installer${NC}"
echo -e "${GREEN}============================================${NC}"
echo ""

# Get extension ID
EXT_ID="$1"
if [ -z "$EXT_ID" ]; then
  echo -e "${YELLOW}请输入 Chrome 扩展 ID（在 chrome://extensions 中查看）:${NC}"
  read -r EXT_ID
fi

if [ -z "$EXT_ID" ]; then
  echo -e "${RED}错误: 未提供扩展 ID${NC}"
  exit 1
fi

# Validate native_host.py exists
if [ ! -f "$NATIVE_HOST_PY" ]; then
  echo -e "${RED}错误: 找不到 $NATIVE_HOST_PY${NC}"
  exit 1
fi

# Make native_host.py executable
chmod +x "$NATIVE_HOST_PY"

# Find python3 path
PYTHON_PATH=$(which python3 2>/dev/null || echo "/usr/bin/python3")
echo -e "Python3 路径: ${GREEN}$PYTHON_PATH${NC}"
echo -e "扩展 ID:     ${GREEN}$EXT_ID${NC}"
echo ""

# Create manifest directory
mkdir -p "$MANIFEST_DIR"

# Generate manifest from template
cat "$MANIFEST_TEMPLATE" \
  | sed "s|NATIVE_HOST_PYTHON_PATH|$PYTHON_PATH|" \
  | sed "s|EXTENSION_ID_PLACEHOLDER|$EXT_ID|" \
  > "$MANIFEST_FILE"

echo -e "${GREEN}✓ 已安装 manifest:${NC}"
echo -e "  $MANIFEST_FILE"
echo ""

# Verify python3 can run the script
if $PYTHON_PATH -c "import json, struct, subprocess, sys; print('ok')" 2>/dev/null; then
  echo -e "${GREEN}✓ Python3 环境检查通过${NC}"
else
  echo -e "${RED}✗ Python3 环境异常，请检查${NC}"
  exit 1
fi

echo ""
echo -e "${GREEN}============================================${NC}"
echo -e "${GREEN}  安装完成！${NC}"
echo -e "${GREEN}============================================${NC}"
echo ""
echo -e "下一步："
echo -e "  1. 在 Chrome 中打开 ${YELLOW}chrome://extensions${NC}"
echo -e "  2. 找到 LinguaFlow 扩展，点击「重新加载」🔄"
echo -e "  3. 打开任务清单页面，点击 🍎 提醒 即可一键导入"
echo ""

#!/bin/bash
# ============================================================
# LinguaFlow Reminders Bridge — macOS URL Scheme Handler
# ============================================================
# When installed, this app handles linguaflow-reminders:// URLs.
# The web page opens a URL with base64-encoded AppleScript,
# and this app decodes + runs it via osascript.
#
# Install:  chmod +x install.sh && ./install.sh
# Uninstall: rm -rf ~/Applications/LinguaFlowReminders.app
# ============================================================

set -e

APP_NAME="LinguaFlowReminders"
APP_DIR="$HOME/Applications/$APP_NAME.app"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
INSTALL_DIR="$HOME/Applications"

mkdir -p "$INSTALL_DIR"

echo "🔧 Building $APP_NAME.app ..."

# Remove old version if exists
rm -rf "$APP_DIR"

# Create app bundle structure
mkdir -p "$APP_DIR/Contents/MacOS"

# ====== Executable ======
cat > "$APP_DIR/Contents/MacOS/$APP_NAME" << 'EXEC'
#!/bin/bash
# LinguaFlow Reminders Bridge
# Handles linguaflow-reminders://run?script=<base64>

URL="$1"
# Extract the base64-encoded script from the URL
SCRIPT_B64=$(echo "$URL" | sed -n 's/.*linguaflow-reminders:\/\/run?script=\([^&]*\).*/\1/p' | sed 's/%2B/+/g; s/%2F/\//g; s/%3D/=/g')

if [ -z "$SCRIPT_B64" ]; then
  osascript -e 'display notification "No script data received" with title "LinguaFlow"'
  exit 1
fi

# Decode and run via osascript
APPLESCRIPT=$(echo "$SCRIPT_B64" | base64 -d 2>/dev/null)
if [ -z "$APPLESCRIPT" ]; then
  osascript -e 'display notification "Failed to decode script" with title "LinguaFlow"'
  exit 1
fi

# Run the AppleScript
RESULT=$(osascript -e "$APPLESCRIPT" 2>&1)
EXIT_CODE=$?

if [ $EXIT_CODE -eq 0 ]; then
  # Count reminders created
  COUNT=$(echo "$APPLESCRIPT" | grep -c 'make new reminder')
  osascript -e "display notification \"已导入 ${COUNT} 条提醒事项\" with title \"LinguaFlow ✅\""
else
  osascript -e "display notification \"导入失败: ${RESULT}\" with title \"LinguaFlow ❌\""
fi
EXEC

chmod +x "$APP_DIR/Contents/MacOS/$APP_NAME"

# ====== Info.plist ======
cat > "$APP_DIR/Contents/Info.plist" << 'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>CFBundleExecutable</key>
    <string>LinguaFlowReminders</string>
    <key>CFBundleIdentifier</key>
    <string>com.linguflow.reminders-bridge</string>
    <key>CFBundleName</key>
    <string>LinguaFlow Reminders Bridge</string>
    <key>CFBundleVersion</key>
    <string>1.0</string>
    <key>CFBundleURLTypes</key>
    <array>
        <dict>
            <key>CFBundleURLName</key>
            <string>LinguaFlow Reminders URL</string>
            <key>CFBundleURLSchemes</key>
            <array>
                <string>linguaflow-reminders</string>
            </array>
        </dict>
    </array>
</dict>
</plist>
PLIST

# Register with Launch Services
/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister -f "$APP_DIR" 2>/dev/null || true

echo ""
echo "✅ 安装完成！"
echo ""
echo "  应用位置: $APP_DIR"
echo "  URL 协议: linguaflow-reminders://"
echo ""
echo "现在打开任务清单页面，点击 🍎 提醒 即可一键导入。"
echo ""

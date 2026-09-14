@echo off
rem =====================================================================
rem  LinguaFlow 一键拉起服务 · Windows Native Host 安装脚本（方案 B）
rem  用法：install_native_host_win.bat <扩展ID> [python路径]
rem   扩展ID：chrome://extensions 里本插件的 ID（32 位小写字母）
rem   python：留空则自动用 PATH 里的 python（建议传服务实际使用的解释器）
rem  效果：注册 com.linguaflow.launcher 宿主，微信工具页出现「一键拉起服务」
rem  卸载：reg delete "HKCU\Software\Google\Chrome\NativeMessagingHosts\com.linguaflow.launcher" /f
rem =====================================================================
setlocal
if "%~1"=="" (
  echo 用法：install_native_host_win.bat ^<扩展ID^> [python路径]
  exit /b 1
)
cd /d "%~dp0"
set "EXTID=%~1"
set "PY=%~2"
if "%PY%"=="" set "PY=python"

"%PY%" -c "import sys,os,json;host=os.path.abspath('native_host_launcher.py');m={'name':'com.linguaflow.launcher','description':'LinguaFlow scheduler launcher','path':host,'type':'stdio','allowed_origins':['chrome-extension://%~1/']};open('launcher_host_manifest.json','w',encoding='utf-8').write(json.dumps(m,indent=2));print('manifest OK ->',host)"
if errorlevel 1 ( echo [错误] python 不可用，请把第二个参数传为 python.exe 绝对路径 & exit /b 1 )

set "MF=%CD%\launcher_host_manifest.json"
reg add "HKCU\Software\Google\Chrome\NativeMessagingHosts\com.linguaflow.launcher" /ve /t REG_SZ /d "%MF%" /f
if errorlevel 1 ( echo [错误] 写注册表失败 & exit /b 1 )
echo.
echo [完成] 已注册一键拉起宿主。重新加载扩展后，打开「微信工具」页即可使用。
pause

@echo off
rem =====================================================================
rem  LinguaFlow 微信定时消息服务 · 一键启动（零 pip 依赖）
rem  自动完成：定位可用 Python → 检查端口 → 启动服务
rem  前提：PC 微信已登录且主窗口开着（可最小化）、不锁屏
rem  透传参数：start_wx_scheduler.bat --port 8766 --token abc
rem =====================================================================
setlocal EnableDelayedExpansion
cd /d "%~dp0"

rem ---------- 1. 定位 Python ----------
rem 顺序：py 启动器 / PATH 里的 python（排除 Store 占位桩）→ pyenv-win 全局版本 →
rem       pyenv-win versions 目录扫描 → 常规安装目录
set "PYCALL="
for %%C in ("py -3" "python") do (
  if not defined PYCALL (
    %%~C -c "import sys" >nul 2>nul && set "PYCALL=%%~C"
  )
)
if not defined PYCALL (
  if exist "%USERPROFILE%\.pyenv\pyenv-win\version" (
    set /p PYENVGLOBAL=<"%USERPROFILE%\.pyenv\pyenv-win\version"
    if exist "%USERPROFILE%\.pyenv\pyenv-win\versions\!PYENVGLOBAL!\python.exe" (
      "%USERPROFILE%\.pyenv\pyenv-win\versions\!PYENVGLOBAL!\python.exe" -c "import sys" >nul 2>nul && set "PYCALL="%USERPROFILE%\.pyenv\pyenv-win\versions\!PYENVGLOBAL!\python.exe""
    )
  )
)
if not defined PYCALL (
  for /d %%V in ("%USERPROFILE%\.pyenv\pyenv-win\versions\*") do (
    if exist "%%V\python.exe" (
      if not defined PYCALL "%%V\python.exe" -c "import sys" >nul 2>nul && set "PYCALL="%%V\python.exe""
    )
  )
)
if not defined PYCALL (
  for /d %%V in ("%LOCALAPPDATA%\Programs\Python\Python3*") do (
    if exist "%%V\python.exe" (
      if not defined PYCALL "%%V\python.exe" -c "import sys" >nul 2>nul && set "PYCALL="%%V\python.exe""
    )
  )
)
if not defined PYCALL (
  echo [错误] 未找到可用的 Python 3。
  echo        请安装 Python 3.9+（安装时勾选 Add to PATH），或 pyenv-win 用户执行 pyenv rehash
  echo        下载地址： https://www.python.org/downloads/
  pause & exit /b 1
)
echo [1/3] Python：
!PYCALL! --version

rem ---------- 2. 端口占用检查（未显式指定 --port 时按默认 8765 检查） ----------
set "PORT=8765"
echo %* | findstr /C:"--port" >nul 2>nul || (
  netstat -ano | findstr /C:":!PORT! " | findstr /C:"LISTENING" >nul 2>nul
  if not errorlevel 1 (
    echo [错误] 端口 !PORT! 已被占用——服务可能已在运行，直接打开 http://127.0.0.1:!PORT!/ 即可；
    echo        确需再起实例： start_wx_scheduler.bat --port 8766
    pause & exit /b 1
  )
)
echo [2/3] 端口检查通过

rem ---------- 3. 启动（日志同落 wx_scheduler.log） ----------
echo [3/3] 启动服务（Ctrl+C 停止）... 管理页 http://127.0.0.1:!PORT!/wechat_schedule.html
echo        提示：请在页面点「环境体检」确认微信窗口就绪，新任务先「演练」再启用。
echo ---- [%date% %time%] 服务启动 %* ---- >> wx_scheduler.log
!PYCALL! server.py %* >> wx_scheduler.log 2>&1
echo.
echo [退出] 服务已停止（错误码 !errorlevel!）。最近日志见 wx_scheduler.log：
powershell -NoProfile -Command "Get-Content wx_scheduler.log -Tail 15 -ErrorAction SilentlyContinue"
pause

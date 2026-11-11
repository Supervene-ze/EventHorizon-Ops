@echo off
setlocal
set PORT=%AGENT_HUD_PORT%
if "%PORT%"=="" set PORT=7788
set ROOT=%~dp0
where node >nul 2>nul
if errorlevel 1 (
  echo node not found in PATH
  exit /b 1
)
for /f "tokens=5" %%p in ('netstat -ano ^| findstr /r /c:":%PORT% .*LISTENING"') do (
  taskkill /F /PID %%p >nul 2>nul
)
start "EventHorizon-Ops" /min cmd /c ""node" "%ROOT%plugin\server.mjs" %PORT%"
timeout /t 2 /nobreak >nul
start "" "http://127.0.0.1:%PORT%/"
echo EventHorizon-Ops http://127.0.0.1:%PORT%/
endlocal

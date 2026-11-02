@echo off
rem Runs Jarvis with no window (started by scripts\jarvis-hidden.vbs at Windows sign-in).
rem Restarts it if it crashes. Output goes to data\server.log. "Stop Jarvis.bat" ends it.
rem Runs the production build (no source code or dev tools exposed to the network). After changing the code,
rem run "npm run build" in this folder, then Stop + Start Jarvis.
cd /d "%~dp0.."
if not exist data mkdir data
if exist data\stop.flag del data\stop.flag
call :running && exit /b 0
echo [%date% %time%] Jarvis background launcher started > data\server.log

:loop
echo [%date% %time%] starting >> data\server.log
if not exist .next\BUILD_ID call npm run build >> data\server.log 2>&1
call npm start >> data\server.log 2>&1
if exist data\stop.flag (
  del data\stop.flag
  echo [%date% %time%] stopped by Stop Jarvis.bat >> data\server.log
  exit /b 0
)
echo [%date% %time%] Jarvis stopped, restarting in 5s >> data\server.log
timeout /t 5 /nobreak >nul
call :running && exit /b 0
goto loop

:running
rem Exit code 0 if something is already serving port 3900.
powershell -NoProfile -Command "if (Get-NetTCPConnection -LocalPort 3900 -State Listen -ErrorAction SilentlyContinue) { exit 0 } else { exit 1 }"
exit /b %errorlevel%

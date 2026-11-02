@echo off
rem Trusts the "Jarvis Local CA" for your Windows user so https://localhost:3900 shows no "Not private" warning.
rem It can only vouch for localhost and IP addresses (never real websites). Windows asks you to confirm: click Yes.
rem Start Jarvis once first (it creates certificates\ca.pem).
rem To undo: certmgr.msc > Trusted Root Certification Authorities > Certificates > delete "Jarvis Local CA".
certutil -user -addstore Root "%~dp0..\certificates\ca.pem"
echo.
echo Done. Close and reopen your browser, then open https://localhost:3900
pause

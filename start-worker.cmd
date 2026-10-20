@echo off
rem Khoi dong worker App-Video. Dat shortcut file nay vao thu muc Startup (Win+R -> shell:startup) de tu chay khi bat may.
title App-Video worker
cd /d "%~dp0auto-video-gen"
:loop
call npm run worker
echo Worker dung, khoi dong lai sau 15 giay... (Ctrl+C de thoat)
timeout /t 15 /nobreak >nul
goto loop

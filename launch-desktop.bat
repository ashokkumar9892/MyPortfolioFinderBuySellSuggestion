@echo off
title Portfolio Signal Finder - Desktop
cd /d "%~dp0"

echo Starting Portfolio Signal Finder Desktop...
echo.

REM Start backend + frontend in background
start "PSF-Server" /min cmd /c "npm run dev"

REM Wait a few seconds for servers to start
echo Waiting for servers to start...
timeout /t 6 /nobreak >nul

REM Launch Electron window
echo Launching desktop window...
node_modules\.bin\electron .

REM When Electron closes, kill the background servers
taskkill /F /FI "WINDOWTITLE eq PSF-Server" >nul 2>&1

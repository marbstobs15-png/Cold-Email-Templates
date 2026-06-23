@echo off
REM ===================================================================
REM  Website Finder launcher
REM  Double-click this file to start the finder and open it in your
REM  browser. Keep the window that appears open while you use it;
REM  close it (or press Ctrl+C) when you're done.
REM ===================================================================

cd /d "%~dp0"
title Website Finder

echo ===================================================
echo   Starting the Website Finder...
echo   Keep THIS window open while you use the finder.
echo   A browser tab will open in a few seconds.
echo ===================================================
echo.

REM First-time setup: install dependencies if they're missing.
if not exist "node_modules" (
  echo First-time setup - installing dependencies, please wait...
  call npm install
  echo.
)

REM Open the browser after a short delay so the server is ready.
start "" cmd /c "ping -n 4 127.0.0.1 >nul & start http://localhost:3000/finder.html"

REM Start the server (this keeps running until you close the window).
npm start

REM If the server stops, pause so you can read any error message.
echo.
echo The server has stopped. You can close this window.
pause

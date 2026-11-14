@echo off
title YT Premium Vibe - Remove download helper
echo Removing the YT Premium Vibe download helper...
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0download-helper\uninstall.ps1"
echo.
pause

@echo off
title YT Premium Vibe - Download helper
echo Installing the YT Premium Vibe download helper for Chrome, Edge and Brave...
echo (No admin rights needed. This takes a few minutes the first time.)
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0download-helper\install.ps1"
echo.
pause

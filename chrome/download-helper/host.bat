@echo off
rem Chrome starts this for each download message; the real work is in host.ps1.
powershell.exe -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "%~dp0host.ps1"

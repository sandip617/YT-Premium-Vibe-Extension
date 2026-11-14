@echo off
rem Chrome starts this for each download message; the real work is in host.ps1.
rem -InputFormat None: otherwise PowerShell itself reads part of stdin and the message arrives cut off.
powershell.exe -NoLogo -NoProfile -NonInteractive -InputFormat None -ExecutionPolicy Bypass -File "%~dp0host.ps1"

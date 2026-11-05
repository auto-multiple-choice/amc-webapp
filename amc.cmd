@echo off
rem AMC web app launcher for Windows. Usage: amc help
rem Runs amc.ps1 without changing the system's PowerShell script policy.
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0amc.ps1" %*
exit /b %ERRORLEVEL%

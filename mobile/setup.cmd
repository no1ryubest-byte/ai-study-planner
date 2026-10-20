@echo off
chcp 65001 >nul
powershell -NoProfile -ExecutionPolicy Bypass -NoExit -File "%~dp0setup.ps1"

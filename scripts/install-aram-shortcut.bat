@echo off
chcp 65001 >nul
setlocal EnableExtensions

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0install-aram-shortcut.ps1"
if errorlevel 1 (
  echo Falha ao criar o atalho.
  pause
  exit /b 1
)

echo.
pause

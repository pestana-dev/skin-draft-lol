@echo off
chcp 65001 >nul
setlocal EnableExtensions

cd /d "%~dp0.."

if not exist "scripts\sync-aram.mjs" (
  echo Nao encontrei scripts\sync-aram.mjs
  echo Rode este atalho a partir da pasta do projeto skin-draft-lol.
  pause
  exit /b 1
)

where node >nul 2>&1
if errorlevel 1 (
  echo Node.js nao encontrado no PATH.
  echo Instale em https://nodejs.org e tente de novo.
  pause
  exit /b 1
)

set "ROOM=%~1"
if "%ROOM%"=="" (
  if exist "scripts\.aram-room.txt" (
    set /p ROOM=<"scripts\.aram-room.txt"
  )
)

if "%ROOM%"=="" (
  set /p ROOM=Codigo da sala: 
)

if "%ROOM%"=="" (
  echo Nenhum codigo informado.
  pause
  exit /b 1
)

rem Remove espacos
set "ROOM=%ROOM: =%"

echo %ROOM%>"scripts\.aram-room.txt"

echo.
echo Skin Draft - sync ARAM
echo Sala: %ROOM%
echo Deixe o LoL aberto na select do ARAM.
echo Feche esta janela ou Ctrl+C para parar.
echo.

node "scripts\sync-aram.mjs" --room=%ROOM%
set "EXITCODE=%ERRORLEVEL%"

echo.
if not "%EXITCODE%"=="0" (
  echo O sync encerrou com erro (%EXITCODE%).
  pause
)
exit /b %EXITCODE%

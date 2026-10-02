@echo off
chcp 65001 >nul
cd /d "%~dp0"
title UMP Vendas - copia de seguranca

echo.
echo   Gerando copia de seguranca dos dados do evento...
echo.

node server\scripts\backup.js
if errorlevel 1 (
  echo.
  echo   Nao foi possivel gerar a copia. O sistema ja foi iniciado alguma vez?
)

echo.
pause

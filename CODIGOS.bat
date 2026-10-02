@echo off
chcp 65001 >nul
cd /d "%~dp0"
title UMP Vendas - codigos de acesso

node server\scripts\codigos.js
if errorlevel 1 (
  echo.
  echo   Nao foi possivel ler os codigos. Rode o INICIAR.bat pelo menos
  echo   uma vez para o sistema criar o banco de dados.
)

echo.
pause

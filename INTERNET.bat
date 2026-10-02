@echo off
chcp 65001 >nul
title UMP Vendas - Acesso pela internet
color 0B
cd /d "%~dp0"

set PORT=3000
if not "%~1"=="" set PORT=%~1

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0tunel.ps1" -Porta %PORT%

@echo off
setlocal enabledelayedexpansion
chcp 65001 >nul
cd /d "%~dp0"
title UMP Vendas - servidor (NAO FECHE ESTA JANELA)

rem Porta: usa 3000, ou a que for passada como argumento (ex.: INICIAR.bat 3001)
set "PORT=%~1"
if "%PORT%"=="" set "PORT=3000"

echo.
echo ========================================================
echo   UMP VENDAS - iniciando o servidor
echo ========================================================
echo.

rem ---------------------------------------------------- Node instalado?
where node >nul 2>nul
if errorlevel 1 (
  echo   [X] O Node.js nao esta instalado neste computador.
  echo.
  echo   Baixe a versao LTS em https://nodejs.org, instale,
  echo   FECHE esta janela e abra o INICIAR.bat de novo.
  echo.
  pause
  exit /b 1
)

node -e "process.exit(parseInt(process.versions.node,10)>=22?0:1)"
if errorlevel 1 (
  for /f %%v in ('node -v') do echo   [X] Node %%v e antigo demais. Instale a versao 22 ou mais nova.
  echo.
  echo   Baixe a LTS em https://nodejs.org, instale e rode o INICIAR.bat de novo.
  echo.
  pause
  exit /b 1
)

rem ---------------------------------------------------- Porta livre?
netstat -ano | findstr /c:":%PORT% " | findstr /c:"LISTENING" >nul
if not errorlevel 1 (
  echo   [X] A porta %PORT% ja esta sendo usada por outro programa.
  echo.
  echo   Feche o outro programa ^(Docker, outro servidor, outra janela
  echo   deste sistema^) ou use outra porta: abra o Prompt de Comando
  echo   nesta pasta e rode
  echo.
  echo       INICIAR.bat 3001
  echo.
  echo   ^(nesse caso o endereco dos outros PCs termina em :3001^)
  echo.
  echo   Quem esta usando a porta %PORT% agora:
  for /f "tokens=5" %%p in ('netstat -ano ^| findstr /c:":%PORT% " ^| findstr /c:"LISTENING"') do (
    for /f "tokens=1" %%n in ('tasklist /fi "PID eq %%p" /nh /fo table 2^>nul ^| findstr /v /c:"INFORMA"') do echo       %%n ^(PID %%p^)
  )
  echo.
  pause
  exit /b 1
)

rem ---------------------------------------------------- Primeira vez?
if not exist "node_modules\" (
  echo   Primeira vez neste computador: instalando os componentes...
  echo   ^(isso pode levar alguns minutos, so acontece uma vez^)
  echo.
  call npm install --no-fund --no-audit
  if errorlevel 1 (
    echo.
    echo   [X] A instalacao falhou. Confira se ha internet e tente de novo.
    pause
    exit /b 1
  )
  echo.
)

if not exist "server\public\index.html" (
  echo   Preparando as telas...
  call npm run build
  if errorlevel 1 (
    echo.
    echo   [X] Nao foi possivel preparar as telas.
    pause
    exit /b 1
  )
  echo.
)

rem ---------------------------------------------------- Sobe o servidor
echo   Pronto. Deixe ESTA JANELA ABERTA o evento inteiro.
echo   Para desligar no fim: feche a janela ou aperte Ctrl+C.
echo.

node server\index.js

rem So chega aqui se o servidor parar
echo.
echo ========================================================
echo   O servidor foi encerrado.
echo ========================================================
echo.
pause

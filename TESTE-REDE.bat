@echo off
chcp 65001 >nul
title Teste de conexao - UMP Vendas
color 0E
echo ========================================================
echo   TESTE DE CONEXAO - UMP VENDAS
echo ========================================================
echo.
echo   Rode este arquivo NO COMPUTADOR DO CAIXA
echo   (o que NAO esta com o servidor ligado).
echo.
echo ========================================================
echo   1) QUAL O IP DESTE COMPUTADOR
echo ========================================================
ipconfig | findstr /C:"IPv4"
echo.
echo   Para funcionar, ele PRECISA comecar com 192.168.32
echo   Se comecar com outra coisa, os dois PCs estao em
echo   redes diferentes - conecte no mesmo Wi-Fi.
echo.
echo ========================================================
echo   2) O SERVIDOR RESPONDE? (ping)
echo ========================================================
ping -n 3 192.168.32.26
echo.
echo ========================================================
echo   3) A PORTA 3000 ESTA ABERTA?
echo ========================================================
powershell -NoProfile -Command "$r = Test-NetConnection -ComputerName 192.168.32.26 -Port 3000 -WarningAction SilentlyContinue; if ($r.TcpTestSucceeded) { Write-Host '   [OK] A porta 3000 respondeu. O sistema deve abrir no Chrome:' -ForegroundColor Green; Write-Host '        http://192.168.32.26:3000' -ForegroundColor Green } else { Write-Host '   [X] A porta 3000 NAO respondeu.' -ForegroundColor Red; Write-Host '       O Wi-Fi esta bloqueando a conversa entre os PCs,' -ForegroundColor Red; Write-Host '       ou o servidor nao esta ligado no outro computador.' -ForegroundColor Red }"
echo.
echo ========================================================
echo.
pause

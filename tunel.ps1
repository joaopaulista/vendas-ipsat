# Abre o sistema para a internet com o Cloudflare Tunnel.
#
# Existe porque o Wi-Fi da igreja nao deixa um computador falar com o outro
# (isolamento de clientes). O tunel contorna isso: o caixa acessa por um
# endereco publico em vez do IP da rede local.
#
# Chamado pelo INTERNET.bat. Nao precisa de conta nem de token: o Cloudflare
# entrega um endereco aleatorio que vale enquanto esta janela ficar aberta.

param([int]$Porta = 3000)

$ErrorActionPreference = 'Stop'
$raiz = Split-Path -Parent $MyInvocation.MyCommand.Path
$arquivoUrl = Join-Path $raiz 'ENDERECO-INTERNET.txt'
$log = Join-Path $env:TEMP ('ump-tunel-' + [guid]::NewGuid().ToString('N').Substring(0, 8) + '.log')

function Linha { Write-Host ('=' * 62) -ForegroundColor DarkCyan }

# ------------------------------------------------ onde esta o cloudflared
$candidatos = @(
  'C:\Program Files (x86)\cloudflared\cloudflared.exe',
  'C:\Program Files\cloudflared\cloudflared.exe'
)
$exe = $null
foreach ($c in $candidatos) { if (Test-Path $c) { $exe = $c; break } }
if (-not $exe) {
  $doPath = Get-Command cloudflared -ErrorAction SilentlyContinue
  if ($doPath) { $exe = $doPath.Source }
}
if (-not $exe) {
  Linha
  Write-Host '  [X] O cloudflared nao esta instalado neste computador.' -ForegroundColor Red
  Write-Host ''
  Write-Host '  Para instalar, abra o Prompt de Comando e rode:'
  Write-Host '      winget install --id Cloudflare.cloudflared' -ForegroundColor Yellow
  Linha
  Read-Host 'Enter para fechar'
  exit 1
}

# ------------------------------------------------ o servidor esta ligado?
$ligado = $false
try {
  $t = Test-NetConnection -ComputerName '127.0.0.1' -Port $Porta -WarningAction SilentlyContinue
  $ligado = $t.TcpTestSucceeded
} catch { $ligado = $false }

if (-not $ligado) {
  Linha
  Write-Host ('  [X] Nada rodando na porta ' + $Porta + '.') -ForegroundColor Red
  Write-Host ''
  Write-Host '  Abra o INICIAR.bat primeiro e deixe a janela preta aberta.'
  Write-Host '  Depois abra este arquivo de novo.'
  Linha
  Read-Host 'Enter para fechar'
  exit 1
}

Linha
Write-Host '  ABRINDO O SISTEMA PARA A INTERNET' -ForegroundColor Cyan
Linha
Write-Host ('  Servidor local:  http://localhost:' + $Porta + '  (respondendo)')
Write-Host '  Conectando no Cloudflare... isso leva uns 15 segundos.'
Write-Host ''

$proc = Start-Process -FilePath $exe `
  -ArgumentList @('tunnel', '--url', ('http://localhost:' + $Porta), '--no-autoupdate') `
  -RedirectStandardOutput $log -RedirectStandardError ($log + '.err') `
  -WindowStyle Hidden -PassThru

try {
  # O endereco aparece no log alguns segundos depois de conectar.
  $url = $null
  for ($i = 0; $i -lt 60; $i++) {
    Start-Sleep -Seconds 1
    foreach ($f in @($log, ($log + '.err'))) {
      if (-not (Test-Path $f)) { continue }
      $txt = Get-Content $f -Raw -ErrorAction SilentlyContinue
      if ($txt -match 'https://[a-z0-9-]+\.trycloudflare\.com') {
        $url = $Matches[0]
        break
      }
    }
    if ($url) { break }
    if ($proc.HasExited) { break }
  }

  if (-not $url) {
    Linha
    Write-Host '  [X] Nao consegui abrir o tunel.' -ForegroundColor Red
    Write-Host '      Quase sempre e falta de internet neste computador.'
    Write-Host ('      Detalhes tecnicos em: ' + $log)
    Linha
    Read-Host 'Enter para fechar'
    exit 1
  }

  Set-Content -Path $arquivoUrl -Value $url -Encoding utf8

  Write-Host ''
  Linha
  Write-Host '  PRONTO. Use este endereco no computador do caixa:' -ForegroundColor Green
  Write-Host ''
  Write-Host ('      ' + $url) -ForegroundColor Yellow
  Write-Host ''
  Write-Host '  Funciona em qualquer aparelho com internet: outro PC, celular,'
  Write-Host '  4G, outro Wi-Fi. Nao depende mais da rede da igreja.'
  Linha
  Write-Host ('  O endereco tambem foi salvo em ENDERECO-INTERNET.txt')
  Write-Host ''
  Write-Host '  DEIXE ESTA JANELA ABERTA o evento inteiro.' -ForegroundColor Cyan
  Write-Host '  Ao fechar, o endereco morre e o proximo sera diferente.'
  Linha

  while (-not $proc.HasExited) { Start-Sleep -Seconds 2 }

  Write-Host ''
  Write-Host '  O tunel caiu. Feche e abra este arquivo de novo.' -ForegroundColor Red
  Read-Host 'Enter para fechar'
} finally {
  # Fechar a janela nao pode deixar o cloudflared rodando escondido.
  if ($proc -and -not $proc.HasExited) {
    try { Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue } catch {}
  }
  foreach ($f in @($log, ($log + '.err'))) {
    try { Remove-Item $f -Force -ErrorAction SilentlyContinue } catch {}
  }
}

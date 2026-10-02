import express from 'express'
import { existsSync } from 'node:fs'
import { networkInterfaces } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { requireAuth } from './auth.js'
import { consumeSeededCodes, DATA_DIR, getConfig, ROLES } from './db.js'
import { addClient, clientCount } from './events.js'
import { PASTA_BACKUP, salvarBackup, temDados } from './planilha.js'
import adminRoutes from './routes/admin.js'
import authRoutes from './routes/auth.js'
import kitchenRoutes from './routes/kitchen.js'
import orderRoutes from './routes/orders.js'
import priceRoutes from './routes/price.js'
import { buildState } from './state.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const PORT = Number(process.env.PORT || 3000)
const PUBLIC_DIR = join(__dirname, 'public')
const MINUTOS_BACKUP = Number(process.env.BACKUP_MIN || 10)

const app = express()
app.set('trust proxy', true)

/*
 * Registro de quem chega de fora.
 *
 * Quando o outro computador "nao abre o sistema", a duvida e sempre a mesma:
 * o pedido dele chegou a sair da rede? Aqui a janela preta responde. Cada
 * endereco novo aparece uma vez, com a hora. Silencio absoluto enquanto alguem
 * tenta acessar significa que o problema esta na rede, nao no sistema.
 */
const visitantes = new Set()
app.use((req, res, next) => {
  const bruto = req.socket.remoteAddress || ''
  // Node entrega IPv4 embrulhado em IPv6 (::ffff:192.168.0.10).
  const ip = bruto.replace(/^::ffff:/, '')
  if (ip && ip !== '127.0.0.1' && ip !== '::1' && !visitantes.has(ip)) {
    visitantes.add(ip)
    const hora = new Date().toLocaleTimeString('pt-BR')
    console.log(`  >> ${hora}  acesso de ${ip}  (chegou ate aqui)`)
  }
  next()
})
app.use(express.json({ limit: '256kb' }))

app.get('/api/health', (req, res) => {
  res.json({ ok: true, conectados: clientCount(), uptime: Math.round(process.uptime()) })
})

app.use('/api/auth', authRoutes)
app.use('/api/orders', orderRoutes)
app.use('/api/kitchen', kitchenRoutes)
app.use('/api/price', priceRoutes)
app.use('/api/admin', adminRoutes)

app.get('/api/state', requireAuth(), (req, res) => {
  res.json(buildState())
})

// Canal em tempo real: qualquer mudanca de estoque, preco ou pedido chega
// nas duas maquinas sem precisar atualizar a pagina.
app.get('/events', requireAuth(), (req, res) => {
  const cleanup = addClient(res)
  req.on('close', cleanup)
})

/**
 * Rota de API que nao existe quase sempre significa uma coisa so: aquele
 * computador esta com a tela antiga em memoria, chamando um endereco que o
 * sistema nao tem mais. Melhor dizer isso na cara do que devolver o HTML do
 * app e o navegador mostrar "nao foi possivel completar a acao".
 */
app.use('/api', (req, res) => {
  res.status(404).json({
    error:
      'Esta tela esta desatualizada e chamou um endereco que nao existe mais. ' +
      'Recarregue a pagina (Ctrl+F5) para pegar a versao nova.',
    desatualizado: true,
    rota: req.method + ' /api' + req.path,
  })
})

/* ---------------------------------------------------- frontend compilado */

if (existsSync(PUBLIC_DIR)) {
  // Os arquivos de assets tem o hash no nome, entao podem ficar em cache para
  // sempre. Ja o index.html NAO pode: e ele que aponta para o bundle novo, e um
  // index velho em cache mantem a maquina rodando a versao antiga o dia inteiro.
  app.use(
    express.static(PUBLIC_DIR, {
      index: false,
      setHeaders(res, caminho) {
        if (caminho.endsWith('index.html')) res.setHeader('Cache-Control', 'no-store')
        else if (caminho.includes('assets')) {
          res.setHeader('Cache-Control', 'public, max-age=31536000, immutable')
        }
      },
    })
  )
  app.get(/^\/(?!api|events).*/, (req, res) => {
    res.setHeader('Cache-Control', 'no-store')
    res.sendFile(join(PUBLIC_DIR, 'index.html'))
  })
} else {
  app.get('/', (req, res) => {
    res
      .status(503)
      .type('html')
      .send(
        '<h1>Front-end nao compilado</h1><p>Rode <code>npm run build</code> na pasta do projeto e inicie de novo com <code>npm start</code>.</p>'
      )
  })
}

/* -------------------------------------------------------- erros e start */

// eslint-disable-next-line no-unused-vars -- o Express so reconhece o handler de erro com 4 argumentos
app.use((err, req, res, next) => {
  const status = err.status || 500
  if (status >= 500) console.error('[erro]', err)
  res.status(status).json({
    error: status >= 500 ? 'Erro interno no servidor. Tente de novo.' : err.message,
    ...(err.extra || {}),
  })
})

function localAddresses() {
  const out = []
  for (const list of Object.values(networkInterfaces())) {
    for (const net of list || []) {
      if (net.family === 'IPv4' && !net.internal) out.push(net.address)
    }
  }
  return out
}

app.listen(PORT, '0.0.0.0', () => {
  const novos = consumeSeededCodes()
  const linha = '='.repeat(56)

  console.log('\n' + linha)
  console.log('  ' + getConfig('event_name', 'Venda de Pasteis').toUpperCase())
  console.log(linha)
  console.log('  Neste computador:  http://localhost:' + PORT)
  const enderecos = localAddresses()
  for (const ip of enderecos) {
    console.log('  Nos outros PCs:    http://' + ip + ':' + PORT)
  }
  if (enderecos.length === 0) {
    console.log('  [!] Sem rede: este computador nao esta conectado a nenhum Wi-Fi.')
  } else {
    console.log('      Digite o endereco INTEIRO, com http:// e com :' + PORT)
  }

  console.log(linha)
  // O aviso abaixo transforma esta janela no teste de rede: se alguem tentar
  // abrir o sistema de outro aparelho e nada aparecer aqui, o pedido nem saiu
  // da rede dele — o problema nao esta no sistema.
  console.log('  Quando alguem abrir de outro aparelho, aparece uma linha aqui.')

  console.log(linha)
  if (novos) {
    console.log('  CODIGOS DE ACESSO:')
    for (const [role, code] of novos) console.log('    ' + role.padEnd(9) + code)
    console.log('  Tambem salvos em ' + join(DATA_DIR, 'CODIGOS.txt'))
  } else {
    console.log('  CODIGOS DE ACESSO (ja configurados):')
    for (const role of ROLES) console.log('    ' + role.padEnd(9) + getConfig('code_' + role, '-'))
  }
  console.log(linha)
  console.log('  Backup em Excel automatico a cada ' + MINUTOS_BACKUP + ' min e ao desligar')
  console.log('  Pasta: ' + PASTA_BACKUP)
  console.log(linha + '\n')
})

/* ----------------------------------------------------- backup automatico */

function backup(motivo) {
  try {
    const caminho = salvarBackup(motivo)
    if (caminho) console.log('[backup] planilha salva: ' + caminho)
    return caminho
  } catch (err) {
    // Backup que falha nao pode derrubar a venda; so avisa e segue.
    console.error('[backup] falhou (' + motivo + '):', err.message)
    return null
  }
}

// Rede de seguranca contra queda de energia e "finalizar tarefa", que nao
// disparam nenhum aviso de desligamento.
const timer = setInterval(() => {
  if (temDados()) backup('automatico')
}, Math.max(0.1, MINUTOS_BACKUP) * 60_000)
timer.unref()

let encerrando = false

function encerrar(motivo, codigo) {
  if (encerrando) return
  encerrando = true
  clearInterval(timer)
  console.log('\n[' + motivo + '] gerando a planilha do evento antes de fechar...')
  backup('desligamento')
  process.exit(codigo)
}

// Ctrl+C, fechar a janela, encerrar o Windows, "stop" do gerenciador de tarefas
for (const sinal of ['SIGINT', 'SIGTERM', 'SIGHUP', 'SIGBREAK']) {
  process.on(sinal, () => encerrar(sinal, 0))
}

process.on('uncaughtException', (err) => {
  console.error('[erro fatal]', err)
  encerrar('erro fatal', 1)
})

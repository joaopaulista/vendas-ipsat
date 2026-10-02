/**
 * Teste de ponta a ponta das regras de venda.
 *
 * Sobe uma copia do servidor numa porta e num banco temporarios, executa as
 * regras que importam no dia do evento (estoque, preco congelado, permissoes,
 * KPIs) e derruba tudo. Nao encosta no banco de producao.
 *
 * Rode com: npm test
 */
import { spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const SERVER = join(__dirname, '..', 'index.js')
const PORT = 3100 + Math.floor(Math.random() * 400)
const BASE = `http://localhost:${PORT}`
const DATA_DIR = mkdtempSync(join(tmpdir(), 'ump-vendas-teste-'))
const BACKUP_DIR = join(DATA_DIR, 'backups')

const aprovados = []
const falhas = []

function check(nome, condicao, detalhe = '') {
  if (condicao) aprovados.push(nome)
  else falhas.push(`${nome}${detalhe ? ' -> ' + detalhe : ''}`)
}

async function call(method, path, { token, body } = {}) {
  const res = await fetch(BASE + path, {
    method,
    headers: {
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: 'Bearer ' + token } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  })
  const texto = await res.text()
  let json
  try {
    json = JSON.parse(texto)
  } catch {
    json = texto
  }
  return { status: res.status, json }
}

async function esperarServidor(tentativas = 50) {
  for (let i = 0; i < tentativas; i++) {
    try {
      const res = await fetch(BASE + '/api/health')
      if (res.ok) return true
    } catch {
      /* ainda subindo */
    }
    await new Promise((r) => setTimeout(r, 200))
  }
  return false
}

function lerCodigos() {
  const db = new DatabaseSync(join(DATA_DIR, 'vendas.db'), { readOnly: true })
  const ler = (role) => db.prepare('SELECT value FROM config WHERE key = ?').get('code_' + role).value
  const codigos = { admin: ler('admin'), caixa: ler('caixa'), cozinha: ler('cozinha') }
  db.close()
  return codigos
}

const servidor = spawn(process.execPath, [SERVER], {
  env: { ...process.env, PORT: String(PORT), DATA_DIR, BACKUP_DIR, BACKUP_MIN: '600' },
  stdio: 'ignore',
})

function encerrar(codigoSaida) {
  servidor.kill()
  try {
    rmSync(DATA_DIR, { recursive: true, force: true })
  } catch {
    /* o Windows as vezes segura o arquivo; e pasta temporaria de qualquer forma */
  }
  process.exit(codigoSaida)
}

try {
  if (!(await esperarServidor())) {
    console.error('O servidor de teste nao subiu na porta ' + PORT)
    encerrar(1)
  }

  const codigos = lerCodigos()

  /* ------------------------------------------------------------ acesso */

  check(
    'banco novo ja nasce com os codigos combinados',
    codigos.admin === 'UMPADM' && codigos.caixa === 'UMPCAI' && codigos.cozinha === 'UMPCOZ',
    JSON.stringify(codigos)
  )

  check('codigo invalido e rejeitado', (await call('POST', '/api/auth/login', { body: { code: 'XXXXXX' } })).status === 401)

  const admin = (await call('POST', '/api/auth/login', { body: { code: codigos.admin } })).json
  const caixa = (await call('POST', '/api/auth/login', { body: { code: codigos.caixa } })).json
  const cozinha = (await call('POST', '/api/auth/login', { body: { code: codigos.cozinha } })).json
  check('login de cada perfil', admin.role === 'admin' && caixa.role === 'caixa' && cozinha.role === 'cozinha')
  check('codigo aceita minusculo', (await call('POST', '/api/auth/login', { body: { code: codigos.caixa.toLowerCase() } })).json.role === 'caixa')
  check('sem token nao le o estado', (await call('GET', '/api/state')).status === 401)
  check('cozinha nao define o valor do pastel', (await call('POST', '/api/price', { token: cozinha.token, body: { price: 8 } })).status === 403)

  /* ----------------------------------------------------- preco e estoque */

  const inicial = (await call('GET', '/api/state', { token: caixa.token })).json
  const carne = inicial.flavors.find((f) => f.name === 'Carne')
  const queijo = inicial.flavors.find((f) => f.name === 'Queijo')

  const semPreco = await call('POST', '/api/orders', {
    token: caixa.token,
    body: { customerName: 'Ana', paymentMethod: 'PIX', items: [{ flavorId: carne.id, qty: 1 }] },
  })
  check('nao vende sem o valor definido', semPreco.status === 400, JSON.stringify(semPreco.json))
  check('banco novo comeca sem valor', inicial.config.unitPriceCents === 0, String(inicial.config.unitPriceCents))

  // Valor unico para todos os sabores, definido pelo caixa.
  const preco = await call('POST', '/api/price', { token: caixa.token, body: { price: '8,50' } })
  check('caixa define o valor do pastel', preco.json.unitPriceCents === 850, JSON.stringify(preco.json))
  check('valor aceita virgula', preco.json.unitPriceCents === 850)
  check('valor zero e recusado', (await call('POST', '/api/price', { token: caixa.token, body: { price: 0 } })).status === 400)
  check('valor sem numero e recusado', (await call('POST', '/api/price', { token: caixa.token, body: {} })).status === 400)
  check(
    'todos os sabores ficam com o mesmo valor',
    (await call('GET', '/api/state', { token: caixa.token })).json.config.unitPriceCents === 850
  )

  const carga = await call('POST', '/api/kitchen/stock/lote', {
    token: cozinha.token,
    body: { kind: 'inicial', entries: [{ flavorId: carne.id, qty: 20 }, { flavorId: queijo.id, qty: 10 }] },
  })
  check('carga inicial de estoque', carga.status === 201, JSON.stringify(carga.json))

  /* -------------------------------------------------------------- vendas */

  const semEstoque = await call('POST', '/api/orders', {
    token: caixa.token,
    body: { customerName: 'Bruno', paymentMethod: 'PIX', items: [{ flavorId: queijo.id, qty: 11 }] },
  })
  check('nao vende mais do que tem', semEstoque.status === 409, JSON.stringify(semEstoque.json))

  const pedido1 = await call('POST', '/api/orders', {
    token: caixa.token,
    body: {
      customerName: 'Ana Clara',
      paymentMethod: 'Dinheiro',
      items: [{ flavorId: carne.id, qty: 2 }, { flavorId: queijo.id, qty: 1 }],
    },
  })
  check('pedido criado com numero 1', pedido1.status === 201 && pedido1.json.number === 1, JSON.stringify(pedido1.json))
  // 3 pasteis a 8,50 = 25,50 — o mesmo valor para carne e queijo.
  check('total = quantidade x valor do pastel', pedido1.json.totalCents === 3 * 850, JSON.stringify(pedido1.json))
  check(
    'cada item guarda o valor da venda',
    pedido1.json.items.every((i) => i.unitPriceCents === 850),
    JSON.stringify(pedido1.json.items)
  )

  const pedido2 = await call('POST', '/api/orders', {
    token: caixa.token,
    body: {
      customerName: 'Beto',
      paymentMethod: 'PIX',
      items: [{ flavorId: carne.id, qty: 1 }, { flavorId: carne.id, qty: 2 }],
    },
  })
  check('sabor repetido vira um item so', pedido2.json.items.length === 1 && pedido2.json.qtyTotal === 3)
  check('numeracao e sequencial', pedido2.json.number === 2)

  check('nome do comprador e obrigatorio', (await call('POST', '/api/orders', { token: caixa.token, body: { customerName: ' ', paymentMethod: 'PIX', items: [{ flavorId: carne.id, qty: 1 }] } })).status === 400)
  check('forma de pagamento e validada', (await call('POST', '/api/orders', { token: caixa.token, body: { customerName: 'X', paymentMethod: 'Boleto', items: [{ flavorId: carne.id, qty: 1 }] } })).status === 400)
  check('quantidade fracionada e recusada', (await call('POST', '/api/orders', { token: caixa.token, body: { customerName: 'X', paymentMethod: 'PIX', items: [{ flavorId: carne.id, qty: 1.5 }] } })).status === 400)

  /* --------------------------------------------- preco novo nao retroage */

  await call('POST', '/api/price', { token: caixa.token, body: { price: 10 } })
  const depois = (await call('GET', '/api/state', { token: admin.token })).json
  const antigo = depois.orders.find((o) => o.number === 1)
  check('pedido antigo mantem o valor da venda', antigo.totalCents === 2550, JSON.stringify(antigo))
  check(
    'item antigo mantem o valor da venda',
    antigo.items.every((i) => i.unitPriceCents === 850),
    JSON.stringify(antigo.items)
  )
  check('valor atual mudou', depois.config.unitPriceCents === 1000, String(depois.config.unitPriceCents))

  /* ----------------------------------------------------------------- kpi */

  check('kpi de vendas', depois.kpi.ordersCount === 2, JSON.stringify(depois.kpi))
  check('kpi de pasteis vendidos', depois.kpi.pasteisSold === 6)
  check('kpi de faturamento', depois.kpi.revenueCents === 2550 + 2550, JSON.stringify(depois.kpi.revenueCents))
  check('kpi por forma de pagamento', depois.kpi.byPayment.length === 2)
  const carneDepois = depois.flavors.find((f) => f.id === carne.id)
  check('estoque por sabor', carneDepois.produced === 20 && carneDepois.sold === 5 && carneDepois.available === 15, JSON.stringify(carneDepois))

  /* --------------------------------------------------------------- baixa */

  check('caixa nao da baixa', (await call('POST', `/api/orders/${pedido1.json.id}/retirar`, { token: caixa.token })).status === 403)
  check('cozinha da baixa', (await call('POST', `/api/orders/${pedido1.json.id}/retirar`, { token: cozinha.token })).status === 200)
  check('baixa em duplicidade e barrada', (await call('POST', `/api/orders/${pedido1.json.id}/retirar`, { token: cozinha.token })).status === 409)
  check('baixa pode ser desfeita', (await call('POST', `/api/orders/${pedido1.json.id}/reabrir`, { token: cozinha.token })).status === 200)
  await call('POST', `/api/orders/${pedido1.json.id}/retirar`, { token: cozinha.token })

  /* ------------------------------------------------------ retirada parcial */

  const parcial = await call('POST', '/api/orders', {
    token: caixa.token,
    body: {
      customerName: 'Clara Dias',
      paymentMethod: 'PIX',
      items: [{ flavorId: carne.id, qty: 4 }, { flavorId: queijo.id, qty: 2 }],
    },
  })
  check('pedido para retirada parcial criado', parcial.status === 201, JSON.stringify(parcial.json))

  const leva1 = await call('POST', `/api/orders/${parcial.json.id}/retirar-parcial`, {
    token: cozinha.token,
    body: { items: [{ flavorId: carne.id, qty: 2 }] },
  })
  check('primeira retirada parcial', leva1.status === 200 && leva1.json.status === 'parcial', JSON.stringify(leva1.json))
  check('sobra o que falta', leva1.json.restante === 4, JSON.stringify(leva1.json))

  const demais = await call('POST', `/api/orders/${parcial.json.id}/retirar-parcial`, {
    token: cozinha.token,
    body: { items: [{ flavorId: carne.id, qty: 3 }] },
  })
  check('nao entrega mais do que o cliente tem', demais.status === 409, JSON.stringify(demais.json))

  const caixaParcial = await call('POST', `/api/orders/${parcial.json.id}/retirar-parcial`, {
    token: caixa.token,
    body: { items: [{ flavorId: carne.id, qty: 1 }] },
  })
  check('caixa nao faz retirada parcial', caixaParcial.status === 403)

  const estadoParcial = (await call('GET', '/api/state', { token: admin.token })).json
  const pedidoParcial = estadoParcial.orders.find((o) => o.id === parcial.json.id)
  check('pedido aparece como parcial', pedidoParcial.status === 'parcial', pedidoParcial.status)
  check('entregue e restante batem', pedidoParcial.qtyDelivered === 2 && pedidoParcial.qtyRemaining === 4)
  check('KPI de parciais', estadoParcial.kpi.ordersPartial === 1, JSON.stringify(estadoParcial.kpi))
  check(
    'estoque nao muda na retirada parcial',
    estadoParcial.flavors.find((f) => f.id === carne.id).available ===
      depois.flavors.find((f) => f.id === carne.id).available - 4,
    'a reserva sai na venda, nao na retirada'
  )

  const resto = await call('POST', `/api/orders/${parcial.json.id}/retirar`, { token: cozinha.token })
  check('entregar o resto fecha o pedido', resto.status === 200 && resto.json.status === 'retirado', JSON.stringify(resto.json))

  const reaberto = await call('POST', `/api/orders/${parcial.json.id}/reabrir`, { token: cozinha.token })
  check('reabrir zera as entregas', reaberto.json.status === 'pendente' && reaberto.json.entregue === 0, JSON.stringify(reaberto.json))
  await call('POST', `/api/orders/${parcial.json.id}/cancelar`, { token: admin.token })

  /* --------------------------------------------------------------- edicao */

  const paraEditar = await call('POST', '/api/orders', {
    token: caixa.token,
    body: {
      customerName: 'Rute Almeida',
      paymentMethod: 'Dinheiro',
      items: [{ flavorId: carne.id, qty: 3 }, { flavorId: queijo.id, qty: 1 }],
    },
  })
  check('pedido para edicao criado', paraEditar.status === 201, JSON.stringify(paraEditar.json))
  const idEdit = paraEditar.json.id
  const precoDaVenda = paraEditar.json.unitPriceCents
  const estoqueAntesEdicao = (await call('GET', '/api/state', { token: admin.token })).json
    .flavors.find((f) => f.id === carne.id).available

  check(
    'cozinha nao edita pedido',
    (await call('PUT', `/api/orders/${idEdit}`, {
      token: cozinha.token,
      body: { customerName: 'X', paymentMethod: 'PIX', items: [{ flavorId: carne.id, qty: 1 }] },
    })).status === 403
  )

  const editado = await call('PUT', `/api/orders/${idEdit}`, {
    token: caixa.token,
    body: {
      customerName: 'Rute Almeida Souza',
      paymentMethod: 'PIX',
      items: [{ flavorId: carne.id, qty: 5 }, { flavorId: queijo.id, qty: 1 }],
    },
  })
  check('caixa edita o pedido', editado.status === 200, JSON.stringify(editado.json))
  check('quantidade nova soma certo', editado.json.qtyTotal === 6, JSON.stringify(editado.json.qtyTotal))
  check('total recalculado', editado.json.totalCents === 6 * precoDaVenda, JSON.stringify(editado.json.totalCents))
  check('edicao mantem o valor congelado da venda', editado.json.unitPriceCents === precoDaVenda)

  const posEdicao = (await call('GET', '/api/state', { token: admin.token })).json
  const pedidoEditado = posEdicao.orders.find((o) => o.id === idEdit)
  check('nome e pagamento atualizados', pedidoEditado.customerName === 'Rute Almeida Souza' && pedidoEditado.paymentMethod === 'PIX')
  check('edicao deixa rastro', Boolean(pedidoEditado.updatedAt) && pedidoEditado.updatedBy === 'caixa', JSON.stringify(pedidoEditado.updatedBy))
  check(
    'aumentar no pedido tira do estoque',
    posEdicao.flavors.find((f) => f.id === carne.id).available === estoqueAntesEdicao - 2,
    'esperado ' + (estoqueAntesEdicao - 2)
  )

  const edicaoSemEstoque = await call('PUT', `/api/orders/${idEdit}`, {
    token: caixa.token,
    body: { customerName: 'Rute', paymentMethod: 'PIX', items: [{ flavorId: carne.id, qty: 900 }] },
  })
  check('edicao respeita o estoque', edicaoSemEstoque.status === 409, JSON.stringify(edicaoSemEstoque.json))

  // O cliente leva parte: a partir daqui o pedido tem um piso.
  await call('POST', `/api/orders/${idEdit}/retirar-parcial`, {
    token: cozinha.token,
    body: { items: [{ flavorId: carne.id, qty: 4 }] },
  })
  const abaixoDoRetirado = await call('PUT', `/api/orders/${idEdit}`, {
    token: caixa.token,
    body: { customerName: 'Rute', paymentMethod: 'PIX', items: [{ flavorId: carne.id, qty: 2 }, { flavorId: queijo.id, qty: 1 }] },
  })
  check('nao reduz abaixo do que o cliente ja retirou', abaixoDoRetirado.status === 409, JSON.stringify(abaixoDoRetirado.json))

  const sumindoComSabor = await call('PUT', `/api/orders/${idEdit}`, {
    token: caixa.token,
    body: { customerName: 'Rute', paymentMethod: 'PIX', items: [{ flavorId: queijo.id, qty: 1 }] },
  })
  check('nao tira sabor que ja foi retirado', sumindoComSabor.status === 409, JSON.stringify(sumindoComSabor.json))

  const ateOpiso = await call('PUT', `/api/orders/${idEdit}`, {
    token: caixa.token,
    body: { customerName: 'Rute', paymentMethod: 'PIX', items: [{ flavorId: carne.id, qty: 4 }, { flavorId: queijo.id, qty: 1 }] },
  })
  check('reduzir ate o que foi retirado e aceito', ateOpiso.status === 200, JSON.stringify(ateOpiso.json))
  const posPiso = (await call('GET', '/api/state', { token: admin.token })).json.orders.find((o) => o.id === idEdit)
  check('entregas sobrevivem a edicao', posPiso.qtyDelivered === 4, JSON.stringify(posPiso.qtyDelivered))
  check('status recalculado apos editar', posPiso.status === 'parcial', posPiso.status)

  check(
    'pedido cancelado nao e editado',
    (await call('PUT', `/api/orders/${parcial.json.id}`, {
      token: caixa.token,
      body: { customerName: 'X', paymentMethod: 'PIX', items: [{ flavorId: carne.id, qty: 1 }] },
    })).status === 409
  )

  check(
    'edicao sem nome e recusada',
    (await call('PUT', `/api/orders/${idEdit}`, {
      token: caixa.token,
      body: { customerName: '  ', paymentMethod: 'PIX', items: [{ flavorId: carne.id, qty: 4 }] },
    })).status === 400
  )

  check(
    'edicao sem itens e recusada',
    (await call('PUT', `/api/orders/${idEdit}`, {
      token: caixa.token,
      body: { customerName: 'Rute', paymentMethod: 'PIX', items: [] },
    })).status === 400
  )

  await call('DELETE', `/api/orders/${idEdit}`, { token: admin.token })

  /* --------------------------------------------------------- cancelamento */

  check('cozinha nao cancela', (await call('POST', `/api/orders/${pedido2.json.id}/cancelar`, { token: cozinha.token })).status === 403)
  check('admin cancela', (await call('POST', `/api/orders/${pedido2.json.id}/cancelar`, { token: admin.token })).status === 200)

  const posCancel = (await call('GET', '/api/state', { token: admin.token })).json
  check('cancelar devolve ao estoque', posCancel.flavors.find((f) => f.id === carne.id).available === 18)
  check('cancelado sai dos KPIs', posCancel.kpi.ordersCount === 1 && posCancel.kpi.revenueCents === 2550, JSON.stringify(posCancel.kpi.revenueCents))

  /* ------------------------------------------------------------ producao */

  await call('POST', '/api/kitchen/stock', { token: cozinha.token, body: { flavorId: carne.id, qty: 30, kind: 'producao' } })
  const posProducao = (await call('GET', '/api/state', { token: admin.token })).json
  check('fornada nova soma no estoque', posProducao.flavors.find((f) => f.id === carne.id).produced === 50)

  const palmito = await call('POST', '/api/kitchen/flavors', { token: cozinha.token, body: { name: 'Palmito' } })
  check('sabor novo e cadastrado', palmito.status === 201, JSON.stringify(palmito.json))
  check('sabor repetido e barrado', (await call('POST', '/api/kitchen/flavors', { token: cozinha.token, body: { name: 'palmito' } })).status === 409)

  // Apagar so vale para sabor virgem; com historico, a saida e desativar.
  const descartavel = await call('POST', '/api/kitchen/flavors', { token: cozinha.token, body: { name: 'Teste' } })
  check('sabor sem historico pode ser apagado', (await call('DELETE', `/api/kitchen/flavors/${descartavel.json.id}`, { token: cozinha.token })).status === 200)
  check('sabor com historico nao e apagado', (await call('DELETE', `/api/kitchen/flavors/${carne.id}`, { token: cozinha.token })).status === 409)
  check('caixa nao apaga sabor', (await call('DELETE', `/api/kitchen/flavors/${palmito.json.id}`, { token: caixa.token })).status === 403)

  // Sabor novo ja entra valendo o preco corrente — nao fica como "sem preco".
  const comValor = (await call('GET', '/api/state', { token: admin.token })).json
  check(
    'sabor novo ja vale o preco corrente',
    comValor.config.unitPriceCents === 1000,
    String(comValor.config.unitPriceCents)
  )

  /* --------------------------------------------------------------- admin */

  check('admin ve os codigos', (await call('GET', '/api/admin/codes', { token: admin.token })).json.length === 3)
  check('caixa nao ve os codigos', (await call('GET', '/api/admin/codes', { token: caixa.token })).status === 403)
  check('admin troca um codigo', (await call('PUT', '/api/admin/codes/caixa', { token: admin.token, body: { code: 'VENDA1' } })).status === 200)
  check('codigo duplicado e barrado', (await call('PUT', '/api/admin/codes/cozinha', { token: admin.token, body: { code: 'VENDA1' } })).status === 409)
  check('codigo novo ja funciona', (await call('POST', '/api/auth/login', { body: { code: 'VENDA1' } })).json.role === 'caixa')

  // Volta aos codigos combinados pela linha de comando (npm run codigos -- --padrao)
  const restaurou = spawnSync(process.execPath, [join(__dirname, 'codigos.js'), '--padrao'], {
    env: { ...process.env, DATA_DIR },
    encoding: 'utf8',
  })
  check('script restaura os codigos padrao', restaurou.status === 0, (restaurou.stderr || '').slice(0, 200))
  check('codigo padrao volta a valer', (await call('POST', '/api/auth/login', { body: { code: 'UMPCAI' } })).json.role === 'caixa')
  check('codigo improvisado deixa de valer', (await call('POST', '/api/auth/login', { body: { code: 'VENDA1' } })).status === 401)

  /* --------------------------------------------------- custos e liquido */

  check('caixa nao lanca custo', (await call('POST', '/api/admin/custos', { token: caixa.token, body: { description: 'x', category: 'Outros', amount: 10 } })).status === 403)
  check('custo sem categoria valida', (await call('POST', '/api/admin/custos', { token: admin.token, body: { description: 'x', category: 'Nada', amount: 10 } })).status === 400)
  check('custo com valor zero', (await call('POST', '/api/admin/custos', { token: admin.token, body: { description: 'x', category: 'Outros', amount: 0 } })).status === 400)

  const custo1 = await call('POST', '/api/admin/custos', {
    token: admin.token,
    body: { description: 'Farinha de trigo 10kg', category: 'Ingredientes', amount: 5 },
  })
  check('custo lancado', custo1.status === 201 && custo1.json.amountCents === 500, JSON.stringify(custo1.json))

  const custo2 = await call('POST', '/api/admin/custos', {
    token: admin.token,
    body: { description: 'Gas de cozinha', category: 'Gas', amount: 3.5 },
  })
  check('segundo custo lancado', custo2.status === 201 && custo2.json.amountCents === 350)

  const comCustos = (await call('GET', '/api/state', { token: admin.token })).json
  check('total de custos somado', comCustos.kpi.costsCents === 850, JSON.stringify(comCustos.kpi.costsCents))
  check(
    'valor liquido = faturamento - custos',
    comCustos.kpi.netCents === comCustos.kpi.revenueCents - 850,
    `liquido ${comCustos.kpi.netCents}, bruto ${comCustos.kpi.revenueCents}`
  )
  check('custos aparecem na lista', comCustos.costs.length === 2, JSON.stringify(comCustos.costs.length))

  check('apagar custo', (await call('DELETE', `/api/admin/custos/${custo2.json.id}`, { token: admin.token })).status === 200)
  const semCusto2 = (await call('GET', '/api/state', { token: admin.token })).json
  check('total recalcula ao apagar', semCusto2.kpi.costsCents === 500, JSON.stringify(semCusto2.kpi.costsCents))

  const csv = await call('GET', '/api/admin/relatorio.csv', { token: admin.token })
  check('relatorio CSV sai preenchido', typeof csv.json === 'string' && csv.json.includes('Ana Clara'))
  check('CSV traz custos e resultado', csv.json.includes('Farinha de trigo') && csv.json.includes('Valor liquido'))

  /* --------------------------------------------------------- pagamento */

  const paraPagar = await call('POST', '/api/orders', {
    token: caixa.token,
    body: { customerName: 'Paga Depois', paymentMethod: 'Dinheiro', items: [{ flavorId: carne.id, qty: 1 }] },
  })
  const idPagar = paraPagar.json.id

  const antesPag = (await call('GET', '/api/state', { token: admin.token })).json
  const pedidoNovo = antesPag.orders.find((o) => o.id === idPagar)
  check('pedido nasce nao pago', pedidoNovo.pago === false, JSON.stringify(pedidoNovo.paidAt))
  const aReceberAntes = antesPag.kpi.aReceberCents

  check('caixa marca como pago', (await call('POST', `/api/orders/${idPagar}/pagar`, { token: caixa.token })).status === 200)
  check('marcar de novo e barrado', (await call('POST', `/api/orders/${idPagar}/pagar`, { token: caixa.token })).status === 409)

  const posPag = (await call('GET', '/api/state', { token: admin.token })).json
  check('pedido fica marcado como pago', posPag.orders.find((o) => o.id === idPagar).pago === true)
  check(
    'valor sai de "a receber" e entra em "recebido"',
    posPag.kpi.aReceberCents === aReceberAntes - paraPagar.json.totalCents,
    `antes ${aReceberAntes}, depois ${posPag.kpi.aReceberCents}`
  )
  check(
    'recebido + a receber = faturamento',
    posPag.kpi.recebidoCents + posPag.kpi.aReceberCents === posPag.kpi.revenueCents,
    JSON.stringify([posPag.kpi.recebidoCents, posPag.kpi.aReceberCents, posPag.kpi.revenueCents])
  )

  check('cozinha tambem pode marcar', (await call('POST', `/api/orders/${idPagar}/despagar`, { token: cozinha.token })).status === 200)
  check('desmarcar volta para nao pago', (await call('GET', '/api/state', { token: admin.token })).json.orders.find((o) => o.id === idPagar).pago === false)
  check('desmarcar duas vezes e barrado', (await call('POST', `/api/orders/${idPagar}/despagar`, { token: admin.token })).status === 409)

  await call('POST', `/api/orders/${idPagar}/pagar`, { token: admin.token })

  /* ------------------------------------------------------ exportar dados */

  const expPedidos = await call('GET', '/api/admin/exportar/pedidos.csv', { token: admin.token })
  check('exporta pedidos', typeof expPedidos.json === 'string' && expPedidos.json.includes('Ana Clara'), String(expPedidos.status))
  check('exportacao de pedidos traz o que falta retirar', expPedidos.json.includes('A retirar'))

  const expItens = await call('GET', '/api/admin/exportar/itens.csv', { token: admin.token })
  check('exporta um sabor por linha', typeof expItens.json === 'string' && expItens.json.includes('Carne') && expItens.json.includes('Queijo'))

  const expEstoque = await call('GET', '/api/admin/exportar/estoque.csv', { token: admin.token })
  check('exporta as movimentacoes de estoque', typeof expEstoque.json === 'string' && expEstoque.json.includes('inicial'))

  const expCustos = await call('GET', '/api/admin/exportar/custos.csv', { token: admin.token })
  check('exporta os custos', typeof expCustos.json === 'string' && expCustos.json.includes('Farinha de trigo'))

  const completo = await call('GET', '/api/admin/exportar/completo.json', { token: admin.token })
  check(
    'exportacao completa traz todas as tabelas',
    completo.json && ['sabores', 'pedidos', 'itens', 'estoque', 'custos', 'historicoPrecos'].every((k) => Array.isArray(completo.json[k])),
    JSON.stringify(Object.keys(completo.json || {}))
  )
  check(
    'exportacao completa nao leva os codigos de acesso',
    !JSON.stringify(completo.json).includes('UMPADM'),
    'codigo vazou na exportacao'
  )
  check('caixa nao exporta', (await call('GET', '/api/admin/exportar/completo.json', { token: caixa.token })).status === 403)

  /* -------------------------------------------------- planilha do Excel */

  const planilha = await fetch(BASE + '/api/admin/exportar/planilha.xlsx', {
    headers: { Authorization: 'Bearer ' + admin.token },
  })
  const xlsx = Buffer.from(await planilha.arrayBuffer())
  check('planilha responde', planilha.status === 200, String(planilha.status))
  // Todo .xlsx e um ZIP: comeca com "PK\x03\x04"
  check('arquivo e um xlsx de verdade', xlsx.subarray(0, 4).toString('hex') === '504b0304', xlsx.subarray(0, 4).toString('hex'))
  check('planilha tem tamanho plausivel', xlsx.length > 2000, xlsx.length + ' bytes')

  // As pecas obrigatorias aparecem no diretorio central do ZIP, em texto claro
  const comoTexto = xlsx.toString('latin1')
  check(
    'planilha traz as abas esperadas',
    ['xl/workbook.xml', 'xl/styles.xml', 'xl/worksheets/sheet1.xml', 'xl/worksheets/sheet7.xml'].every((p) => comoTexto.includes(p)),
    'faltou alguma parte do pacote'
  )
  check('nomes das abas estao no workbook', comoTexto.includes('[Content_Types]'), 'pacote incompleto')

  const planilhaCaixa = await fetch(BASE + '/api/admin/exportar/planilha.xlsx', {
    headers: { Authorization: 'Bearer ' + caixa.token },
  })
  check('caixa nao baixa a planilha', planilhaCaixa.status === 403)

  /* --------------------------------------------- backup gravado em disco */

  // Mesmo caminho que o sistema usa ao ser desligado. DATA_DIR/BACKUP_DIR sao
  // definidos ANTES do import para o modulo nao escrever na pasta de verdade.
  process.env.DATA_DIR = DATA_DIR
  process.env.BACKUP_DIR = BACKUP_DIR
  const { montarAbas, salvarBackup, temDados } = await import(
    'file://' + join(__dirname, '..', 'planilha.js').replace(/\\/g, '/')
  )

  // Os nomes das abas moram no workbook.xml, que vai comprimido dentro do ZIP —
  // por isso conferimos na origem, nao procurando texto nos bytes do arquivo.
  const abas = montarAbas()
  const esperadas = ['Resumo', 'Pedidos', 'Itens dos pedidos', 'Sabores', 'Estoque', 'Custos', 'Historico de precos']
  check(
    'planilha tem uma aba por assunto',
    esperadas.every((e) => abas.some((a) => a.nome === e)),
    'abas: ' + abas.map((a) => a.nome).join(', ')
  )
  check(
    'aba de pedidos traz a coluna de pagamento',
    abas.find((a) => a.nome === 'Pedidos').colunas.some((c) => c.titulo === 'Pago?'),
    'faltou a coluna Pago?'
  )
  check(
    'aba de resumo mostra recebido e a receber',
    abas.find((a) => a.nome === 'Resumo').linhas.some((l) => l.item === 'Ja recebido') &&
      abas.find((a) => a.nome === 'Resumo').linhas.some((l) => l.item === 'Ainda a receber'),
    JSON.stringify(abas.find((a) => a.nome === 'Resumo').linhas.map((l) => l.item))
  )
  check('reconhece que ha dados para salvar', temDados() === true)

  const arquivo = salvarBackup('teste')
  check('backup gravado em disco', arquivo && existsSync(arquivo), String(arquivo))
  if (arquivo) {
    const gravado = readFileSync(arquivo)
    check('arquivo gravado e um xlsx', gravado.subarray(0, 4).toString('hex') === '504b0304')
    check('arquivo gravado tem conteudo', gravado.length > 2000, gravado.length + ' bytes')
    check('nome do arquivo diz o motivo', arquivo.includes('-teste.xlsx'), arquivo)
  }

  /* -------------------------------------------------------- apagar pedido */

  const paraApagar = await call('POST', '/api/orders', {
    token: caixa.token,
    body: { customerName: 'Some Daqui', paymentMethod: 'PIX', items: [{ flavorId: carne.id, qty: 2 }] },
  })
  check('pedido de teste criado', paraApagar.status === 201, JSON.stringify(paraApagar.json))
  const numeroApagado = paraApagar.json.number

  const antesDeApagar = (await call('GET', '/api/state', { token: admin.token })).json
  const dispAntes = antesDeApagar.flavors.find((f) => f.id === carne.id).available

  check('caixa nao apaga pedido', (await call('DELETE', `/api/orders/${paraApagar.json.id}`, { token: caixa.token })).status === 403)
  check('cozinha nao apaga pedido', (await call('DELETE', `/api/orders/${paraApagar.json.id}`, { token: cozinha.token })).status === 403)

  const apagou = await call('DELETE', `/api/orders/${paraApagar.json.id}`, { token: admin.token })
  check('admin apaga o pedido', apagou.status === 200, JSON.stringify(apagou.json))
  check('resposta diz o que foi apagado', apagou.json.apagado && apagou.json.apagado.customerName === 'Some Daqui', JSON.stringify(apagou.json.apagado))

  const posApagar = (await call('GET', '/api/state', { token: admin.token })).json
  check('pedido some da listagem', !posApagar.orders.some((o) => o.number === numeroApagado))
  check('pasteis voltam ao estoque', posApagar.flavors.find((f) => f.id === carne.id).available === dispAntes + 2)
  check('apagar pedido inexistente da 404', (await call('DELETE', `/api/orders/${paraApagar.json.id}`, { token: admin.token })).status === 404)

  // O numero do pedido apagado nao pode ser reaproveitado.
  const depoisDoApagado = await call('POST', '/api/orders', {
    token: caixa.token,
    body: { customerName: 'Depois', paymentMethod: 'PIX', items: [{ flavorId: carne.id, qty: 1 }] },
  })
  check(
    'numero do pedido apagado nao volta',
    depoisDoApagado.json.number > numeroApagado,
    `apagado #${numeroApagado}, novo #${depoisDoApagado.json.number}`
  )
  await call('DELETE', `/api/orders/${depoisDoApagado.json.id}`, { token: admin.token })

  await call('POST', '/api/admin/revogar-acessos', { token: admin.token })
  check('revogar derruba os tokens', (await call('GET', '/api/state', { token: caixa.token })).status === 401)

  const admin2 = (await call('POST', '/api/auth/login', { body: { code: codigos.admin } })).json
  check('zerar exige confirmacao', (await call('POST', '/api/admin/zerar-evento', { token: admin2.token, body: {} })).status === 400)
  check('zerar evento', (await call('POST', '/api/admin/zerar-evento', { token: admin2.token, body: { confirmacao: 'ZERAR' } })).status === 200)

  const zerado = (await call('GET', '/api/state', { token: admin2.token })).json
  check(
    'evento zerado mantem sabores e o valor do pastel',
    zerado.orders.length === 0 && zerado.totals.produced === 0 && zerado.config.unitPriceCents === 1000,
    JSON.stringify([zerado.totals, zerado.config.unitPriceCents])
  )
  check('evento zerado limpa os custos', zerado.costs.length === 0 && zerado.kpi.costsCents === 0)

  /* ------------------------------------------------------------ resultado */

  console.log(`\n${aprovados.length} verificacoes passaram.`)
  if (falhas.length) {
    console.log(`${falhas.length} FALHARAM:`)
    for (const f of falhas) console.log('  x ' + f)
    encerrar(1)
  }
  console.log('Sistema pronto para o evento.\n')
  encerrar(0)
} catch (err) {
  console.error('\nErro durante os testes:', err)
  encerrar(1)
}

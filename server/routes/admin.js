import { Router } from 'express'
import { requireAuth } from '../auth.js'
import { COST_CATEGORIES, db, generateCode, getConfig, getInt, ROLES, setConfig, transaction } from '../db.js'
import { BadRequest } from '../errors.js'
import { broadcastState } from '../events.js'
import { gerarPlanilha } from '../planilha.js'
import { totalCostsCents } from '../state.js'

const router = Router()
const admin = requireAuth('admin')

/* --------------------------------------------------------------- custos */

router.post('/custos', admin, (req, res, next) => {
  try {
    const description = String(req.body?.description || '').trim()
    const category = String(req.body?.category || '').trim()
    const note = String(req.body?.note || '').trim() || null
    const reais = Number(req.body?.amount)

    if (!description) throw new BadRequest('Descreva o custo (ex.: farinha de trigo).')
    if (description.length > 80) throw new BadRequest('Descricao muito longa (maximo 80 caracteres).')
    if (!COST_CATEGORIES.includes(category)) throw new BadRequest('Escolha uma categoria.')
    if (!Number.isFinite(reais) || reais <= 0) throw new BadRequest('Informe um valor maior que zero.')
    if (reais > 100000) throw new BadRequest('Valor acima do limite permitido.')

    const amountCents = Math.round(reais * 100)
    const { lastInsertRowid } = db
      .prepare(
        'INSERT INTO costs (description, category, amount_cents, note, created_by) VALUES (?, ?, ?, ?, ?)'
      )
      .run(description, category, amountCents, note, req.role)

    broadcastState()
    res.status(201).json({ id: Number(lastInsertRowid), description, category, amountCents })
  } catch (err) {
    next(err)
  }
})

router.delete('/custos/:id', admin, (req, res, next) => {
  try {
    const id = Number(req.params.id)
    const custo = db.prepare('SELECT id, description FROM costs WHERE id = ?').get(id)
    if (!custo) throw new BadRequest('Custo nao encontrado.', 404)

    db.prepare('DELETE FROM costs WHERE id = ?').run(id)

    broadcastState()
    res.json({ ok: true, id, description: custo.description })
  } catch (err) {
    next(err)
  }
})

/* ------------------------------------------------------- codigos de acesso */

router.get('/codes', admin, (req, res) => {
  res.json(ROLES.map((role) => ({ role, code: getConfig(`code_${role}`, '') })))
})

router.put('/codes/:role', admin, (req, res, next) => {
  try {
    const role = String(req.params.role)
    if (!ROLES.includes(role)) throw new BadRequest('Perfil invalido.')

    const code = String(req.body?.code ?? generateCode()).trim().toUpperCase()
    if (code.length < 4) throw new BadRequest('O codigo precisa ter pelo menos 4 caracteres.')
    if (code.length > 20) throw new BadRequest('O codigo pode ter no maximo 20 caracteres.')

    const clash = ROLES.find((r) => r !== role && String(getConfig(`code_${r}`, '')).toUpperCase() === code)
    if (clash) throw new BadRequest(`Esse codigo ja e usado pelo perfil ${clash}.`, 409)

    setConfig(`code_${role}`, code)
    res.json({ role, code })
  } catch (err) {
    next(err)
  }
})

// Derruba todas as sessoes abertas (util se um codigo vazou no meio do evento).
router.post('/revogar-acessos', admin, (req, res) => {
  setConfig('token_version', getInt('token_version', 1) + 1)
  res.json({ ok: true })
})

/* --------------------------------------------------------------- evento */

router.put('/event', admin, (req, res, next) => {
  try {
    const name = String(req.body?.eventName || '').trim()
    if (!name) throw new BadRequest('Informe o nome do evento.')
    if (name.length > 60) throw new BadRequest('Nome do evento muito longo (maximo 60 caracteres).')
    setConfig('event_name', name)
    broadcastState()
    res.json({ eventName: name })
  } catch (err) {
    next(err)
  }
})

/**
 * Zera o evento para comecar outro dia de venda: apaga pedidos e estoque,
 * mantendo sabores, codigos e o valor unitario. Exige a frase de confirmacao.
 */
router.post('/zerar-evento', admin, (req, res, next) => {
  try {
    if (String(req.body?.confirmacao || '').trim().toUpperCase() !== 'ZERAR') {
      throw new BadRequest('Para zerar o evento envie a confirmacao "ZERAR".')
    }

    const antes = {
      pedidos: db.prepare('SELECT COUNT(*) AS n FROM orders').get().n,
      movimentacoes: db.prepare('SELECT COUNT(*) AS n FROM stock_movements').get().n,
      custos: db.prepare('SELECT COUNT(*) AS n FROM costs').get().n,
    }

    transaction(() => {
      db.exec('DELETE FROM order_items')
      db.exec('DELETE FROM orders')
      db.exec('DELETE FROM stock_movements')
      db.exec('DELETE FROM costs')
      db.exec("DELETE FROM sqlite_sequence WHERE name IN ('orders','order_items','stock_movements','costs')")
    })

    broadcastState()
    res.json({ ok: true, apagados: antes })
  } catch (err) {
    next(err)
  }
})

/* ------------------------------------------------------------- relatorios */

router.get('/orders', admin, (req, res) => {
  const status = String(req.query.status || '')
  const filtered = ['pendente', 'parcial', 'retirado', 'cancelado'].includes(status)
  const where = filtered ? 'WHERE o.status = ?' : ''
  const params = filtered ? [status] : []
  res.json(
    db
      .prepare(
        `SELECT o.id, o.number, o.customer_name AS customerName, o.payment_method AS paymentMethod,
                o.unit_price_cents AS unitPriceCents, o.total_cents AS totalCents,
                o.qty_total AS qtyTotal, o.status, o.created_at AS createdAt,
                o.delivered_at AS deliveredAt,
                (SELECT GROUP_CONCAT(f.name || ' x' || i.qty, ', ')
                   FROM order_items i JOIN flavors f ON f.id = i.flavor_id
                  WHERE i.order_id = o.id) AS itemsLabel
           FROM orders o ${where}
          ORDER BY o.number DESC`
      )
      .all(...params)
  )
})

function csvCell(value) {
  const text = value === null || value === undefined ? '' : String(value)
  return `"${text.replace(/"/g, '""')}"`
}

const reais = (cents) => (cents / 100).toFixed(2).replace('.', ',')
const linha = (campos) => campos.map(csvCell).join(';')

/** Manda um CSV pronto para o Excel: BOM no inicio, ; como separador, CRLF. */
function enviarCsv(res, nome, lines) {
  const stamp = new Date().toISOString().slice(0, 10)
  res.set('Content-Type', 'text/csv; charset=utf-8')
  res.set('Content-Disposition', `attachment; filename="${nome}-${stamp}.csv"`)
  res.send('﻿' + lines.join('\r\n'))
}

/* ------------------------------------------------------- exportar os dados */

/** Um pedido por linha — a listagem completa de vendas. */
router.get('/exportar/pedidos.csv', admin, (req, res) => {
  const rows = db
    .prepare(
      `SELECT o.number, o.customer_name, o.payment_method, o.qty_total,
              o.total_cents, o.status, o.note, o.created_by,
              o.created_at, o.delivered_at, o.canceled_at,
              (SELECT GROUP_CONCAT(
                        f.name || ' x' || i.qty || ' a ' ||
                        printf('%.2f', i.unit_price_cents / 100.0), ' + ')
                 FROM order_items i JOIN flavors f ON f.id = i.flavor_id
                WHERE i.order_id = o.id) AS itens,
              (SELECT COALESCE(SUM(i.delivered_qty), 0)
                 FROM order_items i WHERE i.order_id = o.id) AS entregues
         FROM orders o ORDER BY o.number`
    )
    .all()

  const lines = [
    linha([
      'Pedido', 'Comprador', 'Itens (sabor x qtd a preco)', 'Quantidade', 'Ja retirados',
      'A retirar', 'Total', 'Forma de pagamento', 'Status', 'Lancado por',
      'Criado em', 'Retirado em', 'Cancelado em', 'Observacao',
    ]),
  ]
  for (const r of rows) {
    lines.push(
      linha([
        r.number, r.customer_name, r.itens, r.qty_total, r.entregues,
        r.qty_total - r.entregues, reais(r.total_cents), r.payment_method, r.status,
        r.created_by, r.created_at, r.delivered_at, r.canceled_at, r.note,
      ])
    )
  }
  enviarCsv(res, 'pedidos', lines)
})

/** Um sabor por linha — serve para somar quanto cada sabor rendeu. */
router.get('/exportar/itens.csv', admin, (req, res) => {
  const rows = db
    .prepare(
      `SELECT o.number, o.customer_name, o.status, o.payment_method, o.created_at,
              f.name AS sabor, i.qty, i.delivered_qty, i.unit_price_cents, i.subtotal_cents
         FROM order_items i
         JOIN orders o ON o.id = i.order_id
         JOIN flavors f ON f.id = i.flavor_id
        ORDER BY o.number, f.sort_order, f.name`
    )
    .all()

  const lines = [
    linha([
      'Pedido', 'Comprador', 'Sabor', 'Quantidade', 'Ja retirados', 'Preco unitario',
      'Subtotal', 'Status do pedido', 'Forma de pagamento', 'Criado em',
    ]),
  ]
  for (const r of rows) {
    lines.push(
      linha([
        r.number, r.customer_name, r.sabor, r.qty, r.delivered_qty,
        reais(r.unit_price_cents), reais(r.subtotal_cents), r.status, r.payment_method, r.created_at,
      ])
    )
  }
  enviarCsv(res, 'itens-dos-pedidos', lines)
})

router.get('/exportar/custos.csv', admin, (req, res) => {
  const rows = db
    .prepare(
      'SELECT description, category, amount_cents, note, created_by, created_at FROM costs ORDER BY id'
    )
    .all()

  const lines = [linha(['Descricao', 'Categoria', 'Valor', 'Observacao', 'Lancado por', 'Lancado em'])]
  for (const c of rows) {
    lines.push(linha([c.description, c.category, reais(c.amount_cents), c.note, c.created_by, c.created_at]))
  }
  enviarCsv(res, 'custos', lines)
})

router.get('/exportar/estoque.csv', admin, (req, res) => {
  const rows = db
    .prepare(
      `SELECT m.created_at, f.name AS sabor, m.qty, m.kind, m.note, m.created_by
         FROM stock_movements m JOIN flavors f ON f.id = m.flavor_id
        ORDER BY m.id`
    )
    .all()

  const lines = [linha(['Data', 'Sabor', 'Quantidade', 'Tipo', 'Observacao', 'Lancado por'])]
  for (const m of rows) {
    lines.push(linha([m.created_at, m.sabor, m.qty, m.kind, m.note, m.created_by]))
  }
  enviarCsv(res, 'estoque', lines)
})

/**
 * A planilha do Excel com uma aba por assunto — e o mesmo arquivo que o sistema
 * grava sozinho em backups/ ao ser desligado.
 */
router.get('/exportar/planilha.xlsx', admin, (req, res, next) => {
  try {
    const stamp = new Date().toISOString().slice(0, 10)
    res.set('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
    res.set('Content-Disposition', `attachment; filename="evento-${stamp}.xlsx"`)
    res.send(gerarPlanilha())
  } catch (err) {
    next(err)
  }
})

/**
 * Tudo o que existe no banco num arquivo so — pedidos, itens, sabores, estoque,
 * custos e historico de precos. Serve de copia de seguranca legivel e para quem
 * quiser cruzar os dados em outra ferramenta. Nao leva os codigos de acesso.
 */
router.get('/exportar/completo.json', admin, (req, res) => {
  const tudo = {
    exportadoEm: new Date().toISOString(),
    evento: getConfig('event_name', 'Venda de Pasteis'),
    resumo: {
      faturamentoCentavos: db
        .prepare("SELECT COALESCE(SUM(total_cents), 0) AS t FROM orders WHERE status <> 'cancelado'")
        .get().t,
      custosCentavos: totalCostsCents(),
    },
    sabores: db
      .prepare(
        'SELECT id, name, price_cents, active, sort_order, created_at FROM flavors ORDER BY sort_order, name'
      )
      .all(),
    pedidos: db
      .prepare(
        `SELECT id, number, customer_name, payment_method, unit_price_cents, total_cents,
                qty_total, status, note, created_by, created_at, delivered_at, canceled_at
           FROM orders ORDER BY number`
      )
      .all(),
    itens: db
      .prepare(
        `SELECT i.id, i.order_id, o.number AS order_number, i.flavor_id, f.name AS flavor_name,
                i.qty, i.delivered_qty, i.unit_price_cents, i.subtotal_cents
           FROM order_items i
           JOIN orders o ON o.id = i.order_id
           JOIN flavors f ON f.id = i.flavor_id
          ORDER BY o.number, i.id`
      )
      .all(),
    estoque: db
      .prepare(
        `SELECT m.id, m.flavor_id, f.name AS flavor_name, m.qty, m.kind, m.note,
                m.created_by, m.created_at
           FROM stock_movements m JOIN flavors f ON f.id = m.flavor_id ORDER BY m.id`
      )
      .all(),
    custos: db
      .prepare(
        'SELECT id, description, category, amount_cents, note, created_by, created_at FROM costs ORDER BY id'
      )
      .all(),
    historicoPrecos: db
      .prepare(
        `SELECT h.id, h.flavor_id, f.name AS flavor_name, h.unit_price_cents,
                h.changed_by, h.created_at
           FROM price_history h LEFT JOIN flavors f ON f.id = h.flavor_id ORDER BY h.id`
      )
      .all(),
  }
  tudo.resumo.liquidoCentavos = tudo.resumo.faturamentoCentavos - tudo.resumo.custosCentavos

  const stamp = new Date().toISOString().slice(0, 10)
  res.set('Content-Type', 'application/json; charset=utf-8')
  res.set('Content-Disposition', `attachment; filename="ump-vendas-completo-${stamp}.json"`)
  res.send(JSON.stringify(tudo, null, 2))
})

router.get('/relatorio.csv', admin, (req, res) => {
  const rows = db
    .prepare(
      `SELECT o.number, o.customer_name, o.payment_method, o.qty_total,
              o.unit_price_cents, o.total_cents, o.status, o.created_at, o.delivered_at,
              (SELECT GROUP_CONCAT(
                        f.name || ' x' || i.qty || ' a ' ||
                        printf('%.2f', i.unit_price_cents / 100.0), ' + ')
                 FROM order_items i JOIN flavors f ON f.id = i.flavor_id
                WHERE i.order_id = o.id) AS itens,
              (SELECT COALESCE(SUM(i.delivered_qty), 0)
                 FROM order_items i WHERE i.order_id = o.id) AS entregues
         FROM orders o ORDER BY o.number`
    )
    .all()

  const lines = [
    linha([
      'Pedido', 'Comprador', 'Itens (sabor x qtd a preco)', 'Quantidade', 'Ja retirados',
      'Valor medio unit.', 'Total', 'Forma de pagamento', 'Status', 'Criado em', 'Retirado em',
    ]),
  ]

  for (const r of rows) {
    lines.push(
      linha([
        r.number,
        r.customer_name,
        r.itens,
        r.qty_total,
        r.entregues,
        reais(r.unit_price_cents),
        reais(r.total_cents),
        r.payment_method,
        r.status,
        r.created_at,
        r.delivered_at,
      ])
    )
  }

  /* ------------------------------------------------- custos e resultado */

  const custos = db
    .prepare(
      'SELECT description, category, amount_cents, note, created_at FROM costs ORDER BY id'
    )
    .all()

  lines.push('', linha(['CUSTOS DO EVENTO']))
  lines.push(linha(['Descricao', 'Categoria', 'Valor', 'Observacao', 'Lancado em']))
  for (const c of custos) {
    lines.push(linha([c.description, c.category, reais(c.amount_cents), c.note, c.created_at]))
  }

  const faturamento = db
    .prepare("SELECT COALESCE(SUM(total_cents), 0) AS t FROM orders WHERE status <> 'cancelado'")
    .get().t
  const totalCustos = totalCostsCents()

  lines.push('', linha(['RESULTADO']))
  lines.push(linha(['Faturamento bruto', reais(faturamento)]))
  lines.push(linha(['Custos do evento', reais(totalCustos)]))
  lines.push(linha(['Valor liquido', reais(faturamento - totalCustos)]))

  const stamp = new Date().toISOString().slice(0, 10)
  res.set('Content-Type', 'text/csv; charset=utf-8')
  res.set('Content-Disposition', `attachment; filename="evento-${stamp}.csv"`)
  res.send('﻿' + lines.join('\r\n')) // BOM para o Excel abrir os acentos certos
})

export default router

import { statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { COST_CATEGORIES, db, getConfig, getInt, PAYMENT_METHODS } from './db.js'

const PUBLIC_INDEX = join(dirname(fileURLToPath(import.meta.url)), 'public', 'index.html')
let versaoCache = { valor: 'dev', ate: 0 }

/**
 * Identifica a versao do front-end servida agora. Uma aba aberta o dia todo
 * continua rodando o JS que baixou na primeira vez; comparando este valor com o
 * que ela viu ao carregar, o app percebe que foi atualizado e oferece recarregar.
 */
export function versaoDoApp(agora) {
  if (agora < versaoCache.ate) return versaoCache.valor
  try {
    const s = statSync(PUBLIC_INDEX)
    versaoCache = { valor: String(s.mtimeMs) + '-' + s.size, ate: agora + 10_000 }
  } catch {
    versaoCache = { valor: 'dev', ate: agora + 10_000 }
  }
  return versaoCache.valor
}

const ORDERS_IN_SNAPSHOT = 300

/**
 * Estoque por sabor.
 *  produzido  = soma das movimentacoes
 *  vendido    = soma dos itens de pedidos nao cancelados (reserva)
 *  entregue   = quanto ja saiu fisicamente da cozinha
 *  disponivel = produzido - vendido
 */
export function flavorsWithStock() {
  return db
    .prepare(
      `SELECT f.id,
              f.name,
              f.active,
              f.sort_order                                   AS sortOrder,
              COALESCE(m.produced, 0)                        AS produced,
              COALESCE(s.sold, 0)                            AS sold,
              COALESCE(s.delivered, 0)                       AS delivered,
              COALESCE(s.sold, 0) - COALESCE(s.delivered, 0) AS aRetirar,
              COALESCE(m.produced, 0) - COALESCE(s.sold, 0)  AS available,
              COALESCE(s.revenue, 0)                         AS revenueCents
         FROM flavors f
         LEFT JOIN (SELECT flavor_id, SUM(qty) AS produced
                      FROM stock_movements GROUP BY flavor_id) m ON m.flavor_id = f.id
         LEFT JOIN (SELECT i.flavor_id,
                           SUM(i.qty)            AS sold,
                           SUM(i.delivered_qty)  AS delivered,
                           SUM(i.subtotal_cents) AS revenue
                      FROM order_items i
                      JOIN orders o ON o.id = i.order_id
                     WHERE o.status <> 'cancelado'
                     GROUP BY i.flavor_id) s ON s.flavor_id = f.id
        ORDER BY f.sort_order, f.name`
    )
    .all()
    .map((f) => ({ ...f, active: !!f.active }))
}

export function totalCostsCents() {
  return db.prepare('SELECT COALESCE(SUM(amount_cents), 0) AS total FROM costs').get().total
}

function kpis() {
  const base = db
    .prepare(
      `SELECT COUNT(*)                                                          AS ordersCount,
              COALESCE(SUM(qty_total), 0)                                       AS pasteisSold,
              COALESCE(SUM(total_cents), 0)                                     AS revenueCents,
              COALESCE(SUM(CASE WHEN status = 'pendente' THEN 1 ELSE 0 END), 0) AS ordersPending,
              COALESCE(SUM(CASE WHEN status = 'parcial'  THEN 1 ELSE 0 END), 0) AS ordersPartial,
              COALESCE(SUM(CASE WHEN status = 'retirado' THEN 1 ELSE 0 END), 0) AS ordersDelivered
         FROM orders
        WHERE status <> 'cancelado'`
    )
    .get()

  const entrega = db
    .prepare(
      `SELECT COALESCE(SUM(i.delivered_qty), 0)         AS pasteisDelivered,
              COALESCE(SUM(i.qty - i.delivered_qty), 0) AS pasteisPending
         FROM order_items i JOIN orders o ON o.id = i.order_id
        WHERE o.status <> 'cancelado'`
    )
    .get()

  const canceled = db.prepare(`SELECT COUNT(*) AS n FROM orders WHERE status = 'cancelado'`).get().n

  // Quanto do faturamento ja virou dinheiro na mao e quanto ainda esta para receber.
  const caixa = db
    .prepare(
      `SELECT COALESCE(SUM(CASE WHEN paid_at IS NOT NULL THEN total_cents ELSE 0 END), 0) AS recebidoCents,
              COALESCE(SUM(CASE WHEN paid_at IS NULL     THEN total_cents ELSE 0 END), 0) AS aReceberCents,
              COALESCE(SUM(CASE WHEN paid_at IS NULL     THEN 1 ELSE 0 END), 0)           AS ordersNaoPagos
         FROM orders WHERE status <> 'cancelado'`
    )
    .get()

  const byPayment = db
    .prepare(
      `SELECT payment_method AS method, COUNT(*) AS count,
              COALESCE(SUM(total_cents), 0) AS totalCents
         FROM orders WHERE status <> 'cancelado'
        GROUP BY payment_method ORDER BY totalCents DESC`
    )
    .all()

  const costsCents = totalCostsCents()

  return {
    ...base,
    ...entrega,
    ...caixa,
    ordersCanceled: canceled,
    ticketMedioCents: base.ordersCount ? Math.round(base.revenueCents / base.ordersCount) : 0,
    costsCents,
    // O que sobra para a igreja depois de pagar as despesas do evento.
    netCents: base.revenueCents - costsCents,
    byPayment,
  }
}

function ordersSnapshot() {
  const orders = db
    .prepare(
      `SELECT id, number, customer_name AS customerName, payment_method AS paymentMethod,
              unit_price_cents AS unitPriceCents, total_cents AS totalCents,
              qty_total AS qtyTotal, status, note, created_by AS createdBy,
              created_at AS createdAt, delivered_at AS deliveredAt, canceled_at AS canceledAt,
              paid_at AS paidAt, updated_at AS updatedAt, updated_by AS updatedBy
         FROM orders ORDER BY number DESC LIMIT ?`
    )
    .all(ORDERS_IN_SNAPSHOT)

  if (orders.length === 0) return []

  const placeholders = orders.map(() => '?').join(',')
  const items = db
    .prepare(
      `SELECT i.order_id AS orderId, i.flavor_id AS flavorId, f.name AS flavorName,
              i.qty, i.delivered_qty AS deliveredQty,
              i.unit_price_cents AS unitPriceCents, i.subtotal_cents AS subtotalCents
         FROM order_items i JOIN flavors f ON f.id = i.flavor_id
        WHERE i.order_id IN (${placeholders})
        ORDER BY f.sort_order, f.name`
    )
    .all(...orders.map((o) => o.id))

  const byOrder = new Map()
  for (const it of items) {
    if (!byOrder.has(it.orderId)) byOrder.set(it.orderId, [])
    byOrder.get(it.orderId).push(it)
  }

  return orders.map((o) => {
    const lista = byOrder.get(o.id) || []
    const qtyDelivered = lista.reduce((sum, i) => sum + i.deliveredQty, 0)
    return {
      ...o,
      items: lista,
      qtyDelivered,
      qtyRemaining: o.qtyTotal - qtyDelivered,
      pago: Boolean(o.paidAt),
    }
  })
}

function costsList() {
  return db
    .prepare(
      `SELECT id, description, category, amount_cents AS amountCents, note,
              created_by AS createdBy, created_at AS createdAt
         FROM costs ORDER BY id DESC`
    )
    .all()
}

/** Retrato completo do sistema: e o que vai no GET /api/state e em cada push do SSE. */
export function buildState() {
  const agora = Date.now()
  const flavors = flavorsWithStock()
  const totals = flavors.reduce(
    (acc, f) => ({
      produced: acc.produced + f.produced,
      sold: acc.sold + f.sold,
      delivered: acc.delivered + f.delivered,
      available: acc.available + f.available,
    }),
    { produced: 0, sold: 0, delivered: 0, available: 0 }
  )

  return {
    ts: agora,
    versaoApp: versaoDoApp(agora),
    config: {
      eventName: getConfig('event_name', 'Venda de Pasteis'),
      // Valor unico do pastel, definido pelo caixa.
      unitPriceCents: getInt('unit_price_cents', 0),
      paymentMethods: PAYMENT_METHODS,
      costCategories: COST_CATEGORIES,
    },
    flavors,
    totals,
    kpi: kpis(),
    orders: ordersSnapshot(),
    costs: costsList(),
    ordersTruncated: db.prepare('SELECT COUNT(*) AS n FROM orders').get().n > ORDERS_IN_SNAPSHOT,
  }
}

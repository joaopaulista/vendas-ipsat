import { Router } from 'express'
import { requireAuth } from '../auth.js'
import { db, getInt, PAYMENT_METHODS, setConfig, transaction } from '../db.js'
import { BadRequest } from '../errors.js'
import { broadcastState } from '../events.js'
import { flavorsWithStock } from '../state.js'

const router = Router()

/** Valida o corpo e junta itens repetidos do mesmo sabor num item so. */
function parseItems(raw) {
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new BadRequest('Inclua pelo menos um sabor no pedido.')
  }
  const merged = new Map()
  for (const item of raw) {
    const flavorId = Number(item?.flavorId)
    const qty = Number(item?.qty)
    if (!Number.isInteger(flavorId) || flavorId <= 0) throw new BadRequest('Sabor invalido.')
    if (!Number.isInteger(qty) || qty <= 0) {
      throw new BadRequest('A quantidade deve ser um numero inteiro maior que zero.')
    }
    if (qty > 999) throw new BadRequest('Quantidade muito alta para um unico sabor (maximo 999).')
    merged.set(flavorId, (merged.get(flavorId) || 0) + qty)
  }
  return [...merged.entries()].map(([flavorId, qty]) => ({ flavorId, qty }))
}

router.post('/', requireAuth('caixa', 'admin'), (req, res, next) => {
  try {
    const customerName = String(req.body?.customerName || '').trim()
    const paymentMethod = String(req.body?.paymentMethod || '').trim()
    const note = String(req.body?.note || '').trim() || null
    const items = parseItems(req.body?.items)

    if (!customerName) throw new BadRequest('Informe o nome do comprador.')
    if (customerName.length > 80) throw new BadRequest('Nome do comprador muito longo.')
    if (!PAYMENT_METHODS.includes(paymentMethod)) throw new BadRequest('Escolha a forma de pagamento.')

    const order = transaction(() => {
      // O valor e lido dentro da transacao e congelado no pedido: mudar o preco
      // depois nao mexe no que ja foi vendido.
      const unitPriceCents = getInt('unit_price_cents', 0)
      if (unitPriceCents <= 0) {
        throw new BadRequest('O valor do pastel ainda nao foi definido. Informe o valor no caixa.')
      }

      const stock = new Map(flavorsWithStock().map((f) => [f.id, f]))

      const faltando = []
      for (const item of items) {
        const flavor = stock.get(item.flavorId)
        if (!flavor) throw new BadRequest('Sabor nao encontrado.')
        if (!flavor.active) throw new BadRequest(`O sabor ${flavor.name} esta desativado.`)
        if (item.qty > flavor.available) {
          faltando.push({ flavor: flavor.name, pedido: item.qty, disponivel: flavor.available })
        }
      }

      if (faltando.length) {
        const detalhe = faltando
          .map((f) => `${f.flavor}: pedido ${f.pedido}, disponivel ${f.disponivel}`)
          .join(' | ')
        throw new BadRequest(`Estoque insuficiente. ${detalhe}`, 409, { faltando })
      }

      const detalhados = items.map((i) => ({
        ...i,
        flavorName: stock.get(i.flavorId).name,
        unitPriceCents,
        subtotalCents: i.qty * unitPriceCents,
      }))

      const qtyTotal = detalhados.reduce((sum, i) => sum + i.qty, 0)
      const totalCents = qtyTotal * unitPriceCents
      // Contador que so cresce: apagar um pedido nao devolve o numero dele para a fila.
      const nextNumber = getInt('next_order_number', 1)
      setConfig('next_order_number', nextNumber + 1)

      const { lastInsertRowid } = db
        .prepare(
          `INSERT INTO orders (number, customer_name, payment_method, unit_price_cents,
                               total_cents, qty_total, note, created_by)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(nextNumber, customerName, paymentMethod, unitPriceCents, totalCents, qtyTotal, note, req.role)

      const orderId = Number(lastInsertRowid)
      const insertItem = db.prepare(
        `INSERT INTO order_items (order_id, flavor_id, qty, unit_price_cents, subtotal_cents)
         VALUES (?, ?, ?, ?, ?)`
      )
      for (const item of detalhados) {
        insertItem.run(orderId, item.flavorId, item.qty, item.unitPriceCents, item.subtotalCents)
      }

      return {
        id: orderId,
        number: nextNumber,
        customerName,
        paymentMethod,
        unitPriceCents,
        totalCents,
        qtyTotal,
        items: detalhados,
      }
    })

    broadcastState()
    res.status(201).json(order)
  } catch (err) {
    next(err)
  }
})

/* ------------------------------------------------------------------ retirada */

function carregarPedido(id) {
  if (!Number.isInteger(id)) throw new BadRequest('Pedido invalido.')
  const order = db
    .prepare('SELECT id, number, status, qty_total, paid_at FROM orders WHERE id = ?')
    .get(id)
  if (!order) throw new BadRequest('Pedido nao encontrado.', 404)
  return order
}

/**
 * O status do pedido sempre vem das quantidades entregues, nunca de um clique
 * solto: nada entregue = pendente, uma parte = parcial, tudo = retirado.
 * `delivered_at` so e carimbado quando o cliente leva a ultima unidade.
 */
function recalcularStatus(orderId) {
  const soma = db
    .prepare('SELECT SUM(qty) AS total, SUM(delivered_qty) AS entregue FROM order_items WHERE order_id = ?')
    .get(orderId)

  const entregue = soma.entregue || 0
  const status = entregue === 0 ? 'pendente' : entregue >= soma.total ? 'retirado' : 'parcial'

  db.prepare(
    `UPDATE orders
        SET status = ?,
            delivered_at = CASE WHEN ? = 'retirado' THEN COALESCE(delivered_at, datetime('now')) ELSE NULL END
      WHERE id = ?`
  ).run(status, status, orderId)

  return { status, entregue, total: soma.total, restante: soma.total - entregue }
}

// Retirada total: o cliente levou tudo o que faltava.
router.post('/:id/retirar', requireAuth('cozinha', 'admin'), (req, res, next) => {
  try {
    const order = carregarPedido(Number(req.params.id))
    if (order.status === 'cancelado') throw new BadRequest(`O pedido #${order.number} esta cancelado.`, 409)
    if (order.status === 'retirado') throw new BadRequest(`O pedido #${order.number} ja foi retirado por inteiro.`, 409)

    const resultado = transaction(() => {
      db.prepare('UPDATE order_items SET delivered_qty = qty WHERE order_id = ?').run(order.id)
      return recalcularStatus(order.id)
    })

    broadcastState()
    res.json({ ok: true, id: order.id, number: order.number, ...resultado })
  } catch (err) {
    next(err)
  }
})

/**
 * Retirada parcial: o cliente leva parte agora e volta depois pelo resto.
 * O corpo traz o que esta saindo NESTE momento, por sabor.
 */
router.post('/:id/retirar-parcial', requireAuth('cozinha', 'admin'), (req, res, next) => {
  try {
    const order = carregarPedido(Number(req.params.id))
    if (order.status === 'cancelado') throw new BadRequest(`O pedido #${order.number} esta cancelado.`, 409)
    if (order.status === 'retirado') throw new BadRequest(`O pedido #${order.number} ja foi retirado por inteiro.`, 409)

    const pedidos = parseItems(req.body?.items)

    const resultado = transaction(() => {
      const itens = db
        .prepare(
          `SELECT i.id, i.flavor_id AS flavorId, i.qty, i.delivered_qty AS deliveredQty, f.name
             FROM order_items i JOIN flavors f ON f.id = i.flavor_id
            WHERE i.order_id = ?`
        )
        .all(order.id)

      const porSabor = new Map(itens.map((i) => [i.flavorId, i]))
      const atualizar = db.prepare('UPDATE order_items SET delivered_qty = delivered_qty + ? WHERE id = ?')

      for (const entrega of pedidos) {
        const item = porSabor.get(entrega.flavorId)
        if (!item) throw new BadRequest(`O pedido #${order.number} nao tem esse sabor.`)
        const restante = item.qty - item.deliveredQty
        if (entrega.qty > restante) {
          throw new BadRequest(
            `${item.name}: o cliente ainda tem ${restante} para retirar, nao ${entrega.qty}.`,
            409
          )
        }
        atualizar.run(entrega.qty, item.id)
      }

      return recalcularStatus(order.id)
    })

    broadcastState()
    res.json({ ok: true, id: order.id, number: order.number, ...resultado })
  } catch (err) {
    next(err)
  }
})

// Correcao: desfaz tudo o que ja tinha sido entregue e volta o pedido para a fila.
router.post('/:id/reabrir', requireAuth('cozinha', 'admin'), (req, res, next) => {
  try {
    const order = carregarPedido(Number(req.params.id))
    if (order.status === 'cancelado') throw new BadRequest(`O pedido #${order.number} esta cancelado.`, 409)
    if (order.status === 'pendente') throw new BadRequest(`O pedido #${order.number} ja esta na fila.`, 409)

    const resultado = transaction(() => {
      db.prepare('UPDATE order_items SET delivered_qty = 0 WHERE order_id = ?').run(order.id)
      return recalcularStatus(order.id)
    })

    broadcastState()
    res.json({ ok: true, id: order.id, number: order.number, ...resultado })
  } catch (err) {
    next(err)
  }
})

/* --------------------------------------------------------------- pagamento */

/**
 * Marca que o dinheiro do pedido entrou. Quem recebe pode ser o caixa (na venda)
 * ou a cozinha (se o cliente so paga ao retirar), entao os dois podem marcar.
 */
router.post('/:id/pagar', requireAuth('caixa', 'cozinha', 'admin'), (req, res, next) => {
  try {
    const order = carregarPedido(Number(req.params.id))
    if (order.status === 'cancelado') {
      throw new BadRequest(`O pedido #${order.number} esta cancelado.`, 409)
    }
    if (order.paid_at) throw new BadRequest(`O pedido #${order.number} ja esta pago.`, 409)

    db.prepare("UPDATE orders SET paid_at = datetime('now') WHERE id = ?").run(order.id)

    broadcastState()
    res.json({ ok: true, id: order.id, number: order.number, pago: true })
  } catch (err) {
    next(err)
  }
})

// Desfaz a marcacao, para quando alguem clicou no pedido errado.
router.post('/:id/despagar', requireAuth('caixa', 'cozinha', 'admin'), (req, res, next) => {
  try {
    const order = carregarPedido(Number(req.params.id))
    if (!order.paid_at) throw new BadRequest(`O pedido #${order.number} ainda nao estava pago.`, 409)

    db.prepare('UPDATE orders SET paid_at = NULL WHERE id = ?').run(order.id)

    broadcastState()
    res.json({ ok: true, id: order.id, number: order.number, pago: false })
  } catch (err) {
    next(err)
  }
})

/* -------------------------------------------------------------- cancelamento */

// Cancelar devolve os pasteis ao estoque disponivel.
router.post('/:id/cancelar', requireAuth('admin'), (req, res, next) => {
  try {
    const order = carregarPedido(Number(req.params.id))
    if (order.status === 'cancelado') throw new BadRequest(`O pedido #${order.number} ja esta cancelado.`, 409)

    db.prepare("UPDATE orders SET status = 'cancelado', canceled_at = datetime('now') WHERE id = ?").run(order.id)

    broadcastState()
    res.json({ ok: true, id: order.id, number: order.number, status: 'cancelado' })
  } catch (err) {
    next(err)
  }
})

/**
 * Apaga o pedido de vez — some dos relatorios e do faturamento, e os pasteis
 * voltam ao disponivel. Diferente de cancelar, que deixa rastro. So o admin faz,
 * a tela pede confirmacao e o numero do pedido NAO volta para a fila: o contador
 * de numeracao so cresce, entao nenhum pedido novo herda o numero do apagado.
 */
router.delete('/:id', requireAuth('admin'), (req, res, next) => {
  try {
    const order = carregarPedido(Number(req.params.id))

    const resumo = db
      .prepare(
        `SELECT o.number, o.customer_name AS customerName, o.total_cents AS totalCents,
                o.qty_total AS qtyTotal,
                (SELECT GROUP_CONCAT(f.name || ' x' || i.qty, ', ')
                   FROM order_items i JOIN flavors f ON f.id = i.flavor_id
                  WHERE i.order_id = o.id) AS itens
           FROM orders o WHERE o.id = ?`
      )
      .get(order.id)

    transaction(() => {
      db.prepare('DELETE FROM order_items WHERE order_id = ?').run(order.id)
      db.prepare('DELETE FROM orders WHERE id = ?').run(order.id)
    })

    broadcastState()
    res.json({ ok: true, id: order.id, apagado: resumo })
  } catch (err) {
    next(err)
  }
})

router.post('/:id/restaurar', requireAuth('admin'), (req, res, next) => {
  try {
    const order = carregarPedido(Number(req.params.id))
    if (order.status !== 'cancelado') throw new BadRequest(`O pedido #${order.number} nao esta cancelado.`, 409)

    // Volta ao estado que as quantidades entregues indicam, nao sempre a 'pendente'.
    const resultado = transaction(() => {
      db.prepare("UPDATE orders SET canceled_at = NULL WHERE id = ?").run(order.id)
      return recalcularStatus(order.id)
    })

    broadcastState()
    res.json({ ok: true, id: order.id, number: order.number, ...resultado })
  } catch (err) {
    next(err)
  }
})

/* ------------------------------------------------------------------- edicao */

/**
 * Corrige um pedido ja lancado: nome, forma de pagamento, observacao e as
 * quantidades por sabor. E para o engano de balcao — "era 6, nao 8".
 *
 * Tres travas protegem o que ja aconteceu no mundo real:
 *  - o valor unitario continua congelado no que foi vendido, entao editar um
 *    pedido antigo nunca aplica um preco novo nele;
 *  - nenhum sabor pode cair abaixo do que o cliente ja levou da cozinha;
 *  - a quantidade nova precisa caber no estoque, contando de volta o que este
 *    mesmo pedido ja tinha reservado.
 */
router.put('/:id', requireAuth('caixa', 'admin'), (req, res, next) => {
  try {
    const id = Number(req.params.id)
    const order = carregarPedido(id)
    if (order.status === 'cancelado') {
      throw new BadRequest(`O pedido #${order.number} esta cancelado. Restaure ele antes de editar.`, 409)
    }

    const customerName = String(req.body?.customerName || '').trim()
    const paymentMethod = String(req.body?.paymentMethod || '').trim()
    const note = String(req.body?.note || '').trim() || null
    const items = parseItems(req.body?.items)

    if (!customerName) throw new BadRequest('Informe o nome do comprador.')
    if (customerName.length > 80) throw new BadRequest('Nome do comprador muito longo.')
    if (!PAYMENT_METHODS.includes(paymentMethod)) throw new BadRequest('Escolha a forma de pagamento.')

    const resultado = transaction(() => {
      const cabecalho = db
        .prepare('SELECT unit_price_cents AS unitPriceCents, total_cents AS totalCents FROM orders WHERE id = ?')
        .get(id)

      const antes = new Map(
        db
          .prepare(
            `SELECT flavor_id AS flavorId, qty, delivered_qty AS deliveredQty
               FROM order_items WHERE order_id = ?`
          )
          .all(id)
          .map((i) => [i.flavorId, i])
      )
      const depois = new Map(items.map((i) => [i.flavorId, i.qty]))
      const estoque = new Map(flavorsWithStock().map((f) => [f.id, f]))

      // Nada pode ficar abaixo do que ja saiu fisicamente da cozinha.
      for (const [flavorId, anterior] of antes) {
        if (anterior.deliveredQty <= 0) continue
        const nome = estoque.get(flavorId)?.name || 'sabor'
        const novaQtd = depois.get(flavorId) || 0
        if (novaQtd < anterior.deliveredQty) {
          throw new BadRequest(
            `O cliente ja retirou ${anterior.deliveredQty} de ${nome}. ` +
              `Nao da para deixar esse sabor com menos que isso.`,
            409
          )
        }
      }

      const faltando = []
      for (const item of items) {
        const flavor = estoque.get(item.flavorId)
        if (!flavor) throw new BadRequest('Sabor nao encontrado.')
        const anterior = antes.get(item.flavorId)?.qty || 0
        // Sabor desligado continua valendo enquanto a quantidade nao aumenta:
        // corrigir um pedido antigo nao deveria esbarrar nisso.
        if (!flavor.active && item.qty > anterior) {
          throw new BadRequest(`O sabor ${flavor.name} esta desativado e nao da para aumentar.`)
        }
        // O proprio pedido ja segura `anterior` unidades: elas voltam para a conta.
        const disponivel = flavor.available + anterior
        if (item.qty > disponivel) {
          faltando.push({ flavor: flavor.name, pedido: item.qty, disponivel })
        }
      }

      if (faltando.length) {
        const detalhe = faltando
          .map((f) => `${f.flavor}: pedido ${f.pedido}, disponivel ${f.disponivel}`)
          .join(' | ')
        throw new BadRequest(`Estoque insuficiente. ${detalhe}`, 409, { faltando })
      }

      const unitPriceCents = cabecalho.unitPriceCents
      const qtyTotal = items.reduce((sum, i) => sum + i.qty, 0)
      const totalCents = qtyTotal * unitPriceCents

      // Troca a lista inteira, mas carrega de volta quanto ja foi entregue de
      // cada sabor — quem apagou e reinseriu foi o sistema, nao o cliente.
      db.prepare('DELETE FROM order_items WHERE order_id = ?').run(id)
      const inserir = db.prepare(
        `INSERT INTO order_items (order_id, flavor_id, qty, delivered_qty, unit_price_cents, subtotal_cents)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      for (const item of items) {
        const entregue = Math.min(antes.get(item.flavorId)?.deliveredQty || 0, item.qty)
        inserir.run(id, item.flavorId, item.qty, entregue, unitPriceCents, item.qty * unitPriceCents)
      }

      db.prepare(
        `UPDATE orders
            SET customer_name = ?, payment_method = ?, note = ?,
                qty_total = ?, total_cents = ?,
                updated_at = datetime('now'), updated_by = ?
          WHERE id = ?`
      ).run(customerName, paymentMethod, note, qtyTotal, totalCents, req.role, id)

      const status = recalcularStatus(id)
      return { unitPriceCents, qtyTotal, totalCents, totalAnteriorCents: cabecalho.totalCents, ...status }
    })

    // Pedido pago cujo valor mudou: ninguem mexe no dinheiro por conta propria,
    // o caixa e quem decide acertar a diferenca.
    const avisoPagamento =
      order.paid_at && resultado.totalCents !== resultado.totalAnteriorCents
        ? `Atencao: este pedido esta marcado como PAGO por ${(resultado.totalAnteriorCents / 100).toFixed(2)} ` +
          `e agora vale ${(resultado.totalCents / 100).toFixed(2)}. Acerte a diferenca no caixa.`
        : null

    broadcastState()
    res.json({ ok: true, id, number: order.number, customerName, paymentMethod, ...resultado, avisoPagamento })
  } catch (err) {
    next(err)
  }
})

export default router

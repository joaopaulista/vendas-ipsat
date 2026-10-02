import { Router } from 'express'
import { requireAuth } from '../auth.js'
import { db, getInt, transaction } from '../db.js'
import { BadRequest } from '../errors.js'
import { broadcastState } from '../events.js'

const router = Router()
const kitchen = requireAuth('cozinha', 'admin')

/* ------------------------------------------------------------------ sabores */

router.post('/flavors', kitchen, (req, res, next) => {
  try {
    const name = String(req.body?.name || '').trim()
    if (!name) throw new BadRequest('Informe o nome do sabor.')
    if (name.length > 40) throw new BadRequest('Nome do sabor muito longo (maximo 40 caracteres).')

    // O valor do pastel e unico e vem do caixa; o sabor novo ja nasce com ele.
    const valorAtual = getInt('unit_price_cents', 0)

    const existing = db.prepare('SELECT id, active FROM flavors WHERE name = ? COLLATE NOCASE').get(name)
    if (existing) {
      if (existing.active) throw new BadRequest(`O sabor ${name} ja esta cadastrado.`, 409)
      // Sabor que tinha sido desativado volta a valer, preservando o historico.
      db.prepare('UPDATE flavors SET active = 1, price_cents = ? WHERE id = ?').run(
        valorAtual,
        existing.id
      )
      broadcastState()
      return res.status(200).json({ id: existing.id, name, reactivated: true })
    }

    const nextOrder = db.prepare('SELECT COALESCE(MAX(sort_order), -1) AS n FROM flavors').get().n + 1
    const { lastInsertRowid } = db
      .prepare('INSERT INTO flavors (name, price_cents, sort_order) VALUES (?, ?, ?)')
      .run(name, valorAtual, nextOrder)

    broadcastState()
    res.status(201).json({ id: Number(lastInsertRowid), name })
  } catch (err) {
    next(err)
  }
})

router.patch('/flavors/:id', kitchen, (req, res, next) => {
  try {
    const id = Number(req.params.id)
    const flavor = db.prepare('SELECT id, name FROM flavors WHERE id = ?').get(id)
    if (!flavor) throw new BadRequest('Sabor nao encontrado.', 404)

    if (req.body?.name !== undefined) {
      const name = String(req.body.name).trim()
      if (!name) throw new BadRequest('Informe o nome do sabor.')
      const clash = db
        .prepare('SELECT id FROM flavors WHERE name = ? COLLATE NOCASE AND id <> ?')
        .get(name, id)
      if (clash) throw new BadRequest(`Ja existe outro sabor chamado ${name}.`, 409)
      db.prepare('UPDATE flavors SET name = ? WHERE id = ?').run(name, id)
    }

    if (req.body?.active !== undefined) {
      db.prepare('UPDATE flavors SET active = ? WHERE id = ?').run(req.body.active ? 1 : 0, id)
    }

    broadcastState()
    res.json({ ok: true })
  } catch (err) {
    next(err)
  }
})

/**
 * Apaga um sabor de vez. So funciona se ele nunca foi usado: com pedido ou
 * movimentacao de estoque no historico, apagar corromperia os relatorios —
 * nesse caso a saida e desativar.
 */
router.delete('/flavors/:id', kitchen, (req, res, next) => {
  try {
    const id = Number(req.params.id)
    const flavor = db.prepare('SELECT id, name FROM flavors WHERE id = ?').get(id)
    if (!flavor) throw new BadRequest('Sabor nao encontrado.', 404)

    const emPedidos = db.prepare('SELECT COUNT(*) AS n FROM order_items WHERE flavor_id = ?').get(id).n
    const emEstoque = db.prepare('SELECT COUNT(*) AS n FROM stock_movements WHERE flavor_id = ?').get(id).n

    if (emPedidos > 0 || emEstoque > 0) {
      throw new BadRequest(
        `${flavor.name} ja tem historico (${emPedidos} em pedidos, ${emEstoque} no estoque). ` +
          'Desative em vez de apagar, para nao furar os relatorios.',
        409
      )
    }

    transaction(() => {
      db.prepare('DELETE FROM price_history WHERE flavor_id = ?').run(id)
      db.prepare('DELETE FROM flavors WHERE id = ?').run(id)
    })

    broadcastState()
    res.json({ ok: true, id, name: flavor.name })
  } catch (err) {
    next(err)
  }
})

/* ------------------------------------------------------------------ estoque */

router.post('/stock', kitchen, (req, res, next) => {
  try {
    const flavorId = Number(req.body?.flavorId)
    const qty = Number(req.body?.qty)
    const kind = String(req.body?.kind || 'producao')
    const note = String(req.body?.note || '').trim() || null

    if (!['inicial', 'producao', 'ajuste'].includes(kind)) throw new BadRequest('Tipo de lancamento invalido.')
    if (!Number.isInteger(qty) || qty === 0) throw new BadRequest('Informe uma quantidade inteira diferente de zero.')
    if (kind !== 'ajuste' && qty < 0) throw new BadRequest('Para retirar do estoque use o tipo "ajuste".')
    if (Math.abs(qty) > 10000) throw new BadRequest('Quantidade fora do limite permitido.')

    const flavor = db.prepare('SELECT id, name FROM flavors WHERE id = ?').get(flavorId)
    if (!flavor) throw new BadRequest('Sabor nao encontrado.', 404)

    db.prepare(
      'INSERT INTO stock_movements (flavor_id, qty, kind, note, created_by) VALUES (?, ?, ?, ?, ?)'
    ).run(flavorId, qty, kind, note, req.role)

    broadcastState()
    res.status(201).json({ ok: true, flavor: flavor.name, qty })
  } catch (err) {
    next(err)
  }
})

// Lanca a producao de varios sabores de uma vez (usado na carga inicial).
router.post('/stock/lote', kitchen, (req, res, next) => {
  try {
    const entries = Array.isArray(req.body?.entries) ? req.body.entries : []
    const kind = String(req.body?.kind || 'producao')
    if (!['inicial', 'producao', 'ajuste'].includes(kind)) throw new BadRequest('Tipo de lancamento invalido.')

    const parsed = entries
      .map((e) => ({ flavorId: Number(e?.flavorId), qty: Number(e?.qty) }))
      .filter((e) => Number.isInteger(e.flavorId) && Number.isInteger(e.qty) && e.qty !== 0)

    if (parsed.length === 0) throw new BadRequest('Informe a quantidade de pelo menos um sabor.')

    transaction(() => {
      const insert = db.prepare(
        'INSERT INTO stock_movements (flavor_id, qty, kind, note, created_by) VALUES (?, ?, ?, ?, ?)'
      )
      for (const entry of parsed) {
        const flavor = db.prepare('SELECT id FROM flavors WHERE id = ?').get(entry.flavorId)
        if (!flavor) throw new BadRequest('Sabor nao encontrado.', 404)
        if (Math.abs(entry.qty) > 10000) throw new BadRequest('Quantidade fora do limite permitido.')
        insert.run(entry.flavorId, entry.qty, kind, null, req.role)
      }
    })

    broadcastState()
    res.status(201).json({ ok: true, lancamentos: parsed.length })
  } catch (err) {
    next(err)
  }
})

router.get('/stock/movements', kitchen, (req, res) => {
  res.json(
    db
      .prepare(
        `SELECT m.id, m.qty, m.kind, m.note, m.created_by AS createdBy, m.created_at AS createdAt,
                f.name AS flavorName
           FROM stock_movements m JOIN flavors f ON f.id = m.flavor_id
          ORDER BY m.id DESC LIMIT 200`
      )
      .all()
  )
})

export default router

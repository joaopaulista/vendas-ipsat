import { Router } from 'express'
import { requireAuth } from '../auth.js'
import { db, getInt, setConfig, transaction } from '../db.js'
import { BadRequest } from '../errors.js'
import { broadcastState } from '../events.js'

const router = Router()

/**
 * O valor do pastel e UM SO para todos os sabores, e quem define e o caixa —
 * e ele que fala com o cliente e sabe por quanto esta vendendo hoje.
 *
 * Mudar o valor vale so para pedidos novos: cada item ja vendido guarda o preco
 * do momento da venda, entao o faturamento ja registrado nao se mexe.
 */
router.post('/', requireAuth('caixa', 'admin'), (req, res, next) => {
  try {
    const bruto = req.body?.price ?? req.body?.unitPrice
    if (bruto === undefined || bruto === null || bruto === '') {
      throw new BadRequest('Informe o valor do pastel.')
    }

    const reais = typeof bruto === 'number' ? bruto : Number(String(bruto).replace(',', '.'))
    if (!Number.isFinite(reais) || reais <= 0) throw new BadRequest('Informe um valor maior que zero.')
    if (reais > 1000) throw new BadRequest('Valor acima do limite permitido (R$ 1.000,00).')

    const cents = Math.round(reais * 100)

    transaction(() => {
      setConfig('unit_price_cents', cents)
      // Os sabores guardam o mesmo valor para os relatorios continuarem batendo.
      db.prepare('UPDATE flavors SET price_cents = ?').run(cents)
      db.prepare('INSERT INTO price_history (unit_price_cents, changed_by) VALUES (?, ?)').run(
        cents,
        req.role
      )
    })

    broadcastState()
    res.json({ unitPriceCents: cents })
  } catch (err) {
    next(err)
  }
})

router.get('/history', requireAuth(), (req, res) => {
  res.json(
    db
      .prepare(
        `SELECT id, unit_price_cents AS unitPriceCents, changed_by AS changedBy, created_at AS createdAt
           FROM price_history ORDER BY id DESC LIMIT 100`
      )
      .all()
  )
})

router.get('/', requireAuth(), (req, res) => {
  res.json({ unitPriceCents: getInt('unit_price_cents', 0) })
})

export default router

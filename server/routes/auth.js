import { Router } from 'express'
import { issueToken, requireAuth, roleForCode } from '../auth.js'
import { getConfig } from '../db.js'

const router = Router()

// Protecao simples contra tentativa de adivinhar o codigo por forca bruta.
const attempts = new Map() // ip -> { count, until }
const MAX_ATTEMPTS = 8
const LOCK_MS = 60_000

function blockedFor(ip) {
  const rec = attempts.get(ip)
  if (!rec || !rec.until) return 0
  const left = rec.until - Date.now()
  if (left <= 0) {
    attempts.delete(ip)
    return 0
  }
  return Math.ceil(left / 1000)
}

router.post('/login', (req, res) => {
  const ip = req.ip || 'desconhecido'
  const wait = blockedFor(ip)
  if (wait) {
    return res.status(429).json({ error: `Muitas tentativas. Aguarde ${wait}s e tente de novo.` })
  }

  const role = roleForCode(req.body?.code)
  if (!role) {
    const rec = attempts.get(ip) || { count: 0, until: 0 }
    rec.count += 1
    if (rec.count >= MAX_ATTEMPTS) {
      rec.until = Date.now() + LOCK_MS
      rec.count = 0
    }
    attempts.set(ip, rec)
    return res.status(401).json({ error: 'Codigo invalido. Confira com o administrador.' })
  }

  attempts.delete(ip)
  res.json({
    token: issueToken(role),
    role,
    eventName: getConfig('event_name', 'Venda de Pasteis'),
  })
})

router.get('/me', requireAuth(), (req, res) => {
  res.json({ role: req.role, eventName: getConfig('event_name', 'Venda de Pasteis') })
})

export default router

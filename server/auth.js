import { createHmac, timingSafeEqual } from 'node:crypto'
import { getConfig, getInt, ROLES } from './db.js'

function b64url(buf) {
  return Buffer.from(buf).toString('base64url')
}

function sign(payloadB64) {
  return createHmac('sha256', getConfig('auth_secret')).update(payloadB64).digest('base64url')
}

export function issueToken(role) {
  const payload = b64url(JSON.stringify({ role, v: getInt('token_version', 1), iat: Date.now() }))
  return `${payload}.${sign(payload)}`
}

export function verifyToken(token) {
  if (typeof token !== 'string' || !token.includes('.')) return null
  const [payload, mac] = token.split('.')
  let expected
  try {
    expected = Buffer.from(sign(payload))
  } catch {
    return null
  }
  const given = Buffer.from(mac || '')
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null

  let data
  try {
    data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'))
  } catch {
    return null
  }
  if (!ROLES.includes(data.role)) return null
  if (data.v !== getInt('token_version', 1)) return null // acesso revogado pelo admin
  return data
}

/** Compara o codigo digitado com os codigos cadastrados e devolve o papel. */
export function roleForCode(code) {
  const typed = String(code || '').trim().toUpperCase()
  if (!typed) return null
  for (const role of ROLES) {
    const stored = String(getConfig(`code_${role}`) || '').trim().toUpperCase()
    if (stored && stored === typed) return role
  }
  return null
}

function tokenFromRequest(req) {
  const header = req.get('authorization')
  if (header && header.startsWith('Bearer ')) return header.slice(7)
  // EventSource nao envia cabecalhos, entao o SSE manda o token na query.
  if (typeof req.query.token === 'string') return req.query.token
  return null
}

/** Exige um login valido; com argumentos, exige tambem um dos papeis. */
export function requireAuth(...allowedRoles) {
  return (req, res, next) => {
    const data = verifyToken(tokenFromRequest(req))
    if (!data) return res.status(401).json({ error: 'Sessao expirada. Entre novamente com o codigo.' })
    if (allowedRoles.length && !allowedRoles.includes(data.role)) {
      return res.status(403).json({ error: 'Seu perfil nao tem permissao para esta acao.' })
    }
    req.role = data.role
    next()
  }
}

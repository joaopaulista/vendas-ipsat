const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })

export function money(cents) {
  return brl.format((Number(cents) || 0) / 100)
}

export function moneyInput(cents) {
  return ((Number(cents) || 0) / 100).toFixed(2).replace('.', ',')
}

/** Converte "8,50" ou "8.50" para numero. Devolve NaN se nao der. */
export function parseMoney(text) {
  const clean = String(text).trim().replace(/\s/g, '').replace(/\./g, '').replace(',', '.')
  return clean === '' ? NaN : Number(clean)
}

/** O SQLite grava datetime('now') em UTC; o "Z" faz o navegador converter. */
export function hora(sqliteDate) {
  if (!sqliteDate) return '-'
  const date = new Date(sqliteDate.replace(' ', 'T') + 'Z')
  if (Number.isNaN(date.getTime())) return '-'
  return date.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
}

export function dataHora(sqliteDate) {
  if (!sqliteDate) return '-'
  const date = new Date(sqliteDate.replace(' ', 'T') + 'Z')
  if (Number.isNaN(date.getTime())) return '-'
  return date.toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export function plural(n, singular, pluralForm) {
  return `${n} ${n === 1 ? singular : pluralForm}`
}

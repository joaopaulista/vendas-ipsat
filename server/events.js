import { buildState, versaoDoApp } from './state.js'

const clients = new Set()

/** Registra uma conexao SSE e devolve a funcao de limpeza. */
export function addClient(res) {
  res.set({
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  })
  res.flushHeaders?.()
  res.write('retry: 2000\n\n')
  clients.add(res)

  send(res, 'state', buildState())

  // O ping tambem carrega a versao do front-end. Assim uma tela parada — sem
  // pedido novo, sem mudanca de estoque — ainda descobre que o sistema foi
  // atualizado e pode oferecer o "recarregar" para o operador.
  const ping = setInterval(() => {
    try {
      send(res, 'versao', { versaoApp: versaoDoApp(Date.now()) })
    } catch {
      clearInterval(ping)
      clients.delete(res)
    }
  }, 20000)

  return () => {
    clearInterval(ping)
    clients.delete(res)
  }
}

function send(res, event, data) {
  try {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
  } catch {
    clients.delete(res)
  }
}

/**
 * Empurra o estado completo para todos os navegadores conectados.
 * Mandar o retrato inteiro (em vez de deltas) mantem cozinha e caixa
 * sempre iguais, mesmo depois de uma queda de rede.
 */
export function broadcastState() {
  if (clients.size === 0) return
  const state = buildState()
  for (const res of clients) send(res, 'state', state)
}

/** Aviso pontual (ex.: estoque acabando) alem do estado. */
export function broadcastNotice(notice) {
  for (const res of clients) send(res, 'notice', notice)
}

export function clientCount() {
  return clients.size
}

import { useEffect, useRef, useState } from 'react'
import { api, getToken } from './api.js'

/**
 * Mantem o retrato do sistema sempre igual nas duas maquinas.
 *
 * O servidor empurra o estado inteiro por SSE a cada mudanca (pedido, baixa,
 * producao, preco). Se a rede cair, o EventSource reconecta sozinho e a
 * primeira mensagem depois da volta ja traz tudo atualizado — nao existe
 * estado parcial para ficar dessincronizado.
 */
export function useLiveState(isLoggedIn) {
  const [state, setState] = useState(null)
  const [versaoApp, setVersaoApp] = useState(null)
  const [connected, setConnected] = useState(false)
  const sourceRef = useRef(null)

  useEffect(() => {
    if (!isLoggedIn) {
      setState(null)
      setVersaoApp(null)
      setConnected(false)
      return
    }

    let cancelled = false

    // Carga inicial por HTTP: a tela aparece preenchida mesmo que o SSE demore.
    api
      .state()
      .then((data) => {
        if (!cancelled) setState(data)
      })
      .catch(() => {
        /* o SSE abaixo cobre a carga; erro de sessao ja dispara o logout */
      })

    const source = new EventSource('/events?token=' + encodeURIComponent(getToken() || ''))
    sourceRef.current = source

    source.addEventListener('open', () => {
      if (!cancelled) setConnected(true)
    })

    source.addEventListener('state', (event) => {
      if (cancelled) return
      try {
        setState(JSON.parse(event.data))
        setConnected(true)
      } catch {
        /* mensagem truncada: a proxima vem completa */
      }
    })

    // Chega junto com o ping, a cada 20s: e o que faz uma tela parada perceber
    // que o sistema foi atualizado no servidor.
    source.addEventListener('versao', (event) => {
      if (cancelled) return
      try {
        setVersaoApp(JSON.parse(event.data).versaoApp)
        setConnected(true)
      } catch {
        /* proxima mensagem resolve */
      }
    })

    // O EventSource reconecta sozinho, inclusive quando o token foi revogado —
    // e ai ficaria tentando para sempre. Esta sondagem responde 401 e faz o
    // app cair na tela de login em vez de piscar "offline" indefinidamente.
    let probe = null
    source.addEventListener('error', () => {
      if (cancelled) return
      setConnected(false)
      if (probe) return
      probe = setTimeout(() => {
        probe = null
        api.state().catch(() => {})
      }, 4000)
    })

    return () => {
      cancelled = true
      if (probe) clearTimeout(probe)
      source.close()
      sourceRef.current = null
    }
  }, [isLoggedIn])

  // A versao do ping tem prioridade: ela e mais recente que a do ultimo estado.
  return { state, connected, versaoApp: versaoApp ?? state?.versaoApp ?? null }
}

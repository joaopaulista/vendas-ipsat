import { useCallback, useEffect, useRef, useState } from 'react'
import { clearSession, getStoredRole, getToken, saveSession } from './api.js'
import { Marca } from './components/Marca.jsx'
import { Toast, useToast } from './components/Toast.jsx'
import Admin from './screens/Admin.jsx'
import Caixa from './screens/Caixa.jsx'
import Cozinha from './screens/Cozinha.jsx'
import Custos from './screens/Custos.jsx'
import Dashboard from './screens/Dashboard.jsx'
import Login from './screens/Login.jsx'
import { useLiveState } from './useLiveState.js'

const ABAS = [
  { id: 'inicio', label: 'Inicio', roles: ['admin', 'caixa', 'cozinha'] },
  { id: 'caixa', label: 'Caixa', roles: ['admin', 'caixa'] },
  { id: 'cozinha', label: 'Cozinha', roles: ['admin', 'cozinha'] },
  { id: 'custos', label: 'Custos', roles: ['admin'] },
  { id: 'admin', label: 'Admin', roles: ['admin'] },
]

// Cada perfil abre direto na tela que vai usar o dia inteiro.
const ABA_INICIAL = { caixa: 'caixa', cozinha: 'cozinha', admin: 'inicio' }

export default function App() {
  const [sessao, setSessao] = useState(() => {
    const token = getToken()
    const role = getStoredRole()
    return token && role ? { token, role } : null
  })
  const [aba, setAba] = useState(() => ABA_INICIAL[getStoredRole()] || 'inicio')
  const { toast, show } = useToast()
  const { state, connected, versaoApp } = useLiveState(Boolean(sessao))

  const sair = useCallback(() => {
    clearSession()
    setSessao(null)
  }, [])

  // O api.js avisa quando o servidor responde 401 (codigo trocado ou acessos revogados).
  useEffect(() => {
    const aoDeslogar = () => setSessao(null)
    window.addEventListener('ump:logout', aoDeslogar)
    return () => window.removeEventListener('ump:logout', aoDeslogar)
  }, [])

  /*
   * Uma aba aberta o dia todo continua rodando o JS que baixou na primeira vez.
   * Guardamos a versao vista no primeiro carregamento; quando o servidor passa a
   * anunciar outra, o sistema foi atualizado e a tela oferece recarregar.
   */
  const versaoInicial = useRef(null)
  const [desatualizado, setDesatualizado] = useState(false)
  useEffect(() => {
    if (!versaoApp) return
    if (versaoInicial.current === null) versaoInicial.current = versaoApp
    else if (versaoInicial.current !== versaoApp) setDesatualizado(true)
  }, [versaoApp])

  // Caminho direto: o api.js avisa quando uma chamada bateu num endereco que o
  // servidor nao tem mais — prova de que esta tela e de uma versao anterior.
  useEffect(() => {
    const aoDetectar = () => setDesatualizado(true)
    window.addEventListener('ump:desatualizado', aoDetectar)
    return () => window.removeEventListener('ump:desatualizado', aoDetectar)
  }, [])

  function entrar(dados) {
    saveSession(dados.token, dados.role)
    setSessao({ token: dados.token, role: dados.role })
    setAba(ABA_INICIAL[dados.role] || 'inicio')
  }

  if (!sessao) return <Login onEntrar={entrar} />

  const abasVisiveis = ABAS.filter((a) => a.roles.includes(sessao.role))
  const abaAtual = abasVisiveis.some((a) => a.id === aba) ? aba : abasVisiveis[0].id

  return (
    <div className="app">
      <header className="topbar">
        <Marca />
        <div className="topbar__evento">
          <div className="topbar__titulo">{state?.config.eventName || 'Venda de Pasteis'}</div>
          <div className="topbar__sub">UMP · IPSAT</div>
        </div>
        <span className="topbar__spacer" />
        <div className="topbar__meta">
          <span className={connected ? 'conn' : 'conn conn--off'}>
            <span className="conn__dot" />
            {connected ? 'ao vivo' : 'reconectando'}
          </span>
          <span className="badge-role">{sessao.role}</span>
          <button className="btn btn--ghost btn--sm" type="button" onClick={sair}>
            Sair
          </button>
        </div>
      </header>

      <nav className="tabs">
        {abasVisiveis.map((a) => (
          <button
            key={a.id}
            type="button"
            className={a.id === abaAtual ? 'is-active' : ''}
            onClick={() => setAba(a.id)}
          >
            {a.label}
          </button>
        ))}
      </nav>

      {desatualizado ? (
        <div className="aviso-versao">
          O sistema foi atualizado neste servidor. Recarregue para usar a versao nova.
          <button className="btn btn--sm" type="button" onClick={() => window.location.reload()}>
            Atualizar agora
          </button>
        </div>
      ) : null}

      <main className="content">
        {!state ? (
          <div className="vazio">Carregando dados do evento...</div>
        ) : (
          <>
            {abaAtual === 'inicio' && <Dashboard state={state} />}
            {abaAtual === 'caixa' && <Caixa state={state} onToast={show} />}
            {abaAtual === 'cozinha' && <Cozinha state={state} onToast={show} />}
            {abaAtual === 'custos' && <Custos state={state} onToast={show} />}
            {abaAtual === 'admin' && <Admin state={state} onToast={show} onLogout={sair} />}
          </>
        )}
      </main>

      <Toast toast={toast} />
    </div>
  )
}

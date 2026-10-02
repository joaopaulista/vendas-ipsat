import { useState } from 'react'
import { api } from '../api.js'
import { MarcaGrande } from '../components/Marca.jsx'

export default function Login({ onEntrar }) {
  const [code, setCode] = useState('')
  const [erro, setErro] = useState('')
  const [enviando, setEnviando] = useState(false)

  async function submeter(event) {
    event.preventDefault()
    if (!code.trim() || enviando) return

    setEnviando(true)
    setErro('')
    try {
      const sessao = await api.login(code.trim())
      onEntrar(sessao)
    } catch (err) {
      setErro(err.message)
      setCode('')
      setEnviando(false)
    }
  }

  return (
    <div className="login">
      <form className="login__card" onSubmit={submeter}>
        <MarcaGrande />
        <h1 className="login__title">Venda de Pasteis</h1>
        <p className="login__sub">Digite o codigo de acesso fornecido pelo administrador.</p>

        {erro ? (
          <div className="alert alert--error" role="alert">
            {erro}
          </div>
        ) : null}

        <label className="field">
          <span className="field__label">Codigo de acesso</span>
          <input
            className="login__code"
            type="text"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            autoFocus
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck="false"
            maxLength={20}
            placeholder="------"
            aria-label="Codigo de acesso"
          />
        </label>

        <button className="btn btn--lg" type="submit" disabled={!code.trim() || enviando}>
          {enviando ? 'Entrando...' : 'Entrar'}
        </button>

        <p className="small muted" style={{ marginTop: 16, marginBottom: 0 }}>
          Cada perfil (caixa, cozinha, admin) tem o seu proprio codigo.
        </p>
      </form>
    </div>
  )
}

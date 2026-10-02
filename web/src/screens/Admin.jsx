import { useEffect, useState } from 'react'
import { api, baixarArquivo, EXPORTACOES } from '../api.js'
import { BotaoPago } from '../components/BotaoPago.jsx'
import { StatusPill } from '../components/Kpi.jsx'
import { Paginacao, useLinhasQueCabem, usePaginacao } from '../components/Paginacao.jsx'
import { dataHora, money } from '../format.js'

export default function Admin({ state, onToast, onLogout }) {
  return (
    <div className="screen screen--split">
      <Pedidos state={state} onToast={onToast} />
      <div className="col" style={{ gridTemplateRows: 'auto minmax(0, 1fr)' }}>
        <Exportar state={state} onToast={onToast} />
        <Configuracoes state={state} onToast={onToast} onLogout={onLogout} />
      </div>
    </div>
  )
}

/* -------------------------------------------------------------- exportar */

function Exportar({ state, onToast }) {
  const [baixando, setBaixando] = useState(null)

  async function baixar(exp) {
    setBaixando(exp.id)
    try {
      await baixarArquivo(exp.caminho, exp.arquivo)
      onToast(`${exp.rotulo} exportado.`, 'success')
    } catch (err) {
      onToast(err.message, 'error')
    } finally {
      setBaixando(null)
    }
  }

  const vazio = state.orders.length === 0 && state.costs.length === 0

  return (
    <section className="panel">
      <div className="panel__head">
        <h2 className="panel__title">Extrair os dados</h2>
        <span className="small muted">
          {state.orders.length} pedidos · {state.costs.length} custos
        </span>
      </div>

      <div className="panel__body">
        {vazio ? (
          <p className="small muted" style={{ margin: '0 0 8px' }}>
            Ainda nao ha o que exportar — os arquivos sairiam so com o cabecalho.
          </p>
        ) : null}

        <div className="exportar">
          {EXPORTACOES.map((exp) => (
            <button
              key={exp.id}
              className={exp.id === 'planilha' ? 'btn btn--accent' : 'btn btn--ghost'}
              type="button"
              onClick={() => baixar(exp)}
              disabled={baixando === exp.id}
              title={exp.detalhe}
            >
              {baixando === exp.id ? '...' : exp.rotulo}
            </button>
          ))}
        </div>

        <p className="small muted" style={{ margin: '8px 0 0' }}>
          A planilha do Excel e a mesma que o sistema salva sozinho em backups/ ao ser
          desligado. Os CSV abrem direto no Excel; o JSON leva o banco inteiro, menos os
          codigos de acesso.
        </p>
      </div>
    </section>
  )
}

/* --------------------------------------------------------- configuracoes */

const DESCRICAO = {
  admin: 'Acesso total, custos e relatorios.',
  caixa: 'Lanca os pedidos e ve os KPIs.',
  cozinha: 'Cardapio, producao e retiradas.',
}

function Configuracoes({ state, onToast, onLogout }) {
  const [codigos, setCodigos] = useState(null)
  const [rascunho, setRascunho] = useState({})
  const [salvando, setSalvando] = useState(null)
  const [nome, setNome] = useState(state.config.eventName)
  const [zerando, setZerando] = useState(false)

  useEffect(() => {
    api
      .codigos()
      .then((lista) => {
        setCodigos(lista)
        setRascunho(Object.fromEntries(lista.map((c) => [c.role, c.code])))
      })
      .catch((err) => onToast(err.message, 'error'))
  }, [onToast])

  async function salvarCodigo(role) {
    setSalvando(role)
    try {
      const res = await api.salvarCodigo(role, rascunho[role])
      setCodigos((atual) => atual.map((c) => (c.role === role ? res : c)))
      setRascunho((atual) => ({ ...atual, [role]: res.code }))
      onToast(`Codigo do perfil ${role} atualizado.`, 'success')
    } catch (err) {
      onToast(err.message, 'error')
    } finally {
      setSalvando(null)
    }
  }

  async function revogar() {
    const certeza = window.confirm(
      'Isso desconecta TODOS os computadores, inclusive este. Cada um tera que entrar de novo com o codigo. Continuar?'
    )
    if (!certeza) return

    try {
      await api.revogarAcessos()
      onToast('Todos os acessos foram revogados.', 'success')
      onLogout()
    } catch (err) {
      onToast(err.message, 'error')
    }
  }

  async function salvarNome(event) {
    event.preventDefault()
    try {
      await api.salvarEvento(nome.trim())
      onToast('Nome do evento atualizado.', 'success')
    } catch (err) {
      onToast(err.message, 'error')
    }
  }

  async function zerar() {
    const digitado = window.prompt(
      'ATENCAO: isso apaga TODOS os pedidos, o estoque e os custos deste evento.\n' +
        'Sabores, precos e codigos sao mantidos.\n\n' +
        'Exporte os dados antes, se ainda nao exportou.\n\n' +
        'Digite ZERAR para confirmar:'
    )
    if (String(digitado || '').trim().toUpperCase() !== 'ZERAR') return

    setZerando(true)
    try {
      const res = await api.zerarEvento()
      onToast(`Evento zerado (${res.apagados.pedidos} pedidos, ${res.apagados.custos} custos).`, 'success')
    } catch (err) {
      onToast(err.message, 'error')
    } finally {
      setZerando(false)
    }
  }

  return (
    <section className="panel">
      <div className="panel__head">
        <h2 className="panel__title">Configuracoes</h2>
        <button className="btn btn--ghost btn--sm" type="button" onClick={revogar} disabled={!codigos}>
          Revogar acessos
        </button>
      </div>

      <div className="panel__body">
        <div className="rolagem">
          <form className="row" onSubmit={salvarNome} style={{ marginBottom: 12 }}>
            <input
              type="text"
              value={nome}
              onChange={(e) => setNome(e.target.value)}
              maxLength={60}
              aria-label="Nome do evento"
            />
            <button className="btn fixo" type="submit" disabled={!nome.trim()}>
              Salvar nome
            </button>
          </form>

          {!codigos ? (
            <p className="small muted">Carregando codigos...</p>
          ) : (
            codigos.map((c) => (
              <div className="field" key={c.role} style={{ marginBottom: 6 }}>
                <span className="field__label" style={{ marginBottom: 2 }}>
                  {c.role}
                </span>
                <div className="row">
                  <input
                    type="text"
                    value={rascunho[c.role] ?? ''}
                    onChange={(e) => setRascunho((a) => ({ ...a, [c.role]: e.target.value.toUpperCase() }))}
                    maxLength={20}
                    autoComplete="off"
                    spellCheck="false"
                  />
                  <button
                    className="btn fixo"
                    type="button"
                    onClick={() => salvarCodigo(c.role)}
                    disabled={salvando === c.role || !rascunho[c.role] || rascunho[c.role] === c.code}
                  >
                    Salvar
                  </button>
                </div>
                <span className="small muted">{DESCRICAO[c.role]}</span>
              </div>
            ))
          )}

          <hr style={{ border: 0, borderTop: '1px solid var(--border)', margin: '14px 0 12px' }} />

          <button className="btn btn--danger btn--block" type="button" onClick={zerar} disabled={zerando}>
            {zerando ? 'Zerando...' : 'Zerar evento'}
          </button>
          <p className="small muted" style={{ margin: '6px 0 0' }}>
            Apaga pedidos, estoque e custos. Nao da para desfazer — exporte antes.
          </p>
        </div>
      </div>
    </section>
  )
}

/* ---------------------------------------------------------------- pedidos */

function Pedidos({ state, onToast }) {
  const [filtro, setFiltro] = useState('todos')
  const [busca, setBusca] = useState('')
  const [ocupado, setOcupado] = useState(null)

  const lista = state.orders.filter((o) => {
    if (filtro !== 'todos' && o.status !== filtro) return false
    const termo = busca.trim().toLowerCase()
    if (!termo) return true
    return String(o.number).includes(termo) || o.customerName.toLowerCase().includes(termo)
  })

  const [area, linhas] = useLinhasQueCabem()
  const pag = usePaginacao(lista, linhas)

  async function cancelarOuRestaurar(order) {
    if (order.status !== 'cancelado') {
      const certeza = window.confirm(
        `Cancelar o pedido #${order.number} de ${order.customerName}?\n` +
          `Os ${order.qtyTotal} pasteis voltam para o estoque e o valor sai do faturamento.\n` +
          'O pedido continua na lista, marcado como cancelado.'
      )
      if (!certeza) return
    }

    setOcupado(order.id)
    try {
      await (order.status === 'cancelado' ? api.restaurar(order.id) : api.cancelar(order.id))
      onToast(
        `Pedido #${order.number} ${order.status === 'cancelado' ? 'restaurado' : 'cancelado'}.`,
        'success'
      )
    } catch (err) {
      onToast(err.message, 'error')
    } finally {
      setOcupado(null)
    }
  }

  /** Exclusao de verdade: some da lista e dos relatorios, sem volta. */
  async function apagar(order) {
    const itens = order.items.map((i) => `${i.flavorName} x${i.qty}`).join(', ')
    const certeza = window.confirm(
      `APAGAR o pedido #${order.number} de ${order.customerName}?\n\n` +
        `${itens}\n` +
        `Total ${money(order.totalCents)} · ${order.paymentMethod}\n\n` +
        'Ele some da lista e de todos os relatorios, e os pasteis voltam para o estoque.\n' +
        'NAO da para desfazer. Para manter o rastro, use Cancelar.'
    )
    if (!certeza) return

    setOcupado(order.id)
    try {
      await api.apagarPedido(order.id)
      onToast(`Pedido #${order.number} apagado.`, 'success')
    } catch (err) {
      onToast(err.message, 'error')
    } finally {
      setOcupado(null)
    }
  }

  return (
    <section className="panel">
      <div className="panel__head">
        <h2 className="panel__title">Todos os pedidos</h2>
        <div className="row" style={{ flex: '0 1 380px' }}>
          <input
            type="text"
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder="Buscar numero ou nome"
            autoComplete="off"
          />
          <select
            value={filtro}
            onChange={(e) => setFiltro(e.target.value)}
            style={{ flex: '0 0 150px' }}
            aria-label="Filtrar por status"
          >
            <option value="todos">Todos</option>
            <option value="pendente">Aguardando</option>
            <option value="parcial">Parcial</option>
            <option value="retirado">Retirados</option>
            <option value="cancelado">Cancelados</option>
          </select>
        </div>
      </div>

      <div className="panel__body">
        {state.ordersTruncated ? (
          <div className="alert alert--warning">
            A tela mostra os 300 pedidos mais recentes. A exportacao traz todos.
          </div>
        ) : null}

        <div className="rolagem" ref={area}>
          {lista.length === 0 ? (
            <div className="vazio">Nenhum pedido encontrado.</div>
          ) : (
            <table>
              <thead>
                <tr>
                  <th className="num">#</th>
                  <th>Comprador</th>
                  <th>Itens</th>
                  <th className="num">Qtd</th>
                  <th className="num">Total</th>
                  <th>Pagamento</th>
                  <th>Pago?</th>
                  <th>Status</th>
                  <th>Criado</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {pag.visiveis.map((o) => (
                  <tr key={o.id}>
                    <td className="num">
                      <strong>{o.number}</strong>
                    </td>
                    <td className="trunca">{o.customerName}</td>
                    <td className="trunca small muted">
                      {o.items
                        .map((i) => `${i.flavorName} x${i.qty} (${money(i.unitPriceCents)})`)
                        .join(', ')}
                    </td>
                    <td className="num">{o.qtyTotal}</td>
                    <td className="num dinheiro">{money(o.totalCents)}</td>
                    <td>{o.paymentMethod}</td>
                    <td>
                      <BotaoPago order={o} onToast={onToast} pequeno />
                    </td>
                    <td>
                      <StatusPill status={o.status} restante={o.qtyRemaining} />
                    </td>
                    <td className="small muted">{dataHora(o.createdAt)}</td>
                    <td className="num" style={{ whiteSpace: 'nowrap' }}>
                      <button
                        className="btn btn--ghost btn--sm"
                        type="button"
                        disabled={ocupado === o.id}
                        onClick={() => cancelarOuRestaurar(o)}
                        title={
                          o.status === 'cancelado'
                            ? 'Volta o pedido para a fila'
                            : 'Tira do faturamento mas mantem o registro'
                        }
                      >
                        {o.status === 'cancelado' ? 'Restaurar' : 'Cancelar'}
                      </button>{' '}
                      <button
                        className="btn btn--ghost btn--sm"
                        type="button"
                        disabled={ocupado === o.id}
                        onClick={() => apagar(o)}
                        title="Apaga o pedido de vez (pede confirmacao)"
                        style={{ color: 'var(--danger)' }}
                      >
                        Apagar
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        <Paginacao estado={pag} rotulo="pedidos" />
      </div>
    </section>
  )
}

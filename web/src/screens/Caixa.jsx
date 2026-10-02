import { useEffect, useMemo, useRef, useState } from 'react'
import { api } from '../api.js'
import { BotaoPago } from '../components/BotaoPago.jsx'
import EditarPedido from '../components/EditarPedido.jsx'
import { StatusPill } from '../components/Kpi.jsx'
import { Paginacao, useLinhasQueCabem, usePaginacao } from '../components/Paginacao.jsx'
import { hora, money, moneyInput, parseMoney, plural } from '../format.js'


/**
 * O valor do pastel vive aqui, no caixa, porque e o caixa que fala com o cliente
 * e sabe por quanto esta vendendo hoje. E UM SO para todos os sabores.
 *
 * Fica sempre visivel e sempre editavel, no alto da tela de venda — nao atras de
 * um clique. Trocar o valor mexe so nos pedidos novos: cada venda ja lancada
 * guarda o preco do momento, para o faturamento bater com a caixinha.
 */
function ValorDoPastel({ precoCents, onToast }) {
  const [valor, setValor] = useState(() => (precoCents > 0 ? moneyInput(precoCents) : ''))
  const [salvando, setSalvando] = useState(false)
  const [tocado, setTocado] = useState(false)

  // Enquanto o caixa nao esta digitando, o campo acompanha o que veio do servidor
  // (outro computador pode ter mudado o valor).
  useEffect(() => {
    if (!tocado) setValor(precoCents > 0 ? moneyInput(precoCents) : '')
  }, [precoCents, tocado])

  async function salvar() {
    const numero = parseMoney(valor)
    if (!Number.isFinite(numero) || numero <= 0) {
      return onToast('Informe um valor valido, por exemplo 8,50.', 'error')
    }

    setSalvando(true)
    try {
      const res = await api.definirPreco(numero)
      setValor(moneyInput(res.unitPriceCents))
      setTocado(false)
      onToast(`Valor do pastel: ${money(res.unitPriceCents)}.`, 'success')
    } catch (err) {
      onToast(err.message, 'error')
    } finally {
      setSalvando(false)
    }
  }

  const definido = precoCents > 0
  const mudou = tocado && parseMoney(valor) !== precoCents / 100

  return (
    <div className={definido ? 'valor-strip' : 'valor-strip valor-strip--vazio'}>
      <span className="valor-strip__rotulo">
        Valor do pastel
        <span className="small muted"> — vale para todos os sabores</span>
      </span>

      <div className="valor-strip__campo">
        <span className="valor-strip__moeda">R$</span>
        <input
          type="text"
          inputMode="decimal"
          value={valor}
          onChange={(e) => {
            setTocado(true)
            setValor(e.target.value)
          }}
          onFocus={(e) => e.target.select()}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              salvar()
            }
          }}
          placeholder="8,50"
          aria-label="Valor do pastel"
          autoFocus={!definido}
        />
      </div>

      <button
        className={mudou || !definido ? 'btn' : 'btn btn--ghost'}
        type="button"
        onClick={salvar}
        disabled={salvando}
      >
        {salvando ? 'Salvando...' : 'Salvar valor'}
      </button>
    </div>
  )
}

export default function Caixa({ state, onToast }) {
  const [nome, setNome] = useState('')
  const [pagamento, setPagamento] = useState('')
  const [quantidades, setQuantidades] = useState({})
  const [enviando, setEnviando] = useState(false)
  const [erro, setErro] = useState('')
  const [ultimo, setUltimo] = useState(null)
  const [editandoId, setEditandoId] = useState(null)
  const nomeRef = useRef(null)

  const { config, flavors } = state
  // Um valor so para todos os sabores, definido aqui no caixa.
  const precoCents = config.unitPriceCents
  const ativos = useMemo(() => flavors.filter((f) => f.active), [flavors])

  const pedidoEditando = useMemo(
    () => state.orders.find((o) => o.id === editandoId) || null,
    [state.orders, editandoId]
  )

  const [areaRecentes, linhasRecentes] = useLinhasQueCabem()
  const pagRecentes = usePaginacao(state.orders, linhasRecentes)

  useEffect(() => {
    if (!pagamento && config.paymentMethods.length) setPagamento(config.paymentMethods[0])
  }, [config.paymentMethods, pagamento])

  const itens = useMemo(
    () => ativos.map((f) => ({ flavor: f, qty: quantidades[f.id] || 0 })).filter((i) => i.qty > 0),
    [ativos, quantidades]
  )

  const qtdTotal = itens.reduce((sum, i) => sum + i.qty, 0)
  // O total acompanha os precos vindos do servidor: se a cozinha mexer no preco
  // de um sabor enquanto o pedido esta sendo montado, ele se atualiza na hora.
  const totalCents = qtdTotal * precoCents

  function ajustar(flavor, delta) {
    setQuantidades((atual) => {
      const novo = Math.max(0, (atual[flavor.id] || 0) + delta)
      if (novo > flavor.available) return atual
      return { ...atual, [flavor.id]: novo }
    })
  }

  function digitar(flavor, texto) {
    const n = Number.parseInt(texto, 10)
    setQuantidades((atual) => ({
      ...atual,
      [flavor.id]: Number.isNaN(n) ? 0 : Math.min(Math.max(0, n), flavor.available),
    }))
  }

  function limpar() {
    setNome('')
    setQuantidades({})
    setErro('')
    nomeRef.current?.focus()
  }

  async function lancar(event) {
    event.preventDefault()
    setErro('')

    if (!nome.trim()) return setErro('Informe o nome do comprador.')
    if (qtdTotal === 0) return setErro('Escolha pelo menos um pastel.')

    setEnviando(true)
    try {
      const pedido = await api.criarPedido({
        customerName: nome.trim(),
        paymentMethod: pagamento,
        items: itens.map((i) => ({ flavorId: i.flavor.id, qty: i.qty })),
      })
      setUltimo(pedido)
      onToast(`Pedido #${pedido.number} lancado — ${money(pedido.totalCents)}`, 'success')
      limpar()
      pagRecentes.primeira()
    } catch (err) {
      setErro(err.message)
      onToast(err.message, 'error')
    } finally {
      setEnviando(false)
    }
  }

  return (
    <form className="screen screen--split" onSubmit={lancar}>
      <section className="panel">
        <div className="panel__head">
          <h2 className="panel__title">Novo pedido</h2>
        </div>

        <div className="panel__body">
          <ValorDoPastel precoCents={precoCents} onToast={onToast} />

          <div className="row" style={{ marginBottom: 10, flex: 'none' }}>
            <label className="field" style={{ marginBottom: 0, flex: 2 }}>
              <span className="field__label">Nome do comprador</span>
              <input
                ref={nomeRef}
                type="text"
                value={nome}
                onChange={(e) => setNome(e.target.value)}
                placeholder="Ex.: Maria Silva"
                maxLength={80}
                autoComplete="off"
                autoFocus
              />
            </label>
            <label className="field" style={{ marginBottom: 0, flex: 1 }}>
              <span className="field__label">Pagamento</span>
              <select value={pagamento} onChange={(e) => setPagamento(e.target.value)}>
                {config.paymentMethods.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="rolagem">
            {ativos.length === 0 ? (
              <div className="vazio">Nenhum sabor ativo. Fale com a cozinha.</div>
            ) : (
              <div className="sabores">
                {ativos.map((f) => {
                  const qty = quantidades[f.id] || 0
                  const esgotado = f.available <= 0
                  const bloqueado = esgotado || precoCents <= 0
                  const classes = ['sabor']
                  if (qty > 0) classes.push('sabor--escolhido')
                  if (bloqueado) classes.push('sabor--vazio')

                  return (
                    <div key={f.id} className={classes.join(' ')}>
                      <div className="sabor__head">
                        <span className="sabor__nome">{f.name}</span>
                        <span
                          className={
                            bloqueado || f.available <= 5
                              ? 'sabor__estoque sabor__estoque--baixo'
                              : 'sabor__estoque'
                          }
                        >
                          {esgotado ? 'esgotado' : `${f.available} disp.`}
                        </span>
                      </div>

                      <div className="sabor__preco">
                        {precoCents > 0 ? money(precoCents) : '—'} <span className="muted">cada</span>
                      </div>

                      <div className="stepper">
                        <button
                          type="button"
                          onClick={() => ajustar(f, -1)}
                          disabled={qty === 0}
                          aria-label={`Diminuir ${f.name}`}
                        >
                          −
                        </button>
                        <input
                          type="number"
                          min="0"
                          max={f.available}
                          value={qty}
                          onChange={(e) => digitar(f, e.target.value)}
                          onFocus={(e) => e.target.select()}
                          disabled={bloqueado}
                          aria-label={`Quantidade de ${f.name}`}
                        />
                        <button
                          type="button"
                          onClick={() => ajustar(f, 1)}
                          disabled={bloqueado || qty >= f.available}
                          aria-label={`Aumentar ${f.name}`}
                        >
                          +
                        </button>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </div>
      </section>

      <div className="col" style={{ gridTemplateRows: 'auto minmax(0, 1fr)' }}>
        <section className="panel">
          <div className="panel__head">
            <h2 className="panel__title">Resumo</h2>
            {ultimo ? <span className="small muted">ultimo: #{ultimo.number}</span> : null}
          </div>

          <div className="panel__body">
            {itens.length === 0 ? (
              <p className="small muted" style={{ margin: '4px 0' }}>
                Escolha os sabores ao lado.
              </p>
            ) : (
              itens.map((i) => (
                <div className="resumo__linha" key={i.flavor.id}>
                  <span>
                    {i.flavor.name} <span className="muted">x{i.qty}</span>

                  </span>
                  <span className="dinheiro">{money(i.qty * precoCents)}</span>
                </div>
              ))
            )}

            <div className="resumo__total">
              <span className="small muted">{plural(qtdTotal, 'pastel', 'pasteis')}</span>
              <strong>{money(totalCents)}</strong>
            </div>

            {erro ? (
              <div className="alert alert--error" role="alert">
                {erro}
              </div>
            ) : null}

            <div className="row" style={{ flex: 'none' }}>
              <button
                className="btn"
                type="submit"
                style={{ flex: 2 }}
                disabled={enviando || qtdTotal === 0}
              >
                {enviando ? 'Lancando...' : 'Lancar pedido'}
              </button>
              <button className="btn btn--ghost" type="button" onClick={limpar} disabled={enviando}>
                Limpar
              </button>
            </div>

            {ultimo ? (
              <p className="small" style={{ margin: '10px 0 0', fontWeight: 700, color: 'var(--success)' }}>
                Pedido #{ultimo.number} de {ultimo.customerName} — informe o numero para retirar na cozinha.
              </p>
            ) : null}
          </div>
        </section>

        <section className="panel">
          <div className="panel__head">
            <h2 className="panel__title">Pedidos recentes</h2>
          </div>
          <div className="panel__body">
            <div className="rolagem" ref={areaRecentes}>
              {state.orders.length === 0 ? (
                <div className="vazio">Nenhum pedido ainda.</div>
              ) : (
                <table>
                  <thead>
                    <tr>
                      <th className="num">#</th>
                      <th>Comprador</th>
                      <th className="num">Total</th>
                      <th>Pago?</th>
                      <th>Status</th>
                      <th>Hora</th>
                      <th className="num">Editar</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pagRecentes.visiveis.map((o) => (
                      <tr key={o.id}>
                        <td className="num">
                          <strong>{o.number}</strong>
                        </td>
                        <td className="trunca">{o.customerName}</td>
                        <td className="num dinheiro">{money(o.totalCents)}</td>
                        <td>
                          <BotaoPago order={o} onToast={onToast} pequeno />
                        </td>
                        <td>
                          <StatusPill status={o.status} restante={o.qtyRemaining} />
                        </td>
                        <td className="small muted">
                          {hora(o.createdAt)}
                          {o.updatedAt ? <span className="tag-editado">editado</span> : null}
                        </td>
                        <td className="num">
                          <button
                            className="btn btn--ghost btn--sm"
                            type="button"
                            onClick={() => setEditandoId(o.id)}
                            disabled={o.status === 'cancelado'}
                            title={
                              o.status === 'cancelado'
                                ? 'Pedido cancelado: restaure antes de editar'
                                : 'Corrigir nome, pagamento ou quantidades'
                            }
                          >
                            Editar
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
            <Paginacao estado={pagRecentes} rotulo="pedidos" />
          </div>
        </section>
      </div>

      {pedidoEditando ? (
        <EditarPedido
          order={pedidoEditando}
          flavors={flavors}
          paymentMethods={config.paymentMethods}
          onFechar={() => setEditandoId(null)}
          onToast={onToast}
        />
      ) : null}
    </form>
  )
}

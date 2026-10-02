import { useMemo, useRef, useState } from 'react'
import { api } from '../api.js'
import { BotaoPago } from '../components/BotaoPago.jsx'
import { Paginacao, useCartoesQueCabem, usePaginacao } from '../components/Paginacao.jsx'
import { hora, money, plural } from '../format.js'

export default function Cozinha({ state, onToast }) {
  return (
    <div className="screen screen--cozinha">
      <FilaRetirada state={state} onToast={onToast} />

      {/* A cozinha cuida dos sabores e da producao. O valor do pastel fica no caixa. */}
      <div className="rodape">
        <Sabores flavors={state.flavors} onToast={onToast} />
        <Producao flavors={state.flavors} totals={state.totals} onToast={onToast} />
        <VendidosPorSabor flavors={state.flavors} totals={state.totals} />
      </div>
    </div>
  )
}

/* --------------------------------------------------------- fila de retirada */

const ALTURA_FICHA = 178

function FilaRetirada({ state, onToast }) {
  const [busca, setBusca] = useState('')
  const [ocupado, setOcupado] = useState(null)
  const [parcialDe, setParcialDe] = useState(null) // id do pedido com o painel aberto

  // Pendentes e parciais dividem a mesma fila: os dois ainda devem pasteis.
  const naFila = useMemo(
    () => state.orders.filter((o) => o.status === 'pendente' || o.status === 'parcial'),
    [state.orders]
  )

  const filtrados = useMemo(() => {
    const termo = busca.trim().toLowerCase()
    if (!termo) return naFila
    return naFila.filter(
      (o) => String(o.number).includes(termo) || o.customerName.toLowerCase().includes(termo)
    )
  }, [busca, naFila])

  // A fila e uma grade de fichas: a medida real da area diz quantas cabem sem rolar.
  const [area, porPagina] = useCartoesQueCabem({ largura: 252, altura: ALTURA_FICHA, minimo: 1 })

  // Abrir o painel de retirada parcial deixa a ficha mais alta, e a medicao
  // reduziria a pagina — o cartao em uso podia sumir para a pagina seguinte no
  // meio do atendimento. Enquanto o painel esta aberto, a pagina fica do
  // tamanho que tinha antes de abrir.
  const congelado = useRef(porPagina)
  if (parcialDe === null) congelado.current = porPagina
  const pag = usePaginacao(filtrados, parcialDe === null ? porPagina : congelado.current)

  const totalPendente = naFila.reduce((sum, o) => sum + o.qtyRemaining, 0)
  const retiradosRecentes = state.orders.filter((o) => o.status === 'retirado').slice(0, 6)

  async function acao(order, fn, mensagem) {
    setOcupado(order.id)
    try {
      await fn()
      onToast(mensagem, 'success')
      setParcialDe(null)
      setBusca('')
    } catch (err) {
      onToast(err.message, 'error')
    } finally {
      setOcupado(null)
    }
  }

  return (
    <section className="panel">
      <div className="panel__head">
        <h2 className="panel__title">
          Fila de retirada — {plural(naFila.length, 'pedido', 'pedidos')} / {totalPendente} pasteis
        </h2>
        <input
          type="text"
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
          placeholder="Buscar numero ou nome..."
          autoComplete="off"
          style={{ maxWidth: 260 }}
          aria-label="Buscar pedido na fila"
        />
      </div>

      <div className="panel__body">
        <div className="rolagem" ref={area}>
          {filtrados.length === 0 ? (
            <div className="vazio">
              {naFila.length === 0 ? (
                <div>
                  Nenhum pedido aguardando retirada.
                  {retiradosRecentes.length ? (
                    <div className="small muted" style={{ marginTop: 8 }}>
                      Ultimos entregues: {retiradosRecentes.map((o) => `#${o.number}`).join(', ')}
                    </div>
                  ) : null}
                </div>
              ) : (
                'Nenhum pedido encontrado com esse termo.'
              )}
            </div>
          ) : (
            <div className="fila">
              {pag.visiveis.map((o) => (
                <Ficha
                  key={o.id}
                  order={o}
                  ocupado={ocupado === o.id}
                  aberto={parcialDe === o.id}
                  onToast={onToast}
                  onAbrirParcial={() => setParcialDe(parcialDe === o.id ? null : o.id)}
                  onRetirarTudo={() =>
                    acao(o, () => api.retirar(o.id), `Pedido #${o.number} entregue por completo.`)
                  }
                  onParcial={(items, qtd) =>
                    acao(
                      o,
                      () => api.retirarParcial(o.id, items),
                      `Pedido #${o.number}: ${plural(qtd, 'pastel entregue', 'pasteis entregues')}.`
                    )
                  }
                  onDesfazer={() =>
                    acao(o, () => api.reabrir(o.id), `Pedido #${o.number} voltou para o inicio da fila.`)
                  }
                />
              ))}
            </div>
          )}
        </div>
        <Paginacao estado={pag} rotulo="na fila" />
      </div>
    </section>
  )
}

function Ficha({ order, ocupado, aberto, onToast, onAbrirParcial, onRetirarTudo, onParcial, onDesfazer }) {
  const pendentes = order.items.filter((i) => i.qty - i.deliveredQty > 0)
  const parcial = order.status === 'parcial'

  return (
    <div className={parcial ? 'ficha ficha--parcial' : 'ficha'}>
      <div className="ficha__head">
        <span className="ficha__numero">#{order.number}</span>
        <span className="small muted">{hora(order.createdAt)}</span>
      </div>

      <div className="ficha__nome">{order.customerName}</div>

      {/* Sabores em linha corrida: cabem mais fichas na tela sem rolar. */}
      <div className="ficha__itens">
        {order.items.map((i, pos) => (
          <span key={i.flavorId}>
            {pos > 0 ? ' · ' : ''}
            {i.flavorName} <strong>x{i.qty}</strong>
            {i.deliveredQty > 0 ? <span className="ficha__falta"> ({i.deliveredQty} ja saiu)</span> : null}
          </span>
        ))}
        <span className="muted">
          {' — '}
          {money(order.totalCents)} · {order.paymentMethod}
        </span>
        {parcial ? <strong className="ficha__falta"> · faltam {order.qtyRemaining}</strong> : null}
      </div>

      {aberto ? (
        <PainelParcial
          itens={pendentes}
          ocupado={ocupado}
          onConfirmar={onParcial}
          onCancelar={onAbrirParcial}
        />
      ) : (
        <>
          {/* O botao de pagamento fica aqui tambem: em muitos eventos o cliente
              so paga ao retirar, e quem recebe e a cozinha. */}
          <div className="ficha__acoes">
            <BotaoPago order={order} onToast={onToast} />
            <button
              className="btn btn--partial"
              type="button"
              onClick={onAbrirParcial}
              disabled={ocupado || order.qtyRemaining <= 1}
              title={
                order.qtyRemaining <= 1
                  ? 'So faz sentido em pedidos com mais de um pastel a retirar'
                  : 'O cliente leva parte agora e volta depois'
              }
            >
              Parcial
            </button>
          </div>
          <button
            className="btn btn--success btn--block"
            type="button"
            onClick={onRetirarTudo}
            disabled={ocupado}
          >
            {ocupado ? '...' : parcial ? 'Entregar o resto' : 'Retirado'}
          </button>
        </>
      )}

      {parcial && !aberto ? (
        <button className="btn btn--ghost btn--sm" type="button" onClick={onDesfazer} disabled={ocupado}>
          Desfazer entregas
        </button>
      ) : null}
    </div>
  )
}

/** Steppers com o que ainda falta de cada sabor, para o cliente levar so uma parte. */
function PainelParcial({ itens, ocupado, onConfirmar, onCancelar }) {
  const [levando, setLevando] = useState({})

  const total = itens.reduce((sum, i) => sum + (levando[i.flavorId] || 0), 0)

  function ajustar(item, delta) {
    const restante = item.qty - item.deliveredQty
    setLevando((atual) => {
      const novo = Math.min(restante, Math.max(0, (atual[item.flavorId] || 0) + delta))
      return { ...atual, [item.flavorId]: novo }
    })
  }

  function confirmar() {
    const items = itens
      .map((i) => ({ flavorId: i.flavorId, qty: levando[i.flavorId] || 0 }))
      .filter((i) => i.qty > 0)
    if (items.length === 0) return
    onConfirmar(items, total)
  }

  return (
    <div className="parcial">
      <span className="field__label" style={{ marginBottom: 0 }}>
        Levando agora
      </span>

      {itens.map((i) => {
        const restante = i.qty - i.deliveredQty
        const valor = levando[i.flavorId] || 0
        return (
          <div className="parcial__linha" key={i.flavorId}>
            <span className="parcial__nome">{i.flavorName}</span>
            <span className="parcial__resta">de {restante}</span>
            <div className="stepper">
              <button
                type="button"
                onClick={() => ajustar(i, -1)}
                disabled={valor === 0}
                aria-label={`Menos ${i.flavorName}`}
              >
                −
              </button>
              <input
                type="number"
                min="0"
                max={restante}
                value={valor}
                onChange={(e) => {
                  const n = Number.parseInt(e.target.value, 10)
                  setLevando((a) => ({
                    ...a,
                    [i.flavorId]: Number.isNaN(n) ? 0 : Math.min(restante, Math.max(0, n)),
                  }))
                }}
                onFocus={(e) => e.target.select()}
                aria-label={`Quantidade de ${i.flavorName} levando agora`}
              />
              <button
                type="button"
                onClick={() => ajustar(i, 1)}
                disabled={valor >= restante}
                aria-label={`Mais ${i.flavorName}`}
              >
                +
              </button>
            </div>
          </div>
        )
      })}

      <div className="ficha__acoes">
        <button
          className="btn btn--partial"
          type="button"
          onClick={confirmar}
          disabled={ocupado || total === 0}
        >
          {ocupado ? '...' : `Entregar ${total}`}
        </button>
        <button className="btn btn--ghost" type="button" onClick={onCancelar} disabled={ocupado}>
          Cancelar
        </button>
      </div>
    </div>
  )
}


/* ------------------------------------------------------------------ producao */

function Producao({ flavors, totals, onToast }) {
  const ativos = flavors.filter((f) => f.active)
  const [entradas, setEntradas] = useState({})
  const [tipo, setTipo] = useState('producao')
  const [salvando, setSalvando] = useState(false)

  const [area, porPagina] = useCartoesQueCabem({ largura: 118, altura: 44, minimo: 2 })
  const pag = usePaginacao(ativos, porPagina)

  const totalLancar = Object.values(entradas).reduce((sum, v) => sum + (Number.parseInt(v, 10) || 0), 0)

  async function lancar(event) {
    event.preventDefault()
    const lista = ativos
      .map((f) => ({ flavorId: f.id, qty: Number.parseInt(entradas[f.id], 10) }))
      .filter((e) => Number.isInteger(e.qty) && e.qty !== 0)

    if (lista.length === 0) return onToast('Informe a quantidade de pelo menos um sabor.', 'error')

    setSalvando(true)
    try {
      await api.lancarEstoqueLote({ kind: tipo, entries: lista })
      setEntradas({})
      onToast(`${plural(totalLancar, 'pastel lancado', 'pasteis lancados')} no estoque.`, 'success')
    } catch (err) {
      onToast(err.message, 'error')
    } finally {
      setSalvando(false)
    }
  }

  return (
    <section className="panel">
      <div className="panel__head">
        <h2 className="panel__title">Lancar producao</h2>
        <span className="small muted">{totals.available} disponiveis</span>
      </div>

      <form className="panel__body" onSubmit={lancar}>
        <div className="row" style={{ marginBottom: 8, flex: 'none' }}>
          <select
            value={tipo}
            onChange={(e) => setTipo(e.target.value)}
            aria-label="Tipo de lancamento"
          >
            <option value="inicial">Carga inicial (antes de abrir)</option>
            <option value="producao">Producao (fornada nova)</option>
            <option value="ajuste">Ajuste / perda (aceita negativo)</option>
          </select>
          <button className="btn fixo" type="submit" disabled={salvando}>
            {salvando ? 'Lancando...' : totalLancar ? `Lancar ${totalLancar}` : 'Lancar'}
          </button>
        </div>

        <div className="rolagem" ref={area}>
          {ativos.length === 0 ? (
            <div className="vazio">Cadastre um sabor primeiro.</div>
          ) : (
            <div className="producao">
              {pag.visiveis.map((f) => (
                <label className="producao__item" key={f.id}>
                  <span className="producao__nome">
                    <b>{f.name}</b>
                    <span
                      className={
                        f.available <= 0 ? 'small sabor__estoque--baixo' : 'small muted'
                      }
                    >
                      {f.available} disp.
                    </span>
                  </span>
                  <input
                    type="number"
                    step="1"
                    value={entradas[f.id] ?? ''}
                    placeholder="0"
                    onChange={(e) => setEntradas((a) => ({ ...a, [f.id]: e.target.value }))}
                    onFocus={(e) => e.target.select()}
                    aria-label={`Quantidade de ${f.name}`}
                  />
                </label>
              ))}
            </div>
          )}
        </div>

        <Paginacao estado={pag} rotulo="sabores" />
      </form>
    </section>
  )
}

/* ------------------------------------------------------------------ sabores */

/**
 * O cardapio da cozinha: cadastra sabor, liga/desliga o que acabou e apaga o que
 * nunca foi usado. O VALOR nao mora aqui — e unico para todos os sabores e quem
 * define e o caixa, na aba dele.
 */
function Sabores({ flavors, onToast }) {
  const [novo, setNovo] = useState('')
  const [salvando, setSalvando] = useState(false)
  const [ocupado, setOcupado] = useState(null)

  const [area, porPagina] = useCartoesQueCabem({ largura: 186, altura: 40, minimo: 2 })
  const pag = usePaginacao(flavors, porPagina)

  async function adicionar(event) {
    event.preventDefault()
    if (!novo.trim()) return

    setSalvando(true)
    try {
      const res = await api.criarSabor(novo.trim())
      onToast(
        res.reactivated ? `Sabor ${res.name} reativado.` : `Sabor ${novo.trim()} cadastrado.`,
        'success'
      )
      setNovo('')
      pag.primeira()
    } catch (err) {
      onToast(err.message, 'error')
    } finally {
      setSalvando(false)
    }
  }

  async function alternar(flavor) {
    setOcupado(flavor.id)
    try {
      await api.atualizarSabor(flavor.id, { active: !flavor.active })
      onToast(`${flavor.name} ${flavor.active ? 'desativado' : 'reativado'}.`, 'success')
    } catch (err) {
      onToast(err.message, 'error')
    } finally {
      setOcupado(null)
    }
  }

  async function apagar(flavor) {
    if (!window.confirm(`Apagar o sabor ${flavor.name} de vez?`)) return

    setOcupado(flavor.id)
    try {
      await api.apagarSabor(flavor.id)
      onToast(`Sabor ${flavor.name} apagado.`, 'success')
    } catch (err) {
      // Sabor com historico nao pode sumir; a mensagem do servidor ja explica.
      onToast(err.message, 'error')
    } finally {
      setOcupado(null)
    }
  }

  const ativos = flavors.filter((f) => f.active).length

  return (
    <section className="panel">
      <div className="panel__head">
        <h2 className="panel__title">Sabores</h2>
        <span className="small muted">
          {ativos} no ar de {flavors.length}
        </span>
      </div>

      <div className="panel__body">
        <form className="row" onSubmit={adicionar} style={{ marginBottom: 8, flex: 'none' }}>
          <input
            type="text"
            value={novo}
            onChange={(e) => setNovo(e.target.value)}
            placeholder="Novo sabor"
            maxLength={40}
            aria-label="Nome do novo sabor"
          />
          <button className="btn fixo" type="submit" disabled={!novo.trim() || salvando}>
            Add
          </button>
        </form>

        <div className="rolagem" ref={area}>
          {flavors.length === 0 ? (
            <div className="vazio">Nenhum sabor cadastrado.</div>
          ) : (
            <div className="cardapio">
              {pag.visiveis.map((f) => (
                <div
                  className={f.active ? 'cardapio__item' : 'cardapio__item cardapio__item--off'}
                  key={f.id}
                >
                  <span className="cardapio__nome" title={f.name}>
                    {f.name}
                  </span>
                  <span className="small muted" style={{ textAlign: 'right' }}>
                    {f.available} disp.
                  </span>
                  <button
                    className="btn btn--ghost btn--sm"
                    type="button"
                    onClick={() => alternar(f)}
                    disabled={ocupado === f.id}
                    title={f.active ? 'Some do caixa' : 'Volta para o caixa'}
                  >
                    {f.active ? 'Off' : 'On'}
                  </button>
                  <button
                    className="btn btn--ghost btn--sm"
                    type="button"
                    onClick={() => apagar(f)}
                    disabled={ocupado === f.id}
                    title="Apaga de vez (so se o sabor nunca foi usado)"
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
        <Paginacao estado={pag} rotulo="sabores" />
      </div>
    </section>
  )
}

/* --------------------------------------------------------- vendidos por sabor */

/**
 * Placar de quantos pasteis ja sairam de cada sabor. So numero, sem dinheiro:
 * a cozinha quer saber o que esta girando para decidir a proxima fornada.
 */
function VendidosPorSabor({ flavors, totals }) {
  const comVenda = flavors.filter((f) => f.active || f.sold > 0)

  const [area, porPagina] = useCartoesQueCabem({ largura: 108, altura: 56, minimo: 2 })
  const pag = usePaginacao(comVenda, porPagina)

  return (
    <section className="panel">
      <div className="panel__head">
        <h2 className="panel__title">Vendidos por sabor</h2>
        <span className="small muted">{totals.sold} no total</span>
      </div>

      <div className="panel__body">
        <div className="rolagem" ref={area}>
          {comVenda.length === 0 ? (
            <div className="vazio">Nenhum sabor cadastrado.</div>
          ) : (
            <div className="placar">
              {pag.visiveis.map((f) => (
                <div className="placar__item" key={f.id}>
                  <span className="placar__numero">{f.sold}</span>
                  <span className="placar__nome" title={f.name}>
                    {f.name}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
        <Paginacao estado={pag} rotulo="sabores" />
      </div>
    </section>
  )
}

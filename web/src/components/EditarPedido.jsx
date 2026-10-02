import { useEffect, useMemo, useRef, useState } from 'react'
import { api } from '../api.js'
import { money, plural } from '../format.js'

/**
 * Corrige um pedido ja lancado, sem precisar apagar e refazer.
 *
 * O valor unitario aparece travado de proposito: o pedido guarda o preco do
 * momento da venda, e mexer nisso depois faria o faturamento nao bater com a
 * caixinha. O que se corrige aqui e o engano de balcao — nome trocado, sabor
 * errado, "era 6, nao 8".
 *
 * Cada sabor tem um piso: o que o cliente JA retirou da cozinha. Nao adianta a
 * tela deixar digitar menos que isso, entao ela simplesmente nao deixa.
 */
export default function EditarPedido({ order, flavors, paymentMethods, onFechar, onToast }) {
  const [nome, setNome] = useState(order.customerName)
  const [pagamento, setPagamento] = useState(order.paymentMethod)
  const [obs, setObs] = useState(order.note || '')
  const [quantidades, setQuantidades] = useState(() => {
    const inicial = {}
    for (const item of order.items) inicial[item.flavorId] = item.qty
    return inicial
  })
  const [enviando, setEnviando] = useState(false)
  const [erro, setErro] = useState('')
  const nomeRef = useRef(null)

  useEffect(() => {
    nomeRef.current?.focus()
    nomeRef.current?.select()
  }, [])

  // Esc fecha, como em qualquer janela.
  useEffect(() => {
    const aoTeclar = (e) => {
      if (e.key === 'Escape') onFechar()
    }
    window.addEventListener('keydown', aoTeclar)
    return () => window.removeEventListener('keydown', aoTeclar)
  }, [onFechar])

  const precoCents = order.unitPriceCents

  /*
   * Limites de cada sabor:
   *  piso = o que ja foi retirado (nao da para desfazer o que o cliente levou)
   *  teto = o disponivel no estoque MAIS o que este pedido ja segurava, porque
   *         essas unidades voltam para a conta quando ele e reescrito
   */
  const linhas = useMemo(() => {
    const noPedido = new Map(order.items.map((i) => [i.flavorId, i]))
    return flavors
      .filter((f) => f.active || noPedido.has(f.id))
      .map((f) => {
        const item = noPedido.get(f.id)
        const original = item?.qty || 0
        return {
          flavor: f,
          original,
          piso: item?.deliveredQty || 0,
          teto: f.available + original,
          desativado: !f.active,
        }
      })
  }, [flavors, order.items])

  const qtdTotal = linhas.reduce((s, l) => s + (quantidades[l.flavor.id] || 0), 0)
  const totalCents = qtdTotal * precoCents
  const diferencaCents = totalCents - order.totalCents

  function ajustar(linha, delta) {
    setQuantidades((atual) => {
      const alvo = (atual[linha.flavor.id] || 0) + delta
      return { ...atual, [linha.flavor.id]: Math.min(Math.max(alvo, linha.piso), linha.teto) }
    })
  }

  function digitar(linha, texto) {
    const n = Number.parseInt(texto, 10)
    setQuantidades((atual) => ({
      ...atual,
      [linha.flavor.id]: Number.isNaN(n) ? linha.piso : Math.min(Math.max(n, linha.piso), linha.teto),
    }))
  }

  async function salvar(event) {
    event?.preventDefault()
    setErro('')

    if (!nome.trim()) return setErro('Informe o nome do comprador.')
    const items = linhas
      .map((l) => ({ flavorId: l.flavor.id, qty: quantidades[l.flavor.id] || 0 }))
      .filter((i) => i.qty > 0)
    if (items.length === 0) return setErro('O pedido precisa de pelo menos um pastel.')

    setEnviando(true)
    try {
      const r = await api.editarPedido(order.id, {
        customerName: nome.trim(),
        paymentMethod: pagamento,
        note: obs.trim(),
        items,
      })
      onToast('Pedido #' + order.number + ' atualizado — ' + money(r.totalCents), 'success')
      // Pedido pago que mudou de valor: o aviso vem do servidor e precisa ser lido.
      if (r.avisoPagamento) onToast(r.avisoPagamento, 'error')
      onFechar()
    } catch (err) {
      setErro(err.message)
    } finally {
      setEnviando(false)
    }
  }

  return (
    <div className="modal-fundo" onMouseDown={(e) => e.target === e.currentTarget && onFechar()}>
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        onKeyDown={(e) => {
          // Sem <form> aqui: a tela do caixa ja e um formulario, e um dentro do
          // outro faria o Enter lancar um pedido novo em vez de salvar este.
          if (e.key === 'Enter' && !enviando) salvar(e)
        }}
      >
        <div className="modal__head">
          <h2 className="modal__titulo">
            Editar pedido <strong>#{order.number}</strong>
          </h2>
          <button className="btn btn--ghost btn--sm" type="button" onClick={onFechar}>
            Fechar
          </button>
        </div>

        <div className="modal__body">
          <div className="modal__linha">
            <label className="field" style={{ flex: 2, marginBottom: 0 }}>
              <span className="field__label">Comprador</span>
              <input ref={nomeRef} value={nome} onChange={(e) => setNome(e.target.value)} maxLength={80} />
            </label>
            <label className="field" style={{ flex: 1, marginBottom: 0 }}>
              <span className="field__label">Pagamento</span>
              <select value={pagamento} onChange={(e) => setPagamento(e.target.value)}>
                {paymentMethods.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <label className="field">
            <span className="field__label">Observacao (opcional)</span>
            <input value={obs} onChange={(e) => setObs(e.target.value)} maxLength={140} />
          </label>

          <div className="modal__sabores">
            {linhas.map((l) => {
              const qtd = quantidades[l.flavor.id] || 0
              return (
                <div key={l.flavor.id} className={qtd > 0 ? 'linha-sabor is-ativa' : 'linha-sabor'}>
                  <div className="linha-sabor__info">
                    <span className="linha-sabor__nome">
                      {l.flavor.name}
                      {l.desativado ? <span className="tag-off">desligado</span> : null}
                    </span>
                    <span className="linha-sabor__limites">
                      {l.piso > 0 ? 'ja retirou ' + l.piso + ' · ' : ''}
                      max {l.teto}
                    </span>
                  </div>
                  <div className="stepper">
                    <button
                      type="button"
                      onClick={() => ajustar(l, -1)}
                      disabled={qtd <= l.piso}
                      aria-label={'Diminuir ' + l.flavor.name}
                    >
                      −
                    </button>
                    <input
                      type="number"
                      inputMode="numeric"
                      value={qtd}
                      onChange={(e) => digitar(l, e.target.value)}
                      aria-label={'Quantidade de ' + l.flavor.name}
                    />
                    <button
                      type="button"
                      onClick={() => ajustar(l, 1)}
                      disabled={qtd >= l.teto}
                      aria-label={'Aumentar ' + l.flavor.name}
                    >
                      +
                    </button>
                  </div>
                </div>
              )
            })}
          </div>

          {erro ? (
            <div className="alert alert--error" role="alert">
              {erro}
            </div>
          ) : null}
        </div>

        <div className="modal__pe">
          <div className="modal__conta">
            <span className="modal__linha-conta">
              {plural(qtdTotal, 'pastel', 'pasteis')} x {money(precoCents)}
              <span className="travado">valor travado na venda</span>
            </span>
            <span className="modal__valores">
              <strong className="modal__total">{money(totalCents)}</strong>
              {diferencaCents !== 0 ? (
                <span className={diferencaCents > 0 ? 'delta delta--mais' : 'delta delta--menos'}>
                  {diferencaCents > 0 ? '+' : '−'}
                  {money(Math.abs(diferencaCents))}
                </span>
              ) : null}
            </span>
          </div>
          <div className="modal__acoes">
            <button className="btn btn--ghost" type="button" onClick={onFechar}>
              Cancelar
            </button>
            <button className="btn" type="button" onClick={salvar} disabled={enviando}>
              {enviando ? 'Salvando...' : 'Salvar alteracoes'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

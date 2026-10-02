import { useMemo, useState } from 'react'
import { api } from '../api.js'
import { Kpi } from '../components/Kpi.jsx'
import { Paginacao, useLinhasQueCabem, usePaginacao } from '../components/Paginacao.jsx'
import { dataHora, money, parseMoney } from '../format.js'

export default function Custos({ state, onToast }) {
  const { kpi, costs, config } = state

  const [descricao, setDescricao] = useState('')
  const [categoria, setCategoria] = useState(config.costCategories[0])
  const [valor, setValor] = useState('')
  const [salvando, setSalvando] = useState(false)
  const [apagando, setApagando] = useState(null)

  const [area, linhas] = useLinhasQueCabem()
  const pag = usePaginacao(costs, linhas)

  // Quanto foi gasto em cada categoria, para ver onde o dinheiro foi.
  const porCategoria = useMemo(() => {
    const mapa = new Map()
    for (const c of costs) mapa.set(c.category, (mapa.get(c.category) || 0) + c.amountCents)
    return [...mapa.entries()].sort((a, b) => b[1] - a[1])
  }, [costs])

  async function lancar(event) {
    event.preventDefault()
    const numero = parseMoney(valor)
    if (!descricao.trim()) return onToast('Descreva o custo.', 'error')
    if (!Number.isFinite(numero) || numero <= 0) return onToast('Informe um valor valido, ex.: 120,50.', 'error')

    setSalvando(true)
    try {
      await api.criarCusto({ description: descricao.trim(), category: categoria, amount: numero })
      onToast(`Custo de ${money(Math.round(numero * 100))} lancado.`, 'success')
      setDescricao('')
      setValor('')
      pag.primeira()
    } catch (err) {
      onToast(err.message, 'error')
    } finally {
      setSalvando(false)
    }
  }

  async function apagar(custo) {
    if (!window.confirm(`Apagar o custo "${custo.description}" de ${money(custo.amountCents)}?`)) return

    setApagando(custo.id)
    try {
      await api.apagarCusto(custo.id)
      onToast('Custo removido.', 'success')
    } catch (err) {
      onToast(err.message, 'error')
    } finally {
      setApagando(null)
    }
  }

  const margem = kpi.revenueCents > 0 ? Math.round((kpi.netCents / kpi.revenueCents) * 100) : 0

  return (
    <div className="screen screen--dashboard">
      <div className="kpis">
        <Kpi
          variante="brand"
          label="Faturamento bruto"
          value={money(kpi.revenueCents)}
          hint={`${kpi.ordersCount} vendas`}
        />
        <Kpi
          variante="custo"
          label="Total de custos"
          value={money(kpi.costsCents)}
          hint={`${costs.length} lancamentos`}
        />
        <Kpi
          variante="net"
          label="Valor liquido"
          value={money(kpi.netCents)}
          negativo={kpi.netCents < 0}
          hint={kpi.revenueCents > 0 ? `${margem}% do faturamento` : 'sem vendas ainda'}
        />
      </div>

      <div className="split">
        <section className="panel">
          <div className="panel__head">
            <h2 className="panel__title">Custos lancados</h2>
          </div>

          <div className="panel__body">
            <div className="rolagem" ref={area}>
              {costs.length === 0 ? (
                <div className="vazio">
                  Nenhum custo lancado. Use o formulario ao lado para registrar ingredientes,
                  embalagens, gas e o que mais o evento consumir.
                </div>
              ) : (
                <table>
                  <thead>
                    <tr>
                      <th>Descricao</th>
                      <th>Categoria</th>
                      <th className="num">Valor</th>
                      <th>Lancado</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {pag.visiveis.map((c) => (
                      <tr key={c.id}>
                        <td className="trunca">{c.description}</td>
                        <td className="small muted">{c.category}</td>
                        <td className="num dinheiro">{money(c.amountCents)}</td>
                        <td className="small muted">{dataHora(c.createdAt)}</td>
                        <td className="num">
                          <button
                            className="btn btn--ghost btn--sm"
                            type="button"
                            onClick={() => apagar(c)}
                            disabled={apagando === c.id}
                          >
                            Apagar
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr>
                      <th colSpan={2}>Total</th>
                      <th className="num">{money(kpi.costsCents)}</th>
                      <th colSpan={2} />
                    </tr>
                  </tfoot>
                </table>
              )}
            </div>
            <Paginacao estado={pag} rotulo="custos" />
          </div>
        </section>

        <div className="col" style={{ gridTemplateRows: 'auto minmax(0, 1fr)' }}>
          <section className="panel">
            <div className="panel__head">
              <h2 className="panel__title">Lancar custo</h2>
            </div>

            <form className="panel__body" onSubmit={lancar}>
              <label className="field">
                <span className="field__label">Descricao</span>
                <input
                  type="text"
                  value={descricao}
                  onChange={(e) => setDescricao(e.target.value)}
                  placeholder="Ex.: 10kg de farinha de trigo"
                  maxLength={80}
                  autoComplete="off"
                />
              </label>

              <div className="row">
                <label className="field" style={{ marginBottom: 0, flex: 2 }}>
                  <span className="field__label">Categoria</span>
                  <select value={categoria} onChange={(e) => setCategoria(e.target.value)}>
                    {config.costCategories.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="field" style={{ marginBottom: 0, flex: 1 }}>
                  <span className="field__label">Valor (R$)</span>
                  <input
                    type="text"
                    inputMode="decimal"
                    value={valor}
                    onChange={(e) => setValor(e.target.value)}
                    placeholder="120,50"
                  />
                </label>
              </div>

              <button
                className="btn btn--block"
                type="submit"
                disabled={salvando}
                style={{ marginTop: 10, flex: 'none' }}
              >
                {salvando ? 'Lancando...' : 'Lancar custo'}
              </button>
            </form>
          </section>

          <section className="panel">
            <div className="panel__head">
              <h2 className="panel__title">Por categoria</h2>
            </div>
            <div className="panel__body">
              <div className="rolagem">
                {porCategoria.length === 0 ? (
                  <div className="vazio">Sem custos ainda.</div>
                ) : (
                  <table>
                    <tbody>
                      {porCategoria.map(([nome, total]) => (
                        <tr key={nome}>
                          <td>{nome}</td>
                          <td className="num dinheiro">{money(total)}</td>
                          <td className="num small muted">
                            {Math.round((total / kpi.costsCents) * 100)}%
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </div>
          </section>
        </div>
      </div>
    </div>
  )
}

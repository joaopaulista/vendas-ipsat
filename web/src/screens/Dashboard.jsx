import { SeloPago } from '../components/BotaoPago.jsx'
import { Kpi, StatusPill } from '../components/Kpi.jsx'
import { Paginacao, useLinhasQueCabem, usePaginacao } from '../components/Paginacao.jsx'
import { hora, money } from '../format.js'

export default function Dashboard({ state }) {
  const { kpi, flavors, totals, config } = state
  const comMovimento = flavors.filter((f) => f.active || f.sold > 0 || f.produced > 0)

  const [areaSabores, linhasSabores] = useLinhasQueCabem({ reservado: 62 })
  const [areaPedidos, linhasPedidos] = useLinhasQueCabem()

  const pagSabores = usePaginacao(comMovimento, linhasSabores)
  const pagPedidos = usePaginacao(state.orders, linhasPedidos)

  const esgotados = flavors.filter((f) => f.active && f.available <= 0 && f.produced > 0)

  return (
    <div className="screen screen--dashboard">
      <div className="kpis">
        <Kpi
          variante="brand"
          label="Faturamento"
          value={money(kpi.revenueCents)}
          hint={`${kpi.ordersCount} vendas · ticket ${money(kpi.ticketMedioCents)}`}
        />
        <Kpi
          variante="custo"
          label="Custos do evento"
          value={money(kpi.costsCents)}
          hint={state.costs.length ? `${state.costs.length} lancamentos` : 'nenhum lancamento'}
        />
        <Kpi
          variante="net"
          label="Valor liquido"
          value={money(kpi.netCents)}
          negativo={kpi.netCents < 0}
          hint="faturamento - custos"
        />
        <Kpi
          label="Pasteis vendidos"
          value={kpi.pasteisSold}
          hint={`${kpi.pasteisDelivered} entregues · ${kpi.pasteisPending} a retirar`}
        />
        <Kpi
          label="Disponivel agora"
          value={totals.available}
          hint={`${totals.produced} produzidos`}
        />
        <Kpi
          label="Ja recebido"
          value={money(kpi.recebidoCents)}
          negativo={kpi.aReceberCents > 0}
          hint={
            kpi.aReceberCents > 0
              ? `faltam ${money(kpi.aReceberCents)} de ${kpi.ordersNaoPagos} pedido(s)`
              : 'todos os pedidos pagos'
          }
        />
        <Kpi
          label="Na fila"
          value={kpi.ordersPending + kpi.ordersPartial}
          hint={
            kpi.ordersPartial > 0
              ? `${kpi.ordersPartial} em retirada parcial`
              : 'pedidos aguardando retirada'
          }
        />
        <Kpi
          label="Valor do pastel"
          value={config.unitPriceCents > 0 ? money(config.unitPriceCents) : '—'}
          hint="definido no caixa"
        />
      </div>

      <div className="split">
        <section className="panel">
          <div className="panel__head">
            <h2 className="panel__title">Ultimos pedidos</h2>
            {esgotados.length ? (
              <span className="small" style={{ color: 'var(--danger)', fontWeight: 700 }}>
                Esgotado: {esgotados.map((f) => f.name).join(', ')}
              </span>
            ) : null}
          </div>

          <div className="panel__body">
            <div className="rolagem" ref={areaPedidos}>
              {state.orders.length === 0 ? (
                <div className="vazio">Nenhum pedido lancado ainda.</div>
              ) : (
                <table>
                  <thead>
                    <tr>
                      <th className="num">#</th>
                      <th>Comprador</th>
                      <th className="num">Qtd</th>
                      <th className="num">Total</th>
                      <th>Pagamento</th>
                      <th>Pago?</th>
                      <th>Status</th>
                      <th>Hora</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pagPedidos.visiveis.map((o) => (
                      <tr key={o.id}>
                        <td className="num">
                          <strong>{o.number}</strong>
                        </td>
                        <td className="trunca">{o.customerName}</td>
                        <td className="num">{o.qtyTotal}</td>
                        <td className="num dinheiro">{money(o.totalCents)}</td>
                        <td>{o.paymentMethod}</td>
                        <td>
                          <SeloPago pago={o.pago} />
                        </td>
                        <td>
                          <StatusPill status={o.status} restante={o.qtyRemaining} />
                        </td>
                        <td className="small muted">{hora(o.createdAt)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
            <Paginacao estado={pagPedidos} rotulo="pedidos" />
          </div>
        </section>

        <section className="panel">
          <div className="panel__head">
            <h2 className="panel__title">Pasteis por sabor</h2>
          </div>

          <div className="panel__body">
            <div className="rolagem" ref={areaSabores}>
              {comMovimento.length === 0 ? (
                <div className="vazio">Nenhum sabor cadastrado.</div>
              ) : (
                <table>
                  <thead>
                    <tr>
                      <th>Sabor</th>
                      <th className="num">Prod.</th>
                      <th className="num">Vend.</th>
                      <th className="num">Disp.</th>
                      <th className="num">Valor</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pagSabores.visiveis.map((f) => (
                      <tr key={f.id}>
                        <td className="trunca">
                          {f.name}
                          {!f.active ? <span className="small muted"> (off)</span> : null}
                        </td>
                        <td className="num">{f.produced}</td>
                        <td className="num">{f.sold}</td>
                        <td className={f.available <= 0 ? 'num sabor__estoque--baixo' : 'num'}>
                          {f.available}
                        </td>
                        <td className="num dinheiro">{money(f.revenueCents)}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr>
                      <th>Total</th>
                      <th className="num">{totals.produced}</th>
                      <th className="num">{totals.sold}</th>
                      <th className="num">{totals.available}</th>
                      <th className="num">{money(kpi.revenueCents)}</th>
                    </tr>
                  </tfoot>
                </table>
              )}
            </div>
            <Paginacao estado={pagSabores} rotulo="sabores" />
          </div>
        </section>
      </div>
    </div>
  )
}

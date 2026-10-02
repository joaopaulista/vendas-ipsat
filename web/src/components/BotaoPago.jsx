import { useState } from 'react'
import { api } from '../api.js'
import { money } from '../format.js'

/**
 * Um clique marca que o dinheiro entrou: "Pago?" vira "Pagou".
 *
 * Marcar e um clique so, porque acontece o tempo todo na correria. Desmarcar
 * pede confirmacao, porque so acontece quando alguem errou e some dinheiro do
 * caixa se passar batido.
 */
export function BotaoPago({ order, onToast, pequeno = false }) {
  const [ocupado, setOcupado] = useState(false)

  async function alternar() {
    if (order.pago) {
      const certeza = window.confirm(
        `Desmarcar o pagamento do pedido #${order.number} de ${order.customerName}?\n` +
          `${money(order.totalCents)} voltam para "a receber".`
      )
      if (!certeza) return
    }

    setOcupado(true)
    try {
      await (order.pago ? api.despagar(order.id) : api.pagar(order.id))
      onToast(
        order.pago
          ? `Pedido #${order.number} voltou para "a receber".`
          : `Pedido #${order.number} pago — ${money(order.totalCents)}.`,
        'success'
      )
    } catch (err) {
      onToast(err.message, 'error')
    } finally {
      setOcupado(false)
    }
  }

  const classes = ['btn', order.pago ? 'btn--success' : 'btn--pagar']
  if (pequeno) classes.push('btn--sm')

  return (
    <button
      className={classes.join(' ')}
      type="button"
      onClick={alternar}
      disabled={ocupado || order.status === 'cancelado'}
      title={order.pago ? 'Clique para desmarcar (pede confirmacao)' : 'Marcar que o cliente pagou'}
    >
      {ocupado ? '...' : order.pago ? 'Pagou' : 'Pago?'}
    </button>
  )
}

/** Selo so de leitura, para onde nao cabe o botao. */
export function SeloPago({ pago }) {
  return (
    <span className={pago ? 'pill pill--retirado' : 'pill pill--naopago'}>
      {pago ? 'Pagou' : 'Nao pago'}
    </span>
  )
}

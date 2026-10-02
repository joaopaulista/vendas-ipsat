export function Kpi({ label, value, hint, variante = '', negativo = false }) {
  return (
    <div className={variante ? `kpi kpi--${variante}` : 'kpi'}>
      <div className="kpi__label">{label}</div>
      <div className={negativo ? 'kpi__value kpi__value--negativo' : 'kpi__value'}>{value}</div>
      {hint ? <div className="kpi__hint">{hint}</div> : null}
    </div>
  )
}

const ROTULO = {
  pendente: 'Aguardando',
  parcial: 'Parcial',
  retirado: 'Retirado',
  cancelado: 'Cancelado',
}

export function StatusPill({ status, restante }) {
  const texto =
    status === 'parcial' && restante ? `Parcial · falta ${restante}` : ROTULO[status] || status
  return <span className={`pill pill--${status}`}>{texto}</span>
}

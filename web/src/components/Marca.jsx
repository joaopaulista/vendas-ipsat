/**
 * Selo conjunto das duas marcas: a UMP (sociedade que realiza o evento) e a
 * IPSAT (igreja). O logo da IPSAT e um quadrado verde com o circulo desenhado
 * dentro, por isso vai recortado em circulo.
 */
export function Marca() {
  return (
    <div className="marca">
      <img className="marca__ump" src="/logo-ump.png" alt="UMP" />
      <span className="marca__risco" aria-hidden="true" />
      <img className="marca__ipsat" src="/logo-ipsat.png" alt="IPSAT" />
    </div>
  )
}

export function MarcaGrande() {
  return (
    <div className="login__marca">
      <img src="/logo-ump.png" alt="UMP" />
      <img src="/logo-ipsat.png" alt="IPSAT" />
    </div>
  )
}

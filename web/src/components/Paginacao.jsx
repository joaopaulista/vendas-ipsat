import { useEffect, useLayoutEffect, useRef, useState } from 'react'

/**
 * Descobre quantas linhas cabem no espaco que sobrou da tela.
 *
 * A regra do sistema e "nada de rolar a pagina": em vez de cortar a lista num
 * numero fixo, medimos a area util e paginamos exatamente no que cabe. Se a
 * janela muda de tamanho (ou o monitor da cozinha e menor), a conta refaz.
 */
// No celular a area cresce com o conteudo, entao a conta daria centenas de
// linhas. Este teto mantem a pagina leve sem atrapalhar o desktop.
const TETO = 30

export function useLinhasQueCabem({ alturaLinha = 34, reservado = 32, minimo = 2 } = {}) {
  const ref = useRef(null)
  const [linhas, setLinhas] = useState(minimo)

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return

    const medir = () => {
      const disponivel = el.clientHeight - reservado
      setLinhas(Math.min(TETO, Math.max(minimo, Math.floor(disponivel / alturaLinha))))
    }

    medir()
    const observer = new ResizeObserver(medir)
    observer.observe(el)
    return () => observer.disconnect()
  }, [alturaLinha, reservado, minimo])

  // A conta acima e uma estimativa; a altura real da linha muda com a fonte do
  // sistema e com o zoom. Depois de pintar, se ainda sobrou conteudo, tira uma
  // linha e repete — em uma ou duas voltas a tabela encaixa exata.
  useEffect(() => {
    const el = ref.current
    if (!el) return
    if (el.scrollHeight > el.clientHeight + 1 && linhas > minimo) setLinhas(linhas - 1)
  })

  return [ref, linhas]
}

/**
 * Mesma ideia da medicao acima, mas para grades de cartoes: conta quantos
 * cabem na largura e quantas faixas cabem na altura.
 */
export function useCartoesQueCabem({ largura, altura, minimo = 2 } = {}) {
  const ref = useRef(null)
  const [quantos, setQuantos] = useState(minimo)

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return

    const medir = () => {
      const colunas = Math.max(1, Math.floor(el.clientWidth / largura))
      const faixas = Math.max(1, Math.floor(el.clientHeight / altura))
      setQuantos(Math.min(TETO, Math.max(minimo, colunas * faixas)))
    }

    medir()
    const observer = new ResizeObserver(medir)
    observer.observe(el)
    return () => observer.disconnect()
  }, [largura, altura, minimo])

  useEffect(() => {
    const el = ref.current
    if (!el) return
    if (el.scrollHeight > el.clientHeight + 1 && quantos > minimo) setQuantos(quantos - 1)
  })

  return [ref, quantos]
}

/** Fatia uma lista em paginas, mantendo a pagina valida quando a lista encolhe. */
export function usePaginacao(itens, porPagina) {
  const [pagina, setPagina] = useState(0)
  const total = itens.length
  const paginas = Math.max(1, Math.ceil(total / Math.max(1, porPagina)))
  const atual = Math.min(pagina, paginas - 1)

  useEffect(() => {
    if (pagina > paginas - 1) setPagina(Math.max(0, paginas - 1))
  }, [pagina, paginas])

  const inicio = atual * porPagina
  return {
    pagina: atual,
    paginas,
    total,
    inicio,
    visiveis: itens.slice(inicio, inicio + porPagina),
    irPara: setPagina,
    primeira: () => setPagina(0),
  }
}

export function Paginacao({ estado, rotulo = 'itens' }) {
  const { pagina, paginas, total, inicio, visiveis, irPara } = estado
  if (total === 0) return null

  const fim = inicio + visiveis.length

  return (
    <div className="paginacao">
      <span className="paginacao__info">
        {inicio + 1}–{fim} de {total} {rotulo}
      </span>
      {paginas > 1 ? (
        <>
          <button type="button" onClick={() => irPara(0)} disabled={pagina === 0} aria-label="Primeira pagina">
            «
          </button>
          <button
            type="button"
            onClick={() => irPara(pagina - 1)}
            disabled={pagina === 0}
            aria-label="Pagina anterior"
          >
            ‹
          </button>
          <span className="paginacao__pos">
            {pagina + 1}/{paginas}
          </span>
          <button
            type="button"
            onClick={() => irPara(pagina + 1)}
            disabled={pagina >= paginas - 1}
            aria-label="Proxima pagina"
          >
            ›
          </button>
          <button
            type="button"
            onClick={() => irPara(paginas - 1)}
            disabled={pagina >= paginas - 1}
            aria-label="Ultima pagina"
          >
            »
          </button>
        </>
      ) : null}
    </div>
  )
}

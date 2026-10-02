/**
 * Contador de mudancas do sistema.
 *
 * Existe para a tela poder perguntar "mudou alguma coisa?" gastando 50 bytes em
 * vez de baixar o retrato inteiro. Serve o caminho de sondagem, usado quando o
 * SSE nao passa — atras de um tunel ou de um proxy que segura fluxo continuo.
 *
 * `inicio` muda a cada vez que o servidor sobe. Sem isso, um servidor reiniciado
 * voltaria a contar do zero e a tela acharia que nada mudou desde o numero alto
 * que ela tinha guardado.
 */
const inicio = Date.now().toString(36)
let contador = 0

/** Chamado sempre que algo muda de verdade (pedido, estoque, preco, custo). */
export function marcarMudanca() {
  contador += 1
  return contador
}

/** Identidade do estado atual: muda se o sistema mudou OU se o servidor reiniciou. */
export function revisaoAtual() {
  return inicio + '-' + contador
}

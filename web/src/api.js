const TOKEN_KEY = 'ump-vendas.token'
const ROLE_KEY = 'ump-vendas.role'

export function getToken() {
  try {
    return localStorage.getItem(TOKEN_KEY)
  } catch {
    return null
  }
}

export function getStoredRole() {
  try {
    return localStorage.getItem(ROLE_KEY)
  } catch {
    return null
  }
}

export function saveSession(token, role) {
  try {
    localStorage.setItem(TOKEN_KEY, token)
    localStorage.setItem(ROLE_KEY, role)
  } catch {
    /* navegador sem localStorage: a sessao vale ate fechar a aba */
  }
}

export function clearSession() {
  try {
    localStorage.removeItem(TOKEN_KEY)
    localStorage.removeItem(ROLE_KEY)
  } catch {
    /* nada a limpar */
  }
}

/** Erro vindo da API, ja com a mensagem em portugues pronta para a tela. */
export class ApiError extends Error {
  constructor(message, status, extra) {
    super(message)
    this.status = status
    this.extra = extra
  }
}

async function request(method, path, body) {
  const token = getToken()
  let res
  try {
    res = await fetch(path, {
      method,
      headers: {
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(token ? { Authorization: 'Bearer ' + token } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    })
  } catch {
    throw new ApiError('Sem conexao com o servidor. Verifique a rede e tente de novo.', 0)
  }

  if (res.status === 401) {
    clearSession()
    window.dispatchEvent(new CustomEvent('ump:logout'))
    throw new ApiError('Sessao encerrada. Entre novamente com o codigo.', 401)
  }

  const text = await res.text()
  let data = null
  if (text) {
    try {
      data = JSON.parse(text)
    } catch {
      data = { raw: text }
    }
  }

  if (!res.ok) {
    // O servidor marca assim quando a tela chamou um endereco que nao existe
    // mais — ou seja, este navegador esta rodando uma versao velha do sistema.
    if (data?.desatualizado) window.dispatchEvent(new CustomEvent('ump:desatualizado'))

    throw new ApiError(
      data?.error ||
        (res.status === 404
          ? 'Esta tela esta desatualizada. Recarregue a pagina (Ctrl+F5).'
          : 'Nao foi possivel completar a acao.'),
      res.status,
      data
    )
  }
  return data
}

export const api = {
  get: (path) => request('GET', path),
  post: (path, body) => request('POST', path, body ?? {}),
  put: (path, body) => request('PUT', path, body ?? {}),
  patch: (path, body) => request('PATCH', path, body ?? {}),
  del: (path) => request('DELETE', path),

  login: (code) => request('POST', '/api/auth/login', { code }),
  state: () => request('GET', '/api/state'),

  criarPedido: (payload) => request('POST', '/api/orders', payload),
  editarPedido: (id, payload) => request('PUT', `/api/orders/${id}`, payload),
  retirar: (id) => request('POST', `/api/orders/${id}/retirar`, {}),
  retirarParcial: (id, items) => request('POST', `/api/orders/${id}/retirar-parcial`, { items }),
  reabrir: (id) => request('POST', `/api/orders/${id}/reabrir`, {}),
  cancelar: (id) => request('POST', `/api/orders/${id}/cancelar`, {}),
  restaurar: (id) => request('POST', `/api/orders/${id}/restaurar`, {}),

  definirPreco: (price) => request('POST', '/api/price', { price }),
  lancarEstoque: (payload) => request('POST', '/api/kitchen/stock', payload),
  lancarEstoqueLote: (payload) => request('POST', '/api/kitchen/stock/lote', payload),
  movimentacoes: () => request('GET', '/api/kitchen/stock/movements'),
  criarSabor: (name) => request('POST', '/api/kitchen/flavors', { name }),
  atualizarSabor: (id, payload) => request('PATCH', `/api/kitchen/flavors/${id}`, payload),
  apagarSabor: (id) => request('DELETE', `/api/kitchen/flavors/${id}`),

  pagar: (id) => request('POST', `/api/orders/${id}/pagar`, {}),
  despagar: (id) => request('POST', `/api/orders/${id}/despagar`, {}),
  apagarPedido: (id) => request('DELETE', `/api/orders/${id}`),

  criarCusto: (payload) => request('POST', '/api/admin/custos', payload),
  apagarCusto: (id) => request('DELETE', `/api/admin/custos/${id}`),

  codigos: () => request('GET', '/api/admin/codes'),
  salvarCodigo: (role, code) => request('PUT', `/api/admin/codes/${role}`, { code }),
  revogarAcessos: () => request('POST', '/api/admin/revogar-acessos', {}),
  salvarEvento: (eventName) => request('PUT', '/api/admin/event', { eventName }),
  zerarEvento: () => request('POST', '/api/admin/zerar-evento', { confirmacao: 'ZERAR' }),
}

/**
 * Baixa um arquivo da API. O link direto nao serve porque o navegador nao manda
 * o cabecalho de autenticacao, entao buscamos com fetch e salvamos o blob.
 */
export async function baixarArquivo(caminho, nomeSugerido) {
  let res
  try {
    res = await fetch(caminho, { headers: { Authorization: 'Bearer ' + getToken() } })
  } catch {
    throw new ApiError('Sem conexao com o servidor.', 0)
  }
  if (!res.ok) throw new ApiError('Nao foi possivel gerar o arquivo.', res.status)

  const stamp = new Date().toISOString().slice(0, 10)
  const blob = await res.blob()
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  const ext = caminho.endsWith('.json') ? 'json' : caminho.endsWith('.xlsx') ? 'xlsx' : 'csv'
  link.download = `${nomeSugerido}-${stamp}.${ext}`
  document.body.appendChild(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(url)
}

export const EXPORTACOES = [
  {
    id: 'pedidos',
    rotulo: 'Pedidos',
    detalhe: 'um pedido por linha, com itens, status e horarios',
    caminho: '/api/admin/exportar/pedidos.csv',
    arquivo: 'pedidos',
  },
  {
    id: 'itens',
    rotulo: 'Itens dos pedidos',
    detalhe: 'um sabor por linha — da para somar quanto cada sabor rendeu',
    caminho: '/api/admin/exportar/itens.csv',
    arquivo: 'itens-dos-pedidos',
  },
  {
    id: 'estoque',
    rotulo: 'Estoque',
    detalhe: 'toda carga inicial, fornada e ajuste lancados',
    caminho: '/api/admin/exportar/estoque.csv',
    arquivo: 'estoque',
  },
  {
    id: 'custos',
    rotulo: 'Custos',
    detalhe: 'as despesas do evento por categoria',
    caminho: '/api/admin/exportar/custos.csv',
    arquivo: 'custos',
  },
  {
    id: 'resumo',
    rotulo: 'Resumo do evento',
    detalhe: 'pedidos + custos + resultado liquido num arquivo so',
    caminho: '/api/admin/relatorio.csv',
    arquivo: 'evento',
  },
  {
    id: 'planilha',
    rotulo: 'Planilha (Excel)',
    detalhe: 'uma aba por assunto — o mesmo arquivo do backup automatico',
    caminho: '/api/admin/exportar/planilha.xlsx',
    arquivo: 'evento',
  },
  {
    id: 'completo',
    rotulo: 'Tudo (JSON)',
    detalhe: 'o banco inteiro, para copia de seguranca ou outra ferramenta',
    caminho: '/api/admin/exportar/completo.json',
    arquivo: 'ump-vendas-completo',
  },
]

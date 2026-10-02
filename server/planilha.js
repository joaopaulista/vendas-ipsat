/**
 * Monta a planilha do evento e grava o backup em disco.
 *
 * O backup roda sozinho em tres momentos:
 *   - quando o sistema e desligado (Ctrl+C, fechar a janela, encerrar o Windows)
 *   - de tempos em tempos enquanto ele esta no ar, se algo mudou
 *   - quando o admin clica em "Planilha (Excel)" na aba Admin
 *
 * O desligamento sozinho nao basta: falta de energia ou "finalizar tarefa" nao
 * avisam ninguem. Por isso existe tambem o backup periodico — no pior caso
 * perde-se o intervalo, nunca o evento inteiro. O banco em si (SQLite com WAL)
 * continua sendo a fonte da verdade e sobrevive a queda; a planilha e a copia
 * legivel para abrir no Excel.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { db, getConfig } from './db.js'
import { totalCostsCents } from './state.js'
import { dinheiro, gerarXlsx } from './xlsx.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
export const PASTA_BACKUP = process.env.BACKUP_DIR || join(__dirname, '..', 'backups')

const STATUS = {
  pendente: 'Aguardando retirada',
  parcial: 'Retirada parcial',
  retirado: 'Retirado',
  cancelado: 'Cancelado',
}

/** O SQLite grava em UTC; aqui vira dia/mes/ano hora:minuto no fuso da maquina. */
function horario(texto) {
  if (!texto) return ''
  const d = new Date(texto.replace(' ', 'T') + 'Z')
  return Number.isNaN(d.getTime()) ? texto : d.toLocaleString('pt-BR')
}

/** Le o banco inteiro e devolve as abas prontas para virar planilha. */
export function montarAbas() {
  const pedidos = db
    .prepare(
      `SELECT o.number, o.customer_name, o.payment_method, o.qty_total, o.total_cents,
              o.status, o.paid_at, o.note, o.created_by, o.created_at, o.delivered_at,
              o.canceled_at, o.updated_at, o.updated_by,
              (SELECT GROUP_CONCAT(f.name || ' x' || i.qty, ' + ')
                 FROM order_items i JOIN flavors f ON f.id = i.flavor_id
                WHERE i.order_id = o.id) AS itens,
              (SELECT COALESCE(SUM(i.delivered_qty), 0)
                 FROM order_items i WHERE i.order_id = o.id) AS entregues
         FROM orders o ORDER BY o.number`
    )
    .all()
    .map((o) => ({
      numero: o.number,
      comprador: o.customer_name,
      itens: o.itens,
      quantidade: o.qty_total,
      retirados: o.entregues,
      aRetirar: o.qty_total - o.entregues,
      total: dinheiro(o.total_cents),
      pagamento: o.payment_method,
      pago: o.paid_at ? 'Sim' : 'Nao',
      pagoEm: horario(o.paid_at),
      status: STATUS[o.status] || o.status,
      criadoEm: horario(o.created_at),
      retiradoEm: horario(o.delivered_at),
      canceladoEm: horario(o.canceled_at),
      lancadoPor: o.created_by,
      editadoEm: horario(o.updated_at),
      editadoPor: o.updated_by,
      observacao: o.note,
    }))

  const itens = db
    .prepare(
      `SELECT o.number, o.customer_name, o.status, o.payment_method, o.paid_at, o.created_at,
              f.name AS sabor, i.qty, i.delivered_qty, i.unit_price_cents, i.subtotal_cents
         FROM order_items i
         JOIN orders o ON o.id = i.order_id
         JOIN flavors f ON f.id = i.flavor_id
        ORDER BY o.number, f.sort_order, f.name`
    )
    .all()
    .map((i) => ({
      pedido: i.number,
      comprador: i.customer_name,
      sabor: i.sabor,
      quantidade: i.qty,
      retirados: i.delivered_qty,
      precoUnitario: dinheiro(i.unit_price_cents),
      subtotal: dinheiro(i.subtotal_cents),
      status: STATUS[i.status] || i.status,
      pago: i.paid_at ? 'Sim' : 'Nao',
      pagamento: i.payment_method,
      criadoEm: horario(i.created_at),
    }))

  const sabores = db
    .prepare(
      `SELECT f.name, f.price_cents, f.active,
              COALESCE((SELECT SUM(qty) FROM stock_movements m WHERE m.flavor_id = f.id), 0) AS produzido,
              COALESCE((SELECT SUM(i.qty) FROM order_items i JOIN orders o ON o.id = i.order_id
                         WHERE i.flavor_id = f.id AND o.status <> 'cancelado'), 0) AS vendido,
              COALESCE((SELECT SUM(i.subtotal_cents) FROM order_items i JOIN orders o ON o.id = i.order_id
                         WHERE i.flavor_id = f.id AND o.status <> 'cancelado'), 0) AS faturado
         FROM flavors f ORDER BY f.sort_order, f.name`
    )
    .all()
    .map((f) => ({
      sabor: f.name,
      preco: dinheiro(f.price_cents),
      situacao: f.active ? 'Ativo' : 'Desativado',
      produzido: f.produzido,
      vendido: f.vendido,
      disponivel: f.produzido - f.vendido,
      faturado: dinheiro(f.faturado),
    }))

  const estoque = db
    .prepare(
      `SELECT m.created_at, f.name AS sabor, m.qty, m.kind, m.note, m.created_by
         FROM stock_movements m JOIN flavors f ON f.id = m.flavor_id ORDER BY m.id`
    )
    .all()
    .map((m) => ({
      quando: horario(m.created_at),
      sabor: m.sabor,
      quantidade: m.qty,
      tipo: m.kind,
      observacao: m.note,
      lancadoPor: m.created_by,
    }))

  const custos = db
    .prepare(
      'SELECT description, category, amount_cents, note, created_by, created_at FROM costs ORDER BY id'
    )
    .all()
    .map((c) => ({
      descricao: c.description,
      categoria: c.category,
      valor: dinheiro(c.amount_cents),
      observacao: c.note,
      lancadoPor: c.created_by,
      quando: horario(c.created_at),
    }))

  const precos = db
    .prepare(
      `SELECT h.created_at, f.name AS sabor, h.unit_price_cents, h.changed_by
         FROM price_history h LEFT JOIN flavors f ON f.id = h.flavor_id ORDER BY h.id`
    )
    .all()
    .map((h) => ({
      quando: horario(h.created_at),
      sabor: h.sabor || '(todos)',
      preco: dinheiro(h.unit_price_cents),
      alteradoPor: h.changed_by,
    }))

  /* ------------------------------------------------------------- resumo */

  const v = db
    .prepare(
      `SELECT COUNT(*) AS pedidos, COALESCE(SUM(total_cents), 0) AS faturamento,
              COALESCE(SUM(qty_total), 0) AS pasteis,
              COALESCE(SUM(CASE WHEN paid_at IS NOT NULL THEN total_cents ELSE 0 END), 0) AS recebido,
              COALESCE(SUM(CASE WHEN paid_at IS NULL THEN total_cents ELSE 0 END), 0) AS aReceber
         FROM orders WHERE status <> 'cancelado'`
    )
    .get()
  const gastos = totalCostsCents()
  const cancelados = db.prepare("SELECT COUNT(*) AS n FROM orders WHERE status = 'cancelado'").get().n

  const resumo = [
    { item: 'Evento', valor: getConfig('event_name', 'Venda de Pasteis') },
    { item: 'Pedidos validos', valor: v.pedidos },
    { item: 'Pedidos cancelados', valor: cancelados },
    { item: 'Pasteis vendidos', valor: v.pasteis },
    { item: 'Faturamento bruto', valor: dinheiro(v.faturamento) },
    { item: 'Ja recebido', valor: dinheiro(v.recebido) },
    { item: 'Ainda a receber', valor: dinheiro(v.aReceber) },
    { item: 'Custos do evento', valor: dinheiro(gastos) },
    { item: 'Valor liquido', valor: dinheiro(v.faturamento - gastos) },
  ]

  const porPagamento = db
    .prepare(
      `SELECT payment_method, COUNT(*) AS n, COALESCE(SUM(total_cents), 0) AS total
         FROM orders WHERE status <> 'cancelado' GROUP BY payment_method ORDER BY total DESC`
    )
    .all()
    .map((p) => ({ item: 'Pagamento: ' + p.payment_method, valor: dinheiro(p.total), extra: p.n + ' pedidos' }))

  return [
    {
      nome: 'Resumo',
      colunas: [
        { titulo: 'Item', campo: 'item', largura: 26 },
        { titulo: 'Valor', campo: 'valor', largura: 20 },
        { titulo: '', campo: 'extra', largura: 16 },
      ],
      linhas: [...resumo, ...porPagamento],
    },
    {
      nome: 'Pedidos',
      colunas: [
        { titulo: 'Pedido', campo: 'numero', largura: 9 },
        { titulo: 'Comprador', campo: 'comprador', largura: 26 },
        { titulo: 'Itens', campo: 'itens', largura: 34 },
        { titulo: 'Qtd', campo: 'quantidade', largura: 7 },
        { titulo: 'Retirados', campo: 'retirados', largura: 11 },
        { titulo: 'A retirar', campo: 'aRetirar', largura: 10 },
        { titulo: 'Total', campo: 'total', largura: 13 },
        { titulo: 'Pagamento', campo: 'pagamento', largura: 18 },
        { titulo: 'Pago?', campo: 'pago', largura: 8 },
        { titulo: 'Pago em', campo: 'pagoEm', largura: 19 },
        { titulo: 'Status', campo: 'status', largura: 19 },
        { titulo: 'Criado em', campo: 'criadoEm', largura: 19 },
        { titulo: 'Retirado em', campo: 'retiradoEm', largura: 19 },
        { titulo: 'Cancelado em', campo: 'canceladoEm', largura: 19 },
        { titulo: 'Lancado por', campo: 'lancadoPor', largura: 12 },
        { titulo: 'Editado em', campo: 'editadoEm', largura: 19 },
        { titulo: 'Editado por', campo: 'editadoPor', largura: 12 },
        { titulo: 'Observacao', campo: 'observacao', largura: 24 },
      ],
      linhas: pedidos,
    },
    {
      nome: 'Itens dos pedidos',
      colunas: [
        { titulo: 'Pedido', campo: 'pedido', largura: 9 },
        { titulo: 'Comprador', campo: 'comprador', largura: 26 },
        { titulo: 'Sabor', campo: 'sabor', largura: 22 },
        { titulo: 'Qtd', campo: 'quantidade', largura: 7 },
        { titulo: 'Retirados', campo: 'retirados', largura: 11 },
        { titulo: 'Preco unit.', campo: 'precoUnitario', largura: 13 },
        { titulo: 'Subtotal', campo: 'subtotal', largura: 13 },
        { titulo: 'Status', campo: 'status', largura: 19 },
        { titulo: 'Pago?', campo: 'pago', largura: 8 },
        { titulo: 'Pagamento', campo: 'pagamento', largura: 18 },
        { titulo: 'Criado em', campo: 'criadoEm', largura: 19 },
      ],
      linhas: itens,
    },
    {
      nome: 'Sabores',
      colunas: [
        { titulo: 'Sabor', campo: 'sabor', largura: 22 },
        { titulo: 'Preco', campo: 'preco', largura: 12 },
        { titulo: 'Situacao', campo: 'situacao', largura: 12 },
        { titulo: 'Produzido', campo: 'produzido', largura: 11 },
        { titulo: 'Vendido', campo: 'vendido', largura: 10 },
        { titulo: 'Disponivel', campo: 'disponivel', largura: 11 },
        { titulo: 'Faturado', campo: 'faturado', largura: 14 },
      ],
      linhas: sabores,
    },
    {
      nome: 'Estoque',
      colunas: [
        { titulo: 'Quando', campo: 'quando', largura: 19 },
        { titulo: 'Sabor', campo: 'sabor', largura: 22 },
        { titulo: 'Quantidade', campo: 'quantidade', largura: 12 },
        { titulo: 'Tipo', campo: 'tipo', largura: 12 },
        { titulo: 'Observacao', campo: 'observacao', largura: 24 },
        { titulo: 'Lancado por', campo: 'lancadoPor', largura: 12 },
      ],
      linhas: estoque,
    },
    {
      nome: 'Custos',
      colunas: [
        { titulo: 'Descricao', campo: 'descricao', largura: 32 },
        { titulo: 'Categoria', campo: 'categoria', largura: 16 },
        { titulo: 'Valor', campo: 'valor', largura: 14 },
        { titulo: 'Observacao', campo: 'observacao', largura: 24 },
        { titulo: 'Lancado por', campo: 'lancadoPor', largura: 12 },
        { titulo: 'Quando', campo: 'quando', largura: 19 },
      ],
      linhas: custos,
    },
    {
      nome: 'Historico de precos',
      colunas: [
        { titulo: 'Quando', campo: 'quando', largura: 19 },
        { titulo: 'Sabor', campo: 'sabor', largura: 22 },
        { titulo: 'Preco', campo: 'preco', largura: 12 },
        { titulo: 'Alterado por', campo: 'alteradoPor', largura: 14 },
      ],
      linhas: precos,
    },
  ]
}

/** A planilha em memoria, pronta para mandar pelo navegador. */
export function gerarPlanilha(quando = new Date()) {
  return gerarXlsx(montarAbas(), quando)
}

/** Quantas linhas de dado existem — serve para nao gravar backup de banco vazio. */
export function temDados() {
  const n = db.prepare('SELECT COUNT(*) AS n FROM orders').get().n
  const m = db.prepare('SELECT COUNT(*) AS n FROM stock_movements').get().n
  const c = db.prepare('SELECT COUNT(*) AS n FROM costs').get().n
  return n + m + c > 0
}

/**
 * Grava a planilha em backups/. `motivo` entra no nome do arquivo para dar para
 * saber depois se foi desligamento, automatico ou pedido na tela.
 */
export function salvarBackup(motivo = 'manual') {
  if (!temDados()) return null

  const agora = new Date()
  const carimbo = agora.toISOString().replace(/[:.]/g, '-').slice(0, 19)
  const caminho = join(PASTA_BACKUP, `evento-${carimbo}-${motivo}.xlsx`)

  mkdirSync(PASTA_BACKUP, { recursive: true })
  writeFileSync(caminho, gerarPlanilha(agora))
  return caminho
}

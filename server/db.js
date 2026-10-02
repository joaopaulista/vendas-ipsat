import { DatabaseSync } from 'node:sqlite'
import { randomBytes } from 'node:crypto'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
export const DATA_DIR = process.env.DATA_DIR || join(__dirname, 'data')
const DB_PATH = process.env.DB_PATH || join(DATA_DIR, 'vendas.db')

mkdirSync(DATA_DIR, { recursive: true })

export const db = new DatabaseSync(DB_PATH)

db.exec('PRAGMA journal_mode = WAL')
db.exec('PRAGMA foreign_keys = ON')
db.exec('PRAGMA busy_timeout = 5000')

db.exec(`
CREATE TABLE IF NOT EXISTS config (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS flavors (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT NOT NULL UNIQUE,
  -- Cada sabor tem o seu proprio preco; a cozinha define e pode mudar a qualquer hora.
  price_cents INTEGER NOT NULL DEFAULT 0,
  active      INTEGER NOT NULL DEFAULT 1,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Toda entrada de producao vira uma linha aqui. O estoque produzido de um
-- sabor e a soma das suas movimentacoes (permite acerto com qty negativa).
CREATE TABLE IF NOT EXISTS stock_movements (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  flavor_id  INTEGER NOT NULL REFERENCES flavors(id),
  qty        INTEGER NOT NULL,
  kind       TEXT NOT NULL CHECK (kind IN ('inicial','producao','ajuste')),
  note       TEXT,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS orders (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  number           INTEGER NOT NULL UNIQUE,
  customer_name    TEXT NOT NULL,
  payment_method   TEXT NOT NULL,
  unit_price_cents INTEGER NOT NULL,
  total_cents      INTEGER NOT NULL,
  qty_total        INTEGER NOT NULL,
  -- 'parcial' = o cliente levou parte dos pasteis e volta depois pelo resto
  status           TEXT NOT NULL DEFAULT 'pendente'
                   CHECK (status IN ('pendente','parcial','retirado','cancelado')),
  note             TEXT,
  created_by       TEXT NOT NULL,
  created_at       TEXT NOT NULL DEFAULT (datetime('now')),
  delivered_at     TEXT,
  canceled_at      TEXT,
  -- Quando o dinheiro entrou. NULL = ainda nao pagou.
  paid_at          TEXT,
  -- Quem corrigiu o pedido depois de lancado, e quando.
  updated_at       TEXT,
  updated_by       TEXT
);

CREATE TABLE IF NOT EXISTS order_items (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id         INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  flavor_id        INTEGER NOT NULL REFERENCES flavors(id),
  qty              INTEGER NOT NULL CHECK (qty > 0),
  -- quanto desse sabor o cliente ja levou (retirada parcial)
  delivered_qty    INTEGER NOT NULL DEFAULT 0,
  unit_price_cents INTEGER NOT NULL,
  subtotal_cents   INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS price_history (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  flavor_id        INTEGER REFERENCES flavors(id),
  unit_price_cents INTEGER NOT NULL,
  changed_by       TEXT NOT NULL,
  created_at       TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Despesas do evento (ingredientes, gas, embalagem...). Entram no calculo
-- do lucro liquido: faturamento - custos.
CREATE TABLE IF NOT EXISTS costs (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  description  TEXT NOT NULL,
  category     TEXT NOT NULL,
  amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
  note         TEXT,
  created_by   TEXT NOT NULL,
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_items_order  ON order_items(order_id);
CREATE INDEX IF NOT EXISTS idx_items_flavor ON order_items(flavor_id);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
CREATE INDEX IF NOT EXISTS idx_mov_flavor   ON stock_movements(flavor_id);
`)

/* ---------------------------------------------------------------- migracoes */

function hasColumn(table, column) {
  return db.prepare(`PRAGMA table_info(${table})`).all().some((c) => c.name === column)
}

function tableSql(table) {
  const row = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name=?").get(table)
  return row ? row.sql : ''
}

/**
 * Bancos criados antes da retirada parcial nao tem a coluna delivered_qty nem
 * aceitam o status 'parcial'. Estas migracoes deixam um banco antigo igual a um
 * recem-criado, sem perder pedido nenhum.
 */
function migrate() {
  // Numero do pedido vem de um contador que so cresce. Antes vinha de MAX(number)+1,
  // que reaproveitaria o numero de um pedido apagado — dois pedidos diferentes com
  // o mesmo numero no mesmo evento.
  if (getConfig('next_order_number') === null) {
    const maior = db.prepare('SELECT COALESCE(MAX(number), 0) AS n FROM orders').get().n
    setConfig('next_order_number', maior + 1)
  }

  // Preco por sabor: bancos antigos tinham um valor unico em config.unit_price_cents.
  // Cada sabor herda esse valor, entao nada muda de preco na virada.
  if (!hasColumn('flavors', 'price_cents')) {
    db.exec('ALTER TABLE flavors ADD COLUMN price_cents INTEGER NOT NULL DEFAULT 0')
    const global = db.prepare("SELECT value FROM config WHERE key = 'unit_price_cents'").get()
    const herdado = global ? Number.parseInt(global.value, 10) || 0 : 0
    if (herdado > 0) db.prepare('UPDATE flavors SET price_cents = ?').run(herdado)
  }

  if (!hasColumn('price_history', 'flavor_id')) {
    db.exec('ALTER TABLE price_history ADD COLUMN flavor_id INTEGER REFERENCES flavors(id)')
  }

  if (!hasColumn('order_items', 'delivered_qty')) {
    db.exec('ALTER TABLE order_items ADD COLUMN delivered_qty INTEGER NOT NULL DEFAULT 0')
    // Pedidos ja retirados passam a contar como totalmente entregues.
    db.exec(`UPDATE order_items SET delivered_qty = qty
              WHERE order_id IN (SELECT id FROM orders WHERE status = 'retirado')`)
  }

  if (!tableSql('orders').includes("'parcial'")) {
    // O CHECK antigo nao aceita 'parcial'; o SQLite so troca isso recriando a tabela.
    db.exec('PRAGMA foreign_keys = OFF')
    db.exec('BEGIN IMMEDIATE')
    try {
      db.exec(`
        CREATE TABLE orders_novo (
          id               INTEGER PRIMARY KEY AUTOINCREMENT,
          number           INTEGER NOT NULL UNIQUE,
          customer_name    TEXT NOT NULL,
          payment_method   TEXT NOT NULL,
          unit_price_cents INTEGER NOT NULL,
          total_cents      INTEGER NOT NULL,
          qty_total        INTEGER NOT NULL,
          status           TEXT NOT NULL DEFAULT 'pendente'
                           CHECK (status IN ('pendente','parcial','retirado','cancelado')),
          note             TEXT,
          created_by       TEXT NOT NULL,
          created_at       TEXT NOT NULL DEFAULT (datetime('now')),
          delivered_at     TEXT,
          canceled_at      TEXT
        );
        INSERT INTO orders_novo SELECT id, number, customer_name, payment_method,
               unit_price_cents, total_cents, qty_total, status, note, created_by,
               created_at, delivered_at, canceled_at FROM orders;
        DROP TABLE orders;
        ALTER TABLE orders_novo RENAME TO orders;
        CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
      `)
      db.exec('COMMIT')
    } catch (err) {
      db.exec('ROLLBACK')
      throw err
    } finally {
      db.exec('PRAGMA foreign_keys = ON')
    }
  }

  // DEPOIS da reconstrucao acima, senao a coluna nova seria descartada na copia.
  // Pedido antigo fica como nao pago: o sistema nao tem como saber se o dinheiro
  // entrou, e chutar "pago" esconderia quem deve.
  if (!hasColumn('orders', 'paid_at')) {
    db.exec('ALTER TABLE orders ADD COLUMN paid_at TEXT')
  }

  // Rastro de quem corrigiu o pedido depois de lancado. Tambem vem DEPOIS da
  // reconstrucao, pela mesma razao do paid_at.
  if (!hasColumn('orders', 'updated_at')) {
    db.exec('ALTER TABLE orders ADD COLUMN updated_at TEXT')
  }
  if (!hasColumn('orders', 'updated_by')) {
    db.exec('ALTER TABLE orders ADD COLUMN updated_by TEXT')
  }

  // Volta ao preco unico: se o banco vem da fase de preco por sabor, o maior
  // preco cadastrado vira o valor do pastel, para ninguem comecar o dia a zero.
  if (hasColumn('flavors', 'price_cents')) {
    const atual = getConfig('unit_price_cents')
    if (atual === null || Number.parseInt(atual, 10) <= 0) {
      const maior = db.prepare('SELECT COALESCE(MAX(price_cents), 0) AS n FROM flavors').get().n
      if (maior > 0) setConfig('unit_price_cents', maior)
    }
  }
}

migrate()

/* ------------------------------------------------------------------ config */

export function getConfig(key, fallback = null) {
  const row = db.prepare('SELECT value FROM config WHERE key = ?').get(key)
  return row ? row.value : fallback
}

export function setConfig(key, value) {
  db.prepare(
    'INSERT INTO config (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
  ).run(key, String(value))
}

function setConfigIfAbsent(key, value) {
  db.prepare('INSERT OR IGNORE INTO config (key, value) VALUES (?, ?)').run(key, String(value))
}

export function getInt(key, fallback = 0) {
  const v = getConfig(key)
  return v === null ? fallback : Number.parseInt(v, 10)
}

/* -------------------------------------------------------------------- seed */

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789' // sem I, O, 0, 1

export function generateCode(len = 6) {
  const bytes = randomBytes(len)
  let out = ''
  for (let i = 0; i < len; i++) out += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length]
  return out
}

export const ROLES = ['admin', 'caixa', 'cozinha']
export const PAYMENT_METHODS = ['Dinheiro', 'PIX', 'Cartao de debito', 'Cartao de credito']
export const COST_CATEGORIES = ['Ingredientes', 'Embalagem', 'Bebidas', 'Gas', 'Descartaveis', 'Outros']

/**
 * Codigos definidos pela equipe, para todo mundo ja saber de cor no dia.
 * Sao fixos e previsiveis de proposito; se algum vazar durante o evento,
 * troque na aba Admin e use "Revogar acessos".
 */
export const DEFAULT_CODES = {
  admin: 'UMPADM',
  caixa: 'UMPCAI',
  cozinha: 'UMPCOZ',
}

let seededCodes = null

/** Grava os codigos padrao. `forcar` sobrescreve os que ja existem. */
export function aplicarCodigosPadrao(forcar = false) {
  const aplicados = []
  for (const role of ROLES) {
    const key = `code_${role}`
    if (forcar || getConfig(key) === null) {
      setConfig(key, DEFAULT_CODES[role])
      aplicados.push([role, DEFAULT_CODES[role]])
    }
  }
  return aplicados
}

function seed() {
  setConfigIfAbsent('event_name', 'Venda de Pasteis')
  setConfigIfAbsent('unit_price_cents', '0')
  setConfigIfAbsent('token_version', '1')
  setConfigIfAbsent('auth_secret', randomBytes(32).toString('hex'))

  const fresh = aplicarCodigosPadrao()

  const count = db.prepare('SELECT COUNT(*) AS n FROM flavors').get().n
  if (count === 0) {
    const insert = db.prepare('INSERT INTO flavors (name, sort_order) VALUES (?, ?)')
    ;['Carne', 'Queijo', 'Pizza'].forEach((name, i) => insert.run(name, i))
  }

  if (fresh.length) {
    seededCodes = fresh
    const lines = [
      'CODIGOS DE ACESSO - UMP VENDAS',
      'Definidos em ' + new Date().toLocaleString('pt-BR'),
      '',
      ...ROLES.map((r) => `${r.padEnd(8)} ${getConfig('code_' + r)}`),
      '',
      'Voce pode trocar os codigos na tela de Admin.',
    ]
    try {
      writeFileSync(join(DATA_DIR, 'CODIGOS.txt'), lines.join('\n'), 'utf8')
    } catch {
      /* arquivo e conveniencia; os codigos tambem aparecem na tela de Admin */
    }
  }
}

seed()

export function consumeSeededCodes() {
  const c = seededCodes
  seededCodes = null
  return c
}

/* --------------------------------------------------------------- transacao */

export function transaction(fn) {
  db.exec('BEGIN IMMEDIATE')
  try {
    const result = fn()
    db.exec('COMMIT')
    return result
  } catch (err) {
    try {
      db.exec('ROLLBACK')
    } catch {
      /* ja desfeita */
    }
    throw err
  }
}

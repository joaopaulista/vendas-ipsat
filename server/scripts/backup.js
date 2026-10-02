import { copyFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { db } from '../db.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = join(__dirname, '..', '..')
const backupDir = join(root, 'backups')
mkdirSync(backupDir, { recursive: true })

// Grava o WAL no arquivo principal antes de copiar, senao o backup sai incompleto.
db.exec('PRAGMA wal_checkpoint(TRUNCATE)')

const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
const dest = join(backupDir, `vendas-${stamp}.db`)
copyFileSync(join(__dirname, '..', 'data', 'vendas.db'), dest)

console.log('Backup salvo em ' + dest)

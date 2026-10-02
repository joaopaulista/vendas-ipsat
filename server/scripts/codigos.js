/**
 * Mostra os codigos de acesso.
 *   npm run codigos              -> so lista
 *   npm run codigos -- --padrao  -> devolve os tres aos valores padrao (UMPADM/UMPCAI/UMPCOZ)
 */
import { aplicarCodigosPadrao, DEFAULT_CODES, getConfig, ROLES } from '../db.js'

const restaurar = process.argv.slice(2).some((a) => a === '--padrao' || a === '--restaurar')

if (restaurar) {
  aplicarCodigosPadrao(true)
  console.log('\nCodigos restaurados para o padrao.')
}

console.log('\nCODIGOS DE ACESSO')
console.log('-'.repeat(34))
for (const role of ROLES) {
  const atual = getConfig('code_' + role, '(nao definido)')
  const marca = atual === DEFAULT_CODES[role] ? '' : '  (alterado no Admin)'
  console.log('  ' + role.padEnd(10) + atual + marca)
}
console.log('-'.repeat(34))

if (restaurar) {
  console.log('Quem ja estava logado continua logado.')
  console.log('Para derrubar todo mundo, use "Revogar acessos" na aba Admin.\n')
} else {
  console.log('Para trocar, entre como admin e abra a aba Admin.')
  console.log('Para voltar ao padrao: npm run codigos -- --padrao\n')
}

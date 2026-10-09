#!/usr/bin/env node
/**
 * M8.3A — Rollback: desfaz EditorialContent + ChannelPiece criados pela migration M8.3A
 *
 * Lê: docs/migrations/posts-m8-execution-m8-3a.json
 * Remove em ordem: ChannelPiece → EditorialContent
 * Nunca toca: posts, library_files, S3
 *
 * Uso (modo plano):
 *   node scripts/posts_migration_rollback.mjs
 *
 * Uso (execução):
 *   POSTS_MIGRATION_ROLLBACK_CONFIRM=M8_3A_ROLLBACK_APPROVED \
 *   node scripts/posts_migration_rollback.mjs --execute
 */

import { readFileSync }         from 'fs'
import { resolve, dirname }     from 'path'
import { fileURLToPath }        from 'url'
import adminGuard from './lib/production-admin-guard.cjs'

const __dir = dirname(fileURLToPath(import.meta.url))
const ROOT  = resolve(__dir, '..')

// ── Environment ───────────────────────────────────────────────────────────

function loadEnv() {
  const raw = readFileSync(resolve(ROOT, '.env.local'), 'utf8')
  return Object.fromEntries(
    raw.split('\n')
       .filter(l => l.trim() && !l.startsWith('#') && l.includes('='))
       .map(l => {
         const i = l.indexOf('=')
         const v = l.slice(i + 1).trim()
         return [l.slice(0, i).trim(), v.replace(/^['"]|['"]$/g, '')]
       })
  )
}

const env    = loadEnv()
const get    = k => env[k] ?? ''
const SB_URL = get('SUPABASE_URL')
const SVC    = get('SUPABASE_SECRET_KEY')

if (!SB_URL || !SVC) throw new Error('SUPABASE_URL ou SUPABASE_SECRET_KEY ausente no .env.local')
adminGuard.requireAdminAck({ script: 'posts_migration_rollback.mjs', target: SB_URL })

const BASE_URL   = SB_URL.replace(/\/$/, '')
const SB_HEADERS = { apikey: SVC, Authorization: `Bearer ${SVC}`, 'Content-Type': 'application/json' }

// ── CLI ───────────────────────────────────────────────────────────────────

const args    = process.argv.slice(2)
const EXECUTE = args.includes('--execute')
const CONFIRM = process.env.POSTS_MIGRATION_ROLLBACK_CONFIRM

const MANIFEST_PATH = resolve(ROOT, 'docs/migrations/posts-m8-execution-m8-3a.json')

// ── REST helpers ──────────────────────────────────────────────────────────

async function sbGet(path) {
  const res = await fetch(`${BASE_URL}/rest/v1/${path}`, {
    headers: { ...SB_HEADERS, Accept: 'application/json' },
  })
  if (!res.ok) {
    const t = await res.text()
    throw new Error(`GET ${path} (${res.status}): ${t}`)
  }
  return res.json()
}

async function sbDeleteById(table, id) {
  const res = await fetch(`${BASE_URL}/rest/v1/${table}?id=eq.${id}`, {
    method: 'DELETE',
    headers: SB_HEADERS,
  })
  if (!res.ok) {
    const t = await res.text()
    throw new Error(`DELETE ${table} id=${id} (${res.status}): ${t}`)
  }
}

// ── Main ──────────────────────────────────────────────────────────────────

async function main() {
  // Carregar manifesto
  let manifest
  try {
    manifest = JSON.parse(readFileSync(MANIFEST_PATH, 'utf8'))
  } catch (e) {
    console.error(`ERRO: manifesto não encontrado em ${MANIFEST_PATH}`)
    console.error(e.message)
    process.exit(1)
  }

  if (manifest.phase !== 'M8.3A') {
    console.error(`ERRO: manifesto.phase="${manifest.phase}" incompatível (esperado: M8.3A).`)
    process.exit(1)
  }

  const migratedPosts = manifest.posts.filter(p => p.result === 'MIGRATED')

  console.log('\n╔══════════════════════════════════════════════════════════╗')
  console.log('║  M8.3A — Rollback Posts Migration                        ║')
  console.log('╚══════════════════════════════════════════════════════════╝')
  console.log(`\nManifesto: ${MANIFEST_PATH}`)
  console.log(`Executado em: ${manifest.executed_at}`)
  console.log(`Posts a reverter: ${migratedPosts.length}`)
  console.log('')

  if (migratedPosts.length === 0) {
    console.log('Nenhum post migrado encontrado no manifesto. Nada a reverter.')
    process.exit(0)
  }

  for (const p of migratedPosts) {
    console.log(`  ${p.post_id}`)
    console.log(`    EC: ${p.editorial_content_id}`)
    console.log(`    CP: ${p.channel_piece_id}`)
  }

  if (!EXECUTE) {
    console.log('\nMODO PLANO — nenhuma escrita. Para executar o rollback:')
    console.log('  POSTS_MIGRATION_ROLLBACK_CONFIRM=M8_3A_ROLLBACK_APPROVED \\')
    console.log('  node scripts/posts_migration_rollback.mjs --execute')
    console.log('')
    console.log('Atenção: não reverta sem inspecionar o estado atual do banco.')
    process.exit(0)
  }

  if (CONFIRM !== 'M8_3A_ROLLBACK_APPROVED') {
    console.error('ERRO: POSTS_MIGRATION_ROLLBACK_CONFIRM=M8_3A_ROLLBACK_APPROVED é obrigatório.')
    process.exit(1)
  }

  console.log('\nExecutando rollback em ordem: ChannelPiece → EditorialContent')
  console.log('posts: NUNCA TOCADOS | library_files: NUNCA TOCADOS | S3: NÃO TOCADO')
  console.log('')

  let rolled = 0

  for (const p of migratedPosts) {
    console.log(`\n[${p.post_id}] ${p.post_name ?? '—'}`)

    // 1. Remover ChannelPiece
    const cpId = p.channel_piece_id
    if (cpId) {
      try {
        const existing = await sbGet(`channel_pieces?id=eq.${cpId}&select=id`)
        if (existing.length === 0) {
          console.log(`  ✓ CP já ausente: ${cpId}`)
        } else {
          await sbDeleteById('channel_pieces', cpId)
          console.log(`  ✓ CP removida: ${cpId}`)
        }
      } catch (e) {
        console.error(`  ✗ FALHA ao remover CP ${cpId}: ${e.message}`)
        console.error('  Parando rollback — intervenção manual necessária.')
        process.exit(1)
      }
    } else {
      console.log('  — sem channel_piece_id no manifesto')
    }

    // 2. Remover EditorialContent
    const ecId = p.editorial_content_id
    if (ecId) {
      try {
        const existing = await sbGet(`editorial_contents?id=eq.${ecId}&select=id,legacy_post_id`)
        if (existing.length === 0) {
          console.log(`  ✓ EC já ausente: ${ecId}`)
        } else {
          // Verificar que é realmente um EC da migração antes de deletar
          if (!existing[0].legacy_post_id) {
            console.error(`  ✗ RECUSA: EC ${ecId} não tem legacy_post_id — pode não ser da migração.`)
            console.error('  Parando rollback por segurança.')
            process.exit(1)
          }
          await sbDeleteById('editorial_contents', ecId)
          console.log(`  ✓ EC removido: ${ecId}`)
        }
      } catch (e) {
        console.error(`  ✗ FALHA ao remover EC ${ecId}: ${e.message}`)
        console.error('  Parando rollback — intervenção manual necessária.')
        process.exit(1)
      }
    } else {
      console.log('  — sem editorial_content_id no manifesto')
    }

    rolled++
  }

  console.log('\n══════════════════════════════════════════════════')
  console.log(`  ROLLBACK CONCLUÍDO — ${rolled}/${migratedPosts.length} posts revertidos`)
  console.log('  posts: INTACTOS')
  console.log('  library_files: INTACTOS')
  console.log('  S3: NÃO TOCADO')
  console.log('══════════════════════════════════════════════════')
}

main().catch(e => { console.error('FATAL:', e.message); process.exit(1) })

#!/usr/bin/env node
/**
 * M8.5B — Rollback: clear migrated_at on all 4 posts.
 *
 * Sets posts.migrated_at = NULL for P1–P4.
 * Does NOT touch editorial_contents, channel_pieces, library_files, or S3.
 * After rollback, PATCH and DELETE are unblocked on those posts.
 *
 * Idempotent: re-running when already NULL is safe (0 rows updated, no error).
 *
 * IMPORTANT: this rollback only reverses the M8.5B marking.
 * It does NOT reverse M8.3A or M8.4 (use their own rollback scripts for that).
 *
 * Uso:
 *   POSTS_MIGRATION_M85B_ROLLBACK_CONFIRM=M8_5B_ROLLBACK_APPROVED \
 *   node scripts/posts_migration_m85b_rollback.mjs --execute
 */

import { readFileSync }  from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'
import adminGuard from './lib/production-admin-guard.cjs'

const __dir = dirname(fileURLToPath(import.meta.url))
const ROOT  = resolve(__dir, '..')

const POSTS_LIST = [
  { label: 'P1', post_id: 'd02a9507-d6c3-4203-9939-4667a4e0f027', post_name: 'Teste Post Smoke Test 01' },
  { label: 'P2', post_id: '7eb9ccf4-7989-4f4b-93ba-c10df0345428', post_name: 'outro teste de post' },
  { label: 'P3', post_id: '083a69d5-de8f-4525-b1a1-f495b6404e80', post_name: 'outro teste de story' },
  { label: 'P4', post_id: '7aa6b5a4-8fb2-4e22-937e-82a228f87e8b', post_name: 'teste 04' },
]

const CONFIRM_KEY   = 'POSTS_MIGRATION_M85B_ROLLBACK_CONFIRM'
const CONFIRM_VALUE = 'M8_5B_ROLLBACK_APPROVED'

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

const env = loadEnv()
const get = k => env[k] ?? ''
const SUPABASE_URL = get('SUPABASE_URL') || get('NEXT_PUBLIC_SUPABASE_URL')
const SVC_KEY      = get('SUPABASE_SECRET_KEY') || get('SUPABASE_SERVICE_ROLE_KEY')

if (!SUPABASE_URL || !SVC_KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_SECRET_KEY (legacy: SUPABASE_SERVICE_ROLE_KEY) in .env.local')
  process.exit(1)
}
adminGuard.requireAdminAck({ script: 'posts_migration_m85b_rollback.mjs', target: SUPABASE_URL })

async function sbGet(path) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: { apikey: SVC_KEY, Authorization: `Bearer ${SVC_KEY}`, Accept: 'application/json' },
  })
  if (!res.ok) throw new Error(`GET ${path} → ${res.status}: ${await res.text()}`)
  return res.json()
}

async function sbPatch(table, filter, body) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${filter}`, {
    method: 'PATCH',
    headers: {
      apikey: SVC_KEY,
      Authorization: `Bearer ${SVC_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
    },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(`PATCH ${table}?${filter} → ${res.status}: ${await res.text()}`)
  return res.json()
}

async function main() {
  const execute = process.argv.includes('--execute')
  const dryRun  = !execute

  console.log(`\n════ M8.5B ROLLBACK ════`)
  console.log(`Mode: ${dryRun ? 'DRY-RUN' : 'EXECUTE'}`)
  console.log(`Ação: SET posts.migrated_at = NULL para P1–P4\n`)

  if (!dryRun) {
    if (process.env[CONFIRM_KEY] !== CONFIRM_VALUE) {
      console.error(`  ERRO: Para executar, defina: ${CONFIRM_KEY}=${CONFIRM_VALUE}`)
      process.exit(1)
    }
  }

  // Check current state
  console.log('── Estado atual ──────────────────────────────────────────────')
  const ids = POSTS_LIST.map(p => p.post_id).join(',')
  const posts = await sbGet(`posts?id=in.(${ids})&select=id,name,migrated_at`)
  for (const meta of POSTS_LIST) {
    const post = posts.find(p => p.id === meta.post_id)
    if (!post) { console.error(`  ${meta.label}: NOT FOUND`); continue }
    const state = post.migrated_at ? `MARKED (${post.migrated_at})` : 'NOT MARKED (já NULL)'
    console.log(`  ${meta.label}: ${state}`)
  }

  if (dryRun) {
    const marked = posts.filter(p => p.migrated_at).length
    console.log(`\n  DRY-RUN: ${marked} post(s) teriam migrated_at zerado.`)
    console.log(`  Para executar: ${CONFIRM_KEY}=${CONFIRM_VALUE} node scripts/posts_migration_m85b_rollback.mjs --execute`)
    process.exit(0)
  }

  // Execute rollback
  console.log('\n── Rollback ──────────────────────────────────────────────────')
  let cleared = 0
  for (const meta of POSTS_LIST) {
    try {
      const updated = await sbPatch('posts', `id=eq.${meta.post_id}`, { migrated_at: null })
      const row = updated?.[0]
      if (row && row.migrated_at === null) {
        console.log(`  ${meta.label}: migrated_at = NULL ✅`)
        cleared++
      } else {
        console.warn(`  ${meta.label}: PATCH succeeded but migrated_at not null — re-verify`)
      }
    } catch (err) {
      console.error(`  ${meta.label}: FAIL — ${err.message}`)
    }
  }

  // Verify
  console.log('\n── Verificação pós-rollback ──────────────────────────────────')
  const verify = await sbGet(`posts?id=in.(${ids})&select=id,name,migrated_at`)
  let pass = 0
  for (const meta of POSTS_LIST) {
    const post = verify.find(p => p.id === meta.post_id)
    if (post?.migrated_at === null || post?.migrated_at === undefined) {
      console.log(`  ${meta.label}: migrated_at = NULL ✅`)
      pass++
    } else {
      console.error(`  ${meta.label}: migrated_at still set = ${post.migrated_at} ✗`)
    }
  }

  if (pass === 4) {
    console.log(`\n  M8.5B ROLLBACK CONCLUÍDO ✅ — ${cleared}/4 posts desmarcados`)
    console.log('  PATCH e DELETE desbloqueados. Badge Migrado não aparecerá mais.')
  } else {
    console.error(`\n  ROLLBACK INCOMPLETO — ${pass}/4 posts com migrated_at = NULL`)
    process.exit(1)
  }
}

main().catch(err => {
  console.error('FATAL:', err)
  process.exit(1)
})

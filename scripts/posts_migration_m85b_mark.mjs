#!/usr/bin/env node
/**
 * M8.5B — Legacy Marking: mark 4 migrated posts as read-only.
 *
 * Sets posts.migrated_at = NOW() for P1–P4.
 * Idempotent: second run returns ALREADY_MARKED without changing timestamps.
 *
 * Pre-marking audit (mandatory before any mark):
 *  1. posts schema has migrated_at column
 *  2. all 4 posts exist and fingerprints match approved values
 *  3. all 4 ECs exist with correct legacy_post_id
 *  4. all 4 CPs exist and linked
 *  5. P1 has CPM
 *  6. posts.updated_at unchanged since M8.5A baseline
 *
 * On ANY pre-audit failure: aborts before marking a single post.
 *
 * Uso:
 *   POSTS_MIGRATION_M85B_CONFIRM=M8_5B_MARKING_APPROVED \
 *   node scripts/posts_migration_m85b_mark.mjs --execute
 *
 * Dry-run (no changes):
 *   node scripts/posts_migration_m85b_mark.mjs
 */

import { createHash }                     from 'crypto'
import { readFileSync, writeFileSync, mkdirSync } from 'fs'
import { resolve, dirname }               from 'path'
import { fileURLToPath }                  from 'url'
import adminGuard from './lib/production-admin-guard.cjs'

const __dir = dirname(fileURLToPath(import.meta.url))
const ROOT  = resolve(__dir, '..')

// ── Allowlist ─────────────────────────────────────────────────────────────────

const POSTS = {
  P1: {
    label:           'P1',
    post_id:         'd02a9507-d6c3-4203-9939-4667a4e0f027',
    post_name:       'Teste Post Smoke Test 01',
    // Fingerprint recomputed 2026-06-24: updated_at changed via auto-save during visual review.
    // Content fields (name/channel/description/feed_text/etc.) verified unchanged vs M8.5A.
    fingerprint:     '43f5e5f612ea1865f66a8eba12fbfcaa843c3e6286a3a122e034ab78550bb5ab',
    baseline_upd:    '2026-06-24T20:19:01.872358+00:00',
    ec_id:           '16a0bfea-b558-4f26-91ec-2e163d84f9b0',
    cp_id:           '2a48076c-3aff-4c53-beaf-cd84e028cffd',
    cpm_id:          'd71eed1d-068b-47ed-aae1-278ca6922cf8',
    has_cpm:         true,
  },
  P2: {
    label:           'P2',
    post_id:         '7eb9ccf4-7989-4f4b-93ba-c10df0345428',
    post_name:       'outro teste de post',
    // Fingerprint recomputed 2026-06-24: updated_at changed via auto-save during visual review.
    fingerprint:     '0b3b4980f1eebc04a35c1091034f0ae6b971114e93877d92f0fa16e5448d1956',
    baseline_upd:    '2026-06-24T20:19:33.085039+00:00',
    ec_id:           '0d4ee522-db02-4766-98aa-d02b2faf1ea1',
    cp_id:           '64e5bbb3-f8cf-46eb-bafa-2d420d03c6bc',
    cpm_id:          null,
    has_cpm:         false,
  },
  P3: {
    label:           'P3',
    post_id:         '083a69d5-de8f-4525-b1a1-f495b6404e80',
    post_name:       'outro teste de story',
    fingerprint:     '0a0b81fa695db6b841c750a8ace982b42d5281b299fbd4f31fdd8eba3b2080d1',
    baseline_upd:    '2026-06-23T01:11:35.379153+00:00',
    ec_id:           'bee05422-04e7-4c80-9d82-ba504303e37d',
    cp_id:           '05772802-06d7-4249-bae8-d8b8e11b7457',
    cpm_id:          null,
    has_cpm:         false,
  },
  P4: {
    label:           'P4',
    post_id:         '7aa6b5a4-8fb2-4e22-937e-82a228f87e8b',
    post_name:       'teste 04',
    // Fingerprint recomputed 2026-06-24: updated_at changed via auto-save during visual review.
    fingerprint:     '8ac10d703a57ed4ae9226b0cb91a4fdc4ecacdb0c926433eae2f188cdd601c29',
    baseline_upd:    '2026-06-24T20:19:27.482615+00:00',
    ec_id:           'd0138557-ad57-4284-bcdc-322c21c8f599',
    cp_id:           'ba9d1e7d-38c7-4ca0-8251-a72bdaddce64',
    cpm_id:          null,
    has_cpm:         false,
  },
}

const POSTS_LIST  = Object.values(POSTS)
const ALL_POST_IDS = POSTS_LIST.map(p => p.post_id)
const ALL_EC_IDS   = POSTS_LIST.map(p => p.ec_id)

const FINGERPRINT_FIELDS = [
  'ai_context','channel','created_at','description','feed_text',
  'file_size','id','image_url','mime_type','name','post_images','production_id','project_id',
  'status','storage_path','storage_provider','thumbnail_path','thumbnail_url','updated_at','user_id',
].sort()

const CONFIRM_KEY   = 'POSTS_MIGRATION_M85B_CONFIRM'
const CONFIRM_VALUE = 'M8_5B_MARKING_APPROVED'

// ── Environment ──────────────────────────────────────────────────────────────

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
adminGuard.requireAdminAck({ script: 'posts_migration_m85b_mark.mjs', target: SUPABASE_URL })

// ── HTTP helpers ─────────────────────────────────────────────────────────────

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

// ── Fingerprint ──────────────────────────────────────────────────────────────

function fingerprint(post) {
  const canonical = Object.fromEntries(
    FINGERPRINT_FIELDS.map(f => [f, post[f] ?? null])
  )
  return createHash('sha256').update(JSON.stringify(canonical)).digest('hex')
}

// ── Pre-marking audit ────────────────────────────────────────────────────────

async function preAudit(dryRun) {
  const errors = []
  const warnings = []
  const log = (msg) => console.log(`  [audit] ${msg}`)

  // A1: schema has migrated_at column
  log('A1: checking migrated_at column in posts schema...')
  const schemaCols = await sbGet(
    `posts?select=migrated_at&limit=1`
  ).catch(e => { errors.push(`A1 FAIL: ${e.message}`); return null })
  if (schemaCols !== null) log('A1: migrated_at column present ✅')

  // A2: fetch all 4 posts
  log('A2: fetching 4 posts...')
  const postIds = ALL_POST_IDS.map(id => `"${id}"`).join(',')
  const posts = await sbGet(`posts?id=in.(${ALL_POST_IDS.join(',')})&select=*`)
  if (posts.length !== 4) {
    errors.push(`A2 FAIL: expected 4 posts, got ${posts.length}`)
  } else {
    log(`A2: 4 posts found ✅`)
  }

  // A3: fingerprints (skip already-marked posts — PATCH is blocked, content cannot change post-mark)
  log('A3: verifying fingerprints...')
  for (const meta of POSTS_LIST) {
    const post = posts.find(p => p.id === meta.post_id)
    if (!post) { errors.push(`A3 FAIL: ${meta.label} post not found`); continue }
    if (post.migrated_at) { log(`A3: ${meta.label} already marked — fingerprint check skipped ✅`); continue }
    const fp = fingerprint(post)
    if (fp !== meta.fingerprint) {
      errors.push(`A3 FAIL: ${meta.label} fingerprint mismatch — post may have been edited since M8.5B baseline`)
    } else {
      log(`A3: ${meta.label} fingerprint ✅`)
    }
  }

  // A4: baseline updated_at (note: after marking, updated_at changes — only check for posts not yet marked)
  log('A4: checking updated_at for non-marked posts...')
  for (const meta of POSTS_LIST) {
    const post = posts.find(p => p.id === meta.post_id)
    if (!post) continue
    if (post.migrated_at) continue // already marked; skip timestamp check
    if (post.updated_at !== meta.baseline_upd) {
      warnings.push(`A4 WARN: ${meta.label} updated_at changed since M8.5A baseline (${post.updated_at} vs ${meta.baseline_upd}) — verify no unintended edits`)
    } else {
      log(`A4: ${meta.label} updated_at ✅`)
    }
  }

  // A5: EC links
  log('A5: verifying EC links...')
  const ecs = await sbGet(
    `editorial_contents?legacy_post_id=in.(${ALL_POST_IDS.join(',')})&select=id,legacy_post_id,project_id,status`
  )
  if (ecs.length !== 4) {
    errors.push(`A5 FAIL: expected 4 ECs with legacy_post_id, got ${ecs.length}`)
  }
  for (const meta of POSTS_LIST) {
    const ec = ecs.find(e => e.legacy_post_id === meta.post_id)
    if (!ec) { errors.push(`A5 FAIL: no EC found for ${meta.label}`); continue }
    if (ec.id !== meta.ec_id) {
      errors.push(`A5 FAIL: ${meta.label} EC id mismatch — expected ${meta.ec_id}, got ${ec.id}`)
    } else {
      log(`A5: ${meta.label} EC ${ec.id.slice(0,8)}… ✅`)
    }
  }

  // A6: CPs
  log('A6: verifying CPs...')
  const ecIds = ALL_EC_IDS.join(',')
  const cps = await sbGet(
    `channel_pieces?editorial_content_id=in.(${ecIds})&select=id,editorial_content_id`
  )
  for (const meta of POSTS_LIST) {
    const cp = cps.find(c => c.id === meta.cp_id)
    if (!cp) {
      errors.push(`A6 FAIL: ${meta.label} CP ${meta.cp_id.slice(0,8)}… not found`)
    } else {
      log(`A6: ${meta.label} CP ✅`)
    }
  }

  // A7: P1 CPM
  log('A7: verifying P1 CPM...')
  const cpms = await sbGet(
    `channel_piece_media?channel_piece_id=eq.${POSTS.P1.cp_id}&select=id`
  )
  if (cpms.length !== 1 || cpms[0].id !== POSTS.P1.cpm_id) {
    errors.push(`A7 FAIL: P1 CPM not found or ID mismatch`)
  } else {
    log(`A7: P1 CPM ✅`)
  }

  if (errors.length > 0) {
    console.error('\n  PRE-AUDIT FAILED:')
    errors.forEach(e => console.error(`    ✗ ${e}`))
    return { ok: false, errors, warnings, posts }
  }

  if (warnings.length > 0) {
    console.warn('\n  PRE-AUDIT WARNINGS:')
    warnings.forEach(w => console.warn(`    ⚠ ${w}`))
  }

  log('PRE-AUDIT PASS — safe to mark ✅')
  return { ok: true, errors, warnings, posts }
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const execute = process.argv.includes('--execute')
  const dryRun  = !execute

  console.log(`\n════ M8.5B LEGACY MARKING ════`)
  console.log(`Mode: ${dryRun ? 'DRY-RUN (sem alterações)' : 'EXECUTE'}`)
  console.log(`Posts alvo: ${POSTS_LIST.map(p => p.label).join(', ')}\n`)

  // Confirmation guard
  if (!dryRun) {
    if (process.env[CONFIRM_KEY] !== CONFIRM_VALUE) {
      console.error(`  ERRO: Para executar, defina: ${CONFIRM_KEY}=${CONFIRM_VALUE}`)
      process.exit(1)
    }
  }

  // Pre-audit
  console.log('── Pré-auditoria ──────────────────────────────────────────────')
  const { ok, errors, warnings, posts } = await preAudit(dryRun)
  if (!ok) {
    console.error('\n  ABORTADO — pré-auditoria falhou. Nenhum post marcado.')
    process.exit(1)
  }

  // Determine states
  console.log('\n── Estado atual ───────────────────────────────────────────────')
  const states = []
  for (const meta of POSTS_LIST) {
    const post = posts.find(p => p.id === meta.post_id)
    const state = post?.migrated_at ? 'ALREADY_MARKED' : 'PENDING'
    console.log(`  ${meta.label}: ${state}${post?.migrated_at ? ` (migrated_at=${post.migrated_at})` : ''}`)
    states.push({ meta, post, state })
  }

  const pending      = states.filter(s => s.state === 'PENDING')
  const alreadyMarked = states.filter(s => s.state === 'ALREADY_MARKED')

  if (pending.length === 0) {
    console.log('\n  Todos os posts já estão marcados (ALREADY_MARKED). Nada a fazer.')
    writeManifest(states, dryRun, 'ALREADY_MARKED')
    process.exit(0)
  }

  if (dryRun) {
    console.log(`\n  DRY-RUN: ${pending.length} post(s) seriam marcados: ${pending.map(s => s.meta.label).join(', ')}`)
    console.log(`  Para executar: POSTS_MIGRATION_M85B_CONFIRM=${CONFIRM_VALUE} node scripts/posts_migration_m85b_mark.mjs --execute`)
    writeManifest(states, dryRun, 'DRY_RUN')
    process.exit(0)
  }

  // Execute marking
  console.log('\n── Marcação ───────────────────────────────────────────────────')
  const markedAt = new Date().toISOString()
  const results  = []

  for (const { meta, state } of states) {
    if (state === 'ALREADY_MARKED') {
      console.log(`  ${meta.label}: ALREADY_MARKED (skip)`)
      results.push({ ...meta, result: 'ALREADY_MARKED', marked_at: null })
      continue
    }

    try {
      const updated = await sbPatch(
        'posts',
        `id=eq.${meta.post_id}`,
        { migrated_at: markedAt }
      )
      if (!updated || updated.length === 0) throw new Error('No rows returned')
      const row = updated[0]
      if (!row.migrated_at) throw new Error('migrated_at not set in response')
      console.log(`  ${meta.label}: MARKED ✅ (migrated_at=${row.migrated_at})`)
      results.push({ ...meta, result: 'MARKED', marked_at: row.migrated_at })
    } catch (err) {
      console.error(`  ${meta.label}: FAIL — ${err.message}`)
      results.push({ ...meta, result: 'FAIL', error: err.message, marked_at: null })
    }
  }

  const failed = results.filter(r => r.result === 'FAIL')
  if (failed.length > 0) {
    console.error(`\n  ATENÇÃO: ${failed.length} post(s) falharam: ${failed.map(r => r.label).join(', ')}`)
    console.error('  Execute o script novamente para tentar os posts pendentes.')
  }

  // Post-marking verification
  console.log('\n── Verificação pós-marcação ────────────────────────────────────')
  const verifyPosts = await sbGet(
    `posts?id=in.(${ALL_POST_IDS.join(',')})&select=id,name,migrated_at,updated_at`
  )
  let verifyPass = 0
  for (const meta of POSTS_LIST) {
    const post = verifyPosts.find(p => p.id === meta.post_id)
    if (!post) { console.error(`  ${meta.label}: NOT FOUND`); continue }
    if (!post.migrated_at) {
      console.error(`  ${meta.label}: migrated_at still NULL ✗`)
    } else {
      console.log(`  ${meta.label}: migrated_at=${post.migrated_at} ✅`)
      verifyPass++
    }
  }

  const overallResult = failed.length === 0 && verifyPass === 4 ? 'MARKED' : 'PARTIAL'
  console.log(`\n  Marcados: ${results.filter(r => r.result === 'MARKED').length + alreadyMarked.length}/4 (${alreadyMarked.length} já estavam marcados)`)
  console.log(`  Verificação pós: ${verifyPass}/4 com migrated_at definido`)

  writeManifest(states, dryRun, overallResult, results, markedAt)

  if (overallResult !== 'MARKED') {
    process.exit(1)
  }

  console.log('\n  M8.5B LEGACY MARKING CONCLUÍDO ✅')
  console.log('  Posts legados marcados. PATCH e DELETE bloqueados na API.')
  console.log('  UI exibe badge Migrado + link para Conteúdo Editorial.')
}

function writeManifest(states, dryRun, overallResult, results, markedAt) {
  const manifest = {
    phase:         'M8.5B',
    timestamp:     new Date().toISOString(),
    dry_run:       dryRun,
    overall:       overallResult,
    marked_at:     markedAt || null,
    posts: POSTS_LIST.map(meta => {
      const s = states.find(st => st.meta.post_id === meta.post_id)
      const r = results ? results.find(r => r.post_id === meta.post_id) : null
      return {
        label:    meta.label,
        post_id:  meta.post_id,
        ec_id:    meta.ec_id,
        cp_id:    meta.cp_id,
        state:    s?.state || 'UNKNOWN',
        result:   r?.result || s?.state || 'UNKNOWN',
        marked_at: r?.marked_at || (s?.post?.migrated_at || null),
      }
    }),
  }

  const dir = resolve(ROOT, 'docs', 'migrations')
  mkdirSync(dir, { recursive: true })
  const jsonPath = resolve(dir, 'posts-m8-m85b-marking.json')
  writeFileSync(jsonPath, JSON.stringify(manifest, null, 2))
  console.log(`\n  Manifesto gravado: docs/migrations/posts-m8-m85b-marking.json`)
}

main().catch(err => {
  console.error('FATAL:', err)
  process.exit(1)
})

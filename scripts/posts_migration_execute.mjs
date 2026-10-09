#!/usr/bin/env node
/**
 * M8.3A — Executor controlado: Posts legados → EditorialContent
 *
 * Allowlist: P2, P3, P4 apenas. P1 reservado para M8.4 (exige cópia S3).
 * Por padrão opera em modo de verificação (zero escrita).
 *
 * Para executar:
 *   POSTS_MIGRATION_CONFIRM=M8_3A_APPROVED \
 *   node scripts/posts_migration_execute.mjs \
 *   --execute \
 *   --posts 7eb9ccf4-7989-4f4b-93ba-c10df0345428,7aa6b5a4-8fb2-4e22-937e-82a228f87e8b,083a69d5-de8f-4525-b1a1-f495b6404e80
 */

import { createHash }                             from 'crypto'
import { readFileSync, mkdirSync, writeFileSync }  from 'fs'
import { resolve, dirname }                       from 'path'
import { fileURLToPath }                          from 'url'
import adminGuard from './lib/production-admin-guard.cjs'

// ── Paths ──────────────────────────────────────────────────────────────────

const __dir = dirname(fileURLToPath(import.meta.url))
const ROOT  = resolve(__dir, '..')

// ── Allowlist — hardcoded, not derived from dry-run file ──────────────────

const P1_ID = 'd02a9507-d6c3-4203-9939-4667a4e0f027'  // M8.4 — S3 + library_file

const ALLOWLIST = {
  '7eb9ccf4-7989-4f4b-93ba-c10df0345428': 'P2',  // outro teste de post (youtube/post)
  '083a69d5-de8f-4525-b1a1-f495b6404e80': 'P3',  // outro teste de story (instagram/story, H1)
  '7aa6b5a4-8fb2-4e22-937e-82a228f87e8b': 'P4',  // teste 04 (youtube/video_description)
}

// Fingerprints aprovados no dry-run M8.1
const APPROVED_FINGERPRINTS = {
  '7eb9ccf4-7989-4f4b-93ba-c10df0345428': '6d3cbc65c625aa64d4eb8621c09f91492433cc2f33c09cdb88586254833f7a58',
  '083a69d5-de8f-4525-b1a1-f495b6404e80': '0a0b81fa695db6b841c750a8ace982b42d5281b299fbd4f31fdd8eba3b2080d1',
  '7aa6b5a4-8fb2-4e22-937e-82a228f87e8b': '8edbcebf2a97381d07b8e662450de1a4415152ac66b1c8fc1e512be42895dd31',
}

// Baseline updated_at do dry-run aprovado (detecção de mudança na fonte)
const BASELINE_UPDATED_AT = {
  '7eb9ccf4-7989-4f4b-93ba-c10df0345428': '2026-06-23 01:09:29.849458+00',
  '083a69d5-de8f-4525-b1a1-f495b6404e80': '2026-06-23 01:11:35.379153+00',
  '7aa6b5a4-8fb2-4e22-937e-82a228f87e8b': '2026-06-23 01:14:17.513899+00',
}

// H1: project_id aprovado para P3 (posts.project_id = NULL na fonte)
const P3_PROJECT_ID = 'd0d008c3-321b-46fe-8225-2f1a68e833ec'

const CHANNEL_MAP = {
  instagram_post:  { channel: 'instagram', format: 'feed' },
  instagram_story: { channel: 'instagram', format: 'story' },
  youtube_post:    { channel: 'youtube',   format: 'post' },
  youtube_shorts:  { channel: 'youtube',   format: 'short' },
  youtube_video:   { channel: 'youtube',   format: 'video_description' },
}

// Mesmos campos do dry-run (ordenados) — determinístico
const FINGERPRINT_FIELDS = [
  'ai_context','channel','created_at','description','feed_text',
  'file_size','id','image_url','mime_type','name','post_images','production_id','project_id',
  'status','storage_path','storage_provider','thumbnail_path','thumbnail_url','updated_at','user_id',
].sort()

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const VALID_CP_CHANNEL = ['instagram', 'youtube', 'whatsapp', 'linkedin', 'x', 'tiktok']
const VALID_CP_FORMAT  = ['feed', 'story', 'reel', 'short', 'video_description', 'post',
                          'channel_message', 'carousel', 'article']

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
const SVC    = get('SUPABASE_SERVICE_ROLE_KEY')

if (!SB_URL || !SVC) throw new Error('SUPABASE_URL ou SUPABASE_SERVICE_ROLE_KEY ausente no .env.local')
adminGuard.requireAdminAck({ script: 'posts_migration_execute.mjs', target: SB_URL })

const BASE_URL = SB_URL.replace(/\/$/, '')

// ── CLI ───────────────────────────────────────────────────────────────────

const args      = process.argv.slice(2)
const EXECUTE   = args.includes('--execute')
const CONFIRM   = process.env.POSTS_MIGRATION_CONFIRM
const postsIdx  = args.indexOf('--posts')
const postsArg  = postsIdx !== -1 ? args[postsIdx + 1] : null
const postIds   = postsArg ? postsArg.split(',').map(s => s.trim()).filter(Boolean) : []

// ── Security ──────────────────────────────────────────────────────────────

function assertNoSecrets(str) {
  if (SVC && str.includes(SVC)) throw new Error('SEGURANÇA: output contém service_role key')
}

// ── REST helpers (service_role — bypassa RLS) ─────────────────────────────

const HDR = { apikey: SVC, Authorization: `Bearer ${SVC}`, 'Content-Type': 'application/json' }

async function sbGet(path) {
  const res = await fetch(`${BASE_URL}/rest/v1/${path}`, {
    headers: { ...HDR, Accept: 'application/json' },
  })
  if (!res.ok) {
    const t = await res.text()
    throw new Error(`GET ${path} (${res.status}): ${t}`)
  }
  return res.json()
}

async function sbInsert(table, payload) {
  const res = await fetch(`${BASE_URL}/rest/v1/${table}`, {
    method: 'POST',
    headers: { ...HDR, Prefer: 'return=representation' },
    body: JSON.stringify(payload),
  })
  if (!res.ok) {
    const t = await res.text()
    const err = new Error(`INSERT ${table} (${res.status}): ${t}`)
    err.pgCode = res.status
    err.body   = t
    throw err
  }
  const data = await res.json()
  return Array.isArray(data) ? data[0] : data
}

async function sbDeleteById(table, id) {
  const res = await fetch(`${BASE_URL}/rest/v1/${table}?id=eq.${id}`, {
    method: 'DELETE',
    headers: HDR,
  })
  if (!res.ok) {
    const t = await res.text()
    throw new Error(`DELETE ${table} id=${id} (${res.status}): ${t}`)
  }
}

// ── Fingerprint ───────────────────────────────────────────────────────────

function fingerprint(post) {
  const obj = {}
  for (const k of FINGERPRINT_FIELDS) obj[k] = post[k] ?? null
  return createHash('sha256').update(JSON.stringify(obj)).digest('hex')
}

// ── Timestamp normalization ───────────────────────────────────────────────

const tsMs = ts => new Date(String(ts).replace(' ', 'T').replace(/\+00$/, '+00:00')).getTime()

// ── Snapshot ──────────────────────────────────────────────────────────────

async function takeSnapshot(label) {
  const [ecs, cps, posts] = await Promise.all([
    sbGet('editorial_contents?select=id,legacy_post_id'),
    sbGet('channel_pieces?select=id'),
    sbGet('posts?select=id'),
  ])
  const withLegacy = ecs.filter(e => e.legacy_post_id).length
  console.log(`\n[Snapshot ${label}]`)
  console.log(`  editorial_contents: ${ecs.length} (com legacy_post_id: ${withLegacy})`)
  console.log(`  channel_pieces:     ${cps.length}`)
  console.log(`  posts:              ${posts.length}`)
  return {
    editorial_contents:  ecs.length,
    ec_with_legacy:      withLegacy,
    channel_pieces:      cps.length,
    posts:               posts.length,
    at:                  new Date().toISOString(),
  }
}

// ── CLI validation ────────────────────────────────────────────────────────

function validateCliArgs() {
  if (!EXECUTE) {
    console.log('\n╔══════════════════════════════════════════════════════════╗')
    console.log('║  M8.3A — Posts → EditorialContent  [MODO PLANO/VERIFICAÇÃO] ║')
    console.log('╚══════════════════════════════════════════════════════════╝')
    console.log('\nNenhuma escrita realizada.')
    console.log('\nAllowlist desta rodada:')
    for (const [id, label] of Object.entries(ALLOWLIST)) {
      console.log(`  ${label}: ${id}`)
    }
    console.log(`\nP1 BLOQUEADO (${P1_ID}) — reservado para M8.4 (S3 + library_file).`)
    console.log('\nPara executar a migração real:')
    console.log('  POSTS_MIGRATION_CONFIRM=M8_3A_APPROVED \\')
    console.log('  node scripts/posts_migration_execute.mjs \\')
    console.log('  --execute \\')
    console.log(`  --posts ${Object.keys(ALLOWLIST).join(',')}`)
    console.log('')
    process.exit(0)
  }

  if (CONFIRM !== 'M8_3A_APPROVED') {
    console.error('ERRO: POSTS_MIGRATION_CONFIRM=M8_3A_APPROVED é obrigatório. Zero escrita realizada.')
    process.exit(1)
  }

  if (postIds.length === 0) {
    console.error('ERRO: --posts <ids> obrigatório. Especifique IDs separados por vírgula.')
    process.exit(1)
  }

  // Rejeitar P1 explicitamente
  if (postIds.includes(P1_ID)) {
    console.error(`ERRO: P1 (${P1_ID}) não permitido nesta rodada. Reservado para M8.4.`)
    process.exit(1)
  }

  // Rejeitar IDs inválidos ou fora da allowlist
  for (const id of postIds) {
    if (!UUID_RE.test(id)) {
      console.error(`ERRO: ID inválido (não é UUID): "${id}"`)
      process.exit(1)
    }
    if (!ALLOWLIST[id]) {
      console.error(`ERRO: "${id}" não está na allowlist desta rodada.`)
      process.exit(1)
    }
  }

  // Rejeitar duplicados
  if (new Set(postIds).size !== postIds.length) {
    console.error('ERRO: IDs duplicados em --posts.')
    process.exit(1)
  }
}

// ── Per-post migration ────────────────────────────────────────────────────

async function migratePost(post) {
  // ── 1. Fingerprint check ────────────────────────────────────────────────
  const fp         = fingerprint(post)
  const approvedFp = APPROVED_FINGERPRINTS[post.id]
  if (fp !== approvedFp) {
    return {
      post_id: post.id, result: 'SOURCE_FINGERPRINT_MISMATCH',
      error: `fingerprint atual=${fp} != aprovado=${approvedFp}`,
    }
  }

  // ── 2. Source change detection (belt-and-suspenders) ───────────────────
  const baseline = BASELINE_UPDATED_AT[post.id]
  if (baseline && tsMs(post.updated_at) !== tsMs(baseline)) {
    return {
      post_id: post.id, result: 'SOURCE_CHANGED',
      error: `updated_at="${post.updated_at}" difere do baseline="${baseline}"`,
    }
  }

  // ── 3. Idempotency check ────────────────────────────────────────────────
  const existingECs = await sbGet(`editorial_contents?legacy_post_id=eq.${post.id}&select=id,legacy_post_id`)
  if (existingECs.length > 0) {
    const ecId = existingECs[0].id
    const existingCPs = await sbGet(`channel_pieces?editorial_content_id=eq.${ecId}&select=id`)
    if (existingCPs.length === 0) {
      return {
        post_id: post.id, result: 'PARTIAL_MIGRATION_STATE',
        error: `EC ${ecId} existe com legacy_post_id mas sem ChannelPiece. Requer intervenção manual.`,
        editorial_content_id: ecId,
      }
    }
    return {
      post_id: post.id, result: 'ALREADY_MIGRATED',
      editorial_content_id: ecId, channel_piece_id: existingCPs[0].id,
    }
  }

  // ── 4. Project ──────────────────────────────────────────────────────────
  const effectiveProjectId = post.project_id
    ?? (post.id === '083a69d5-de8f-4525-b1a1-f495b6404e80' ? P3_PROJECT_ID : null)
  if (!effectiveProjectId) {
    return { post_id: post.id, result: 'BLOCKER', error: 'project_id ausente sem decisão H aplicável' }
  }
  const projects = await sbGet(`projects?id=eq.${effectiveProjectId}&select=id`)
  if (!projects.length) {
    return { post_id: post.id, result: 'BLOCKER', error: `Project não encontrado: ${effectiveProjectId}` }
  }

  // ── 5. Production ───────────────────────────────────────────────────────
  if (post.production_id) {
    const prods = await sbGet(`productions?id=eq.${post.production_id}&select=id`)
    if (!prods.length) {
      return { post_id: post.id, result: 'BLOCKER', error: `Production não encontrada: ${post.production_id}` }
    }
  }

  // ── 6. Channel mapping ──────────────────────────────────────────────────
  const mapping = CHANNEL_MAP[post.channel]
  if (!mapping) {
    return { post_id: post.id, result: 'BLOCKER', error: `Canal sem mapeamento: "${post.channel}"` }
  }
  if (!VALID_CP_CHANNEL.includes(mapping.channel)) {
    return { post_id: post.id, result: 'BLOCKER', error: `channel inválido: "${mapping.channel}"` }
  }
  if (!VALID_CP_FORMAT.includes(mapping.format)) {
    return { post_id: post.id, result: 'BLOCKER', error: `format inválido: "${mapping.format}"` }
  }

  // ── 7. Title ────────────────────────────────────────────────────────────
  const title = post.name?.trim() ?? ''
  if (!title)          return { post_id: post.id, result: 'BLOCKER', error: 'title (post.name) vazio' }
  if (title.length > 500) return { post_id: post.id, result: 'BLOCKER', error: `title excede 500 chars (${title.length})` }

  // ── 8. Unexpected media (P2/P3/P4 should have none) ────────────────────
  if ((post.post_images ?? []).length > 0) {
    return { post_id: post.id, result: 'BLOCKER', error: 'Post possui mídia — não previsto nesta rodada. Use M8.4.' }
  }

  // ── Write EC ─────────────────────────────────────────────────────────────
  let ecRow
  try {
    ecRow = await sbInsert('editorial_contents', {
      user_id:        post.user_id,
      project_id:     effectiveProjectId,
      production_id:  post.production_id  ?? null,
      title,
      body:           post.description    ?? null,
      ai_context:     post.ai_context     ?? null,
      status:         'draft',
      legacy_post_id: post.id,
      created_at:     post.created_at,
      updated_at:     post.updated_at,
    })
  } catch (e) {
    if (e.body && e.body.includes('23505')) {
      return { post_id: post.id, result: 'MIGRATION_CONFLICT', error: `Conflito de unicidade (legacy_post_id): ${e.message}` }
    }
    return { post_id: post.id, result: 'EC_INSERT_FAILED', error: e.message }
  }
  console.log(`  ✓ EC criado: ${ecRow.id}`)

  // ── Write CP ──────────────────────────────────────────────────────────────
  let cpRow
  try {
    cpRow = await sbInsert('channel_pieces', {
      user_id:              post.user_id,
      editorial_content_id: ecRow.id,
      channel:              mapping.channel,
      format:               mapping.format,
      title:                null,
      body:                 post.feed_text ?? null,
      cta:                  null,
      hashtags:             null,
      status:               'draft',
    })
  } catch (e) {
    // CP falhou — reverter EC imediatamente
    console.error(`  ✗ CP falhou — revertendo EC ${ecRow.id}...`)
    try {
      await sbDeleteById('editorial_contents', ecRow.id)
      console.error(`  ✓ EC revertido: ${ecRow.id}`)
    } catch (re) {
      console.error(`  ✗ ROLLBACK EC FALHOU: ${re.message}`)
      console.error('  INTERVENÇÃO MANUAL NECESSÁRIA: EC órfão pode existir.')
    }
    return { post_id: post.id, result: 'CP_INSERT_FAILED', error: e.message, rolled_back_ec: ecRow.id }
  }
  console.log(`  ✓ CP criado: ${cpRow.id}`)

  return {
    post_id:               post.id,
    post_name:             post.name,
    result:                'MIGRATED',
    source_fingerprint:    fp,
    editorial_content_id:  ecRow.id,
    channel_piece_id:      cpRow.id,
    channel_piece_media_ids:    [],
    library_file_ids:           [],
    storage_objects_created:    [],
    executed_at:           new Date().toISOString(),
    rollback: {
      channel_piece_id:     cpRow.id,
      editorial_content_id: ecRow.id,
    },
  }
}

// ── Markdown manifest ─────────────────────────────────────────────────────

function buildManifestMd(manifest) {
  const lines = []
  lines.push('# M8.3A — Execution Manifest: Posts → EditorialContent')
  lines.push('')
  lines.push(`**Executado em:** ${manifest.executed_at}  `)
  lines.push(`**Migrados:** ${manifest.migrated} | **Já migrados (skip):** ${manifest.skipped} | **Erros:** ${manifest.errors}`)
  lines.push('')
  lines.push('---')
  lines.push('')
  lines.push('## Snapshot Antes')
  lines.push('')
  lines.push('| | Valor |')
  lines.push('|-|-------|')
  lines.push(`| editorial_contents | ${manifest.snapshot_before.editorial_contents} |`)
  lines.push(`| ec_with_legacy_post_id | ${manifest.snapshot_before.ec_with_legacy} |`)
  lines.push(`| channel_pieces | ${manifest.snapshot_before.channel_pieces} |`)
  lines.push(`| posts | ${manifest.snapshot_before.posts} |`)
  lines.push('')
  lines.push('## Resultados por Post')
  lines.push('')
  for (const p of manifest.posts) {
    lines.push(`### ${ALLOWLIST[p.post_id] ?? '?'} — \`${p.post_id}\``)
    lines.push('')
    lines.push(`**Nome:** ${p.post_name ?? '—'}  `)
    lines.push(`**Resultado:** \`${p.result}\`  `)
    if (p.editorial_content_id) lines.push(`**EditorialContent:** \`${p.editorial_content_id}\`  `)
    if (p.channel_piece_id)     lines.push(`**ChannelPiece:** \`${p.channel_piece_id}\`  `)
    if (p.source_fingerprint)   lines.push(`**Fingerprint:** \`${p.source_fingerprint}\`  `)
    if (p.executed_at)          lines.push(`**executed_at:** ${p.executed_at}  `)
    if (p.error)                lines.push(`**Erro:** ${p.error}  `)
    lines.push('')
  }
  lines.push('---')
  lines.push('')
  lines.push('## Snapshot Depois')
  lines.push('')
  const sa = manifest.snapshot_after
  lines.push('| | Valor |')
  lines.push('|-|-------|')
  lines.push(`| editorial_contents | ${sa?.editorial_contents ?? '—'} |`)
  lines.push(`| ec_with_legacy_post_id | ${sa?.ec_with_legacy ?? '—'} |`)
  lines.push(`| channel_pieces | ${sa?.channel_pieces ?? '—'} |`)
  lines.push(`| posts | ${sa?.posts ?? '—'} |`)
  lines.push('')
  lines.push('---')
  lines.push('')
  lines.push('## Rollback')
  lines.push('')
  lines.push('**Script:** `scripts/posts_migration_rollback.mjs`  ')
  lines.push('**Requer:** `--execute` + `POSTS_MIGRATION_ROLLBACK_CONFIRM=M8_3A_ROLLBACK_APPROVED`  ')
  lines.push('**Manifesto lido:** `docs/migrations/posts-m8-execution-m8-3a.json`')
  lines.push('')
  lines.push('Ordem de remoção: ChannelPiece → EditorialContent')
  lines.push('Nunca toca: `posts`, `library_files`, S3.')
  lines.push('')
  lines.push('---')
  lines.push('')
  lines.push('## P1 (pendente)')
  lines.push('')
  lines.push(`P1 (\`${P1_ID}\`) não foi migrado nesta rodada.`)
  lines.push('Requer M8.4: cópia S3 + criação de library_file + ChannelPieceMedia.')
  return lines.join('\n')
}

// ── Validation post-migration ────────────────────────────────────────────

async function validateMigrated(result) {
  if (result.result !== 'MIGRATED') return null
  const [ecs, cps] = await Promise.all([
    sbGet(`editorial_contents?id=eq.${result.editorial_content_id}&select=id,legacy_post_id,project_id,production_id,status,title`),
    sbGet(`channel_pieces?id=eq.${result.channel_piece_id}&select=id,editorial_content_id,channel,format,status`),
  ])
  const ec = ecs[0]
  const cp = cps[0]
  const checks = {
    ec_exists:       !!ec,
    ec_legacy_ok:    ec?.legacy_post_id === result.post_id,
    ec_status_draft: ec?.status === 'draft',
    cp_exists:       !!cp,
    cp_linked_to_ec: cp?.editorial_content_id === result.editorial_content_id,
    cp_status_draft: cp?.status === 'draft',
    cpm_count:       0,
  }
  console.log(`  [validação] EC: ${checks.ec_exists ? '✓' : '✗'} legacy_ok: ${checks.ec_legacy_ok ? '✓' : '✗'} CP: ${checks.cp_exists ? '✓' : '✗'} CP.linked: ${checks.cp_linked_to_ec ? '✓' : '✗'}`)
  return checks
}

// ── Main ──────────────────────────────────────────────────────────────────

async function main() {
  validateCliArgs()

  console.log('\n╔══════════════════════════════════════════════════════════╗')
  console.log('║  M8.3A — Posts → EditorialContent  [EXECUÇÃO REAL]       ║')
  console.log('╚══════════════════════════════════════════════════════════╝')
  console.log(`\nPosts a migrar: ${postIds.length}`)
  for (const id of postIds) console.log(`  ${ALLOWLIST[id]}: ${id}`)

  // Snapshot antes
  const snapshotBefore = await takeSnapshot('ANTES')

  // Fingerprints pré-execução
  console.log('\n[Fingerprints pré-execução]')
  const postRows = await sbGet(`posts?id=in.(${postIds.join(',')})&select=*`)
  const postMap  = Object.fromEntries(postRows.map(p => [p.id, p]))
  for (const id of postIds) {
    if (!postMap[id]) {
      console.error(`ERRO: Post ${id} não encontrado. Abortando.`)
      process.exit(1)
    }
    const fp = fingerprint(postMap[id])
    const ok = fp === APPROVED_FINGERPRINTS[id]
    console.log(`  ${ALLOWLIST[id]}: ${fp.slice(0, 16)}… ${ok ? '✓' : '✗ DIVERGE'}`)
  }

  // Execução por Post — ordem exata do --posts
  const results = []
  for (const id of postIds) {
    const post  = postMap[id]
    const label = ALLOWLIST[id]
    console.log(`\n[${label}] ${id} — ${post.name}`)
    const result = await migratePost(post)
    results.push({ ...result, post_name: post.name })
    console.log(`  → ${result.result}`)
    if (result.error) console.error(`  Erro: ${result.error}`)

    // Checkpoint: validar imediatamente após escrita
    if (result.result === 'MIGRATED') {
      await validateMigrated(result)
    }

    // Parar em erro não-idempotente
    if (!['MIGRATED','ALREADY_MIGRATED'].includes(result.result)) {
      console.error(`\nERRO em ${label} — parando execução para inspeção.`)
      console.error('Não avance ao próximo Post sem resolver este estado.')
      // Gera manifesto parcial antes de sair
      const manifest = buildPartialManifest(results, snapshotBefore, null)
      writeManifest(manifest)
      process.exit(1)
    }
  }

  // Snapshot depois
  const snapshotAfter = await takeSnapshot('DEPOIS')

  const migrated = results.filter(r => r.result === 'MIGRATED').length
  const skipped  = results.filter(r => r.result === 'ALREADY_MIGRATED').length
  const errors   = results.filter(r => !['MIGRATED','ALREADY_MIGRATED'].includes(r.result)).length

  console.log('\n══════════════════════════════════════════════════')
  console.log(`  EXECUÇÃO CONCLUÍDA`)
  console.log(`  Migrados: ${migrated} | Já migrados: ${skipped} | Erros: ${errors}`)
  console.log('══════════════════════════════════════════════════')

  const manifest = {
    version:         1,
    phase:           'M8.3A',
    executed_at:     new Date().toISOString(),
    migrated,
    skipped,
    errors,
    snapshot_before: snapshotBefore,
    snapshot_after:  snapshotAfter,
    posts:           results,
    allowlist:       Object.entries(ALLOWLIST).map(([id, label]) => ({ id, label })),
    p1_excluded:     P1_ID,
    posts_modified:  false,
    s3_operations:   [],
  }
  writeManifest(manifest)
}

function buildPartialManifest(results, snapshotBefore, snapshotAfter) {
  const migrated = results.filter(r => r.result === 'MIGRATED').length
  const skipped  = results.filter(r => r.result === 'ALREADY_MIGRATED').length
  const errors   = results.filter(r => !['MIGRATED','ALREADY_MIGRATED'].includes(r.result)).length
  return {
    version:         1,
    phase:           'M8.3A',
    executed_at:     new Date().toISOString(),
    partial:         true,
    migrated, skipped, errors,
    snapshot_before: snapshotBefore,
    snapshot_after:  snapshotAfter,
    posts:           results,
    allowlist:       Object.entries(ALLOWLIST).map(([id, label]) => ({ id, label })),
    p1_excluded:     P1_ID,
    posts_modified:  false,
    s3_operations:   [],
  }
}

function writeManifest(manifest) {
  const jsonStr = JSON.stringify(manifest, null, 2)
  assertNoSecrets(jsonStr)
  const mdStr   = buildManifestMd(manifest)
  mkdirSync(resolve(ROOT, 'docs/migrations'), { recursive: true })
  writeFileSync(resolve(ROOT, 'docs/migrations/posts-m8-execution-m8-3a.json'), jsonStr, 'utf8')
  writeFileSync(resolve(ROOT, 'docs/migrations/posts-m8-execution-m8-3a.md'),   mdStr,   'utf8')
  console.log('\nManifesto:')
  console.log('  docs/migrations/posts-m8-execution-m8-3a.json')
  console.log('  docs/migrations/posts-m8-execution-m8-3a.md')
}

main().catch(e => { console.error('FATAL:', e.message); process.exit(1) })

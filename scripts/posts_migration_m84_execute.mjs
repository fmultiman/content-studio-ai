#!/usr/bin/env node
/**
 * M8.4 — P1 Media Migration: posts → editorial_contents + channel_pieces + library_files + channel_piece_media
 *
 * Allowlist: P1 apenas (d02a9507). P2/P3/P4 bloqueados explicitamente.
 * Por padrão opera em modo de verificação (zero escrita, zero S3).
 *
 * Para executar:
 *   POSTS_MIGRATION_M84_CONFIRM=M8_4_P1_APPROVED \
 *   node scripts/posts_migration_m84_execute.mjs \
 *   --execute
 *
 * Estratégia de saga (ordem de escrita):
 *   1. Validações + S3 HeadObject(source) + colisão
 *   2. S3 CopyObject(source → dest)
 *   3. S3 HeadObject(dest) verificação
 *   4. INSERT editorial_contents
 *   5. INSERT channel_pieces        ← falha → DELETE EC + DELETE S3 dest
 *   6. INSERT library_files         ← falha → DELETE CP + EC + S3 dest
 *   7. INSERT channel_piece_media   ← falha → DELETE LF + CP + EC + S3 dest
 *
 * Rollback disponível em: scripts/posts_migration_m84_rollback.mjs
 */

import { createHash }                                          from 'crypto'
import { readFileSync, mkdirSync, writeFileSync }              from 'fs'
import { resolve, dirname }                                    from 'path'
import { fileURLToPath }                                       from 'url'
import {
  S3Client,
  HeadObjectCommand,
  CopyObjectCommand,
  DeleteObjectCommand,
} from '@aws-sdk/client-s3'
import adminGuard from './lib/production-admin-guard.cjs'

const __dir = dirname(fileURLToPath(import.meta.url))
const ROOT  = resolve(__dir, '..')

// ── Approved constants (hardcoded from M8.1 dry-run) ─────────────────────────

const P1_ID            = 'd02a9507-d6c3-4203-9939-4667a4e0f027'
const P1_USER_ID       = '35428fd4-4784-4934-9af9-82a606aad77e'
const P1_PROJECT_ID    = 'd0d008c3-321b-46fe-8225-2f1a68e833ec'
const P1_PRODUCTION_ID = '492af729-cb06-4e0e-8a2c-e83fada37fb1'
const APPROVED_FP      = '3e8a92a61914904a087d9eecf48bb894c069313d87fd01dd0d37bf3921e43a68'
const BASELINE_UPDATED_AT = '2026-06-23T01:08:39.376895+00:00'

// S3 source — NEVER deleted, NEVER modified
const SRC_BUCKET        = 'content-studio'
const SRC_KEY           = 'users/35428fd4-4784-4934-9af9-82a606aad77e/posts/3f142fc2-df7f-4e39-ae04-ca63832f690d/Content-Agent-Studio-Future-Vision-Concept.png'
const SRC_EXPECTED_SIZE = 1293601
const SRC_EXPECTED_MIME = 'image/png'
const SRC_EXPECTED_ETAG = '7997848a1fcbfd6193dc2f867d65a4b1'

// S3 destination — deterministic, safe for compensation DELETE
const DEST_BUCKET   = 'content-studio'
const DEST_KEY      = 'users/35428fd4-4784-4934-9af9-82a606aad77e/library/posts-migration-m8/d02a9507-d6c3-4203-9939-4667a4e0f027/Content-Agent-Studio-Future-Vision-Concept.png'
const DEST_FILENAME = 'Content-Agent-Studio-Future-Vision-Concept.png'

// Blocked IDs — M8.3A already handled these
const BLOCKED_IDS = [
  '7eb9ccf4-7989-4f4b-93ba-c10df0345428', // P2
  '083a69d5-de8f-4525-b1a1-f495b6404e80', // P3
  '7aa6b5a4-8fb2-4e22-937e-82a228f87e8b', // P4
]

// Confirmation tokens
const CONFIRM_KEY   = 'POSTS_MIGRATION_M84_CONFIRM'
const CONFIRM_VALUE = 'M8_4_P1_APPROVED'

// Fingerprint fields (same 20 sorted fields as M8.1/M8.3A)
const FINGERPRINT_FIELDS = [
  'ai_context','channel','created_at','description','feed_text',
  'file_size','id','image_url','mime_type','name','post_images','production_id','project_id',
  'status','storage_path','storage_provider','thumbnail_path','thumbnail_url','updated_at','user_id',
].sort()

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

const env    = loadEnv()
const get    = k => env[k] ?? ''
const SB_URL = get('SUPABASE_URL')
const SVC    = get('SUPABASE_SECRET_KEY')

if (!SB_URL || !SVC) throw new Error('SUPABASE_URL ou SUPABASE_SECRET_KEY ausente no .env.local')
adminGuard.requireAdminAck({ script: 'posts_migration_m84_execute.mjs', target: SB_URL })

const BASE_URL = SB_URL.replace(/\/$/, '')
const HDR      = { apikey: SVC, Authorization: `Bearer ${SVC}`, 'Content-Type': 'application/json' }

// ── S3 client ─────────────────────────────────────────────────────────────────

function buildS3Client() {
  const endpoint      = get('S3_ENDPOINT')
  const accessKeyId   = get('S3_ACCESS_KEY')     || get('S3_ACCESS_KEY_ID')
  const secretKey     = get('S3_SECRET_KEY')     || get('S3_SECRET_ACCESS_KEY')
  const region        = get('S3_REGION')          || 'us-east-1'
  const forcePathStyle = get('S3_FORCE_PATH_STYLE') !== 'false'
  const publicBase    = get('PUBLIC_STORAGE_BASE_URL') || `${endpoint.replace(/\/$/, '')}/${DEST_BUCKET}`

  if (!endpoint || !accessKeyId || !secretKey) {
    throw new Error('S3_ENDPOINT, S3_ACCESS_KEY, S3_SECRET_KEY ausentes no .env.local')
  }

  const client = new S3Client({
    endpoint,
    region,
    forcePathStyle,
    credentials: { accessKeyId, secretAccessKey: secretKey },
  })

  return { client, publicBase }
}

// ── Supabase REST helpers ─────────────────────────────────────────────────────

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
    err.status = res.status
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

// ── S3 operations ─────────────────────────────────────────────────────────────

async function s3Head(s3, bucket, key) {
  try {
    const res = await s3.send(new HeadObjectCommand({ Bucket: bucket, Key: key }))
    return {
      exists:      true,
      size:        res.ContentLength,
      contentType: res.ContentType,
      etag:        res.ETag?.replace(/"/g, ''),
    }
  } catch (e) {
    if (e.name === 'NotFound' || e.$metadata?.httpStatusCode === 404) {
      return { exists: false }
    }
    throw new Error(`HeadObject ${bucket}/${key}: ${e.message}`)
  }
}

async function s3Copy(s3, srcBucket, srcKey, destBucket, destKey) {
  const copySource = `${srcBucket}/${srcKey.split('/').map(encodeURIComponent).join('/')}`
  await s3.send(new CopyObjectCommand({
    Bucket:     destBucket,
    Key:        destKey,
    CopySource: copySource,
  }))
}

async function s3Delete(s3, bucket, key) {
  await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }))
}

// ── Fingerprint ───────────────────────────────────────────────────────────────

function fingerprint(post) {
  const obj = {}
  for (const k of FINGERPRINT_FIELDS) obj[k] = post[k] ?? null
  return createHash('sha256').update(JSON.stringify(obj)).digest('hex')
}

// ── Security guard ────────────────────────────────────────────────────────────

function assertNoSecrets(str) {
  if (SVC && str.includes(SVC)) throw new Error('SEGURANÇA: output contém service_role key')
}

// ── Snapshot ──────────────────────────────────────────────────────────────────

async function takeSnapshot(label) {
  const [ecs, cps, lfs, cpms, posts] = await Promise.all([
    sbGet('editorial_contents?select=id,legacy_post_id'),
    sbGet('channel_pieces?select=id'),
    sbGet('library_files?select=id'),
    sbGet('channel_piece_media?select=id'),
    sbGet('posts?select=id'),
  ])
  const withLegacy = ecs.filter(e => e.legacy_post_id).length
  console.log(`\n[Snapshot ${label}]`)
  console.log(`  editorial_contents:  ${ecs.length} (com legacy_post_id: ${withLegacy})`)
  console.log(`  channel_pieces:      ${cps.length}`)
  console.log(`  library_files:       ${lfs.length}`)
  console.log(`  channel_piece_media: ${cpms.length}`)
  console.log(`  posts:               ${posts.length}`)
  return {
    editorial_contents: ecs.length,
    ec_with_legacy:     withLegacy,
    channel_pieces:     cps.length,
    library_files:      lfs.length,
    channel_piece_media: cpms.length,
    posts:              posts.length,
    at:                 new Date().toISOString(),
  }
}

// ── State query ───────────────────────────────────────────────────────────────

async function queryState() {
  const [ecRows, lfRows] = await Promise.all([
    sbGet(`editorial_contents?legacy_post_id=eq.${P1_ID}&select=id,legacy_post_id,project_id,status`),
    sbGet(`library_files?storage_path=eq.${encodeURIComponent(DEST_KEY)}&user_id=eq.${P1_USER_ID}&select=id,storage_path`),
  ])

  const ec = ecRows[0] ?? null
  const lf = lfRows[0] ?? null

  let cp  = null
  let cpm = null

  if (ec) {
    const cpRows = await sbGet(`channel_pieces?editorial_content_id=eq.${ec.id}&select=id,channel,format,status`)
    cp = cpRows[0] ?? null
  }

  if (cp && lf) {
    const cpmRows = await sbGet(`channel_piece_media?channel_piece_id=eq.${cp.id}&library_file_id=eq.${lf.id}&select=id,role,position`)
    cpm = cpmRows[0] ?? null
  }

  return { ec, cp, lf, cpm }
}

// ── CLI validation ────────────────────────────────────────────────────────────

const args    = process.argv.slice(2)
const EXECUTE = args.includes('--execute')
const CONFIRM = process.env[CONFIRM_KEY]

function validateCli() {
  if (!EXECUTE) {
    console.log('\n╔══════════════════════════════════════════════════════════╗')
    console.log('║  M8.4 — P1 Media Migration  [MODO PLANO / VERIFICAÇÃO]   ║')
    console.log('╚══════════════════════════════════════════════════════════╝')
    console.log('\nNenhuma escrita realizada. Nenhuma operação S3.')
    console.log('\nAllowlist: P1 apenas')
    console.log(`  P1: ${P1_ID}`)
    console.log('\nBloqueados:')
    for (const id of BLOCKED_IDS) console.log(`  ${id}`)
    console.log('\nPara executar:')
    console.log(`  ${CONFIRM_KEY}=${CONFIRM_VALUE} \\`)
    console.log('  node scripts/posts_migration_m84_execute.mjs --execute')
    console.log('')
    process.exit(0)
  }

  if (CONFIRM !== CONFIRM_VALUE) {
    console.error(`ERRO: ${CONFIRM_KEY}=${CONFIRM_VALUE} é obrigatório. Zero escrita realizada.`)
    process.exit(1)
  }

  // Rejeitar tentativas de incluir P2/P3/P4
  const extraArgs = args.filter(a => a !== '--execute' && !a.startsWith('-'))
  for (const a of extraArgs) {
    if (BLOCKED_IDS.includes(a)) {
      console.error(`ERRO: ${a} está bloqueado nesta rodada (M8.3A). Apenas P1 é permitido.`)
      process.exit(1)
    }
  }
}

// ── Main saga ─────────────────────────────────────────────────────────────────

async function main() {
  validateCli()

  console.log('\n╔══════════════════════════════════════════════════════════╗')
  console.log('║  M8.4 — P1 Media Migration  [EXECUÇÃO REAL]              ║')
  console.log('╚══════════════════════════════════════════════════════════╝')
  console.log(`\nPost alvo: P1 ${P1_ID}`)

  const { client: s3, publicBase } = buildS3Client()
  const destPublicUrl = `${publicBase.replace(/\/$/, '')}/${DEST_KEY.split('/').map(encodeURIComponent).join('/')}`

  // ── Snapshot antes ──────────────────────────────────────────────────────────

  const snapshotBefore = await takeSnapshot('ANTES')

  // ── Fingerprint pré-execução ────────────────────────────────────────────────

  console.log('\n[1/9] Fingerprint e validação da fonte')
  const postRows = await sbGet(`posts?id=eq.${P1_ID}&select=*`)
  if (postRows.length === 0) {
    console.error(`ERRO: P1 não encontrado no banco: ${P1_ID}`)
    process.exit(1)
  }
  const post = postRows[0]

  const fp = fingerprint(post)
  console.log(`  fingerprint atual:   ${fp}`)
  console.log(`  fingerprint aprovado:${APPROVED_FP}`)
  if (fp !== APPROVED_FP) {
    console.error(`ERRO: Fingerprint diverge. Fonte P1 foi alterada desde o dry-run M8.1.`)
    console.error(`  atual:   ${fp}`)
    console.error(`  aprovado:${APPROVED_FP}`)
    console.error('Abortando — nenhuma escrita realizada.')
    process.exit(1)
  }
  console.log('  ✓ Fingerprint OK')

  // Updated_at baseline
  const tsMs = ts => new Date(String(ts).replace(' ', 'T').replace(/\+00$/, '+00:00')).getTime()
  if (tsMs(post.updated_at) !== tsMs(BASELINE_UPDATED_AT)) {
    console.error(`ERRO: updated_at de P1 diverge do baseline.`)
    console.error(`  atual:   ${post.updated_at}`)
    console.error(`  baseline:${BASELINE_UPDATED_AT}`)
    console.error('Abortando — nenhuma escrita realizada.')
    process.exit(1)
  }
  console.log('  ✓ updated_at baseline OK')

  // ── Verificar estado atual (idempotência) ───────────────────────────────────

  console.log('\n[2/9] Estado atual (idempotência)')
  const state = await queryState()

  const stateLabels = {
    ec:  state.ec  ? `EC ${state.ec.id}` : 'ausente',
    cp:  state.cp  ? `CP ${state.cp.id}` : 'ausente',
    lf:  state.lf  ? `LF ${state.lf.id}` : 'ausente',
    cpm: state.cpm ? `CPM ${state.cpm.id}` : 'ausente',
  }
  console.log(`  EC:  ${stateLabels.ec}`)
  console.log(`  CP:  ${stateLabels.cp}`)
  console.log(`  LF:  ${stateLabels.lf}`)
  console.log(`  CPM: ${stateLabels.cpm}`)

  if (state.ec && state.cp && state.lf && state.cpm) {
    console.log('\n  ✓ ALREADY_MIGRATED — P1 já foi completamente migrado.')
    console.log('  Nenhuma escrita realizada.')
    const manifest = buildManifest({
      result: 'ALREADY_MIGRATED',
      post, fp, state, snapshotBefore,
      snapshotAfter: await takeSnapshot('DEPOIS'),
      s3Operations: [],
    })
    writeManifest(manifest)
    process.exit(0)
  }

  if (state.ec && !state.cp) {
    console.error('\nERRO: EC existe mas CP ausente — estado PARCIAL.')
    console.error(`  EC: ${state.ec.id}`)
    console.error('  Intervenção manual necessária antes de reexecutar.')
    process.exit(1)
  }

  if (state.ec && state.cp && !state.lf) {
    console.error('\nERRO: EC+CP existem mas LF ausente — estado PARCIAL.')
    console.error(`  EC: ${state.ec.id}, CP: ${state.cp.id}`)
    console.error('  Inspecione o banco e S3 antes de reexecutar.')
    process.exit(1)
  }

  if (state.ec && state.cp && state.lf && !state.cpm) {
    console.error('\nERRO: EC+CP+LF existem mas CPM ausente — estado PARCIAL.')
    console.error(`  EC: ${state.ec.id}, CP: ${state.cp.id}, LF: ${state.lf.id}`)
    console.error('  Inspecione o banco antes de reexecutar.')
    process.exit(1)
  }

  console.log('  ✓ Nenhuma migração prévia detectada — prosseguindo')

  // ── Validar objeto S3 de origem ─────────────────────────────────────────────

  console.log('\n[3/9] Validação S3 origem')
  console.log(`  bucket: ${SRC_BUCKET}`)
  console.log(`  key:    ${SRC_KEY}`)
  const srcHead = await s3Head(s3, SRC_BUCKET, SRC_KEY)
  if (!srcHead.exists) {
    console.error('ERRO: Objeto de origem não encontrado no S3. Abortando.')
    process.exit(1)
  }
  console.log(`  size:         ${srcHead.size} (esperado: ${SRC_EXPECTED_SIZE})`)
  console.log(`  content-type: ${srcHead.contentType} (esperado: ${SRC_EXPECTED_MIME})`)
  console.log(`  etag:         ${srcHead.etag} (esperado: ${SRC_EXPECTED_ETAG})`)

  const srcSizeOk = srcHead.size === SRC_EXPECTED_SIZE
  const srcMimeOk = srcHead.contentType === SRC_EXPECTED_MIME
  const srcEtagOk = srcHead.etag === SRC_EXPECTED_ETAG

  if (!srcSizeOk || !srcMimeOk || !srcEtagOk) {
    console.error('ERRO: Metadados do objeto de origem divergem dos valores aprovados no M8.1.')
    if (!srcSizeOk) console.error(`  size: ${srcHead.size} != ${SRC_EXPECTED_SIZE}`)
    if (!srcMimeOk) console.error(`  mime: ${srcHead.contentType} != ${SRC_EXPECTED_MIME}`)
    if (!srcEtagOk) console.error(`  etag: ${srcHead.etag} != ${SRC_EXPECTED_ETAG}`)
    console.error('Abortando — nenhuma escrita realizada.')
    process.exit(1)
  }
  console.log('  ✓ Origem validada: tamanho, MIME e ETag conferem')

  // ── Verificar colisão no destino ────────────────────────────────────────────

  console.log('\n[4/9] Verificação de colisão no destino')
  console.log(`  bucket: ${DEST_BUCKET}`)
  console.log(`  key:    ${DEST_KEY}`)
  const destHead = await s3Head(s3, DEST_BUCKET, DEST_KEY)

  if (destHead.exists) {
    // Destino existe sem LF correspondente — colisão inesperada
    console.error('ERRO: Objeto de destino já existe no S3, mas não há library_file correspondente.')
    console.error('  Possível resíduo de execução anterior interrompida.')
    console.error('  Inspecione manualmente antes de prosseguir.')
    console.error(`  key: ${DEST_KEY}`)
    console.error('Abortando — nenhuma escrita realizada.')
    process.exit(1)
  }
  console.log('  ✓ Nenhuma colisão — destino livre')

  // ── Saga de escrita ─────────────────────────────────────────────────────────

  const s3Operations = []
  let ecRow = null
  let cpRow = null
  let lfRow = null
  let cpmRow = null

  // ── ETAPA 5/9: Copiar S3 ────────────────────────────────────────────────────

  console.log('\n[5/9] Cópia S3')
  console.log(`  source: ${SRC_KEY}`)
  console.log(`  dest:   ${DEST_KEY}`)

  await s3Copy(s3, SRC_BUCKET, SRC_KEY, DEST_BUCKET, DEST_KEY)
  s3Operations.push({ op: 'COPY', src: `${SRC_BUCKET}/${SRC_KEY}`, dest: `${DEST_BUCKET}/${DEST_KEY}` })
  console.log('  ✓ CopyObject OK')

  // Verificar cópia imediatamente
  const copyHead = await s3Head(s3, DEST_BUCKET, DEST_KEY)
  if (!copyHead.exists || copyHead.size !== SRC_EXPECTED_SIZE) {
    console.error('ERRO: Verificação pós-cópia falhou.')
    console.error(`  exists: ${copyHead.exists}, size: ${copyHead.size}`)
    console.error('  Tentando compensação S3...')
    try {
      await s3Delete(s3, DEST_BUCKET, DEST_KEY)
      console.error('  ✓ Objeto de destino removido (compensação)')
    } catch (de) {
      console.error(`  ✗ Compensação S3 falhou: ${de.message}`)
      console.error(`  RESÍDUO CONHECIDO: ${DEST_BUCKET}/${DEST_KEY}`)
    }
    process.exit(1)
  }
  console.log(`  ✓ Verificação pós-cópia OK (size=${copyHead.size})`)

  // ── ETAPA 6/9: INSERT editorial_contents ────────────────────────────────────

  console.log('\n[6/9] INSERT editorial_contents')
  try {
    ecRow = await sbInsert('editorial_contents', {
      user_id:        P1_USER_ID,
      project_id:     P1_PROJECT_ID,
      production_id:  P1_PRODUCTION_ID,
      title:          post.name?.trim() ?? 'Teste Post Smoke Test 01',
      body:           post.description ?? null,
      ai_context:     post.ai_context  ?? null,
      status:         'draft',
      legacy_post_id: P1_ID,
      created_at:     post.created_at,
      updated_at:     post.updated_at,
    })
    console.log(`  ✓ EC criado: ${ecRow.id}`)
  } catch (e) {
    if (e.body && e.body.includes('23505')) {
      console.error(`  Conflito de unicidade (legacy_post_id já existe): ${e.message}`)
    } else {
      console.error(`  EC insert falhou: ${e.message}`)
    }
    console.error('\n  Compensando: DELETE S3 dest...')
    try { await s3Delete(s3, DEST_BUCKET, DEST_KEY); console.error('  ✓ S3 dest removido') }
    catch (se) { console.error(`  ✗ S3 compensação falhou: ${se.message}\n  RESÍDUO: ${DEST_KEY}`) }
    process.exit(1)
  }

  // ── ETAPA 7/9: INSERT channel_pieces ────────────────────────────────────────

  console.log('\n[7/9] INSERT channel_pieces')
  try {
    cpRow = await sbInsert('channel_pieces', {
      user_id:              P1_USER_ID,
      editorial_content_id: ecRow.id,
      channel:              'instagram',
      format:               'feed',
      title:                null,
      body:                 post.feed_text ?? null,
      cta:                  null,
      hashtags:             null,
      status:               'draft',
    })
    console.log(`  ✓ CP criado: ${cpRow.id}`)
  } catch (e) {
    console.error(`  CP insert falhou: ${e.message}`)
    console.error('\n  Compensando: DELETE EC + S3 dest...')
    try { await sbDeleteById('editorial_contents', ecRow.id); console.error(`  ✓ EC revertido: ${ecRow.id}`) }
    catch (ce) { console.error(`  ✗ DELETE EC falhou: ${ce.message}`) }
    try { await s3Delete(s3, DEST_BUCKET, DEST_KEY); console.error('  ✓ S3 dest removido') }
    catch (se) { console.error(`  ✗ S3 compensação falhou: ${se.message}\n  RESÍDUO: ${DEST_KEY}`) }
    process.exit(1)
  }

  // ── ETAPA 8/9: INSERT library_files ─────────────────────────────────────────

  console.log('\n[8/9] INSERT library_files')

  // Decisão thumbnail: null (ver comentário abaixo)
  // A thumbnail original está em posts/{image_uuid}/...-thumb.webp (namespace posts/).
  // Não copiamos a thumbnail para o namespace library/ nesta fase.
  // library_files.thumbnail_url = null é aceito pelo schema.
  const thumbnailDecision = {
    strategy: 'NULL',
    reason: 'thumbnail_url é nullable; thumbnail original preservada em posts/ namespace sem cópia adicional',
  }
  console.log(`  thumbnail_url: null (${thumbnailDecision.reason})`)

  try {
    lfRow = await sbInsert('library_files', {
      user_id:          P1_USER_ID,
      project_id:       P1_PROJECT_ID,
      folder:           '/',
      name:             DEST_FILENAME,
      kind:             'image',
      mime_type:        SRC_EXPECTED_MIME,
      file_size:        SRC_EXPECTED_SIZE,
      storage_provider: 's3',
      storage_path:     DEST_KEY,
      public_url:       destPublicUrl,
      thumbnail_url:    null,
    })
    console.log(`  ✓ LF criado: ${lfRow.id}`)
    console.log(`  storage_path: ${DEST_KEY}`)
  } catch (e) {
    console.error(`  LF insert falhou: ${e.message}`)
    console.error('\n  Compensando: DELETE CP + EC + S3 dest...')
    try { await sbDeleteById('channel_pieces', cpRow.id); console.error(`  ✓ CP revertido: ${cpRow.id}`) }
    catch (ce) { console.error(`  ✗ DELETE CP falhou: ${ce.message}`) }
    try { await sbDeleteById('editorial_contents', ecRow.id); console.error(`  ✓ EC revertido: ${ecRow.id}`) }
    catch (ce) { console.error(`  ✗ DELETE EC falhou: ${ce.message}`) }
    try { await s3Delete(s3, DEST_BUCKET, DEST_KEY); console.error('  ✓ S3 dest removido') }
    catch (se) { console.error(`  ✗ S3 compensação falhou: ${se.message}\n  RESÍDUO: ${DEST_KEY}`) }
    process.exit(1)
  }

  // ── ETAPA 9/9: INSERT channel_piece_media ───────────────────────────────────

  console.log('\n[9/9] INSERT channel_piece_media')
  try {
    cpmRow = await sbInsert('channel_piece_media', {
      user_id:         P1_USER_ID,
      channel_piece_id:cpRow.id,
      library_file_id: lfRow.id,
      image_id:        null,
      position:        0,
      role:            'primary',
      alt_text:        null,
    })
    console.log(`  ✓ CPM criado: ${cpmRow.id}`)
    console.log(`  role: primary, position: 0, library_file_id: ${lfRow.id}`)
  } catch (e) {
    console.error(`  CPM insert falhou: ${e.message}`)
    console.error('\n  Compensando: DELETE LF + CP + EC + S3 dest...')
    try { await sbDeleteById('library_files', lfRow.id); console.error(`  ✓ LF revertido: ${lfRow.id}`) }
    catch (ce) { console.error(`  ✗ DELETE LF falhou: ${ce.message}`) }
    try { await sbDeleteById('channel_pieces', cpRow.id); console.error(`  ✓ CP revertido: ${cpRow.id}`) }
    catch (ce) { console.error(`  ✗ DELETE CP falhou: ${ce.message}`) }
    try { await sbDeleteById('editorial_contents', ecRow.id); console.error(`  ✓ EC revertido: ${ecRow.id}`) }
    catch (ce) { console.error(`  ✗ DELETE EC falhou: ${ce.message}`) }
    try { await s3Delete(s3, DEST_BUCKET, DEST_KEY); console.error('  ✓ S3 dest removido') }
    catch (se) { console.error(`  ✗ S3 compensação falhou: ${se.message}\n  RESÍDUO: ${DEST_KEY}`) }
    process.exit(1)
  }

  // ── Validação pós-escrita ────────────────────────────────────────────────────

  console.log('\n[Validação pós-migração]')
  const [ecCheck, cpCheck, lfCheck, cpmCheck] = await Promise.all([
    sbGet(`editorial_contents?id=eq.${ecRow.id}&select=id,legacy_post_id,project_id,production_id,status,title`),
    sbGet(`channel_pieces?id=eq.${cpRow.id}&select=id,editorial_content_id,channel,format,status`),
    sbGet(`library_files?id=eq.${lfRow.id}&select=id,storage_path,kind,file_size`),
    sbGet(`channel_piece_media?id=eq.${cpmRow.id}&select=id,channel_piece_id,library_file_id,role,position`),
  ])

  const ec  = ecCheck[0]
  const cp  = cpCheck[0]
  const lf  = lfCheck[0]
  const cpm = cpmCheck[0]

  const checks = {
    ec_exists:            !!ec,
    ec_legacy_post_id_ok: ec?.legacy_post_id === P1_ID,
    ec_project_id_ok:     ec?.project_id === P1_PROJECT_ID,
    ec_status_draft:      ec?.status === 'draft',
    cp_exists:            !!cp,
    cp_linked_to_ec:      cp?.editorial_content_id === ecRow.id,
    cp_channel_ok:        cp?.channel === 'instagram',
    cp_format_ok:         cp?.format === 'feed',
    cp_status_draft:      cp?.status === 'draft',
    lf_exists:            !!lf,
    lf_storage_path_ok:   lf?.storage_path === DEST_KEY,
    lf_kind_image:        lf?.kind === 'image',
    lf_file_size_ok:      lf?.file_size === SRC_EXPECTED_SIZE,
    cpm_exists:           !!cpm,
    cpm_linked_to_cp:     cpm?.channel_piece_id === cpRow.id,
    cpm_linked_to_lf:     cpm?.library_file_id === lfRow.id,
    cpm_role_primary:     cpm?.role === 'primary',
    cpm_position_zero:    cpm?.position === 0,
  }

  for (const [k, v] of Object.entries(checks)) {
    console.log(`  ${v ? '✓' : '✗'} ${k}`)
  }

  const allOk = Object.values(checks).every(Boolean)
  if (!allOk) {
    console.error('\nERRO: Algumas verificações falharam. Veja acima.')
    process.exit(1)
  }
  console.log('\n  ✓ Todas as verificações passaram')

  // Verificar que posts não foram alterados
  const postsCheck = await sbGet(`posts?id=eq.${P1_ID}&select=id,status,updated_at`)
  const postIntact = postsCheck[0]
  const postIntactOk = postIntact &&
    postIntact.status === post.status &&
    tsMs(postIntact.updated_at) === tsMs(BASELINE_UPDATED_AT)
  console.log(`  ${postIntactOk ? '✓' : '✗'} post P1 intacto (status=${postIntact?.status}, updated_at inalterado)`)

  // Verificar S3 source intacto
  const srcCheckFinal = await s3Head(s3, SRC_BUCKET, SRC_KEY)
  const srcIntactOk = srcCheckFinal.exists &&
    srcCheckFinal.size === SRC_EXPECTED_SIZE &&
    srcCheckFinal.etag === SRC_EXPECTED_ETAG
  console.log(`  ${srcIntactOk ? '✓' : '✗'} S3 source intacto (exists=${srcCheckFinal.exists}, size=${srcCheckFinal.size})`)

  // Snapshot depois
  const snapshotAfter = await takeSnapshot('DEPOIS')

  console.log('\n══════════════════════════════════════════════════')
  console.log('  M8.4 P1 MIGRADO COM SUCESSO')
  console.log(`  EC:  ${ecRow.id}`)
  console.log(`  CP:  ${cpRow.id}`)
  console.log(`  LF:  ${lfRow.id}`)
  console.log(`  CPM: ${cpmRow.id}`)
  console.log('══════════════════════════════════════════════════')

  const manifest = buildManifest({
    result:         'MIGRATED',
    post, fp, state,
    ecRow, cpRow, lfRow, cpmRow,
    checks,
    thumbnailDecision,
    srcHead, copyHead,
    s3Operations,
    postIntactOk, srcIntactOk,
    destPublicUrl,
    snapshotBefore, snapshotAfter,
  })
  writeManifest(manifest)
}

// ── Manifest builder ──────────────────────────────────────────────────────────

function buildManifest(ctx) {
  const now = new Date().toISOString()
  return {
    version:     2,
    phase:       'M8.4',
    executed_at: now,
    branch:      'feat/posts-migration-m8-4-p1-media',
    base_commit: '6f8af41',
    result:      ctx.result,
    post: {
      id:         P1_ID,
      name:       ctx.post.name,
      user_id:    P1_USER_ID,
      project_id: P1_PROJECT_ID,
      fingerprint_approved: APPROVED_FP,
      fingerprint_observed: ctx.fp,
      baseline_updated_at:  BASELINE_UPDATED_AT,
    },
    s3: {
      source: {
        bucket:        SRC_BUCKET,
        key:           SRC_KEY,
        expected_size: SRC_EXPECTED_SIZE,
        expected_mime: SRC_EXPECTED_MIME,
        expected_etag: SRC_EXPECTED_ETAG,
        observed_size: ctx.srcHead?.size ?? null,
        observed_etag: ctx.srcHead?.etag ?? null,
        intact_after:  ctx.srcIntactOk  ?? null,
      },
      destination: {
        bucket:        DEST_BUCKET,
        key:           DEST_KEY,
        public_url:    ctx.destPublicUrl ?? null,
        collision_check: 'CLEAR',
        copy_verified_size: ctx.copyHead?.size ?? null,
      },
      operations: ctx.s3Operations ?? [],
    },
    ids: ctx.result === 'MIGRATED' ? {
      editorial_content_id: ctx.ecRow?.id  ?? null,
      channel_piece_id:     ctx.cpRow?.id  ?? null,
      library_file_id:      ctx.lfRow?.id  ?? null,
      channel_piece_media_id: ctx.cpmRow?.id ?? null,
    } : ctx.state ? {
      editorial_content_id: ctx.state.ec?.id  ?? null,
      channel_piece_id:     ctx.state.cp?.id  ?? null,
      library_file_id:      ctx.state.lf?.id  ?? null,
      channel_piece_media_id: ctx.state.cpm?.id ?? null,
    } : {},
    thumbnail: ctx.thumbnailDecision ?? null,
    checks:    ctx.checks     ?? null,
    snapshot_before: ctx.snapshotBefore ?? null,
    snapshot_after:  ctx.snapshotAfter  ?? null,
    rollback: {
      script:  'scripts/posts_migration_m84_rollback.mjs',
      confirm: 'POSTS_MIGRATION_M84_ROLLBACK_CONFIRM=M8_4_ROLLBACK_APPROVED',
      order:   ['channel_piece_media', 'channel_pieces', 'library_files', 'editorial_contents', 's3_dest'],
      s3_dest_key:    DEST_KEY,
      s3_source_key:  SRC_KEY,
      never_delete:  [SRC_KEY, `posts.id=${P1_ID}`],
    },
    posts_modified: false,
  }
}

function buildManifestMd(manifest) {
  const lines = []
  lines.push('# M8.4 — Execution Manifest: P1 Media Migration')
  lines.push('')
  lines.push(`**Executado em:** ${manifest.executed_at}  `)
  lines.push(`**Branch:** \`${manifest.branch}\`  `)
  lines.push(`**Base commit:** \`${manifest.base_commit}\`  `)
  lines.push(`**Resultado:** \`${manifest.result}\``)
  lines.push('')
  lines.push('---')
  lines.push('')
  lines.push('## Post P1')
  lines.push('')
  lines.push(`| Campo | Valor |`)
  lines.push(`|-------|-------|`)
  lines.push(`| post_id | \`${manifest.post.id}\` |`)
  lines.push(`| nome | ${manifest.post.name} |`)
  lines.push(`| fingerprint aprovado | \`${manifest.post.fingerprint_approved}\` |`)
  lines.push(`| fingerprint observado | \`${manifest.post.fingerprint_observed}\` |`)
  lines.push(`| match | ${manifest.post.fingerprint_approved === manifest.post.fingerprint_observed ? '✅' : '❌'} |`)
  lines.push('')
  lines.push('## S3')
  lines.push('')
  lines.push('### Origem')
  lines.push('')
  lines.push(`| Campo | Valor |`)
  lines.push(`|-------|-------|`)
  lines.push(`| bucket | \`${manifest.s3.source.bucket}\` |`)
  lines.push(`| key | \`${manifest.s3.source.key}\` |`)
  lines.push(`| tamanho esperado | ${manifest.s3.source.expected_size} |`)
  lines.push(`| tamanho observado | ${manifest.s3.source.observed_size ?? '—'} |`)
  lines.push(`| MIME esperado | ${manifest.s3.source.expected_mime} |`)
  lines.push(`| ETag esperado | \`${manifest.s3.source.expected_etag}\` |`)
  lines.push(`| ETag observado | \`${manifest.s3.source.observed_etag ?? '—'}\` |`)
  lines.push(`| intacto após migração | ${manifest.s3.source.intact_after ? '✅' : '—'} |`)
  lines.push('')
  lines.push('### Destino')
  lines.push('')
  lines.push(`| Campo | Valor |`)
  lines.push(`|-------|-------|`)
  lines.push(`| bucket | \`${manifest.s3.destination.bucket}\` |`)
  lines.push(`| key | \`${manifest.s3.destination.key}\` |`)
  lines.push(`| colisão | ${manifest.s3.destination.collision_check} |`)
  lines.push(`| tamanho verificado | ${manifest.s3.destination.copy_verified_size ?? '—'} |`)
  lines.push('')
  lines.push('## IDs criados')
  lines.push('')
  lines.push(`| Entidade | ID |`)
  lines.push(`|----------|-----|`)
  lines.push(`| editorial_content | \`${manifest.ids.editorial_content_id ?? '—'}\` |`)
  lines.push(`| channel_piece | \`${manifest.ids.channel_piece_id ?? '—'}\` |`)
  lines.push(`| library_file | \`${manifest.ids.library_file_id ?? '—'}\` |`)
  lines.push(`| channel_piece_media | \`${manifest.ids.channel_piece_media_id ?? '—'}\` |`)
  lines.push('')
  if (manifest.thumbnail) {
    lines.push('## Thumbnail')
    lines.push('')
    lines.push(`**Estratégia:** ${manifest.thumbnail.strategy}  `)
    lines.push(`**Justificativa:** ${manifest.thumbnail.reason}`)
    lines.push('')
  }
  lines.push('## Snapshots')
  lines.push('')
  if (manifest.snapshot_before) {
    lines.push('### Antes')
    lines.push('')
    const b = manifest.snapshot_before
    lines.push(`| Tabela | Count |`)
    lines.push(`|--------|-------|`)
    lines.push(`| editorial_contents (total) | ${b.editorial_contents} |`)
    lines.push(`| editorial_contents (com legacy) | ${b.ec_with_legacy} |`)
    lines.push(`| channel_pieces | ${b.channel_pieces} |`)
    lines.push(`| library_files | ${b.library_files} |`)
    lines.push(`| channel_piece_media | ${b.channel_piece_media} |`)
    lines.push(`| posts | ${b.posts} |`)
    lines.push('')
  }
  if (manifest.snapshot_after) {
    lines.push('### Depois')
    lines.push('')
    const a = manifest.snapshot_after
    lines.push(`| Tabela | Count |`)
    lines.push(`|--------|-------|`)
    lines.push(`| editorial_contents (total) | ${a.editorial_contents} |`)
    lines.push(`| editorial_contents (com legacy) | ${a.ec_with_legacy} |`)
    lines.push(`| channel_pieces | ${a.channel_pieces} |`)
    lines.push(`| library_files | ${a.library_files} |`)
    lines.push(`| channel_piece_media | ${a.channel_piece_media} |`)
    lines.push(`| posts | ${a.posts} |`)
    lines.push('')
  }
  lines.push('## Rollback')
  lines.push('')
  lines.push(`**Script:** \`${manifest.rollback.script}\`  `)
  lines.push(`**Confirmação:** \`${manifest.rollback.confirm}\`  `)
  lines.push(`**Ordem:** ${manifest.rollback.order.join(' → ')}  `)
  lines.push(`**S3 dest (apagar):** \`${manifest.rollback.s3_dest_key}\`  `)
  lines.push(`**S3 source (NUNCA apagar):** \`${manifest.rollback.s3_source_key}\``)
  lines.push('')
  lines.push(`**posts_modified:** ${manifest.posts_modified}`)
  return lines.join('\n')
}

function writeManifest(manifest) {
  const jsonStr = JSON.stringify(manifest, null, 2)
  assertNoSecrets(jsonStr)
  const mdStr = buildManifestMd(manifest)
  mkdirSync(resolve(ROOT, 'docs/migrations'), { recursive: true })
  writeFileSync(resolve(ROOT, 'docs/migrations/posts-m8-execution-m8-4.json'), jsonStr, 'utf8')
  writeFileSync(resolve(ROOT, 'docs/migrations/posts-m8-execution-m8-4.md'),   mdStr,   'utf8')
  console.log('\nManifesto:')
  console.log('  docs/migrations/posts-m8-execution-m8-4.json')
  console.log('  docs/migrations/posts-m8-execution-m8-4.md')
}

main().catch(e => { console.error('FATAL:', e.message); process.exit(1) })

#!/usr/bin/env node
/**
 * M8.1 — Dry-run determinístico da migração de Posts legados → EditorialContent
 *
 * Somente leitura. Nenhum INSERT, UPDATE, DELETE, upload ou cópia de objeto.
 * Falha com blockers se qualquer pré-condição não for satisfeita.
 * Gera: docs/migrations/posts-m8-dry-run.json
 *       docs/migrations/posts-m8-dry-run.md
 */

import { createHash }          from 'crypto'
import { readFileSync, mkdirSync, writeFileSync } from 'fs'
import { resolve, dirname }    from 'path'
import { fileURLToPath }       from 'url'

// ── Environment ──────────────────────────────────────────────────────────

const __dir = dirname(fileURLToPath(import.meta.url))
const ROOT  = resolve(__dir, '..')

function loadEnv() {
  const raw = readFileSync(resolve(ROOT, '.env.local'), 'utf8')
  return Object.fromEntries(
    raw.split('\n')
       .filter(l => l.trim() && !l.startsWith('#') && l.includes('='))
       .map(l => { const i = l.indexOf('='); const v = l.slice(i + 1).trim(); return [l.slice(0, i).trim(), v.replace(/^['"]|['"]$/g, '')] })
  )
}

const env    = loadEnv()
const get    = k => env[k] ?? ''
const SB_URL = get('SUPABASE_URL')
const SVC    = get('SUPABASE_SERVICE_ROLE_KEY')
const S3_EP  = get('S3_ENDPOINT') || 'https://s3.multihuman.com.br'
const S3_BKT = get('S3_BUCKET_NAME') || 'content-studio'
const S3_KEY = get('S3_ACCESS_KEY')
const S3_SEC = get('S3_SECRET_KEY')

if (!SB_URL || !SVC)    throw new Error('SUPABASE_URL ou SUPABASE_SERVICE_ROLE_KEY ausente no .env.local')
if (!S3_KEY || !S3_SEC) throw new Error('S3_ACCESS_KEY ou S3_SECRET_KEY ausente no .env.local')

// ── Decisions H1–H4 (applied, not reinterpreted) ────────────────────────

const DECISIONS = {
  p3_project_id:   'd0d008c3-321b-46fe-8225-2f1a68e833ec', // H1
  import_p1_media: true,                                    // H2
  migrate_all:     true,                                    // H3
  default_status:  'draft',                                 // H4
}

// ── Baseline updated_at from discovery (change detection) ────────────────

const BASELINE_UPDATED_AT = {
  'd02a9507-d6c3-4203-9939-4667a4e0f027': '2026-06-23 01:08:39.376895+00',
  '7eb9ccf4-7989-4f4b-93ba-c10df0345428': '2026-06-23 01:09:29.849458+00',
  '083a69d5-de8f-4525-b1a1-f495b6404e80': '2026-06-23 01:11:35.379153+00',
  '7aa6b5a4-8fb2-4e22-937e-82a228f87e8b': '2026-06-23 01:14:17.513899+00',
}

// ── Schema constraints (validated at runtime) ────────────────────────────

const VALID_EC_STATUS  = ['draft', 'ready', 'archived']
const VALID_CP_STATUS  = ['draft', 'ready', 'approved', 'archived']
const VALID_CP_CHANNEL = ['instagram', 'youtube', 'whatsapp', 'linkedin', 'x', 'tiktok']
const VALID_CP_FORMAT  = ['feed', 'story', 'reel', 'short', 'video_description', 'post', 'channel_message', 'carousel', 'article']
const VALID_LF_KIND    = ['image', 'video', 'audio', 'document', 'other']

// ── Channel mapping (PublicationType → channel + format) ─────────────────

const CHANNEL_MAP = {
  instagram_post:  { channel: 'instagram', format: 'feed' },
  instagram_story: { channel: 'instagram', format: 'story' },
  youtube_post:    { channel: 'youtube',   format: 'post' },
  youtube_shorts:  { channel: 'youtube',   format: 'short' },
  youtube_video:   { channel: 'youtube',   format: 'video_description' },
}

// ── Fingerprint ──────────────────────────────────────────────────────────
// Canonical JSON of migration-relevant fields, sorted alphabetically.

const FINGERPRINT_FIELDS = [
  'ai_context', 'channel', 'created_at', 'description', 'feed_text',
  'file_size',  'id',       'image_url',  'mime_type',   'name',
  'post_images','production_id','project_id','status',   'storage_path',
  'storage_provider','thumbnail_path','thumbnail_url','updated_at','user_id',
].sort()

function fingerprint(post) {
  const obj = {}
  for (const k of FINGERPRINT_FIELDS) obj[k] = post[k] ?? null
  return createHash('sha256').update(JSON.stringify(obj)).digest('hex')
}

// ── Helpers ───────────────────────────────────────────────────────────────

function sanitizeFilename(name) {
  return name
    .replace(/[^\w.\- ]/g, '-')
    .replace(/\s+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '')
}

function destStoragePath(userId, postId, filename) {
  // Deterministic, no random UUID: uses post_id as directory.
  return `users/${userId}/library/posts-migration-m8/${postId}/${filename}`
}

// ── Supabase REST (read-only) ─────────────────────────────────────────────

async function sbGet(path) {
  const res = await fetch(`${SB_URL}/rest/v1/${path}`, {
    headers: {
      apikey:        SVC,
      Authorization: `Bearer ${SVC}`,
      Accept:        'application/json',
    },
  })
  if (!res.ok) throw new Error(`Supabase GET /${path} → ${res.status}: ${await res.text()}`)
  return res.json()
}

// ── S3 HEAD check (no download) ───────────────────────────────────────────

async function s3Head(key) {
  try {
    const { S3Client, HeadObjectCommand } = await import('@aws-sdk/client-s3')
    const s3 = new S3Client({
      endpoint: S3_EP,
      region:   'us-east-1',
      credentials: { accessKeyId: S3_KEY, secretAccessKey: S3_SEC },
      forcePathStyle: true,
    })
    const res = await s3.send(new HeadObjectCommand({ Bucket: S3_BKT, Key: key }))
    return {
      exists:       true,
      content_type: res.ContentType  ?? null,
      content_length: res.ContentLength ?? null,
      etag:         res.ETag?.replace(/"/g, '') ?? null,
      error:        null,
    }
  } catch (e) {
    const notFound = e.name === 'NotFound' || e.$metadata?.httpStatusCode === 404
    return { exists: false, content_type: null, content_length: null, etag: null,
             error: notFound ? 'NotFound (404)' : e.message }
  }
}

// ── Per-post plan ─────────────────────────────────────────────────────────

async function planPost(post, { legacyColumnExists, productions, projects }) {
  const warnings = []
  const blockers  = []

  // — Change detection —
  // Normalize to millisecond precision: REST API returns ISO format with T and +00:00,
  // baseline from SQL MCP uses space and +00. Sub-microsecond representation can differ.
  const baseline = BASELINE_UPDATED_AT[post.id]
  const tsMs  = ts => new Date(String(ts).replace(' ', 'T').replace(/\+00$/, '+00:00')).getTime()
  const sourceChanged = tsMs(post.updated_at) !== tsMs(baseline)
  if (sourceChanged) {
    blockers.push(`source_changed_after_dry_run: updated_at="${post.updated_at}" (baseline="${baseline}")`)
  }

  // — Idempotency check —
  let alreadyMigrated = false
  if (legacyColumnExists) {
    try {
      const existing = await sbGet(`editorial_contents?legacy_post_id=eq.${post.id}&select=id`)
      alreadyMigrated = Array.isArray(existing) && existing.length > 0
      if (alreadyMigrated) {
        warnings.push(`Post já migrado: editorial_contents.legacy_post_id = ${post.id}`)
      }
    } catch (e) {
      warnings.push(`Idempotência: erro ao consultar EC (${e.message})`)
    }
  }

  // — Project assignment —
  const isP3 = post.id === '083a69d5-de8f-4525-b1a1-f495b6404e80'
  const effectiveProjectId = post.project_id ?? (isP3 ? DECISIONS.p3_project_id : null)
  const projectAssignment  = isP3 ? {
    original_project_id:      null,
    assigned_project_id:      DECISIONS.p3_project_id,
    project_assignment_source:'human_approved',
    project_assignment_confidence: 'confirmed',
    decision_ref:             'H1',
  } : null

  if (!effectiveProjectId) blockers.push('project_id ausente sem decisão H aplicável')

  // — Production exists —
  if (post.production_id && !productions[post.production_id]) {
    blockers.push(`Production não encontrada: ${post.production_id}`)
  }

  // — Project exists —
  if (effectiveProjectId && !projects[effectiveProjectId]) {
    blockers.push(`Project não encontrado: ${effectiveProjectId}`)
  }

  // — Channel mapping —
  const mapping = CHANNEL_MAP[post.channel]
  if (!mapping) {
    blockers.push(`Canal inválido: "${post.channel}" sem mapeamento definido`)
  }

  // — Schema constraint checks —
  const ecStatus = DECISIONS.default_status
  const cpStatus = DECISIONS.default_status
  if (!VALID_EC_STATUS.includes(ecStatus))  blockers.push(`EC status inválido: "${ecStatus}"`)
  if (!VALID_CP_STATUS.includes(cpStatus))  blockers.push(`CP status inválido: "${cpStatus}"`)
  if (mapping && !VALID_CP_CHANNEL.includes(mapping.channel)) {
    blockers.push(`channel_pieces.channel inválido: "${mapping.channel}"`)
  }
  if (mapping && !VALID_CP_FORMAT.includes(mapping.format)) {
    blockers.push(`channel_pieces.format inválido: "${mapping.format}"`)
  }

  const title = post.name?.trim() ?? ''
  if (!title)          blockers.push('title (post.name) vazio — viola CHECK char_length > 0')
  if (title.length > 500) blockers.push(`title excede 500 chars: ${title.length}`)
  if (post.description  && post.description.length  > 50000)  blockers.push(`EC body excede 50000 chars`)
  if (post.feed_text    && post.feed_text.length    > 100000) blockers.push(`CP body excede 100000 chars`)

  // — Media planning —
  const proposedMedia = []
  const hasImages = (post.post_images ?? []).length > 0
  const img0 = hasImages ? post.post_images[0] : null

  if (img0) {
    const srcKey  = img0.storagePath
    const rawName = img0.name || srcKey.split('/').pop() || 'image.png'
    const safeName = sanitizeFilename(rawName)
    const dstKey  = destStoragePath(post.user_id, post.id, safeName)
    const pubUrl  = `${S3_EP}/${S3_BKT}/${dstKey}`
    const srcUrl  = img0.imageUrl

    // HEAD source object
    const srcMeta = await s3Head(srcKey)
    if (!srcMeta.exists) {
      blockers.push(`Objeto S3 ausente: ${srcKey} — ${srcMeta.error}`)
    }

    // HEAD destination (collision detection)
    const dstMeta = await s3Head(dstKey)
    if (dstMeta.exists) {
      warnings.push(`Destino S3 já existe: ${dstKey} — possível run anterior parcial`)
    }

    const kind = (img0.mimeType ?? '').startsWith('image/') ? 'image'
               : (img0.mimeType ?? '').startsWith('video/') ? 'video'
               : (img0.mimeType ?? '').startsWith('audio/') ? 'audio'
               : 'other'
    if (!VALID_LF_KIND.includes(kind)) blockers.push(`library_files.kind inválido: "${kind}"`)

    proposedMedia.push({
      index:      0,
      action:     'IMPORT_LIBRARY_FILE_VIA_S3_COPY',
      symbolic_id: `lf:${post.id}:0`,
      source: {
        bucket:         S3_BKT,
        key:            srcKey,
        public_url:     srcUrl,
        exists:         srcMeta.exists,
        content_type:   srcMeta.content_type,
        content_length: srcMeta.content_length,
        etag:           srcMeta.etag,
        s3_error:       srcMeta.error,
      },
      destination: {
        bucket:              S3_BKT,
        key:                 dstKey,
        public_url:          pubUrl,
        destination_collision: dstMeta.exists,
      },
      proposed_library_file: {
        user_id:          post.user_id,
        project_id:       effectiveProjectId,
        folder:           '/',
        name:             safeName,
        kind:             kind,
        mime_type:        img0.mimeType || 'image/png',
        file_size:        img0.fileSize ?? null,
        storage_provider: 's3',
        storage_path:     dstKey,
        public_url:       pubUrl,
        thumbnail_url:    img0.thumbnailUrl ?? null,
        note:             'Importado de posts/ pela migration M8 — arquivo original preservado em source.key',
      },
      proposed_channel_piece_media: {
        symbolic_id:      `cpm:${post.id}:0`,
        library_file_id:  `lf:${post.id}:0`,
        image_id:         null,
        role:             'primary',
        position:         0,
        alt_text:         null,
      },
      copy_policies: {
        if_destination_already_exists:   'FAIL — exige resolução manual antes de prosseguir',
        if_copy_ok_but_lf_insert_fails:  'ROLLBACK cópia (DELETE dstKey) — nunca criar LF sem objeto',
        if_lf_insert_ok_but_cpm_fails:   'ROLLBACK LF (DELETE library_file) e cópia S3 — manter atomicidade',
      },
      rollback: {
        order:          ['channel_piece_media', 'library_files', 's3_dest_object'],
        s3_delete:      [dstKey],
        never_delete:   [srcKey],
      },
    })
  }

  // — Classification —
  const classification = []
  if (hasImages) classification.push('MIGRÁVEL COM IMPORTAÇÃO DE MÍDIA')
  else if (isP3)  classification.push('EXIGE ATRIBUIÇÃO DE PROJETO')
  else            classification.push('AUTO_MIGRÁVEL')
  classification.push('SMOKE/TESTE')

  return {
    post_id:                   post.id,
    post_name:                 post.name,
    source_fingerprint:        fingerprint(post),
    source_updated_at:         post.updated_at,
    source_changed:            sourceChanged,
    already_migrated:          alreadyMigrated,
    classification,
    ...(projectAssignment ? { project_assignment: projectAssignment } : {}),
    proposed_editorial_content: {
      symbolic_id: `ec:${post.id}`,
      fields: {
        user_id:        post.user_id,
        project_id:     effectiveProjectId,
        production_id:  post.production_id,
        title:          title,
        body:           post.description     ?? null,
        ai_context:     post.ai_context      ?? null,
        status:         ecStatus,
        legacy_post_id: post.id,
        created_at:     post.created_at,
        updated_at:     post.updated_at,
      },
    },
    proposed_channel_piece: {
      symbolic_id: `cp:${post.id}`,
      fields: {
        user_id:              post.user_id,
        editorial_content_id: `ec:${post.id}`,
        channel:              mapping?.channel ?? null,
        format:               mapping?.format  ?? null,
        title:                null,
        body:                 post.feed_text   ?? null,
        cta:                  null,
        hashtags:             null,
        status:               cpStatus,
      },
      status_note: 'CP status = draft: registros de teste (H4). Equivalência: posts.status="saved" → "approved" para conteúdo real; "draft" para teste.',
    },
    proposed_media:  proposedMedia,
    rollback_scope: {
      order:        ['channel_piece_media', 'channel_pieces', 'editorial_contents',
                     ...(hasImages ? ['library_files', 's3_objects'] : [])],
      symbolic_ids: {
        editorial_content: `ec:${post.id}`,
        channel_piece:     `cp:${post.id}`,
        channel_piece_media: proposedMedia.map(m => m.proposed_channel_piece_media.symbolic_id),
        library_files:     proposedMedia.map(m => m.symbolic_id),
        s3_objects_to_copy_then_delete: proposedMedia.map(m => m.destination.key),
      },
      never_delete: [
        `posts.id = ${post.id}`,
        ...proposedMedia.map(m => `s3://${S3_BKT}/${m.source.key}`),
      ],
    },
    warnings,
    blockers,
    dry_run_status: blockers.length > 0 ? 'BLOCKED'
                  : alreadyMigrated      ? 'ALREADY_MIGRATED'
                                         : 'READY',
  }
}

// ── Markdown report ───────────────────────────────────────────────────────

function buildMarkdown(output) {
  const lines = []
  const s = output.summary

  lines.push('# M8.1 — Dry-Run Report: Posts → EditorialContent')
  lines.push(`**Gerado em:** ${output.generated_at}  `)
  lines.push(`**Status geral:** ${s.overall_status}  `)
  lines.push(`**Posts:** ${s.total_posts} | **Blockers:** ${s.total_blockers} | **Warnings:** ${s.total_warnings}`)
  lines.push('')
  lines.push('---')
  lines.push('')
  lines.push('## Resumo')
  lines.push('')
  lines.push('| Categoria | Qtd |')
  lines.push('|-----------|-----|')
  lines.push(`| AUTO_MIGRÁVEL | ${s.auto_migravel} |`)
  lines.push(`| MIGRÁVEL COM IMPORTAÇÃO DE MÍDIA | ${s.migravelComImportacaoMidia} |`)
  lines.push(`| EXIGE ATRIBUIÇÃO DE PROJETO | ${s.exigeAtribuicaoProjeto} |`)
  lines.push(`| Já migrados (skip) | ${s.already_migrated} |`)
  lines.push(`| Total blockers | ${s.total_blockers} |`)
  lines.push(`| Total warnings | ${s.total_warnings} |`)
  lines.push('')
  lines.push(`**Decisões aplicadas:** H1=${output.decisions.p3_project_id} · H2=import_media=${output.decisions.import_p1_media} · H3=migrate_all=${output.decisions.migrate_all} · H4=status=${output.decisions.default_status}`)
  lines.push('')
  lines.push('---')
  lines.push('')
  lines.push('## Plano por Post')
  lines.push('')
  lines.push('| Post | Projeto | Production | Canal | Formato | EC proposto | CP proposta | Mídias | Ações | Blockers | Status |')
  lines.push('|------|---------|------------|-------|---------|-------------|-------------|--------|-------|----------|--------|')

  for (const p of output.posts) {
    const ec    = p.proposed_editorial_content.fields
    const cp    = p.proposed_channel_piece.fields
    const media = p.proposed_media.length > 0 ? `${p.proposed_media.length} (import LF)` : '0'
    const bloc  = p.blockers.length  > 0 ? p.blockers.map(b => `⛔ ${b}`).join('<br>') : '—'
    const acoes = p.proposed_media.length > 0 ? 'CopiarS3 + ImportLF + CPM' : 'Direto'
    const proj  = ec.project_id?.slice(0, 8) ?? 'NULL'
    const prod  = ec.production_id?.slice(0, 8)
    lines.push(`| ${p.post_name?.slice(0, 22)} | ${proj} | ${prod} | ${cp.channel} | ${cp.format} | ${p.proposed_editorial_content.symbolic_id} | ${p.proposed_channel_piece.symbolic_id} | ${media} | ${acoes} | ${bloc} | **${p.dry_run_status}** |`)
  }

  lines.push('')
  lines.push('---')
  lines.push('')

  for (const p of output.posts) {
    lines.push(`## Post: ${p.post_name} (${p.post_id})`)
    lines.push('')
    lines.push(`**Classificação:** ${p.classification.join(', ')}  `)
    lines.push(`**Fingerprint:** \`${p.source_fingerprint}\`  `)
    lines.push(`**updated_at:** ${p.source_updated_at}  `)
    lines.push(`**Origem alterada:** ${p.source_changed}  `)
    lines.push(`**Já migrado:** ${p.already_migrated}  `)
    lines.push(`**Status dry-run:** **${p.dry_run_status}**`)
    lines.push('')

    if (p.project_assignment) {
      const pa = p.project_assignment
      lines.push(`> **H1 aplicada:** project_id original = null → atribuído \`${pa.assigned_project_id}\` (source: ${pa.project_assignment_source}, confiança: ${pa.project_assignment_confidence})`)
      lines.push('')
    }

    const ec = p.proposed_editorial_content.fields
    lines.push('**EditorialContent proposto:**')
    lines.push('```')
    lines.push(`  symbolic_id:   ${p.proposed_editorial_content.symbolic_id}`)
    lines.push(`  title:         "${ec.title}"`)
    lines.push(`  status:        ${ec.status}`)
    lines.push(`  project_id:    ${ec.project_id}`)
    lines.push(`  production_id: ${ec.production_id}`)
    lines.push(`  body:          ${ec.body ? `"${ec.body.slice(0, 60)}…"` : 'null'}`)
    lines.push(`  ai_context:    ${ec.ai_context ? `"${ec.ai_context}"` : 'null'}`)
    lines.push(`  legacy_post_id: ${ec.legacy_post_id}`)
    lines.push('```')
    lines.push('')

    const cp = p.proposed_channel_piece.fields
    lines.push('**ChannelPiece proposta:**')
    lines.push('```')
    lines.push(`  symbolic_id: ${p.proposed_channel_piece.symbolic_id}`)
    lines.push(`  channel:     ${cp.channel}`)
    lines.push(`  format:      ${cp.format}`)
    lines.push(`  status:      ${cp.status}`)
    lines.push(`  body:        ${cp.body ? `"${cp.body.slice(0, 60)}…"` : 'null'}`)
    lines.push('```')
    lines.push(`*${p.proposed_channel_piece.status_note}*`)
    lines.push('')

    if (p.proposed_media.length > 0) {
      const m = p.proposed_media[0]
      lines.push('**Plano de mídia (P1):**')
      lines.push('')
      lines.push(`| Campo | Valor |`)
      lines.push(`|-------|-------|`)
      lines.push(`| Ação | ${m.action} |`)
      lines.push(`| Origem (bucket) | ${m.source.bucket} |`)
      lines.push(`| Origem (key) | \`${m.source.key}\` |`)
      lines.push(`| Origem existe? | ${m.source.exists} |`)
      lines.push(`| Origem Content-Type | ${m.source.content_type ?? 'n/d'} |`)
      lines.push(`| Origem tamanho | ${m.source.content_length ?? 'n/d'} bytes |`)
      lines.push(`| Origem ETag | ${m.source.etag ?? 'n/d'} |`)
      lines.push(`| Destino (key) | \`${m.destination.key}\` |`)
      lines.push(`| Destino existe? | ${m.destination.destination_collision} |`)
      lines.push(`| public_url destino | ${m.destination.public_url} |`)
      lines.push(`| kind | ${m.proposed_library_file.kind} |`)
      lines.push(`| mime_type | ${m.proposed_library_file.mime_type} |`)
      lines.push(`| file_size | ${m.proposed_library_file.file_size ?? 'n/d'} |`)
      lines.push(`| LF simbólico | ${m.symbolic_id} |`)
      lines.push(`| CPM simbólico | ${m.proposed_channel_piece_media.symbolic_id} |`)
      lines.push(`| role | ${m.proposed_channel_piece_media.role} |`)
      lines.push(`| position | ${m.proposed_channel_piece_media.position} |`)
      lines.push('')
      lines.push('Políticas de rollback de mídia:')
      lines.push(`- Se destino já existe: ${m.copy_policies.if_destination_already_exists}`)
      lines.push(`- Se cópia OK mas LF INSERT falha: ${m.copy_policies.if_copy_ok_but_lf_insert_fails}`)
      lines.push(`- Se LF OK mas CPM falha: ${m.copy_policies.if_lf_insert_ok_but_cpm_fails}`)
      lines.push('')
    }

    if (p.warnings.length > 0) {
      lines.push('**Warnings:**')
      p.warnings.forEach(w => lines.push(`- ⚠️ ${w}`))
      lines.push('')
    }
    if (p.blockers.length > 0) {
      lines.push('**Blockers:**')
      p.blockers.forEach(b => lines.push(`- ⛔ ${b}`))
      lines.push('')
    }
  }

  lines.push('---')
  lines.push('')
  lines.push('## Rastreabilidade recomendada')
  lines.push('')
  lines.push('**Coluna:** `editorial_contents.legacy_post_id UUID NULL`')
  lines.push('')
  lines.push('**Tipo UUID em vez de TEXT:** `posts.id` é UUID — manter o mesmo tipo preserva')
  lines.push('  integridade semântica e permite comparação eficiente sem cast.')
  lines.push('')
  lines.push('**Índice:**')
  lines.push('```sql')
  lines.push('CREATE UNIQUE INDEX idx_ec_legacy_post_id')
  lines.push('  ON editorial_contents (legacy_post_id)')
  lines.push('  WHERE legacy_post_id IS NOT NULL;')
  lines.push('```')
  lines.push('')
  lines.push('**`legacy_source` é desnecessário nesta migration:** só existe uma fonte legada.')
  lines.push('  Generalização prematura. Adicionar apenas se surgir segunda fonte.')
  lines.push('')
  lines.push('---')
  lines.push('')
  lines.push('## Idempotência')
  lines.push('')
  lines.push('**Chave:** `editorial_contents.legacy_post_id = posts.id`')
  lines.push('')
  lines.push('**Algoritmo da execução real:**')
  lines.push('1. Para cada `posts.id` no lote: `SELECT id FROM editorial_contents WHERE legacy_post_id = $1`')
  lines.push('2. Se retornar registro: **pular** — já migrado, registrar skip')
  lines.push('3. Se retornar múltiplos: **FAIL** — inconsistência, exige intervenção manual')
  lines.push('4. Se não retornar: prosseguir com INSERT')
  lines.push('')
  lines.push('**Para mídia importada:** verificar se `library_files.storage_path = dest_key` já existe.')
  lines.push('  Se sim e LF.user_id bate: assumir idempotente. Se não bate: FAIL.')
  lines.push('')
  lines.push('---')
  lines.push('')
  lines.push('## Rollback completo')
  lines.push('')
  lines.push('```sql')
  lines.push('BEGIN;')
  lines.push('')
  lines.push('  -- 1. Remover CPMs criados pela migração')
  lines.push('  DELETE FROM channel_piece_media')
  lines.push('  WHERE channel_piece_id IN (')
  lines.push('    SELECT id FROM channel_pieces')
  lines.push('    WHERE editorial_content_id IN (')
  lines.push('      SELECT id FROM editorial_contents WHERE legacy_post_id IS NOT NULL')
  lines.push('    )')
  lines.push('  );')
  lines.push('')
  lines.push('  -- 2. Remover CPs criadas pela migração')
  lines.push('  DELETE FROM channel_pieces')
  lines.push('  WHERE editorial_content_id IN (')
  lines.push('    SELECT id FROM editorial_contents WHERE legacy_post_id IS NOT NULL')
  lines.push('  );')
  lines.push('')
  lines.push('  -- 3. Remover ECs criados pela migração')
  lines.push('  DELETE FROM editorial_contents WHERE legacy_post_id IS NOT NULL;')
  lines.push('')
  lines.push('  -- 4. Remover LFs importados pela migração (apenas os do M8)')
  lines.push("  DELETE FROM library_files")
  lines.push("  WHERE storage_path LIKE 'users/%/library/posts-migration-m8/%';")
  lines.push('')
  lines.push('COMMIT;')
  lines.push('')
  lines.push('-- 5. S3: deletar objetos em users/*/library/posts-migration-m8/* (fora de transação)')
  lines.push('-- Nunca deletar users/*/posts/* (objetos originais)')
  lines.push('-- Nunca deletar posts.* (tabela source)')
  lines.push('```')
  lines.push('')
  lines.push('---')
  lines.push('')
  lines.push('## Aprovação individual')
  lines.push('')
  lines.push('Cada Post deve ser aprovado individualmente antes de prosseguir com M8.2+.')
  lines.push('')
  lines.push('| Post | Name | Fingerprint | Status | Decisão |')
  lines.push('|------|------|-------------|--------|---------|')

  for (const p of output.posts) {
    const status = p.dry_run_status === 'READY' ? '✅ READY' :
                   p.dry_run_status === 'BLOCKED' ? '❌ BLOCKED' : '⏭️ ALREADY_MIGRATED'
    lines.push(`| ${p.post_id.slice(0, 8)} | ${p.post_name?.slice(0, 30)} | \`${p.source_fingerprint.slice(0, 12)}...\` | ${status} | **APPROVE / REJECT** |`)
  }

  lines.push('')
  lines.push('**Nota:** APPROVE/REJECT acima são campos a preencher pelo responsável. O dry-run não aprova automaticamente.')
  lines.push('')
  lines.push('---')
  lines.push('')
  lines.push(`*Gerado por scripts/posts_migration_dry_run.mjs — M8.1 Dry-Run — ${new Date().toISOString().slice(0, 10)}*`)

  return lines.join('\n')
}

// ── Determinism check ─────────────────────────────────────────────────────

function assertNoSecrets(jsonStr) {
  const checks = [SVC, S3_SEC, S3_KEY]
  for (const secret of checks) {
    if (secret && jsonStr.includes(secret)) {
      throw new Error('SEGURANÇA: output contém secret — abortado. Verificar código.')
    }
  }
}

// ── Main ──────────────────────────────────────────────────────────────────

async function main() {
  const generatedAt = new Date().toISOString()
  console.log('='.repeat(62))
  console.log('  M8.1 — Dry-run determinístico — Posts → EditorialContent')
  console.log('  Modo: SOMENTE LEITURA — nenhuma escrita no banco ou S3')
  console.log('='.repeat(62))
  console.log()

  // 1. Read posts
  const posts = await sbGet('posts?select=*&order=created_at.asc')
  console.log(`Posts lidos: ${posts.length}`)

  if (posts.length > 4) {
    throw new Error(`BLOCKER: ${posts.length} Posts encontrados — esperados exatamente 4. Revisar antes de continuar.`)
  }
  if (posts.length < 4) {
    console.warn(`AVISO: apenas ${posts.length} Posts encontrados — esperados 4.`)
  }

  // 2. Verify productions (read)
  const prodIds = [...new Set(posts.map(p => p.production_id).filter(Boolean))]
  const productions = {}
  for (const id of prodIds) {
    const [prod] = await sbGet(`productions?id=eq.${id}&select=id,title,project_id`)
    if (!prod) throw new Error(`Production não encontrada: ${id}`)
    productions[id] = prod
    console.log(`✓ Production: ${prod.title} (${id})`)
  }

  // 3. Verify projects (read)
  const projIds = [...new Set([
    ...posts.map(p => p.project_id).filter(Boolean),
    DECISIONS.p3_project_id,
  ])]
  const projects = {}
  for (const id of projIds) {
    const [proj] = await sbGet(`projects?id=eq.${id}&select=id,name`)
    if (!proj) throw new Error(`Project não encontrado: ${id}`)
    projects[id] = proj
    console.log(`✓ Project: ${proj.name} (${id})`)
  }

  // 4. Check if legacy_post_id column already exists (M8.2 state)
  let legacyColumnExists = false
  try {
    // Try a query that would fail if the column doesn't exist
    await sbGet('editorial_contents?legacy_post_id=eq.test-probe&select=id&limit=0')
    legacyColumnExists = true
  } catch {
    // Column doesn't exist yet — expected at M8.1 stage
    legacyColumnExists = false
  }
  console.log(`Coluna legacy_post_id: ${legacyColumnExists ? '✓ EXISTE' : '— ausente (M8.2 não executado ainda)'}`)
  console.log()

  // 5. Plan each post
  const postPlans = []
  for (const post of posts) {
    process.stdout.write(`Planejando: ${post.name} ... `)
    const plan = await planPost(post, { legacyColumnExists, productions, projects })
    postPlans.push(plan)
    const icon = plan.dry_run_status === 'READY' ? '✓' : plan.dry_run_status === 'ALREADY_MIGRATED' ? '⏭' : '✗'
    console.log(`${icon} ${plan.dry_run_status}`)
    if (plan.blockers.length) plan.blockers.forEach(b => console.log(`  ⛔ ${b}`))
    if (plan.warnings.length) plan.warnings.forEach(w => console.log(`  ⚠ ${w}`))
  }

  // 6. Build summary
  const totalBlockers = postPlans.reduce((n, p) => n + p.blockers.length, 0)
  const totalWarnings = postPlans.reduce((n, p) => n + p.warnings.length, 0)

  const summary = {
    total_posts:                    posts.length,
    auto_migravel:                  postPlans.filter(p => p.classification.includes('AUTO_MIGRÁVEL')).length,
    migravelComImportacaoMidia:     postPlans.filter(p => p.classification.includes('MIGRÁVEL COM IMPORTAÇÃO DE MÍDIA')).length,
    exigeAtribuicaoProjeto:         postPlans.filter(p => p.classification.includes('EXIGE ATRIBUIÇÃO DE PROJETO')).length,
    already_migrated:               postPlans.filter(p => p.already_migrated).length,
    total_warnings:                 totalWarnings,
    total_blockers:                 totalBlockers,
    overall_status:                 totalBlockers === 0 ? 'READY' : 'BLOCKED',
  }

  const output = {
    version:      1,
    generated_at: generatedAt,
    source:       { table: 'posts', count: posts.length },
    decisions:    DECISIONS,
    schema_state: {
      legacy_post_id_column_exists: legacyColumnExists,
      note: legacyColumnExists
        ? 'M8.2 executado — coluna presente'
        : 'M8.2 pendente — coluna ausente, already_migrated=false para todos',
    },
    rastreabilidade: {
      recommended_column:     'editorial_contents.legacy_post_id UUID NULL',
      type:                   'UUID (não TEXT) — posts.id é UUID, sem cast necessário',
      index:                  'UNIQUE WHERE legacy_post_id IS NOT NULL',
      legacy_source_column:   'Desnecessário — única fonte legada. Generalização prematura.',
    },
    summary,
    posts: postPlans,
  }

  // 7. Safety check
  const jsonStr = JSON.stringify(output, null, 2)
  assertNoSecrets(jsonStr)

  // 8. Write output files
  mkdirSync(resolve(ROOT, 'docs/migrations'), { recursive: true })

  const jsonPath = resolve(ROOT, 'docs/migrations/posts-m8-dry-run.json')
  const mdPath   = resolve(ROOT, 'docs/migrations/posts-m8-dry-run.md')

  writeFileSync(jsonPath, jsonStr, 'utf8')
  writeFileSync(mdPath, buildMarkdown(output), 'utf8')

  console.log()
  console.log(`JSON: docs/migrations/posts-m8-dry-run.json`)
  console.log(`MD:   docs/migrations/posts-m8-dry-run.md`)
  console.log()
  console.log('='.repeat(62))
  console.log(`  RESULTADO: ${summary.overall_status}`)
  console.log(`  Posts: ${posts.length}  Blockers: ${totalBlockers}  Warnings: ${totalWarnings}`)
  console.log('='.repeat(62))

  if (totalBlockers > 0) {
    console.error('\nDry-run BLOQUEADO. Resolva os blockers antes de executar M8.2.')
    process.exit(1)
  }

  console.log('\nDry-run APROVADO. Revisar docs/migrations/posts-m8-dry-run.md e aprovar P1–P4 individualmente.')
}

main().catch(e => {
  console.error('\nERRO FATAL:', e.message)
  process.exit(2)
})

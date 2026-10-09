#!/usr/bin/env node
/**
 * M10-A Rollback — Desfaz a Production de Arquivo: Alquimia Cibernética
 *
 * Lê o manifesto docs/migrations/project-archive-m10a.json e:
 *   1. Restaura production_id = NULL nos 6 drafts atribuídos pelo M10-A
 *   2. Exclui a Production de Arquivo SOMENTE se:
 *      - foi criada pelo M10-A (não reutilizada)
 *      - ficou vazia após o rollback dos drafts
 *      - não recebeu nenhum outro registro entre a execução e agora
 *
 * Nunca altera ou exclui:
 *   - images, videos, cenas, LibraryFiles ou objetos S3
 *   - os 3 registros de teste (não estão no manifesto)
 *
 * Para executar:
 *   PROJECT_ARCHIVE_ROLLBACK_CONFIRM=M10A_ROLLBACK_APPROVED \
 *   node scripts/project_archive_production_m10a_rollback.mjs --execute
 */

import { readFileSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath }    from 'url'
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
const SB_URL = get('SUPABASE_URL') || get('NEXT_PUBLIC_SUPABASE_URL')
const SVC    = get('SUPABASE_SERVICE_ROLE_KEY')

if (!SB_URL || !SVC) throw new Error('SUPABASE_URL ou SUPABASE_SERVICE_ROLE_KEY ausente no .env.local')
adminGuard.requireAdminAck({ script: 'project_archive_production_m10a_rollback.mjs', target: SB_URL })

const BASE_URL = SB_URL.replace(/\/$/, '')

// ── CLI ───────────────────────────────────────────────────────────────────

const args    = process.argv.slice(2)
const EXECUTE = args.includes('--execute')
const CONFIRM = process.env.PROJECT_ARCHIVE_ROLLBACK_CONFIRM

// ── Security ──────────────────────────────────────────────────────────────

function assertNoSecrets(str) {
  if (SVC && str.includes(SVC)) throw new Error('SEGURANÇA: output contém service_role key')
}

// ── REST helpers ──────────────────────────────────────────────────────────

const HDR = {
  apikey:        SVC,
  Authorization: `Bearer ${SVC}`,
  'Content-Type': 'application/json',
  Prefer:        'return=representation',
}

async function sbGet(path) {
  const res = await fetch(`${BASE_URL}/rest/v1/${path}`, {
    headers: { ...HDR, Accept: 'application/json' },
  })
  const text = await res.text()
  assertNoSecrets(text)
  if (!res.ok) throw new Error(`GET ${path} → ${res.status}: ${text}`)
  return JSON.parse(text)
}

async function sbPatch(path, body) {
  const res = await fetch(`${BASE_URL}/rest/v1/${path}`, {
    method:  'PATCH',
    headers: HDR,
    body:    JSON.stringify(body),
  })
  const text = await res.text()
  assertNoSecrets(text)
  if (!res.ok) throw new Error(`PATCH ${path} → ${res.status}: ${text}`)
  return JSON.parse(text)
}

async function sbDelete(path) {
  const res = await fetch(`${BASE_URL}/rest/v1/${path}`, {
    method:  'DELETE',
    headers: HDR,
  })
  const text = await res.text()
  assertNoSecrets(text)
  if (!res.ok) throw new Error(`DELETE ${path} → ${res.status}: ${text}`)
  return text ? JSON.parse(text) : []
}

// ── Log ───────────────────────────────────────────────────────────────────

function log(msg) { console.log(msg) }
function ok(msg)  { console.log(`  ✓ ${msg}`) }
function warn(msg){ console.log(`  ⚠ ${msg}`) }
function fail(msg){ console.error(`  ✗ ${msg}`) }

// ── Main ──────────────────────────────────────────────────────────────────

async function main() {
  log('='.repeat(60))
  log('M10-A ROLLBACK — Desfaz Production de Arquivo')
  log(`Modo: ${EXECUTE ? 'EXECUÇÃO' : 'DRY-RUN (zero escrita)'}`)
  log('='.repeat(60))

  if (EXECUTE && CONFIRM !== 'M10A_ROLLBACK_APPROVED') {
    throw new Error(
      'ROLLBACK BLOQUEADO: defina PROJECT_ARCHIVE_ROLLBACK_CONFIRM=M10A_ROLLBACK_APPROVED para prosseguir.'
    )
  }

  // ── Ler manifesto ──────────────────────────────────────────────────────
  const manifestPath = resolve(ROOT, 'docs', 'migrations', 'project-archive-m10a.json')
  let manifest
  try {
    manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
  } catch {
    throw new Error(`Manifesto não encontrado: ${manifestPath} — execute o M10-A primeiro`)
  }

  if (!manifest.m10a) throw new Error('Manifesto inválido: campo m10a ausente')

  const productionId     = manifest.production.id
  const productionTitle  = manifest.production.title
  const wasCreatedByM10A = manifest.production.was === 'created'
  const imageDraftIds    = manifest.assigned.image_draft_ids
  const videoDraftIds    = manifest.assigned.video_draft_ids

  log(`\nManifesto carregado: ${manifestPath}`)
  log(`  Production ID:    ${productionId}`)
  log(`  Production title: ${productionTitle}`)
  log(`  Foi criada pelo M10-A: ${wasCreatedByM10A}`)
  log(`  ImageDrafts a restaurar: ${imageDraftIds.length}`)
  log(`  VideoDrafts a restaurar: ${videoDraftIds.length}`)

  // ── Verificar Production no banco ─────────────────────────────────────
  log('\n[PRÉ-CONDIÇÃO] Verificando Production no banco...')
  const prodRows = await sbGet(`productions?id=eq.${productionId}&select=id,title,type`)
  if (!prodRows.length) {
    warn(`Production ${productionId} não encontrada no banco — pode já ter sido removida`)
  } else {
    ok(`Production encontrada: "${prodRows[0].title}"`)
  }

  // ── Verificar estado dos drafts ────────────────────────────────────────
  log('\n[PRÉ-CONDIÇÃO] Verificando estado atual dos drafts...')
  for (const id of imageDraftIds) {
    const rows = await sbGet(`image_drafts?id=eq.${id}&select=id,production_id,user_input`)
    if (!rows.length) { warn(`ImageDraft ${id} não encontrado`); continue }
    const current = rows[0].production_id
    if (current === productionId) {
      ok(`ImageDraft ${id.slice(0,8)}… atribuído à Production de Arquivo — será restaurado`)
    } else if (current === null) {
      ok(`ImageDraft ${id.slice(0,8)}… já com production_id=null (idempotente)`)
    } else {
      warn(`ImageDraft ${id.slice(0,8)}… está atribuído a Production diferente: ${current} — será ignorado no rollback`)
    }
  }
  for (const id of videoDraftIds) {
    const rows = await sbGet(`video_drafts?id=eq.${id}&select=id,production_id,name`)
    if (!rows.length) { warn(`VideoDraft ${id} não encontrado`); continue }
    const current = rows[0].production_id
    if (current === productionId) {
      ok(`VideoDraft ${id.slice(0,8)}… atribuído à Production de Arquivo — será restaurado`)
    } else if (current === null) {
      ok(`VideoDraft ${id.slice(0,8)}… já com production_id=null (idempotente)`)
    } else {
      warn(`VideoDraft ${id.slice(0,8)}… está em outra Production: ${current} — ignorado`)
    }
  }

  // ── Verificar se Production tem outros registros ───────────────────────
  log('\n[PRÉ-CONDIÇÃO] Verificando outros registros na Production...')
  const extraImages = await sbGet(`image_drafts?production_id=eq.${productionId}&select=id&id=not.in.(${imageDraftIds.map(i=>`"${i}"`).join(',')})`)
  const extraVideos = await sbGet(`video_drafts?production_id=eq.${productionId}&select=id&id=not.in.(${videoDraftIds.map(i=>`"${i}"`).join(',')})`)
  const extraECs    = await sbGet(`editorial_contents?production_id=eq.${productionId}&select=id`)

  const hasExtraRecords = extraImages.length > 0 || extraVideos.length > 0 || extraECs.length > 0

  if (hasExtraRecords) {
    warn(`Production tem registros adicionais além dos atribuídos pelo M10-A:`)
    if (extraImages.length) warn(`  ${extraImages.length} ImageDraft(s) extras`)
    if (extraVideos.length) warn(`  ${extraVideos.length} VideoDraft(s) extras`)
    if (extraECs.length)    warn(`  ${extraECs.length} EditorialContent(s)`)
    warn(`  Production NÃO será excluída — apenas os drafts do M10-A serão desvinculados`)
  } else {
    ok('Production ficará vazia após rollback dos drafts')
  }

  // ── DRY-RUN encerra aqui ───────────────────────────────────────────────

  if (!EXECUTE) {
    log('\n' + '─'.repeat(60))
    log('DRY-RUN de rollback concluído — nenhuma escrita realizada.')
    log('Para executar o rollback:')
    log('  PROJECT_ARCHIVE_ROLLBACK_CONFIRM=M10A_ROLLBACK_APPROVED node scripts/project_archive_production_m10a_rollback.mjs --execute')
    log('─'.repeat(60))
    return
  }

  // ── EXECUÇÃO DO ROLLBACK ───────────────────────────────────────────────

  // 1. Restaurar production_id = NULL nos ImageDrafts
  log('\n[ROLLBACK] Restaurando production_id = NULL nos ImageDrafts...')
  for (const id of imageDraftIds) {
    const rows = await sbGet(`image_drafts?id=eq.${id}&select=id,production_id`)
    if (!rows.length) { warn(`ImageDraft ${id} não encontrado — pulando`); continue }
    if (rows[0].production_id !== productionId) { warn(`ImageDraft ${id} não está na Production de Arquivo — pulando`); continue }
    await sbPatch(`image_drafts?id=eq.${id}`, { production_id: null })
    ok(`ImageDraft ${id.slice(0,8)}… restaurado (production_id=null)`)
  }

  // 2. Restaurar production_id = NULL nos VideoDrafts
  log('\n[ROLLBACK] Restaurando production_id = NULL nos VideoDrafts...')
  for (const id of videoDraftIds) {
    const rows = await sbGet(`video_drafts?id=eq.${id}&select=id,production_id`)
    if (!rows.length) { warn(`VideoDraft ${id} não encontrado — pulando`); continue }
    if (rows[0].production_id !== productionId) { warn(`VideoDraft ${id} não está na Production de Arquivo — pulando`); continue }
    await sbPatch(`video_drafts?id=eq.${id}`, { production_id: null })
    ok(`VideoDraft ${id.slice(0,8)}… restaurado (production_id=null)`)
  }

  // 3. Excluir Production (se foi criada pelo M10-A e ficou vazia)
  if (wasCreatedByM10A && !hasExtraRecords) {
    log('\n[ROLLBACK] Verificando se Production está vazia...')
    const remainingImages = await sbGet(`image_drafts?production_id=eq.${productionId}&select=id`)
    const remainingVideos = await sbGet(`video_drafts?production_id=eq.${productionId}&select=id`)
    const remainingECs    = await sbGet(`editorial_contents?production_id=eq.${productionId}&select=id`)
    const isEmpty = remainingImages.length === 0 && remainingVideos.length === 0 && remainingECs.length === 0

    if (isEmpty) {
      log('[ROLLBACK] Excluindo Production de Arquivo (vazia, criada pelo M10-A)...')
      await sbDelete(`productions?id=eq.${productionId}`)
      ok(`Production ${productionId} excluída`)
    } else {
      warn(`Production não está vazia — não será excluída`)
      warn(`  Imagens: ${remainingImages.length}, Vídeos: ${remainingVideos.length}, ECs: ${remainingECs.length}`)
    }
  } else if (!wasCreatedByM10A) {
    ok(`Production foi reutilizada (não criada pelo M10-A) — não será excluída`)
  } else {
    ok(`Production tinha outros registros — não será excluída`)
  }

  log('\n' + '='.repeat(60))
  log('M10-A ROLLBACK CONCLUÍDO')
  log('  production_id = NULL restaurado nos 6 drafts do M10-A')
  log('  Registros de teste: não alterados')
  log('  S3, images, library_files: não alterados')
  log('='.repeat(60))
}

main().catch(err => {
  fail(String(err))
  process.exit(1)
})

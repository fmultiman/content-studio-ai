#!/usr/bin/env node
/**
 * M10-A — Production de Arquivo: Alquimia Cibernética
 *
 * Cria a Production "Arquivo — Alquimia Cibernética" e atribui
 * somente os 6 drafts históricos com conteúdo real a ela.
 *
 * Os 3 registros de teste são explicitamente rejeitados pela allowlist
 * e permanecem com production_id = NULL.
 *
 * Modo padrão: dry-run (zero escrita).
 *
 * Para executar:
 *   PROJECT_ARCHIVE_CONFIRM=M10A_APPROVED \
 *   node scripts/project_archive_production_m10a.mjs --execute
 */

import { readFileSync, mkdirSync, writeFileSync } from 'fs'
import { resolve, dirname }                       from 'path'
import { fileURLToPath }                          from 'url'
import adminGuard from './lib/production-admin-guard.cjs'

// ── Paths ──────────────────────────────────────────────────────────────────

const __dir = dirname(fileURLToPath(import.meta.url))
const ROOT  = resolve(__dir, '..')

// ── Constantes de domínio ─────────────────────────────────────────────────

const PROJECT_ID = '0b04df8b-dfd3-45c5-b7b7-8fe7b95e8187'  // Alquimia Cibernética
const USER_ID    = '35428fd4-4784-4934-9af9-82a606aad77e'

const PRODUCTION_TITLE     = 'Arquivo — Alquimia Cibernética'
const PRODUCTION_TYPE      = 'editorial'
const PRODUCTION_INTENTION =
  'Production de arquivo criada para preservar e organizar drafts históricos ' +
  'produzidos antes da consolidação do workspace por Production.'

// ── Allowlist explícita — somente drafts com conteúdo real ───────────────

const REAL_IMAGE_DRAFT_IDS = [
  'c44bf448-350d-4a3f-833b-8d00f5a9f0b0',  // "Um símbolo mágico"
  '97508404-c5a9-4d30-ac0a-ac5b7ae0706d',  // "Uma floresta vista do alto..."
  'e624d457-b632-45f6-902e-d2598d84f6d9',  // "Criar um objeto mágico"
  '0eb2a983-4354-451a-8038-fd3f502c2413',  // "Uma imagem sobre Alquimia Cibernética"
]

const REAL_VIDEO_DRAFT_IDS = [
  'f1029001-2adf-491f-8063-1c2c9c12ab85',  // "aluimia01" — 2 cenas
  'd46d2259-83d8-4633-a040-92a3a64316d7',  // "teste3" — 2 cenas
]

// ── Registros de teste (explicitamente rejeitados) ────────────────────────

const TEST_DRAFT_IDS = new Set([
  'd52b83b6-cf1c-4d83-9491-df0d6408c933',  // ImageDraft "uma montanha antiga" (sem imagem)
  '8c5bbdb7-e864-4cfe-8745-63e1030be9cd',  // ImageDraft "consciência e tecnologia" (sem imagem)
  '0bc4324c-94f0-41d7-af50-93827ee4da13',  // VideoDraft "testevideo" (1 cena)
])

const ALL_KNOWN_IDS = new Set([
  ...REAL_IMAGE_DRAFT_IDS,
  ...REAL_VIDEO_DRAFT_IDS,
  ...TEST_DRAFT_IDS,
])

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

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
const SVC    = get('SUPABASE_SECRET_KEY') || get('SUPABASE_SERVICE_ROLE_KEY')

if (!SB_URL || !SVC) throw new Error('SUPABASE_URL/NEXT_PUBLIC_SUPABASE_URL ou SUPABASE_SECRET_KEY (ou SUPABASE_SERVICE_ROLE_KEY legado) ausente no .env.local')
adminGuard.requireAdminAck({ script: 'project_archive_production_m10a.mjs', target: SB_URL })

const BASE_URL = SB_URL.replace(/\/$/, '')

// ── CLI ───────────────────────────────────────────────────────────────────

const args    = process.argv.slice(2)
const EXECUTE = args.includes('--execute')
const CONFIRM = process.env.PROJECT_ARCHIVE_CONFIRM

// ── Security ──────────────────────────────────────────────────────────────

function assertNoSecrets(str) {
  if (SVC && str.includes(SVC)) throw new Error('SEGURANÇA: output contém service_role key')
}

// ── REST helpers (service_role — bypassa RLS) ─────────────────────────────

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

async function sbPost(path, body) {
  const res = await fetch(`${BASE_URL}/rest/v1/${path}`, {
    method:  'POST',
    headers: HDR,
    body:    JSON.stringify(body),
  })
  const text = await res.text()
  assertNoSecrets(text)
  if (!res.ok) throw new Error(`POST ${path} → ${res.status}: ${text}`)
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

// ── Log ───────────────────────────────────────────────────────────────────

function log(msg) { console.log(msg) }
function ok(msg)  { console.log(`  ✓ ${msg}`) }
function warn(msg){ console.log(`  ⚠ ${msg}`) }
function fail(msg){ console.error(`  ✗ ${msg}`) }

// ── Validações de pré-condição ────────────────────────────────────────────

function validateDraftIds() {
  log('\n[PRÉ-CONDIÇÃO] Verificando allowlist de IDs...')
  for (const id of [...REAL_IMAGE_DRAFT_IDS, ...REAL_VIDEO_DRAFT_IDS]) {
    if (!UUID_RE.test(id)) throw new Error(`ID inválido na allowlist: ${id}`)
    if (TEST_DRAFT_IDS.has(id)) throw new Error(`ID de teste na allowlist de reais: ${id}`)
  }
  ok(`4 ImageDrafts reais na allowlist`)
  ok(`2 VideoDrafts reais na allowlist`)
  ok(`3 registros de teste explicitamente excluídos`)
}

async function validateDraftStates() {
  log('\n[PRÉ-CONDIÇÃO] Verificando estado atual dos drafts no banco...')

  // Verificar ImageDrafts reais
  for (const id of REAL_IMAGE_DRAFT_IDS) {
    const rows = await sbGet(`image_drafts?id=eq.${id}&select=id,project_id,user_id,production_id,image_url,user_input`)
    if (!rows.length) throw new Error(`ImageDraft não encontrado: ${id}`)
    const r = rows[0]
    if (r.project_id !== PROJECT_ID) throw new Error(`ImageDraft ${id} pertence a outro Projeto: ${r.project_id}`)
    if (r.user_id    !== USER_ID)    throw new Error(`ImageDraft ${id} pertence a outro usuário: ${r.user_id}`)
    if (r.production_id !== null)    throw new Error(`ImageDraft ${id} já tem production_id: ${r.production_id} — ASSIGNMENT_CONFLICT`)
    if (!r.image_url)                warn(`ImageDraft ${id} não tem image_url — classificação pode estar errada`)
    ok(`ImageDraft ${id.slice(0,8)}… ("${r.user_input?.slice(0,30)}") — OK`)
  }

  // Verificar VideoDrafts reais
  for (const id of REAL_VIDEO_DRAFT_IDS) {
    const rows = await sbGet(`video_drafts?id=eq.${id}&select=id,project_id,user_id,production_id,name`)
    if (!rows.length) throw new Error(`VideoDraft não encontrado: ${id}`)
    const r = rows[0]
    if (r.project_id !== PROJECT_ID) throw new Error(`VideoDraft ${id} pertence a outro Projeto: ${r.project_id}`)
    if (r.user_id    !== USER_ID)    throw new Error(`VideoDraft ${id} pertence a outro usuário: ${r.user_id}`)
    if (r.production_id !== null)    throw new Error(`VideoDraft ${id} já tem production_id: ${r.production_id} — ASSIGNMENT_CONFLICT`)
    ok(`VideoDraft ${id.slice(0,8)}… ("${r.name}") — OK`)
  }

  // Verificar que testes continuam com production_id = NULL
  for (const id of TEST_DRAFT_IDS) {
    // Tentar em ambas as tabelas
    let rows = await sbGet(`image_drafts?id=eq.${id}&select=id,production_id`)
    if (!rows.length) rows = await sbGet(`video_drafts?id=eq.${id}&select=id,production_id`)
    if (!rows.length) { warn(`Registro de teste ${id} não encontrado — pode já ter sido removido`); continue }
    if (rows[0].production_id !== null) warn(`Registro de teste ${id} já tem production_id=${rows[0].production_id}`)
    else ok(`Teste ${id.slice(0,8)}… — production_id=null (preservado)`)
  }
}

async function validateProject() {
  log('\n[PRÉ-CONDIÇÃO] Verificando Projeto Alquimia Cibernética...')
  const rows = await sbGet(`projects?id=eq.${PROJECT_ID}&select=id,name,user_id,status`)
  if (!rows.length) throw new Error(`Projeto não encontrado: ${PROJECT_ID}`)
  const p = rows[0]
  if (p.user_id !== USER_ID) throw new Error(`Projeto pertence a outro usuário: ${p.user_id}`)
  ok(`Projeto: "${p.name}" (${p.status})`)
}

// ── Idempotência: verificar Production existente ─────────────────────────

async function findExistingArchiveProduction() {
  const rows = await sbGet(
    `productions?project_id=eq.${PROJECT_ID}&title=eq.${encodeURIComponent(PRODUCTION_TITLE)}&select=id,title,type,intention,user_id`
  )
  if (!rows.length) return null
  const p = rows[0]
  if (p.user_id !== USER_ID) throw new Error(`Production de Arquivo pertence a outro usuário: ${p.user_id}`)
  if (p.type !== PRODUCTION_TYPE) throw new Error(`Production existente diverge: type="${p.type}" esperado="${PRODUCTION_TYPE}" — CONFLICT`)
  return p
}

// ── Operações de escrita ──────────────────────────────────────────────────

async function createArchiveProduction() {
  log('\n[ESCRITA] Criando Production de Arquivo...')
  const rows = await sbPost('productions', {
    user_id:   USER_ID,
    project_id: PROJECT_ID,
    title:     PRODUCTION_TITLE,
    type:      PRODUCTION_TYPE,
    intention: PRODUCTION_INTENTION,
  })
  if (!rows.length) throw new Error('Production não foi criada — resposta vazia')
  ok(`Production criada: ${rows[0].id}`)
  return rows[0]
}

async function assignImageDraft(draftId, productionId) {
  const rows = await sbPatch(
    `image_drafts?id=eq.${draftId}&user_id=eq.${USER_ID}`,
    { production_id: productionId }
  )
  if (!rows.length) throw new Error(`ImageDraft ${draftId} não foi atualizado — linha não encontrada`)
  if (rows[0].production_id !== productionId) throw new Error(`ImageDraft ${draftId} não recebeu production_id esperado`)
  return rows[0]
}

async function assignVideoDraft(draftId, productionId) {
  const rows = await sbPatch(
    `video_drafts?id=eq.${draftId}&user_id=eq.${USER_ID}`,
    { production_id: productionId }
  )
  if (!rows.length) throw new Error(`VideoDraft ${draftId} não foi atualizado — linha não encontrada`)
  if (rows[0].production_id !== productionId) throw new Error(`VideoDraft ${draftId} não recebeu production_id esperado`)
  return rows[0]
}

// ── Auditoria pós-execução ────────────────────────────────────────────────

async function postExecutionAudit(productionId) {
  log('\n[AUDITORIA PÓS] Verificando estado final...')

  const imageDrafts = await sbGet(`image_drafts?production_id=eq.${productionId}&select=id,user_input,image_url,production_id,project_id`)
  const videoDrafts = await sbGet(`video_drafts?production_id=eq.${productionId}&select=id,name,production_id,project_id`)

  log(`  ImageDrafts na Production: ${imageDrafts.length}`)
  for (const d of imageDrafts) {
    ok(`  ImageDraft ${d.id.slice(0,8)}… ("${d.user_input?.slice(0,30)}") — production_id=✓ project_id=✓`)
  }

  log(`  VideoDrafts na Production: ${videoDrafts.length}`)
  for (const d of videoDrafts) {
    ok(`  VideoDraft ${d.id.slice(0,8)}… ("${d.name}") — production_id=✓ project_id=✓`)
  }

  if (imageDrafts.length !== 4) throw new Error(`Esperados 4 ImageDrafts, encontrados ${imageDrafts.length}`)
  if (videoDrafts.length !== 2) throw new Error(`Esperados 2 VideoDrafts, encontrados ${videoDrafts.length}`)

  // Verificar testes preservados
  for (const id of TEST_DRAFT_IDS) {
    let rows = await sbGet(`image_drafts?id=eq.${id}&select=id,production_id`)
    if (!rows.length) rows = await sbGet(`video_drafts?id=eq.${id}&select=id,production_id`)
    if (!rows.length) { warn(`Teste ${id} não encontrado`); continue }
    if (rows[0].production_id !== null) throw new Error(`Teste ${id} foi atribuído indevidamente: production_id=${rows[0].production_id}`)
    ok(`  Teste ${id.slice(0,8)}… — production_id=null (preservado ✓)`)
  }

  ok('Auditoria pós-execução: PASS')

  return { imageDrafts, videoDrafts }
}

// ── Main ──────────────────────────────────────────────────────────────────

async function main() {
  log('='.repeat(60))
  log('M10-A — Production de Arquivo: Alquimia Cibernética')
  log(`Modo: ${EXECUTE ? 'EXECUÇÃO' : 'DRY-RUN (zero escrita)'}`)
  log('='.repeat(60))

  // Validar confirmação antes de qualquer operação
  if (EXECUTE) {
    if (CONFIRM !== 'M10A_APPROVED') {
      throw new Error(
        'EXECUÇÃO BLOQUEADA: defina PROJECT_ARCHIVE_CONFIRM=M10A_APPROVED para prosseguir.'
      )
    }
    log('\n⚠  MODO EXECUÇÃO ATIVADO — operações de escrita serão realizadas')
  }

  // Pré-condições (sempre, mesmo em dry-run)
  validateDraftIds()
  await validateProject()
  await validateDraftStates()

  // Verificar idempotência
  log('\n[IDEMPOTÊNCIA] Verificando Production existente...')
  const existing = await findExistingArchiveProduction()

  let productionId   = null
  let productionWas  = null

  if (existing) {
    productionId  = existing.id
    productionWas = 'PRODUCTION_ALREADY_EXISTS'
    ok(`Production já existe: ${productionId} — reutilizando (idempotente)`)
  } else {
    ok('Production de Arquivo não existe — será criada')
    productionWas = 'PRODUCTION_WILL_BE_CREATED'
  }

  // Verificar se drafts já estão atribuídos (idempotência dos PATCHes)
  log('\n[IDEMPOTÊNCIA] Verificando estado de atribuição dos drafts...')
  const alreadyAssigned = { image: [], video: [] }
  const toAssign        = { image: [], video: [] }

  for (const id of REAL_IMAGE_DRAFT_IDS) {
    const rows = await sbGet(`image_drafts?id=eq.${id}&select=id,production_id`)
    const current = rows[0]?.production_id
    if (current === null) {
      toAssign.image.push(id)
    } else if (productionId && current === productionId) {
      alreadyAssigned.image.push(id)
      ok(`ImageDraft ${id.slice(0,8)}… já atribuído (DRAFT_ALREADY_ASSIGNED)`)
    } else if (current !== null) {
      throw new Error(`ImageDraft ${id} está atribuído a outra Production: ${current} — ASSIGNMENT_CONFLICT`)
    } else {
      toAssign.image.push(id)
    }
  }
  for (const id of REAL_VIDEO_DRAFT_IDS) {
    const rows = await sbGet(`video_drafts?id=eq.${id}&select=id,production_id`)
    const current = rows[0]?.production_id
    if (current === null) {
      toAssign.video.push(id)
    } else if (productionId && current === productionId) {
      alreadyAssigned.video.push(id)
      ok(`VideoDraft ${id.slice(0,8)}… já atribuído (DRAFT_ALREADY_ASSIGNED)`)
    } else if (current !== null) {
      throw new Error(`VideoDraft ${id} está atribuído a outra Production: ${current} — ASSIGNMENT_CONFLICT`)
    } else {
      toAssign.video.push(id)
    }
  }

  log(`\n  ImageDrafts a atribuir: ${toAssign.image.length}`)
  log(`  VideoDrafts a atribuir: ${toAssign.video.length}`)
  log(`  ImageDrafts já atribuídos: ${alreadyAssigned.image.length}`)
  log(`  VideoDrafts já atribuídos: ${alreadyAssigned.video.length}`)

  // ── DRY-RUN encerra aqui ──────────────────────────────────────────────

  if (!EXECUTE) {
    log('\n' + '─'.repeat(60))
    log('DRY-RUN concluído — nenhuma escrita realizada.')
    log('Pré-condições: OK')
    log(`Production: ${productionWas}`)
    log(`ImageDrafts a atribuir: ${toAssign.image.length}`)
    log(`VideoDrafts a atribuir: ${toAssign.video.length}`)
    log('\nPara executar:')
    log('  PROJECT_ARCHIVE_CONFIRM=M10A_APPROVED node scripts/project_archive_production_m10a.mjs --execute')
    log('─'.repeat(60))
    return
  }

  // ── EXECUÇÃO ──────────────────────────────────────────────────────────

  // 1. Criar Production (se não existe)
  let production = existing
  if (!existing) {
    production = await createArchiveProduction()
    productionId = production.id
  }

  // 2. Atribuir ImageDrafts
  log('\n[ESCRITA] Atribuindo ImageDrafts...')
  const assignedImageDrafts = []
  for (const id of toAssign.image) {
    const result = await assignImageDraft(id, productionId)
    assignedImageDrafts.push(result)
    ok(`ImageDraft ${id.slice(0,8)}… atribuído`)
  }

  // 3. Atribuir VideoDrafts
  log('\n[ESCRITA] Atribuindo VideoDrafts...')
  const assignedVideoDrafts = []
  for (const id of toAssign.video) {
    const result = await assignVideoDraft(id, productionId)
    assignedVideoDrafts.push(result)
    ok(`VideoDraft ${id.slice(0,8)}… atribuído`)
  }

  // 4. Auditoria pós-execução
  const { imageDrafts: finalImageDrafts, videoDrafts: finalVideoDrafts } = await postExecutionAudit(productionId)

  // 5. Gerar manifesto
  const manifest = {
    m10a: true,
    executed_at: new Date().toISOString(),
    project_id: PROJECT_ID,
    project_name: 'Alquimia Cibernética',
    user_id: USER_ID,
    production: {
      id:      productionId,
      title:   PRODUCTION_TITLE,
      type:    PRODUCTION_TYPE,
      was:     productionWas === 'PRODUCTION_ALREADY_EXISTS' ? 'reused' : 'created',
    },
    assigned: {
      image_draft_ids: REAL_IMAGE_DRAFT_IDS,
      video_draft_ids: REAL_VIDEO_DRAFT_IDS,
    },
    preserved_tests: {
      description: 'Registros de teste — production_id mantido NULL',
      ids: [...TEST_DRAFT_IDS],
    },
    rollback: {
      script: 'scripts/project_archive_production_m10a_rollback.mjs',
      requires_confirm: 'PROJECT_ARCHIVE_ROLLBACK_CONFIRM=M10A_ROLLBACK_APPROVED',
      will_restore_production_id_to_null: REAL_IMAGE_DRAFT_IDS.concat(REAL_VIDEO_DRAFT_IDS),
      will_delete_production_if_empty: productionWas !== 'PRODUCTION_ALREADY_EXISTS',
    },
  }

  const migrDir = resolve(ROOT, 'docs', 'migrations')
  mkdirSync(migrDir, { recursive: true })
  const jsonPath = resolve(migrDir, 'project-archive-m10a.json')
  writeFileSync(jsonPath, JSON.stringify(manifest, null, 2), 'utf8')
  ok(`Manifesto JSON: ${jsonPath}`)

  log('\n' + '='.repeat(60))
  log('M10-A CONCLUÍDO')
  log(`Production: ${productionId} (${production?.was ?? (productionWas === 'PRODUCTION_ALREADY_EXISTS' ? 'reutilizada' : 'criada')})`)
  log(`ImageDrafts atribuídos: ${REAL_IMAGE_DRAFT_IDS.length}`)
  log(`VideoDrafts atribuídos: ${REAL_VIDEO_DRAFT_IDS.length}`)
  log(`Testes preservados:     ${TEST_DRAFT_IDS.size}`)
  log(`Manifesto: docs/migrations/project-archive-m10a.json`)
  log('='.repeat(60))

  return manifest
}

main().catch(err => {
  fail(String(err))
  process.exit(1)
})

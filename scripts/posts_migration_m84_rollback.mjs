#!/usr/bin/env node
/**
 * M8.4 — Rollback: desfaz a migração de P1 criada por posts_migration_m84_execute.mjs
 *
 * Lê: docs/migrations/posts-m8-execution-m8-4.json
 * Remove em ordem: CPM → CP → LF → EC → S3 dest
 * Nunca toca: posts, S3 source (posts/ namespace), P2/P3/P4
 *
 * Uso (modo plano):
 *   node scripts/posts_migration_m84_rollback.mjs
 *
 * Uso (execução):
 *   POSTS_MIGRATION_M84_ROLLBACK_CONFIRM=M8_4_ROLLBACK_APPROVED \
 *   node scripts/posts_migration_m84_rollback.mjs --execute
 */

import { readFileSync }     from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath }    from 'url'
import {
  S3Client,
  HeadObjectCommand,
  DeleteObjectCommand,
} from '@aws-sdk/client-s3'
import adminGuard from './lib/production-admin-guard.cjs'

const __dir = dirname(fileURLToPath(import.meta.url))
const ROOT  = resolve(__dir, '..')

// ── Safety constants ──────────────────────────────────────────────────────────

const P1_ID      = 'd02a9507-d6c3-4203-9939-4667a4e0f027'
const P1_USER_ID = '35428fd4-4784-4934-9af9-82a606aad77e'

// S3 keys that must NEVER be deleted by this script
const PROTECTED_KEYS = [
  'users/35428fd4-4784-4934-9af9-82a606aad77e/posts/3f142fc2-df7f-4e39-ae04-ca63832f690d/Content-Agent-Studio-Future-Vision-Concept.png',
]

// Blocked IDs — must not be touched
const BLOCKED_POST_IDS = [
  '7eb9ccf4-7989-4f4b-93ba-c10df0345428', // P2
  '083a69d5-de8f-4525-b1a1-f495b6404e80', // P3
  '7aa6b5a4-8fb2-4e22-937e-82a228f87e8b', // P4
]

const MANIFEST_PATH = resolve(ROOT, 'docs/migrations/posts-m8-execution-m8-4.json')
const CONFIRM_KEY   = 'POSTS_MIGRATION_M84_ROLLBACK_CONFIRM'
const CONFIRM_VALUE = 'M8_4_ROLLBACK_APPROVED'

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
const SVC    = get('SUPABASE_SECRET_KEY') || get('SUPABASE_SERVICE_ROLE_KEY')

if (!SB_URL || !SVC) throw new Error('SUPABASE_URL ou SUPABASE_SECRET_KEY (ou SUPABASE_SERVICE_ROLE_KEY legado) ausente no .env.local')
adminGuard.requireAdminAck({ script: 'posts_migration_m84_rollback.mjs', target: SB_URL })

const BASE_URL = SB_URL.replace(/\/$/, '')
const HDR      = { apikey: SVC, Authorization: `Bearer ${SVC}`, 'Content-Type': 'application/json' }

// ── S3 client ─────────────────────────────────────────────────────────────────

function buildS3Client() {
  const endpoint      = get('S3_ENDPOINT')
  const accessKeyId   = get('S3_ACCESS_KEY')     || get('S3_ACCESS_KEY_ID')
  const secretKey     = get('S3_SECRET_KEY')     || get('S3_SECRET_ACCESS_KEY')
  const region        = get('S3_REGION')          || 'us-east-1'
  const forcePathStyle = get('S3_FORCE_PATH_STYLE') !== 'false'

  if (!endpoint || !accessKeyId || !secretKey) {
    throw new Error('S3_ENDPOINT, S3_ACCESS_KEY, S3_SECRET_KEY ausentes no .env.local')
  }

  return new S3Client({
    endpoint, region, forcePathStyle,
    credentials: { accessKeyId, secretAccessKey: secretKey },
  })
}

// ── REST helpers ──────────────────────────────────────────────────────────────

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

// ── S3 helpers ────────────────────────────────────────────────────────────────

async function s3Exists(s3, bucket, key) {
  try {
    await s3.send(new HeadObjectCommand({ Bucket: bucket, Key: key }))
    return true
  } catch (e) {
    if (e.name === 'NotFound' || e.$metadata?.httpStatusCode === 404) return false
    throw new Error(`HeadObject ${bucket}/${key}: ${e.message}`)
  }
}

async function s3Delete(s3, bucket, key) {
  // Guard: never delete protected keys
  if (PROTECTED_KEYS.includes(key)) {
    throw new Error(`SEGURANÇA: tentativa de apagar objeto protegido: ${key}`)
  }
  await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }))
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const args    = process.argv.slice(2)
  const EXECUTE = args.includes('--execute')
  const CONFIRM = process.env[CONFIRM_KEY]

  // Carregar manifesto
  let manifest
  try {
    manifest = JSON.parse(readFileSync(MANIFEST_PATH, 'utf8'))
  } catch (e) {
    console.error(`ERRO: manifesto não encontrado em ${MANIFEST_PATH}`)
    console.error(e.message)
    process.exit(1)
  }

  if (manifest.phase !== 'M8.4') {
    console.error(`ERRO: manifesto.phase="${manifest.phase}" incompatível (esperado: M8.4).`)
    process.exit(1)
  }

  if (manifest.result !== 'MIGRATED') {
    console.error(`ERRO: manifesto.result="${manifest.result}" — rollback só aplicável a migrações bem-sucedidas.`)
    process.exit(1)
  }

  const ids = manifest.ids ?? {}
  const s3DestKey = manifest.rollback?.s3_dest_key

  // Verificar que P1 é o alvo
  if (manifest.post?.id !== P1_ID) {
    console.error(`ERRO: manifesto.post.id="${manifest.post?.id}" != P1 esperado (${P1_ID}).`)
    process.exit(1)
  }

  // Verificar que S3 dest não é um key protegido
  if (s3DestKey && PROTECTED_KEYS.includes(s3DestKey)) {
    console.error(`ERRO CRÍTICO: s3_dest_key aponta para objeto protegido (source): ${s3DestKey}`)
    console.error('Rollback abortado por segurança.')
    process.exit(1)
  }

  // Verificar que os IDs não pertencem a P2/P3/P4 (defesa extra)
  for (const blockedId of BLOCKED_POST_IDS) {
    if (Object.values(ids).includes(blockedId)) {
      console.error(`ERRO: manifesto contém ID de post bloqueado (${blockedId}). Abortando.`)
      process.exit(1)
    }
  }

  console.log('\n╔══════════════════════════════════════════════════════════╗')
  console.log('║  M8.4 — Rollback P1 Media Migration                      ║')
  console.log('╚══════════════════════════════════════════════════════════╝')
  console.log(`\nManifesto: ${MANIFEST_PATH}`)
  console.log(`Executado em: ${manifest.executed_at}`)
  console.log('')
  console.log(`  EC:  ${ids.editorial_content_id ?? '—'}`)
  console.log(`  CP:  ${ids.channel_piece_id     ?? '—'}`)
  console.log(`  LF:  ${ids.library_file_id      ?? '—'}`)
  console.log(`  CPM: ${ids.channel_piece_media_id ?? '—'}`)
  console.log(`  S3 dest: ${s3DestKey ?? '—'}`)

  if (!EXECUTE) {
    console.log('\nMODO PLANO — nenhuma escrita. Para executar o rollback:')
    console.log(`  ${CONFIRM_KEY}=${CONFIRM_VALUE} \\`)
    console.log('  node scripts/posts_migration_m84_rollback.mjs --execute')
    console.log('')
    console.log('Atenção: inspecione o estado atual do banco e S3 antes de reverter.')
    console.log('posts, S3 source e P2/P3/P4 nunca são tocados.')
    process.exit(0)
  }

  if (CONFIRM !== CONFIRM_VALUE) {
    console.error(`ERRO: ${CONFIRM_KEY}=${CONFIRM_VALUE} é obrigatório.`)
    process.exit(1)
  }

  const s3 = buildS3Client()

  console.log('\nOrdem de remoção: CPM → CP → LF → EC → S3 dest')
  console.log('posts: NUNCA TOCADOS | S3 source: NUNCA TOCADO')
  console.log('')

  // ── 1. Remover channel_piece_media ────────────────────────────────────────

  const cpmId = ids.channel_piece_media_id
  if (cpmId) {
    try {
      const rows = await sbGet(`channel_piece_media?id=eq.${cpmId}&select=id,channel_piece_id,library_file_id`)
      if (rows.length === 0) {
        console.log(`  ✓ CPM já ausente: ${cpmId}`)
      } else {
        const cpm = rows[0]
        if (cpm.library_file_id !== ids.library_file_id) {
          console.error(`  ✗ RECUSA: CPM.library_file_id diverge do manifesto.`)
          console.error(`    manifesto: ${ids.library_file_id}, banco: ${cpm.library_file_id}`)
          console.error('  Parando rollback por segurança.')
          process.exit(1)
        }
        await sbDeleteById('channel_piece_media', cpmId)
        console.log(`  ✓ CPM removido: ${cpmId}`)
      }
    } catch (e) {
      console.error(`  ✗ FALHA ao remover CPM ${cpmId}: ${e.message}`)
      console.error('  Parando rollback — intervenção manual necessária.')
      process.exit(1)
    }
  }

  // ── 2. Remover channel_pieces ─────────────────────────────────────────────

  const cpId = ids.channel_piece_id
  if (cpId) {
    try {
      const rows = await sbGet(`channel_pieces?id=eq.${cpId}&select=id,editorial_content_id`)
      if (rows.length === 0) {
        console.log(`  ✓ CP já ausente: ${cpId}`)
      } else {
        const cp = rows[0]
        if (cp.editorial_content_id !== ids.editorial_content_id) {
          console.error(`  ✗ RECUSA: CP.editorial_content_id diverge do manifesto.`)
          console.error(`    manifesto: ${ids.editorial_content_id}, banco: ${cp.editorial_content_id}`)
          console.error('  Parando rollback por segurança.')
          process.exit(1)
        }
        await sbDeleteById('channel_pieces', cpId)
        console.log(`  ✓ CP removido: ${cpId}`)
      }
    } catch (e) {
      console.error(`  ✗ FALHA ao remover CP ${cpId}: ${e.message}`)
      console.error('  Parando rollback — intervenção manual necessária.')
      process.exit(1)
    }
  }

  // ── 3. Remover library_files ──────────────────────────────────────────────

  const lfId = ids.library_file_id
  if (lfId) {
    try {
      const rows = await sbGet(`library_files?id=eq.${lfId}&select=id,storage_path,user_id`)
      if (rows.length === 0) {
        console.log(`  ✓ LF já ausente: ${lfId}`)
      } else {
        const lf = rows[0]
        if (lf.storage_path !== s3DestKey) {
          console.error(`  ✗ RECUSA: LF.storage_path diverge do manifesto.`)
          console.error(`    manifesto: ${s3DestKey}`)
          console.error(`    banco:     ${lf.storage_path}`)
          console.error('  Parando rollback por segurança.')
          process.exit(1)
        }
        if (lf.user_id !== P1_USER_ID) {
          console.error(`  ✗ RECUSA: LF.user_id diverge do esperado.`)
          process.exit(1)
        }
        await sbDeleteById('library_files', lfId)
        console.log(`  ✓ LF removido: ${lfId}`)
      }
    } catch (e) {
      console.error(`  ✗ FALHA ao remover LF ${lfId}: ${e.message}`)
      console.error('  Parando rollback — intervenção manual necessária.')
      process.exit(1)
    }
  }

  // ── 4. Remover editorial_contents ─────────────────────────────────────────

  const ecId = ids.editorial_content_id
  if (ecId) {
    try {
      const rows = await sbGet(`editorial_contents?id=eq.${ecId}&select=id,legacy_post_id`)
      if (rows.length === 0) {
        console.log(`  ✓ EC já ausente: ${ecId}`)
      } else {
        const ec = rows[0]
        if (!ec.legacy_post_id) {
          console.error(`  ✗ RECUSA: EC não tem legacy_post_id — pode não ser da migração.`)
          process.exit(1)
        }
        if (ec.legacy_post_id !== P1_ID) {
          console.error(`  ✗ RECUSA: EC.legacy_post_id diverge de P1.`)
          console.error(`    manifesto: ${P1_ID}, banco: ${ec.legacy_post_id}`)
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
  }

  // ── 5. Remover objeto S3 de destino ───────────────────────────────────────

  if (s3DestKey) {
    try {
      const exists = await s3Exists(s3, manifest.s3?.destination?.bucket ?? 'content-studio', s3DestKey)
      if (!exists) {
        console.log(`  ✓ S3 dest já ausente: ${s3DestKey}`)
      } else {
        await s3Delete(s3, manifest.s3?.destination?.bucket ?? 'content-studio', s3DestKey)
        console.log(`  ✓ S3 dest removido: ${s3DestKey}`)
      }
    } catch (e) {
      console.error(`  ✗ FALHA ao remover S3 dest ${s3DestKey}: ${e.message}`)
      console.error('  Parando rollback — intervenção manual necessária.')
      process.exit(1)
    }
  }

  // Verificar source intacto
  const srcIntact = await s3Exists(s3, manifest.s3?.source?.bucket ?? 'content-studio', manifest.s3?.source?.key ?? '')
  console.log(`\n  ${srcIntact ? '✓' : '✗'} S3 source intacto: ${manifest.s3?.source?.key}`)

  console.log('\n══════════════════════════════════════════════════')
  console.log('  ROLLBACK M8.4 CONCLUÍDO')
  console.log('  posts: INTACTOS')
  console.log('  S3 source: NÃO TOCADO')
  console.log('  P2/P3/P4: NÃO TOCADOS')
  console.log('══════════════════════════════════════════════════')
}

main().catch(e => { console.error('FATAL:', e.message); process.exit(1) })

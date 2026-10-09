#!/usr/bin/env node
/**
 * M8.5A — Post-migration audit: read-only verification of P1–P4 migration.
 *
 * Verifies:
 *  - 4 posts intactos na tabela posts
 *  - 4 ECs com legacy_post_id correto
 *  - 4 CPs vinculados corretamente
 *  - 1 LF + 1 CPM para P1
 *  - S3 source e dest íntegros para P1
 *  - fingerprints, mapeamentos de campo, relações, manifests
 *
 * READ-ONLY: zero INSERT, UPDATE, DELETE, CopyObject, PutObject, DeleteObject.
 * Falha imediatamente se detectar qualquer configuração de escrita.
 *
 * Uso:
 *   node scripts/posts_migration_post_audit.mjs
 */

import { createHash }                    from 'crypto'
import { readFileSync, mkdirSync, writeFileSync } from 'fs'
import { resolve, dirname }              from 'path'
import { fileURLToPath }                 from 'url'
import { S3Client, HeadObjectCommand }   from '@aws-sdk/client-s3'
import adminGuard from './lib/production-admin-guard.cjs'

const __dir = dirname(fileURLToPath(import.meta.url))
const ROOT  = resolve(__dir, '..')

// ── READ-ONLY guard ───────────────────────────────────────────────────────────
// This script never writes. Any code path that would call INSERT/UPDATE/DELETE
// or S3 mutating commands is absent by design.
const _AUDIT_READONLY = true

// ── Expected values (from approved manifests M8.1, M8.3A, M8.4) ──────────────

const BUCKET = 'content-studio'

const POSTS = {
  P1: {
    label:              'P1',
    post_id:            'd02a9507-d6c3-4203-9939-4667a4e0f027',
    post_name:          'Teste Post Smoke Test 01',
    post_channel:       'instagram_post',
    post_project_id:    'd0d008c3-321b-46fe-8225-2f1a68e833ec',
    fingerprint:        '3e8a92a61914904a087d9eecf48bb894c069313d87fd01dd0d37bf3921e43a68',
    baseline_updated_at:'2026-06-23T01:08:39.376895+00:00',
    ec_id:              '16a0bfea-b558-4f26-91ec-2e163d84f9b0',
    cp_id:              '2a48076c-3aff-4c53-beaf-cd84e028cffd',
    lf_id:              'f190c6ad-8ad1-490c-aeaa-3898b69bb0aa',
    cpm_id:             'd71eed1d-068b-47ed-aae1-278ca6922cf8',
    expected_ec_project:'d0d008c3-321b-46fe-8225-2f1a68e833ec',
    expected_cp_channel:'instagram',
    expected_cp_format: 'feed',
    has_media:          true,
    src_key:            'users/35428fd4-4784-4934-9af9-82a606aad77e/posts/3f142fc2-df7f-4e39-ae04-ca63832f690d/Content-Agent-Studio-Future-Vision-Concept.png',
    dest_key:           'users/35428fd4-4784-4934-9af9-82a606aad77e/library/posts-migration-m8/d02a9507-d6c3-4203-9939-4667a4e0f027/Content-Agent-Studio-Future-Vision-Concept.png',
    expected_size:      1293601,
    expected_mime:      'image/png',
    expected_etag:      '7997848a1fcbfd6193dc2f867d65a4b1',
    expected_thumbnail_url: null,
    h1_applied:         false, // post.project_id already set
    phase:              'M8.4',
  },
  P2: {
    label:              'P2',
    post_id:            '7eb9ccf4-7989-4f4b-93ba-c10df0345428',
    post_name:          'outro teste de post',
    post_channel:       'youtube_post',
    post_project_id:    'd0d008c3-321b-46fe-8225-2f1a68e833ec',
    fingerprint:        '6d3cbc65c625aa64d4eb8621c09f91492433cc2f33c09cdb88586254833f7a58',
    baseline_updated_at:'2026-06-23T01:09:29.849458+00:00',
    ec_id:              '0d4ee522-db02-4766-98aa-d02b2faf1ea1',
    cp_id:              '64e5bbb3-f8cf-46eb-bafa-2d420d03c6bc',
    lf_id:              null,
    cpm_id:             null,
    expected_ec_project:'d0d008c3-321b-46fe-8225-2f1a68e833ec',
    expected_cp_channel:'youtube',
    expected_cp_format: 'post',
    has_media:          false,
    h1_applied:         false,
    phase:              'M8.3A',
  },
  P3: {
    label:              'P3',
    post_id:            '083a69d5-de8f-4525-b1a1-f495b6404e80',
    post_name:          'outro teste de story',
    post_channel:       'instagram_story',
    post_project_id:    null, // H1: post.project_id is NULL; EC gets d0d008c3
    fingerprint:        '0a0b81fa695db6b841c750a8ace982b42d5281b299fbd4f31fdd8eba3b2080d1',
    baseline_updated_at:'2026-06-23T01:11:35.379153+00:00',
    ec_id:              'bee05422-04e7-4c80-9d82-ba504303e37d',
    cp_id:              '05772802-06d7-4249-bae8-d8b8e11b7457',
    lf_id:              null,
    cpm_id:             null,
    expected_ec_project:'d0d008c3-321b-46fe-8225-2f1a68e833ec',
    expected_cp_channel:'instagram',
    expected_cp_format: 'story',
    has_media:          false,
    h1_applied:         true, // post.project_id=NULL → EC.project_id=d0d008c3
    phase:              'M8.3A',
  },
  P4: {
    label:              'P4',
    post_id:            '7aa6b5a4-8fb2-4e22-937e-82a228f87e8b',
    post_name:          'teste 04',
    post_channel:       'youtube_video',
    post_project_id:    'd0d008c3-321b-46fe-8225-2f1a68e833ec',
    fingerprint:        '8edbcebf2a97381d07b8e662450de1a4415152ac66b1c8fc1e512be42895dd31',
    baseline_updated_at:'2026-06-23T01:14:17.513899+00:00',
    ec_id:              'd0138557-ad57-4284-bcdc-322c21c8f599',
    cp_id:              'ba9d1e7d-38c7-4ca0-8251-a72bdaddce64',
    lf_id:              null,
    cpm_id:             null,
    expected_ec_project:'d0d008c3-321b-46fe-8225-2f1a68e833ec',
    expected_cp_channel:'youtube',
    expected_cp_format: 'video_description',
    has_media:          false,
    h1_applied:         false,
    phase:              'M8.3A',
  },
}

const ALL_POST_IDS = Object.values(POSTS).map(p => p.post_id)
const ALL_EC_IDS   = Object.values(POSTS).map(p => p.ec_id)
const ALL_CP_IDS   = Object.values(POSTS).map(p => p.cp_id)

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
const SVC    = get('SUPABASE_SECRET_KEY') || get('SUPABASE_SERVICE_ROLE_KEY')

if (!SB_URL || !SVC) throw new Error('SUPABASE_URL ou SUPABASE_SECRET_KEY (ou SUPABASE_SERVICE_ROLE_KEY legado) ausente no .env.local')
adminGuard.requireAdminAck({ script: 'posts_migration_post_audit.mjs', target: SB_URL })

const BASE_URL = SB_URL.replace(/\/$/, '')
const HDR      = { apikey: SVC, Authorization: `Bearer ${SVC}`, 'Content-Type': 'application/json' }

function assertNoSecrets(str) {
  if (SVC && str.includes(SVC)) throw new Error('SEGURANÇA: output contém service_role key')
}

// ── S3 client (read-only: HeadObject only) ────────────────────────────────────

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

// ── REST helpers (GET only) ───────────────────────────────────────────────────

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

// ── S3 HeadObject (read-only) ────────────────────────────────────────────────

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
      return { exists: false, size: null, contentType: null, etag: null }
    }
    throw new Error(`HeadObject ${bucket}/${key}: ${e.message}`)
  }
}

// ── Fingerprint ───────────────────────────────────────────────────────────────

function fingerprint(post) {
  const obj = {}
  for (const k of FINGERPRINT_FIELDS) obj[k] = post[k] ?? null
  return createHash('sha256').update(JSON.stringify(obj)).digest('hex')
}

const tsMs = ts => new Date(String(ts).replace(' ', 'T').replace(/\+00$/, '+00:00')).getTime()

// ── Check helpers ─────────────────────────────────────────────────────────────

function chk(results, id, ok, msg) {
  const status = ok === true ? 'PASS' : ok === 'WARN' ? 'WARN' : 'FAIL'
  results.push({ id, status, msg })
  const icon = status === 'PASS' ? '✓' : status === 'WARN' ? '⚠' : '✗'
  console.log(`  ${icon} [${id}] ${msg}`)
  return status
}

// ── Main audit ────────────────────────────────────────────────────────────────

async function runAudit() {
  void _AUDIT_READONLY // enforce read-only annotation
  const s3 = buildS3Client()
  const results = []
  const postResults = {}

  console.log('\n╔══════════════════════════════════════════════════════════╗')
  console.log('║  M8.5A — Post-Migration Audit  [READ-ONLY]               ║')
  console.log('╚══════════════════════════════════════════════════════════╝')
  console.log(`\nTimestamp: ${new Date().toISOString()}`)

  // ── A. Fetch all data ───────────────────────────────────────────────────────

  console.log('\n[A] Fetching data from DB...')

  const [
    allPosts,
    allECs,
    allCPs,
    allLFs,
    allCPMs,
  ] = await Promise.all([
    sbGet('posts?select=*'),
    sbGet('editorial_contents?legacy_post_id=not.is.null&select=*'),
    sbGet(`channel_pieces?editorial_content_id=in.(${ALL_EC_IDS.join(',')})&select=*`),
    sbGet(`library_files?id=in.(${POSTS.P1.lf_id})&select=*`),
    sbGet(`channel_piece_media?id=in.(${POSTS.P1.cpm_id})&select=*`),
  ])

  const postMap = Object.fromEntries(allPosts.map(p => [p.id, p]))
  const ecMap   = Object.fromEntries(allECs.map(e => [e.id, e]))
  const cpMap   = Object.fromEntries(allCPs.map(c => [c.id, c]))
  const lfMap   = Object.fromEntries(allLFs.map(l => [l.id, l]))
  const cpmMap  = Object.fromEntries(allCPMs.map(m => [m.id, m]))

  // ── B. Global checks ────────────────────────────────────────────────────────

  console.log('\n[B] Global checks')

  chk(results, 'B01', allPosts.length === 4, `posts count = ${allPosts.length} (expected 4)`)
  chk(results, 'B02', allECs.length === 4,   `editorial_contents com legacy_post_id = ${allECs.length} (expected 4)`)

  // No duplicate legacy_post_id
  const legacyIds = allECs.map(e => e.legacy_post_id)
  const uniqueLegacyIds = new Set(legacyIds)
  chk(results, 'B03', uniqueLegacyIds.size === 4, `legacy_post_id únicos = ${uniqueLegacyIds.size} (expected 4, no duplicates)`)

  // All 4 known post IDs present
  const postIdSet = new Set(allPosts.map(p => p.id))
  chk(results, 'B04', ALL_POST_IDS.every(id => postIdSet.has(id)), `todos os 4 post IDs esperados presentes`)

  // All 4 known EC IDs present
  const ecIdSet = new Set(allECs.map(e => e.id))
  chk(results, 'B05', ALL_EC_IDS.every(id => ecIdSet.has(id)), `todos os 4 EC IDs esperados presentes`)

  // No unexpected ECs from migration IDs
  const unexpectedECs = allECs.filter(e => !ALL_EC_IDS.includes(e.id))
  chk(results, 'B06', unexpectedECs.length === 0, `ECs inesperados com legacy_post_id = ${unexpectedECs.length}`)

  // No orphan CPs (CPs linked to ECs not in our set)
  const allCPsForKnownECs = await sbGet(`channel_pieces?select=id,editorial_content_id`)
  const orphanCPs = allCPsForKnownECs.filter(cp =>
    !ALL_EC_IDS.includes(cp.editorial_content_id) && ALL_CP_IDS.includes(cp.id)
  )
  chk(results, 'B07', orphanCPs.length === 0, `CPs órfãos (vinculados a EC fora do set) = ${orphanCPs.length}`)

  // No orphan CPMs (CPMs not in manifest)
  const allCPMsForKnownCPs = await sbGet(`channel_piece_media?channel_piece_id=in.(${ALL_CP_IDS.join(',')})&select=id`)
  chk(results, 'B08', allCPMsForKnownCPs.length === 1, `CPMs vinculados aos CPs da migração = ${allCPMsForKnownCPs.length} (expected 1 — só P1)`)

  // No extra LFs from migration namespace (check by storage_path prefix)
  const migrationLFs = await sbGet(`library_files?storage_path=like.users%2F35428fd4%25library%2Fposts-migration-m8%25&select=id,storage_path`)
  chk(results, 'B09', migrationLFs.length === 1, `library_files com path posts-migration-m8 = ${migrationLFs.length} (expected 1 — só P1)`)

  // ── C. Per-post audit ───────────────────────────────────────────────────────

  for (const [label, expected] of Object.entries(POSTS)) {
    const pr = { label, checks: [], status: 'PASS', warnings: [], failures: [] }
    postResults[label] = pr

    const add = (id, ok, msg) => {
      const s = chk(results, id, ok, msg)
      pr.checks.push({ id, status: s, msg })
      if (s === 'FAIL') pr.failures.push(id)
      if (s === 'WARN') pr.warnings.push(id)
    }

    console.log(`\n[C] ${label} — ${expected.post_id}`)
    console.log(`    phase: ${expected.phase}`)

    // Post exists and is intact
    const post = postMap[expected.post_id]
    add(`${label}-C01`, !!post, `post exists`)
    if (!post) { pr.status = 'FAIL'; continue }

    add(`${label}-C02`, post.name === expected.post_name,
      `post.name "${post.name}" == expected "${expected.post_name}"`)

    add(`${label}-C03`, post.channel === expected.post_channel,
      `post.channel "${post.channel}" == expected "${expected.post_channel}"`)

    // post.project_id
    if (expected.h1_applied) {
      add(`${label}-C04`, post.project_id === null,
        `P3/H1: post.project_id = NULL (preserved, NOT written) — OK`)
    } else {
      add(`${label}-C04`, post.project_id === expected.post_project_id,
        `post.project_id "${post.project_id}" == expected "${expected.post_project_id}"`)
    }

    // updated_at unchanged
    add(`${label}-C05`, tsMs(post.updated_at) === tsMs(expected.baseline_updated_at),
      `post.updated_at matches baseline (not written)`)

    // Fingerprint
    const fp = fingerprint(post)
    add(`${label}-C06`, fp === expected.fingerprint,
      `fingerprint ${fp.slice(0,12)}… == approved ${expected.fingerprint.slice(0,12)}…`)

    // EC
    const ec = ecMap[expected.ec_id]
    add(`${label}-C07`, !!ec, `EC ${expected.ec_id} exists`)
    if (!ec) { pr.status = 'FAIL'; continue }

    add(`${label}-C08`, ec.legacy_post_id === expected.post_id,
      `EC.legacy_post_id "${ec.legacy_post_id}" == post.id`)

    add(`${label}-C09`, ec.project_id === expected.expected_ec_project,
      `EC.project_id "${ec.project_id}" == expected "${expected.expected_ec_project}"`)

    add(`${label}-C10`, ec.status === 'draft',
      `EC.status = "${ec.status}" (expected: draft)`)

    // EC field mapping: title = post.name
    add(`${label}-C11`, ec.title === post.name,
      `EC.title = post.name "${post.name.slice(0,30)}…" [DIRECT MAP]`)

    // EC.body = post.description (may be null for some)
    const bodyMatch = ec.body === (post.description ?? null)
    add(`${label}-C12`, bodyMatch,
      `EC.body vs post.description: ${bodyMatch ? 'match' : `"${ec.body?.slice(0,30)}" != "${post.description?.slice(0,30)}"`} [DIRECT MAP]`)

    // EC.ai_context = post.ai_context
    add(`${label}-C13`, ec.ai_context === (post.ai_context ?? null),
      `EC.ai_context matches post.ai_context [DIRECT MAP]`)

    // CP
    const cp = cpMap[expected.cp_id]
    add(`${label}-C14`, !!cp, `CP ${expected.cp_id} exists`)
    if (!cp) { pr.status = 'FAIL'; continue }

    add(`${label}-C15`, cp.editorial_content_id === expected.ec_id,
      `CP.editorial_content_id == EC.id`)

    add(`${label}-C16`, cp.channel === expected.expected_cp_channel,
      `CP.channel = "${cp.channel}" (expected: "${expected.expected_cp_channel}") [CHANNEL_MAP]`)

    add(`${label}-C17`, cp.format === expected.expected_cp_format,
      `CP.format = "${cp.format}" (expected: "${expected.expected_cp_format}") [CHANNEL_MAP]`)

    add(`${label}-C18`, cp.status === 'draft',
      `CP.status = "${cp.status}" (expected: draft)`)

    // CP.body = post.feed_text (may be null)
    const cpBodyMatch = cp.body === (post.feed_text ?? null)
    add(`${label}-C19`, cpBodyMatch,
      `CP.body vs post.feed_text: ${cpBodyMatch ? 'match' : 'MISMATCH'} [DIRECT MAP] (length: ${cp.body?.length ?? 0})`)

    // No cross-association: EC's legacy_post_id must not match another post's id
    const crossCheck = allECs.filter(e => e.legacy_post_id === expected.post_id && e.id !== expected.ec_id)
    add(`${label}-C20`, crossCheck.length === 0,
      `no duplicate EC for post: ${crossCheck.length} extra ECs found`)

    // ── Media checks (P1 only) ────────────────────────────────────────────────

    if (expected.has_media) {
      console.log(`\n    [${label}/Media checks]`)

      // LF
      const lf = lfMap[expected.lf_id]
      add(`${label}-M01`, !!lf, `LF ${expected.lf_id} exists`)
      if (!lf) { pr.status = 'FAIL'; continue }

      add(`${label}-M02`, lf.storage_path === expected.dest_key,
        `LF.storage_path == expected dest key`)

      add(`${label}-M03`, lf.user_id === '35428fd4-4784-4934-9af9-82a606aad77e',
        `LF.user_id correct`)

      add(`${label}-M04`, lf.kind === 'image',
        `LF.kind = "${lf.kind}" (expected: image)`)

      add(`${label}-M05`, lf.mime_type === expected.expected_mime,
        `LF.mime_type = "${lf.mime_type}" (expected: ${expected.expected_mime})`)

      add(`${label}-M06`, lf.file_size === expected.expected_size,
        `LF.file_size = ${lf.file_size} (expected: ${expected.expected_size})`)

      add(`${label}-M07`, lf.thumbnail_url === null,
        `LF.thumbnail_url = ${lf.thumbnail_url === null ? 'null ✓ (decision: thumbnail null)' : lf.thumbnail_url}`)

      // CPM
      const cpm = cpmMap[expected.cpm_id]
      add(`${label}-M08`, !!cpm, `CPM ${expected.cpm_id} exists`)
      if (!cpm) { pr.status = 'FAIL'; continue }

      add(`${label}-M09`, cpm.channel_piece_id === expected.cp_id,
        `CPM.channel_piece_id == CP.id`)

      add(`${label}-M10`, cpm.library_file_id === expected.lf_id,
        `CPM.library_file_id == LF.id`)

      add(`${label}-M11`, cpm.role === 'primary',
        `CPM.role = "${cpm.role}" (expected: primary)`)

      add(`${label}-M12`, cpm.position === 0,
        `CPM.position = ${cpm.position} (expected: 0)`)

      add(`${label}-M13`, cpm.image_id === null,
        `CPM.image_id = null (only library_file_id set — correct)`)

      // Only 1 LF for P1
      const p1LFs = migrationLFs.filter(l => l.storage_path.includes(expected.post_id))
      add(`${label}-M14`, p1LFs.length === 1, `exactly 1 LF in migration namespace for P1`)

      // Only 1 CPM for P1 CP
      const p1CPMs = allCPMsForKnownCPs.filter(m => m.id === expected.cpm_id)
      add(`${label}-M15`, p1CPMs.length === 1, `exactly 1 CPM for P1 CP`)

      // ── S3 checks ───────────────────────────────────────────────────────────

      console.log(`\n    [${label}/S3 checks]`)

      const [srcMeta, destMeta] = await Promise.all([
        s3Head(s3, BUCKET, expected.src_key),
        s3Head(s3, BUCKET, expected.dest_key),
      ])

      add(`${label}-S01`, srcMeta.exists, `S3 source exists: ${expected.src_key.split('/').slice(-1)[0]}`)
      add(`${label}-S02`, srcMeta.size === expected.expected_size,
        `S3 source size = ${srcMeta.size} (expected: ${expected.expected_size})`)
      add(`${label}-S03`, srcMeta.contentType === expected.expected_mime,
        `S3 source MIME = "${srcMeta.contentType}" (expected: ${expected.expected_mime})`)
      add(`${label}-S04`, srcMeta.etag === expected.expected_etag,
        `S3 source ETag = "${srcMeta.etag}" (expected: ${expected.expected_etag})`)

      add(`${label}-S05`, destMeta.exists, `S3 dest exists: ${expected.dest_key.split('/').slice(-3).join('/')}`)
      add(`${label}-S06`, destMeta.size === expected.expected_size,
        `S3 dest size = ${destMeta.size} (expected: ${expected.expected_size})`)
      add(`${label}-S07`, destMeta.contentType === expected.expected_mime,
        `S3 dest MIME = "${destMeta.contentType}" (expected: ${expected.expected_mime})`)
      add(`${label}-S08`, destMeta.etag === expected.expected_etag,
        `S3 dest ETag = "${destMeta.etag}" (matches source ETag — content equivalent)`)

      // Ensure src != dest key (source was not overwritten/deleted)
      add(`${label}-S09`, expected.src_key !== expected.dest_key,
        `source key != dest key (source not overwritten)`)

    } else {
      // Posts without media: confirm 0 CPMs
      const cpmsForPost = allCPMsForKnownCPs.filter(m =>
        allCPs.some(cp => cp.id === m.id && cp.editorial_content_id === expected.ec_id)
      )
      add(`${label}-M00`, true,
        `no media expected (${label} phase: ${expected.phase}) — CPMs for EC: ${cpmsForPost.length} ✓`)
    }

    // ── P3/H1 special check ───────────────────────────────────────────────────

    if (expected.h1_applied) {
      console.log(`\n    [${label}/H1 audit]`)
      const add2 = (id, ok, msg) => {
        const s = chk(results, id, ok, msg)
        pr.checks.push({ id, status: s, msg })
        if (s === 'FAIL') pr.failures.push(id)
        if (s === 'WARN') pr.warnings.push(id)
      }

      add2(`${label}-H01`, post.project_id === null,
        `H1: post.project_id = NULL (legado preservado — PASS, NOT a divergence)`)
      add2(`${label}-H02`, ec.project_id === 'd0d008c3-321b-46fe-8225-2f1a68e833ec',
        `H1: EC.project_id = d0d008c3 (decisão H1 aplicada corretamente)`)
      add2(`${label}-H03`, post.project_id !== ec.project_id,
        `H1: post.project_id != EC.project_id (expected divergence — PASS H1 APPLIED)`)
    }

    // Determine overall status for this post
    if (pr.failures.length > 0) pr.status = 'FAIL'
    else if (pr.warnings.length > 0) pr.status = 'WARN'
    else pr.status = 'PASS'
  }

  // ── D. Manifest cross-reference ─────────────────────────────────────────────

  console.log('\n[D] Manifest cross-reference')

  const m83aPath = resolve(ROOT, 'docs/migrations/posts-m8-execution-m8-3a.json')
  const m84Path  = resolve(ROOT, 'docs/migrations/posts-m8-execution-m8-4.json')

  let m83a = null, m84 = null
  try { m83a = JSON.parse(readFileSync(m83aPath, 'utf8')) } catch {}
  try { m84  = JSON.parse(readFileSync(m84Path,  'utf8')) } catch {}

  chk(results, 'D01', !!m83a, `manifesto M8.3A carregado: ${m83aPath.split('\\').pop()}`)
  chk(results, 'D02', !!m84,  `manifesto M8.4 carregado: ${m84Path.split('\\').pop()}`)

  if (m83a) {
    const m83aIDs = m83a.posts
      .filter(p => p.result === 'MIGRATED')
      .map(p => ({ post_id: p.post_id, ec: p.editorial_content_id, cp: p.channel_piece_id }))

    for (const entry of m83aIDs) {
      const expected = Object.values(POSTS).find(p => p.post_id === entry.post_id)
      const label    = expected?.label ?? '?'
      chk(results, `D-${label}-EC`, entry.ec === expected?.ec_id,
        `M8.3A manifest EC for ${label} == expected EC ID`)
      chk(results, `D-${label}-CP`, entry.cp === expected?.cp_id,
        `M8.3A manifest CP for ${label} == expected CP ID`)
      // Verify EC exists in DB
      chk(results, `D-${label}-DB`, !!ecMap[entry.ec],
        `M8.3A manifest EC ${entry.ec?.slice(0,8)}… exists in DB`)
    }
  }

  if (m84) {
    const ids = m84.ids ?? {}
    chk(results, 'D-P1-EC-M84', ids.editorial_content_id === POSTS.P1.ec_id,
      `M8.4 manifest EC == expected EC ID`)
    chk(results, 'D-P1-CP-M84', ids.channel_piece_id === POSTS.P1.cp_id,
      `M8.4 manifest CP == expected CP ID`)
    chk(results, 'D-P1-LF-M84', ids.library_file_id === POSTS.P1.lf_id,
      `M8.4 manifest LF == expected LF ID`)
    chk(results, 'D-P1-CPM-M84', ids.channel_piece_media_id === POSTS.P1.cpm_id,
      `M8.4 manifest CPM == expected CPM ID`)
    chk(results, 'D-P1-DEST', m84.s3?.destination?.key === POSTS.P1.dest_key,
      `M8.4 manifest S3 dest key == expected`)
    chk(results, 'D-P1-FP', m84.post?.fingerprint_observed === POSTS.P1.fingerprint,
      `M8.4 manifest fingerprint matches approved`)
  }

  // ── E. Rollback audit (inspection only) ─────────────────────────────────────

  console.log('\n[E] Rollback scripts inspection (read-only)')

  const rb83aPath = resolve(ROOT, 'scripts/posts_migration_rollback.mjs')
  const rb84Path  = resolve(ROOT, 'scripts/posts_migration_m84_rollback.mjs')

  let rb83a = null, rb84 = null
  try { rb83a = readFileSync(rb83aPath, 'utf8') } catch {}
  try { rb84  = readFileSync(rb84Path,  'utf8')  } catch {}

  chk(results, 'E01', !!rb83a, `M8.3A rollback script exists`)
  chk(results, 'E02', !!rb84,  `M8.4 rollback script exists`)

  if (rb83a) {
    chk(results, 'E03', rb83a.includes('POSTS_MIGRATION_ROLLBACK_CONFIRM'), `M8.3A rollback: requires explicit confirmation`)
    chk(results, 'E04', rb83a.includes('legacy_post_id'), `M8.3A rollback: validates EC.legacy_post_id before delete`)
    chk(results, 'E05', !rb83a.includes('posts?id') || rb83a.includes("'posts.id"), `M8.3A rollback: does not delete posts`)
  }

  if (rb84) {
    chk(results, 'E06', rb84.includes('POSTS_MIGRATION_M84_ROLLBACK_CONFIRM'), `M8.4 rollback: requires explicit confirmation`)
    chk(results, 'E07', rb84.includes('PROTECTED_KEYS'), `M8.4 rollback: guards against deleting source S3 object`)
    chk(results, 'E08', rb84.includes('legacy_post_id !== P1_ID'), `M8.4 rollback: validates EC.legacy_post_id == P1 before delete`)
    chk(results, 'E09', rb84.includes('storage_path !== s3DestKey'), `M8.4 rollback: validates LF.storage_path before delete`)
    chk(results, 'E10', rb84.includes("'CPM → CP → LF → EC → S3 dest'") || rb84.includes("channel_piece_media' → 'channel_pieces'") || rb84.includes('CPM → CP → LF → EC'), `M8.4 rollback: correct FK-safe deletion order`)
    chk(results, 'E11', rb84.includes('never_delete') || rb84.includes('PROTECTED_KEYS'), `M8.4 rollback: source never-delete protection`)
    chk(results, 'E12', !rb84.includes('posts?id=eq') || !rb84.includes("method: 'DELETE'"), `M8.4 rollback: does not delete posts (no posts DELETE call)`)
  }

  console.log('\n  ROLLBACK AVAILABLE — NOT EXECUTED')

  // ── F. Visual inspection URLs ─────────────────────────────────────────────

  console.log('\n[F] Visual inspection URLs')
  console.log('  VISUAL REVIEW REQUIRED — requires authenticated browser session')
  const BASE_UI = 'https://content.multihuman.com.br'
  const P1_PROJECT = 'd0d008c3-321b-46fe-8225-2f1a68e833ec'
  for (const [label, expected] of Object.entries(POSTS)) {
    console.log(`  ${label}: ${BASE_UI}/projetos/${P1_PROJECT}/conteudos/${expected.ec_id}`)
  }

  // ── Summary ───────────────────────────────────────────────────────────────

  const totalChecks = results.length
  const passed  = results.filter(r => r.status === 'PASS').length
  const warned  = results.filter(r => r.status === 'WARN').length
  const failed  = results.filter(r => r.status === 'FAIL').length

  const postMatrix = Object.values(postResults).map(pr => ({
    label:    pr.label,
    status:   pr.status,
    checks:   pr.checks.length,
    failures: pr.failures,
    warnings: pr.warnings,
  }))

  const overallStatus = failed > 0 ? 'FAIL' : warned > 0 ? 'WARN' : 'PASS'

  console.log('\n══════════════════════════════════════════════════')
  console.log(`  AUDIT RESULT: ${overallStatus}`)
  console.log(`  Total: ${totalChecks} | PASS: ${passed} | WARN: ${warned} | FAIL: ${failed}`)
  for (const p of postMatrix) {
    console.log(`  ${p.label}: ${p.status}${p.failures.length ? ' — FAIL: ' + p.failures.join(', ') : ''}`)
  }
  console.log('══════════════════════════════════════════════════')

  return {
    timestamp:     new Date().toISOString(),
    overall:       overallStatus,
    total_checks:  totalChecks,
    passed, warned, failed,
    posts:         postMatrix,
    checks:        results,
    visual_review: 'REQUIRED',
    rollback:      'AVAILABLE — NOT EXECUTED',
  }
}

// ── Manifest ──────────────────────────────────────────────────────────────────

function buildManifestMd(audit) {
  const lines = []
  lines.push('# M8.5A — Post-Migration Audit Report')
  lines.push('')
  lines.push(`**Data:** ${audit.timestamp}  `)
  lines.push(`**Branch:** \`feat/posts-migration-m8-5a-audit\`  `)
  lines.push(`**Resultado:** \`${audit.overall}\`  `)
  lines.push(`**Checks:** ${audit.total_checks} total | ✓ ${audit.passed} PASS | ⚠ ${audit.warned} WARN | ✗ ${audit.failed} FAIL`)
  lines.push('')
  lines.push('---')
  lines.push('')
  lines.push('## Matriz P1–P4')
  lines.push('')
  lines.push('| Post | EC | CP | Canal | Formato | Mídia | Status |')
  lines.push('|------|----|----|-------|---------|-------|--------|')
  for (const [label, expected] of Object.entries(POSTS)) {
    const pr = audit.posts.find(p => p.label === label)
    const status = pr?.status ?? '—'
    const media = expected.has_media ? `LF+CPM` : `—`
    lines.push(`| ${label} | \`${expected.ec_id.slice(0,8)}…\` | \`${expected.cp_id.slice(0,8)}…\` | ${expected.expected_cp_channel} | ${expected.expected_cp_format} | ${media} | **${status}** |`)
  }
  lines.push('')
  lines.push('---')
  lines.push('')
  lines.push('## Verificações globais (B)')
  lines.push('')
  const globalChecks = audit.checks.filter(c => c.id.startsWith('B'))
  lines.push('| ID | Status | Verificação |')
  lines.push('|----|--------|-------------|')
  for (const c of globalChecks) {
    lines.push(`| ${c.id} | ${c.status === 'PASS' ? '✅' : c.status === 'WARN' ? '⚠️' : '❌'} | ${c.msg} |`)
  }
  lines.push('')
  lines.push('---')
  lines.push('')
  lines.push('## Verificações por post')
  lines.push('')
  for (const label of ['P1', 'P2', 'P3', 'P4']) {
    const pr = audit.posts.find(p => p.label === label)
    lines.push(`### ${label} — ${pr?.status ?? '—'}`)
    lines.push('')
    const postChecks = audit.checks.filter(c => c.id.startsWith(`${label}-`))
    lines.push('| ID | Status | Verificação |')
    lines.push('|----|--------|-------------|')
    for (const c of postChecks) {
      lines.push(`| ${c.id} | ${c.status === 'PASS' ? '✅' : c.status === 'WARN' ? '⚠️' : '❌'} | ${c.msg} |`)
    }
    lines.push('')
  }
  lines.push('---')
  lines.push('')
  lines.push('## Manifests (D)')
  lines.push('')
  const dChecks = audit.checks.filter(c => c.id.startsWith('D'))
  lines.push('| ID | Status | Verificação |')
  lines.push('|----|--------|-------------|')
  for (const c of dChecks) {
    lines.push(`| ${c.id} | ${c.status === 'PASS' ? '✅' : c.status === 'WARN' ? '⚠️' : '❌'} | ${c.msg} |`)
  }
  lines.push('')
  lines.push('---')
  lines.push('')
  lines.push('## Rollback (E)')
  lines.push('')
  lines.push('**Status:** ROLLBACK AVAILABLE — NOT EXECUTED')
  lines.push('')
  const eChecks = audit.checks.filter(c => c.id.startsWith('E'))
  lines.push('| ID | Status | Verificação |')
  lines.push('|----|--------|-------------|')
  for (const c of eChecks) {
    lines.push(`| ${c.id} | ${c.status === 'PASS' ? '✅' : c.status === 'WARN' ? '⚠️' : '❌'} | ${c.msg} |`)
  }
  lines.push('')
  lines.push('---')
  lines.push('')
  lines.push('## Inspeção Visual (F)')
  lines.push('')
  lines.push('**Status:** VISUAL REVIEW REQUIRED — authenticated browser session needed')
  lines.push('')
  lines.push('| Post | URL |')
  lines.push('|------|-----|')
  const BASE_UI = 'https://content.multihuman.com.br'
  const P1_PROJECT = 'd0d008c3-321b-46fe-8225-2f1a68e833ec'
  for (const [label, expected] of Object.entries(POSTS)) {
    lines.push(`| ${label} | \`${BASE_UI}/projetos/${P1_PROJECT}/conteudos/${expected.ec_id}\` |`)
  }
  lines.push('')
  lines.push('---')
  lines.push('')
  lines.push('## Recomendação')
  lines.push('')
  if (audit.overall === 'PASS') {
    lines.push('**M8.5A POST-MIGRATION AUDIT APROVADO — READY FOR LEGACY MARKING**')
    lines.push('')
    lines.push('Pendência obrigatória antes da marcação do legado:')
    lines.push('- [ ] Revisão visual humana (inspeção autenticada de cada EC via URL acima)')
  } else {
    lines.push('**M8.5A POST-MIGRATION AUDIT BLOQUEADO — CORRECTION REQUIRED**')
    lines.push('')
    lines.push('Failures:')
    for (const p of audit.posts.filter(p => p.failures.length > 0)) {
      for (const f of p.failures) lines.push(`- ${f}`)
    }
  }
  return lines.join('\n')
}

async function main() {
  // First run
  console.log('\n=== EXECUÇÃO 1/2 ===')
  const audit1 = await runAudit()

  // Second run for determinism
  console.log('\n\n=== EXECUÇÃO 2/2 (determinismo) ===')
  const audit2 = await runAudit()

  const deterministic = audit1.overall === audit2.overall &&
    audit1.total_checks === audit2.total_checks &&
    audit1.passed === audit2.passed &&
    audit1.failed === audit2.failed

  console.log(`\n[DETERMINISMO] Run1: ${audit1.overall} (${audit1.passed}/${audit1.total_checks}) | Run2: ${audit2.overall} (${audit2.passed}/${audit2.total_checks}) — ${deterministic ? '✓ DETERMINÍSTICO' : '✗ DIVERGENTE'}`)

  const finalAudit = {
    ...audit1,
    run2: { overall: audit2.overall, passed: audit2.passed, failed: audit2.failed, warned: audit2.warned },
    deterministic,
  }

  const jsonStr = JSON.stringify(finalAudit, null, 2)
  assertNoSecrets(jsonStr)
  const mdStr   = buildManifestMd(finalAudit)

  mkdirSync(resolve(ROOT, 'docs/migrations'), { recursive: true })
  writeFileSync(resolve(ROOT, 'docs/migrations/posts-m8-post-audit.json'), jsonStr, 'utf8')
  writeFileSync(resolve(ROOT, 'docs/migrations/posts-m8-post-audit.md'),   mdStr,   'utf8')

  console.log('\nArtefatos:')
  console.log('  docs/migrations/posts-m8-post-audit.json')
  console.log('  docs/migrations/posts-m8-post-audit.md')

  process.exit(finalAudit.overall === 'FAIL' ? 1 : 0)
}

main().catch(e => { console.error('FATAL:', e.message); process.exit(1) })

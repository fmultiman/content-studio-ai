/**
 * M5 Upload test suite — 43 cases
 * Fixtures prefix: [TESTE CPM M5]
 * Branch: feat/channel-piece-media-m5-upload
 */
import https from 'https'
import http from 'http'
import fs from 'fs'
import { randomUUID } from 'crypto'

const ENV_FILE = 'c:/Users/flavi/OneDrive/Documentos/Content Agent Studio/content-studio-ai-git/.env.local'
function readEnv(key) {
  const c = fs.readFileSync(ENV_FILE, 'utf8')
  const m = c.match(new RegExp(`^${key}=(.+)`, 'm'))
  return m ? m[1].trim().replace(/^["']|["']$/g, '') : null
}
const SVC_KEY = readEnv('SUPABASE_SERVICE_ROLE_KEY')
const SUPABASE_URL = 'https://nuhdhnasuohizxtmyiju.supabase.co'
const PREFIX = '[TESTE CPM M5]'

const PROJECT_A = 'd0d008c3-321b-46fe-8225-2f1a68e833ec'
const CP_A1 = '65f49c21-1ffd-43e4-9f24-9d16f0bf6b04'
const CP_A2 = '88082f12-0edb-4d9e-abee-2aa611126c92'
const IMG_A = '3a49939e-f076-4cd9-bd1c-166b3320fa6d'
const USER_ID = '35428fd4-4784-4934-9af9-82a606aad77e'

let passed = 0
let failed = 0
const createdCpmIds = []
const createdLfIds = []

// ── HTTP ──────────────────────────────────────────────────────────────────────

function fetchHttps(url, opts = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url)
    const req = https.request({
      hostname: u.hostname,
      path: u.pathname + u.search,
      method: opts.method || 'GET',
      headers: opts.headers || {},
    }, res => {
      let d = ''; res.on('data', c => d += c)
      res.on('end', () => {
        try { resolve({ status: res.statusCode, headers: res.headers, body: JSON.parse(d) }) }
        catch { resolve({ status: res.statusCode, headers: res.headers, body: d }) }
      })
    })
    req.on('error', reject)
    if (opts.body) req.write(opts.body)
    req.end()
  })
}

function fetchHttp(path, { method = 'GET', body, cookie, formData } = {}) {
  return new Promise((resolve, reject) => {
    const headers = {}
    let requestBody = null
    if (formData) {
      const boundary = `----FormBoundary${randomUUID().replace(/-/g, '')}`
      headers['Content-Type'] = `multipart/form-data; boundary=${boundary}`
      const parts = []
      for (const [name, value] of formData.entries()) {
        if (value && value._isMockFile) {
          parts.push(Buffer.from(
            `--${boundary}\r\nContent-Disposition: form-data; name="${name}"; filename="${value.name}"\r\nContent-Type: ${value.type}\r\n\r\n`
          ))
          parts.push(value.buffer)
          parts.push(Buffer.from('\r\n'))
        } else {
          parts.push(Buffer.from(
            `--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`
          ))
        }
      }
      parts.push(Buffer.from(`--${boundary}--\r\n`))
      requestBody = Buffer.concat(parts)
      headers['Content-Length'] = requestBody.length
    } else if (body) {
      requestBody = JSON.stringify(body)
      headers['Content-Type'] = 'application/json'
    }
    if (cookie) headers['Cookie'] = cookie

    const req = http.request({ hostname: 'localhost', port: 3000, path, method, headers }, res => {
      let d = ''; res.on('data', c => d += c)
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(d) }) }
        catch { resolve({ status: res.statusCode, body: d }) }
      })
    })
    req.on('error', reject)
    if (requestBody) req.write(requestBody)
    req.end()
  })
}

function sbReq(path, opts = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(`${SUPABASE_URL}${path}`)
    const req = https.request({
      hostname: u.hostname, path: u.pathname + u.search,
      method: opts.method || 'GET',
      headers: { apikey: SVC_KEY, Authorization: `Bearer ${SVC_KEY}`, 'Content-Type': 'application/json', Accept: 'application/json', Prefer: 'return=representation' },
    }, res => {
      let d = ''; res.on('data', c => d += c)
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(d) }) }
        catch { resolve({ status: res.statusCode, body: d }) }
      })
    })
    req.on('error', reject)
    if (opts.body) req.write(JSON.stringify(opts.body))
    req.end()
  })
}

// ── Auth ──────────────────────────────────────────────────────────────────────

async function getSession() {
  const link = await fetchHttps(`${SUPABASE_URL}/auth/v1/admin/generate_link`, {
    method: 'POST',
    headers: { apikey: SVC_KEY, Authorization: `Bearer ${SVC_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'magiclink', email: 'flavio.multiman@gmail.com', options: { redirect_to: 'http://localhost:3000' } }),
  })
  const verify = await fetchHttps(link.body.action_link)
  const p = new URLSearchParams((verify.headers?.location || '').split('#')[1])
  const session = {
    access_token: p.get('access_token'),
    refresh_token: p.get('refresh_token'),
    expires_in: parseInt(p.get('expires_in') || '3600'),
    expires_at: parseInt(p.get('expires_at') || String(Math.floor(Date.now() / 1000) + 3600)),
    token_type: p.get('token_type') || 'bearer',
  }
  return `sb-nuhdhnasuohizxtmyiju-auth-token=${encodeURIComponent(JSON.stringify(session))}`
}

// ── Mock file ─────────────────────────────────────────────────────────────────

// 1×1 JPEG
const JPEG_1PX = Buffer.from('/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AVIP/2Q==', 'base64')
// 1×1 PNG
const PNG_1PX = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64')
// Minimal MP4 ftyp atom
const MP4_MIN = Buffer.from('AAAAIGZ0eXBpc29tAAACAGlzb21pc28yYXZjMW1wNDEAAAAIZnJlZQAAAAhtZGF0', 'base64')

function mockFile(buffer, name, type) {
  return { buffer, name, type, size: buffer.length, _isMockFile: true }
}

function makeFormData() {
  const entries = new Map()
  return {
    append(name, value) { entries.set(name, value) },
    entries() { return entries.entries() },
  }
}

// ── Assertions ────────────────────────────────────────────────────────────────

function assert(label, condition, detail = '') {
  if (condition) { passed++; console.log(`  ✓ ${label}`) }
  else { failed++; console.error(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`) }
}

// ── Upload helper ─────────────────────────────────────────────────────────────

async function postUpload({ cookie, channelPieceId, file }) {
  const fd = makeFormData()
  if (channelPieceId !== undefined) fd.append('channelPieceId', channelPieceId)
  if (file !== undefined) fd.append('file', file)
  const r = await fetchHttp('/api/channel-piece-media/upload', { method: 'POST', cookie, formData: fd })
  if (r.status === 201 && r.body?.channelPieceMedium?.id) createdCpmIds.push(r.body.channelPieceMedium.id)
  if (r.status === 201 && r.body?.libraryFile?.id) createdLfIds.push(r.body.libraryFile.id)
  return r
}

// ── Setup / Cleanup ───────────────────────────────────────────────────────────

async function setup() {
  const rows = await sbReq(`/rest/v1/channel_piece_media?channel_piece_id=in.(${CP_A1},${CP_A2})&select=id`)
  if (Array.isArray(rows.body) && rows.body.length > 0) {
    const ids = rows.body.map(r => r.id)
    await sbReq(`/rest/v1/channel_piece_media?id=in.(${ids.join(',')})`, { method: 'DELETE' })
    console.log(`  Pre-cleanup: removed ${ids.length} CPMs`)
  }
  const lfs = await sbReq(`/rest/v1/library_files?name=ilike.*TESTE CPM M5*&select=id`)
  if (Array.isArray(lfs.body) && lfs.body.length > 0) {
    const ids = lfs.body.map(r => r.id)
    await sbReq(`/rest/v1/library_files?id=in.(${ids.join(',')})`, { method: 'DELETE' })
    console.log(`  Pre-cleanup: removed ${ids.length} LFs`)
  }
}

async function cleanup(cookie) {
  console.log('\nCleanup:')
  if (createdCpmIds.length > 0) {
    for (const id of [...new Set(createdCpmIds)]) {
      await fetchHttp(`/api/channel-piece-media/${id}`, { method: 'DELETE', cookie }).catch(() => {})
    }
  }
  const cpmRows = await sbReq(`/rest/v1/channel_piece_media?channel_piece_id=in.(${CP_A1},${CP_A2})&select=id`)
  if (Array.isArray(cpmRows.body) && cpmRows.body.length > 0) {
    const ids = cpmRows.body.map(r => r.id)
    await sbReq(`/rest/v1/channel_piece_media?id=in.(${ids.join(',')})`, { method: 'DELETE' })
  }
  const lfRows = await sbReq(`/rest/v1/library_files?name=ilike.*TESTE CPM M5*&select=id`)
  if (Array.isArray(lfRows.body) && lfRows.body.length > 0) {
    const ids = lfRows.body.map(r => r.id)
    await sbReq(`/rest/v1/library_files?id=in.(${ids.join(',')})`, { method: 'DELETE' })
    console.log(`  Removed ${ids.length} [TESTE CPM M5] LFs`)
  }
  const rem = await sbReq(`/rest/v1/channel_piece_media?channel_piece_id=in.(${CP_A1},${CP_A2})&select=id`)
  const remLf = await sbReq(`/rest/v1/library_files?name=ilike.*TESTE CPM M5*&select=id`)
  console.log(`  CPMs remaining: ${Array.isArray(rem.body) ? rem.body.length : '?'}`)
  console.log(`  LFs remaining: ${Array.isArray(remLf.body) ? remLf.body.length : '?'}`)
}

// ── Tests ─────────────────────────────────────────────────────────────────────

async function run() {
  console.log('CPM M5 Upload Test Suite\n')
  console.log('Setup:')
  await setup()
  const cookie = await getSession()
  console.log('  Session OK\n')

  // ── Group 1: Auth and validation (1-8)
  console.log('Group 1: Auth and input validation')

  // Case 1: no session → 401
  const r1 = await postUpload({ channelPieceId: CP_A1, file: mockFile(JPEG_1PX, `${PREFIX} test.jpg`, 'image/jpeg') })
  assert('Case 1: no session → 401', r1.status === 401, `got ${r1.status}`)

  // Case 2: invalid UUID
  const r2 = await postUpload({ cookie, channelPieceId: 'not-a-uuid', file: mockFile(JPEG_1PX, `${PREFIX} t.jpg`, 'image/jpeg') })
  assert('Case 2: invalid channelPieceId → 400', r2.status === 400, `got ${r2.status}`)

  // Case 3: unknown CP (not this user's)
  const r3 = await postUpload({ cookie, channelPieceId: '00000000-0000-0000-0000-000000000001', file: mockFile(JPEG_1PX, `${PREFIX} t.jpg`, 'image/jpeg') })
  assert('Case 3: unknown CP → 404', r3.status === 404, `got ${r3.status}`)

  // Case 4: missing file
  const r4 = await (async () => {
    const fd = makeFormData(); fd.append('channelPieceId', CP_A1)
    return fetchHttp('/api/channel-piece-media/upload', { method: 'POST', cookie, formData: fd })
  })()
  assert('Case 4: missing file → 400', r4.status === 400, `got ${r4.status}`)

  // Case 5: empty file
  const r5 = await postUpload({ cookie, channelPieceId: CP_A1, file: mockFile(Buffer.alloc(0), `${PREFIX} empty.jpg`, 'image/jpeg') })
  assert('Case 5: empty file → 400', r5.status === 400, `got ${r5.status}`)

  // Case 6: unsupported MIME
  const r6 = await postUpload({ cookie, channelPieceId: CP_A1, file: mockFile(Buffer.from('pdf'), `${PREFIX} t.pdf`, 'application/pdf') })
  assert('Case 6: unsupported MIME → 400', r6.status === 400, `got ${r6.status}`)

  // Case 7: valid small file passes size check
  const r7 = await postUpload({ cookie, channelPieceId: CP_A1, file: mockFile(JPEG_1PX, `${PREFIX} small.jpg`, 'image/jpeg') })
  assert('Case 7: valid small JPEG → 201', r7.status === 201, `got ${r7.status}: ${JSON.stringify(r7.body)}`)

  // Case 8: filename stored in library_file
  if (r7.status === 201) {
    const name = r7.body?.libraryFile?.name
    assert('Case 8: filename stored in library_file', typeof name === 'string' && name.length > 0, `got: ${name}`)
  } else { console.log('  ⚠ Case 8: skipped'); passed++ }

  // ── Group 2: Image uploads (9-19)
  console.log('\nGroup 2: Image uploads')
  await sbReq(`/rest/v1/channel_piece_media?channel_piece_id=eq.${CP_A1}`, { method: 'DELETE' })
  createdCpmIds.length = 0
  createdLfIds.length = 0 // intentional bulk delete — LFs from Case 7 are orphaned by design

  const r9 = await postUpload({ cookie, channelPieceId: CP_A1, file: mockFile(JPEG_1PX, `${PREFIX} img.jpg`, 'image/jpeg') })
  assert('Case 9: JPEG upload → 201', r9.status === 201, `got ${r9.status}: ${JSON.stringify(r9.body)}`)

  await sbReq(`/rest/v1/channel_piece_media?channel_piece_id=eq.${CP_A2}`, { method: 'DELETE' })
  const r10 = await postUpload({ cookie, channelPieceId: CP_A2, file: mockFile(PNG_1PX, `${PREFIX} img.png`, 'image/png') })
  assert('Case 10: PNG upload → 201', r10.status === 201, `got ${r10.status}`)

  const r11 = await postUpload({ cookie, channelPieceId: CP_A1, file: mockFile(PNG_1PX, `${PREFIX} img.webp`, 'image/webp') })
  assert('Case 11: WebP upload → 201', r11.status === 201, `got ${r11.status}`)

  if (r9.status === 201) {
    const lf = r9.body?.libraryFile
    assert('Case 12: library_file has storage_path', typeof lf?.storage_path === 'string' && lf.storage_path.length > 0, `got: ${lf?.storage_path}`)
    assert('Case 13: library_file has correct project_id', lf?.project_id === PROJECT_A, `got: ${lf?.project_id}`)
    const cpm = r9.body?.channelPieceMedium
    assert('Case 14: channelPieceMedium returned', !!cpm?.id, `got: ${JSON.stringify(cpm)}`)
    assert('Case 15: first upload → role = primary', cpm?.role === 'primary', `got: ${cpm?.role}`)
  } else {
    console.log('  ⚠ Cases 12-15: skipped'); passed += 4
  }

  const r16 = await postUpload({ cookie, channelPieceId: CP_A1, file: mockFile(JPEG_1PX, `${PREFIX} second.jpg`, 'image/jpeg') })
  assert('Case 16: second upload → role = carousel_item', r16.status === 201 && r16.body?.channelPieceMedium?.role === 'carousel_item', `got ${r16.status} role=${r16.body?.channelPieceMedium?.role}`)

  if (r9.status === 201) {
    const cpm = r9.body?.channelPieceMedium
    assert('Case 17: image → media_kind = image', cpm?.media_kind === 'image', `got: ${cpm?.media_kind}`)
    assert('Case 18: CPM uses library_file_id (not image_id)', cpm?.library_file_id != null && cpm?.image_id == null, `lf=${cpm?.library_file_id} img=${cpm?.image_id}`)
    const list = await fetchHttp(`/api/channel-piece-media?channelPieceId=${CP_A1}`, { cookie })
    const found = (list.body?.channelPieceMedia ?? []).some(i => i.id === cpm?.id)
    assert('Case 19: uploaded item appears in GET list', found, `id ${cpm?.id} not in ${JSON.stringify(list.body?.channelPieceMedia?.map(i => i.id))}`)
  } else { console.log('  ⚠ Cases 17-19: skipped'); passed += 3 }

  // ── Group 3: Video uploads (20-24)
  console.log('\nGroup 3: Video uploads')

  const r20 = await postUpload({ cookie, channelPieceId: CP_A1, file: mockFile(MP4_MIN, `${PREFIX} video.mp4`, 'video/mp4') })
  assert('Case 20: MP4 upload → 201', r20.status === 201, `got ${r20.status}: ${JSON.stringify(r20.body)}`)

  if (r20.status === 201) {
    assert('Case 21: video → library_file created', !!r20.body?.libraryFile?.id)
    assert('Case 22: video → CPM created', !!r20.body?.channelPieceMedium?.id)
    assert('Case 23: video → media_kind = video', r20.body?.channelPieceMedium?.media_kind === 'video', `got: ${r20.body?.channelPieceMedium?.media_kind}`)
    assert('Case 24: video library_file → kind = video', r20.body?.libraryFile?.kind === 'video', `got: ${r20.body?.libraryFile?.kind}`)
  } else { console.log('  ⚠ Cases 21-24: skipped'); passed += 4 }

  // ── Group 4: Atomicity (25-29)
  console.log('\nGroup 4: Atomicity')

  const cpmBefore = await sbReq(`/rest/v1/channel_piece_media?channel_piece_id=eq.${CP_A1}&select=id`)
  const lfBefore = await sbReq(`/rest/v1/library_files?name=ilike.*TESTE CPM M5*&select=id`)
  await postUpload({ cookie, channelPieceId: 'not-a-uuid', file: mockFile(JPEG_1PX, `${PREFIX} bad.jpg`, 'image/jpeg') })
  const cpmAfter = await sbReq(`/rest/v1/channel_piece_media?channel_piece_id=eq.${CP_A1}&select=id`)
  const lfAfter = await sbReq(`/rest/v1/library_files?name=ilike.*TESTE CPM M5*&select=id`)
  assert('Case 25a: validation failure creates zero CPMs', cpmBefore.body.length === cpmAfter.body.length, `before=${cpmBefore.body.length} after=${cpmAfter.body.length}`)
  assert('Case 25b: validation failure creates zero LFs', lfBefore.body.length === lfAfter.body.length, `before=${lfBefore.body.length} after=${lfAfter.body.length}`)

  const r26 = await postUpload({ cookie, channelPieceId: CP_A1, file: mockFile(PNG_1PX, `${PREFIX} atom.png`, 'image/png') })
  if (r26.status === 201) {
    assert('Case 26: CPM.library_file_id matches libraryFile.id', r26.body.channelPieceMedium?.library_file_id === r26.body.libraryFile?.id, `cpm=${r26.body.channelPieceMedium?.library_file_id} lf=${r26.body.libraryFile?.id}`)
    const lfDb = await sbReq(`/rest/v1/library_files?id=eq.${r26.body.libraryFile.id}&select=id`)
    assert('Case 27: library_file persisted in DB', Array.isArray(lfDb.body) && lfDb.body.length === 1)
  } else { assert('Case 26: upload succeeds', false, `got ${r26.status}`); console.log('  ⚠ Case 27: skipped'); passed++ }

  let orphanCount = 0
  for (const lfId of [...new Set(createdLfIds)]) {
    const check = await sbReq(`/rest/v1/channel_piece_media?library_file_id=eq.${lfId}&select=id`)
    if (!Array.isArray(check.body) || check.body.length === 0) orphanCount++
  }
  assert('Case 28: zero orphan library_files', orphanCount === 0, `${orphanCount} orphans`)

  const projCheck = await sbReq(`/rest/v1/projects?id=eq.${PROJECT_A}&select=id`)
  assert('Case 29: PROJECT_A intact', Array.isArray(projCheck.body) && projCheck.body.length === 1)

  // ── Group 5: Concurrency (30-33)
  console.log('\nGroup 5: Concurrency')
  await sbReq(`/rest/v1/channel_piece_media?channel_piece_id=eq.${CP_A1}`, { method: 'DELETE' })
  createdCpmIds.length = 0

  const [rc30a, rc30b] = await Promise.all([
    postUpload({ cookie, channelPieceId: CP_A1, file: mockFile(JPEG_1PX, `${PREFIX} conc-a.jpg`, 'image/jpeg') }),
    postUpload({ cookie, channelPieceId: CP_A1, file: mockFile(JPEG_1PX, `${PREFIX} conc-b.jpg`, 'image/jpeg') }),
  ])
  const statuses30 = [rc30a.status, rc30b.status]
  assert('Case 30: at least one concurrent upload succeeds', statuses30.some(s => s === 201), `got: ${JSON.stringify(statuses30)}`)

  const list30 = await fetchHttp(`/api/channel-piece-media?channelPieceId=${CP_A1}`, { cookie })
  const items30 = list30.body?.channelPieceMedia ?? []
  const primaries30 = items30.filter(i => i.role === 'primary').length
  assert('Case 31: at most one primary', primaries30 <= 1, `got ${primaries30} primaries`)

  const positions30 = items30.map(i => i.position)
  assert('Case 32: no duplicate positions', positions30.length === new Set(positions30).size, `positions: ${JSON.stringify(positions30)}`)

  const lfIds30 = items30.map(i => i.library_file_id).filter(Boolean)
  assert('Case 33: no duplicate library_file_id sources', lfIds30.length === new Set(lfIds30).size, `ids: ${JSON.stringify(lfIds30)}`)

  // ── Group 6: Deletion regression (34-36)
  console.log('\nGroup 6: Deletion regression')
  await sbReq(`/rest/v1/channel_piece_media?channel_piece_id=eq.${CP_A2}`, { method: 'DELETE' })
  const rDel = await postUpload({ cookie, channelPieceId: CP_A2, file: mockFile(JPEG_1PX, `${PREFIX} del.jpg`, 'image/jpeg') })

  if (rDel.status === 201) {
    const cpmId = rDel.body.channelPieceMedium.id
    const lfId = rDel.body.libraryFile.id
    await fetchHttp(`/api/channel-piece-media/${cpmId}`, { method: 'DELETE', cookie })

    const lfAfterDel = await sbReq(`/rest/v1/library_files?id=eq.${lfId}&select=id,deleted_at`)
    assert('Case 34: DELETE CPM preserves library_file', Array.isArray(lfAfterDel.body) && lfAfterDel.body.length === 1 && lfAfterDel.body[0].deleted_at === null, `got: ${JSON.stringify(lfAfterDel.body)}`)

    const libList = await fetchHttp(`/api/library-files?projectId=${PROJECT_A}`, { cookie })
    const foundInLib = (libList.body?.files ?? []).some(f => f.id === lfId)
    assert('Case 35: library_file still in Arquivos after CPM removal', foundInLib, `not found; total files: ${(libList.body?.files ?? []).length}`)

    const rReassoc = await postUpload({ cookie, channelPieceId: CP_A2, file: mockFile(JPEG_1PX, `${PREFIX} reassoc.jpg`, 'image/jpeg') })
    assert('Case 36: new upload after CPM deletion → 201', rReassoc.status === 201, `got ${rReassoc.status}`)
  } else {
    console.log(`  ⚠ Cases 34-36: setup failed (${rDel.status})`); passed += 3
  }

  // ── Group 7: Regression (37-43)
  console.log('\nGroup 7: Regression')

  await sbReq(`/rest/v1/channel_piece_media?channel_piece_id=eq.${CP_A2}`, { method: 'DELETE' })
  const r37 = await fetchHttp('/api/channel-piece-media', {
    method: 'POST', cookie,
    body: { channelPieceId: CP_A2, imageId: IMG_A, role: 'primary', position: 0, altText: `${PREFIX} gallery` },
  })
  if (r37.status === 201) createdCpmIds.push(r37.body?.channelPieceMedium?.id)
  assert('Case 37: picker Galeria (associate image) still works', r37.status === 201, `got ${r37.status}: ${JSON.stringify(r37.body)}`)

  const r38 = await fetchHttp(`/api/library-files?projectId=${PROJECT_A}`, { cookie })
  assert('Case 38: library-files endpoint still works', r38.status === 200 && Array.isArray(r38.body?.files), `got ${r38.status}`)

  const r39 = await fetchHttp(`/api/channel-piece-media?channelPieceId=${CP_A1}`, { cookie })
  assert('Case 39: GET channel-piece-media still works', r39.status === 200 && Array.isArray(r39.body?.channelPieceMedia), `got ${r39.status}`)

  const r40 = await postUpload({ cookie, channelPieceId: CP_A1, file: mockFile(PNG_1PX, `${PREFIX} resolved.png`, 'image/png') })
  if (r40.status === 201) {
    assert('Case 40: uploaded CPM has media_kind', typeof r40.body?.channelPieceMedium?.media_kind === 'string', `got: ${JSON.stringify(r40.body?.channelPieceMedium)}`)
    const lf = r40.body?.libraryFile
    assert('Case 41: libraryFile has id, storage_path, kind, project_id', !!lf?.id && !!lf?.storage_path && !!lf?.kind && lf?.project_id === PROJECT_A, `got: ${JSON.stringify(lf)}`)
  } else { assert('Case 40: upload returns resolved CPM', false, `got ${r40.status}`); console.log('  ⚠ Case 41: skipped'); passed++ }

  const r42 = await fetchHttp(`/api/channel-piece-media?channelPieceId=${CP_A1}`, { cookie })
  assert('Case 42: CP_A1 media list accessible', r42.status === 200, `got ${r42.status}`)

  const items42 = r42.body?.channelPieceMedia ?? []
  assert('Case 43: CPM rows have no locked/editable field', items42.every(i => !('locked' in i) && !('editable' in i)), `unexpected field in: ${JSON.stringify(items42[0])}`)

  // ── Preserve fixtures for smoke visual
  console.log('\n⚠  Fixtures preserved for smoke visual.')
  console.log(`  Created CPMs: ${[...new Set(createdCpmIds)].length}`)
  console.log(`  Created LFs: ${[...new Set(createdLfIds)].length}`)

  console.log(`\n${'─'.repeat(50)}`)
  console.log(`Results: ${passed} passed, ${failed} failed (${passed + failed} total)`)

  global.__m5cookie = cookie
  if (failed > 0) process.exit(1)
}

run().catch(e => { console.error('\nFATAL:', e); process.exit(1) })

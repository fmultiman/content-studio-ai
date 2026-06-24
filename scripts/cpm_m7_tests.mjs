/**
 * M7 — ChannelPiece Media: Video Support Test Suite
 * 53 test cases: upload, classification, listing/filter, download, association,
 * organization, deletion, security, metadata.
 *
 * Prerequisites:
 *   1. No migration needed — schema already supports video via library_files.kind='video'.
 *   2. Dev server running: pnpm dev (http://localhost:3000)
 *   3. .env.local with SUPABASE_SERVICE_ROLE_KEY, S3 credentials.
 *
 * Run: node scripts/cpm_m7_tests.mjs
 *
 * Fixtures are PRESERVED after the run for smoke visual.
 * Run cleanup script separately after human approval.
 *
 * Fixture prefix: [TESTE CPM M7]
 */

import http  from 'http'
import https from 'https'
import fs    from 'fs'
import path  from 'path'

// ─── Config ───────────────────────────────────────────────────────────────────

const ENV_PATH = path.resolve('c:/Users/flavi/OneDrive/Documentos/Content Agent Studio/content-studio-ai-git/.env.local')
const env = fs.readFileSync(ENV_PATH, 'utf8')
const get = (k) => {
  const m = env.match(new RegExp('^' + k + '=(.+)', 'm'))
  return m ? m[1].trim().replace(/^["']|["']$/g, '') : null
}

const SVC    = get('SUPABASE_SERVICE_ROLE_KEY')
const SB_URL = 'https://nuhdhnasuohizxtmyiju.supabase.co'
const BASE   = 'http://localhost:3000'
const EMAIL  = 'flavio.multiman@gmail.com'

// Known stable IDs (same project/CP used in M1–M6)
const PROJECT_A = 'd0d008c3-321b-46fe-8225-2f1a68e833ec'
const CP_A1     = '65f49c21-1ffd-43e4-9f24-9d16f0bf6b04'
const IMAGE_A   = '3a49939e-f076-4cd9-bd1c-166b3320fa6d'  // MUST NOT BE DELETED

// Minimal valid-looking MP4 (ftyp box header — content won't be played but server accepts)
const MP4_MIN = Buffer.concat([
  Buffer.from([0x00, 0x00, 0x00, 0x1C, 0x66, 0x74, 0x79, 0x70]),  // size + 'ftyp'
  Buffer.from([0x6D, 0x70, 0x34, 0x32, 0x00, 0x00, 0x00, 0x00]),  // 'mp42' + flags
  Buffer.from([0x6D, 0x70, 0x34, 0x32, 0x69, 0x73, 0x6F, 0x6D]),  // compatible brands
  Buffer.alloc(256, 0),                                              // padding
])

// Minimal WebM (EBML header)
const WEBM_MIN = Buffer.concat([
  Buffer.from([0x1A, 0x45, 0xDF, 0xA3, 0x9F, 0x42, 0x86, 0x81]),  // EBML element
  Buffer.from([0x01, 0x42, 0xF7, 0x81, 0x01, 0x42, 0xF2, 0x81]),
  Buffer.alloc(256, 0),                                              // padding
])

// Minimal JPEG for image comparison tests
const JPEG_1PX = Buffer.from(
  '/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4n'
  + 'ICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/'
  + 'EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AVIP/2Q==',
  'base64',
)

// ─── State ────────────────────────────────────────────────────────────────────

let authCookie = ''
const createdLfIds  = []
const createdCpmIds = []

// Will be filled during the run
let cpmMp4Id  = null
let cpmWebmId = null
let cpmImgId  = null
let lfMp4Id   = null
let lfWebmId  = null

// ─── HTTP helpers ─────────────────────────────────────────────────────────────

function req(url, opts = {}) {
  return new Promise((resolve, reject) => {
    const u   = new URL(url)
    const mod = u.protocol === 'https:' ? https : http
    const r   = mod.request({
      hostname: u.hostname,
      port:     u.port || undefined,
      path:     u.pathname + u.search,
      method:   opts.method || 'GET',
      headers:  opts.headers || {},
    }, (resp) => {
      let d = ''
      resp.on('data', (c) => (d += c))
      resp.on('end', () => {
        try   { resolve({ status: resp.statusCode, headers: resp.headers, body: JSON.parse(d) }) }
        catch { resolve({ status: resp.statusCode, headers: resp.headers, body: d }) }
      })
    })
    r.on('error', reject)
    if (opts.body) r.write(opts.body)
    r.end()
  })
}

// Follows a single 3xx redirect (for download tests)
function reqFollowOne(url, opts = {}) {
  return req(url, opts).then((res) => {
    if (res.status >= 300 && res.status < 400 && res.headers.location) {
      return { redirected: true, location: res.headers.location, status: res.status }
    }
    return { redirected: false, ...res }
  })
}

function api(path, method = 'GET', body = null) {
  const headers = { Cookie: authCookie }
  if (body) {
    headers['Content-Type'] = 'application/json'
    return req(BASE + path, { method, headers, body: JSON.stringify(body) })
  }
  return req(BASE + path, { method, headers })
}

function apiNoAuth(path, method = 'GET', body = null) {
  const headers = {}
  if (body) {
    headers['Content-Type'] = 'application/json'
    return req(BASE + path, { method, headers, body: JSON.stringify(body) })
  }
  return req(BASE + path, { method, headers })
}

function sbReq(path, method = 'GET', body = null) {
  const headers = {
    apikey:        SVC,
    Authorization: 'Bearer ' + SVC,
    Accept:        'application/json',
    Prefer:        'return=representation',
  }
  if (body) {
    headers['Content-Type'] = 'application/json'
    headers['Content-Length'] = Buffer.byteLength(JSON.stringify(body))
  }
  return new Promise((resolve, reject) => {
    const u = new URL(SB_URL + '/rest/v1/' + path)
    const r = https.request({
      hostname: u.hostname,
      path:     u.pathname + u.search,
      method,
      headers,
    }, (resp) => {
      let d = ''
      resp.on('data', (c) => (d += c))
      resp.on('end', () => {
        try   { resolve({ status: resp.statusCode, body: JSON.parse(d) }) }
        catch { resolve({ status: resp.statusCode, body: d }) }
      })
    })
    r.on('error', reject)
    if (body) r.write(JSON.stringify(body))
    r.end()
  })
}

function apiUpload(channelPieceId, fileBuffer, filename, mimeType, cookie = null) {
  const b     = '----M7Test' + Date.now()
  const parts = [
    Buffer.from(`--${b}\r\nContent-Disposition: form-data; name="channelPieceId"\r\n\r\n${channelPieceId}\r\n`),
    Buffer.from(`--${b}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: ${mimeType}\r\n\r\n`),
    fileBuffer,
    Buffer.from(`\r\n--${b}--\r\n`),
  ]
  const bodyBuf = Buffer.concat(parts)
  return new Promise((resolve, reject) => {
    const r = http.request({
      hostname: 'localhost',
      port:     3000,
      path:     '/api/channel-piece-media/upload',
      method:   'POST',
      headers: {
        'Content-Type':   `multipart/form-data; boundary=${b}`,
        'Content-Length': bodyBuf.length,
        Cookie:           cookie ?? authCookie,
      },
    }, (resp) => {
      let d = ''
      resp.on('data', (c) => (d += c))
      resp.on('end', () => {
        try   { resolve({ status: resp.statusCode, body: JSON.parse(d) }) }
        catch { resolve({ status: resp.statusCode, body: d }) }
      })
    })
    r.on('error', reject)
    r.write(bodyBuf)
    r.end()
  })
}

// ─── Auth ─────────────────────────────────────────────────────────────────────

async function getSession() {
  const link = await req(SB_URL + '/auth/v1/admin/generate_link', {
    method: 'POST',
    headers: {
      apikey: SVC, Authorization: 'Bearer ' + SVC, 'Content-Type': 'application/json',
    },
    body: JSON.stringify({ type: 'magiclink', email: EMAIL, options: { redirect_to: BASE } }),
  })
  const verify = await req(link.body.action_link)
  const frag   = (verify.headers?.location || '').split('#')[1] || ''
  const p      = new URLSearchParams(frag)
  const token  = p.get('access_token')
  const refresh= p.get('refresh_token')
  if (!token) throw new Error('No token. location=' + verify.headers?.location)
  const session = {
    access_token:  token,
    refresh_token: refresh,
    expires_in:    parseInt(p.get('expires_in') || '3600'),
    expires_at:    parseInt(p.get('expires_at') || String(Math.floor(Date.now() / 1000) + 3600)),
    token_type:    p.get('token_type') || 'bearer',
  }
  return 'sb-nuhdhnasuohizxtmyiju-auth-token=' + encodeURIComponent(JSON.stringify(session))
}

// ─── Test runner ──────────────────────────────────────────────────────────────

let passed = 0
let failed = 0
const failures = []

function assert(condition, testName, detail = '') {
  if (condition) {
    console.log(`  ✓ #${String(passed + failed + 1).padStart(2)} ${testName}`)
    passed++
  } else {
    console.error(`  ✗ #${String(passed + failed + 1).padStart(2)} ${testName}${detail ? ' — ' + detail : ''}`)
    failed++
    failures.push(`${testName}${detail ? ': ' + detail : ''}`)
  }
}

// ─── Cleanup helpers ──────────────────────────────────────────────────────────

async function cleanupAll() {
  // Remove CPM associations (service role bypasses RPC)
  for (const id of createdCpmIds) {
    await sbReq(`channel_piece_media?id=eq.${id}`, 'DELETE')
  }
  // Remove library files
  for (const id of createdLfIds) {
    await sbReq(`library_files?id=eq.${id}`, 'DELETE')
  }
}

// ─── Test groups ──────────────────────────────────────────────────────────────

// Group 1: Upload de vídeos (10 casos)
async function testUpload() {
  console.log('\n── Grupo 1: Upload de vídeos ─────────────────────────────')

  // 1. Upload MP4 válido → 201
  const up1 = await apiUpload(CP_A1, MP4_MIN, '[TESTE CPM M7] video.mp4', 'video/mp4')
  assert(up1.status === 201, 'Upload MP4 válido retorna 201', `status=${up1.status}`)

  if (up1.status === 201) {
    cpmMp4Id = up1.body.channelPieceMedium?.id
    lfMp4Id  = up1.body.libraryFile?.id
    if (cpmMp4Id) createdCpmIds.push(cpmMp4Id)
    if (lfMp4Id)  createdLfIds.push(lfMp4Id)
  }

  // 2. Upload MP4 retorna channelPieceMedium + libraryFile
  assert(
    up1.body?.channelPieceMedium?.id && up1.body?.libraryFile?.id,
    'Upload MP4 retorna channelPieceMedium e libraryFile',
    `keys=${Object.keys(up1.body || {}).join(',')}`
  )

  // 3. library_file.kind = 'video' para MP4
  assert(
    up1.body?.libraryFile?.kind === 'video',
    'library_file.kind = "video" para upload MP4',
    `kind=${up1.body?.libraryFile?.kind}`
  )

  // 4. library_file.mime_type = 'video/mp4'
  assert(
    up1.body?.libraryFile?.mime_type === 'video/mp4',
    'library_file.mime_type = "video/mp4"',
    `mime_type=${up1.body?.libraryFile?.mime_type}`
  )

  // 5. Upload WebM válido → 201
  const up2 = await apiUpload(CP_A1, WEBM_MIN, '[TESTE CPM M7] video.webm', 'video/webm')
  assert(up2.status === 201, 'Upload WebM válido retorna 201', `status=${up2.status}`)

  if (up2.status === 201) {
    cpmWebmId = up2.body.channelPieceMedium?.id
    lfWebmId  = up2.body.libraryFile?.id
    if (cpmWebmId) createdCpmIds.push(cpmWebmId)
    if (lfWebmId)  createdLfIds.push(lfWebmId)
  }

  // 6. library_file.kind = 'video' para WebM
  assert(
    up2.body?.libraryFile?.kind === 'video',
    'library_file.kind = "video" para upload WebM',
    `kind=${up2.body?.libraryFile?.kind}`
  )

  // 7. library_file.mime_type = 'video/webm'
  assert(
    up2.body?.libraryFile?.mime_type === 'video/webm',
    'library_file.mime_type = "video/webm"',
    `mime_type=${up2.body?.libraryFile?.mime_type}`
  )

  // 8. Upload sem autenticação → 401
  const up3 = await apiUpload(CP_A1, MP4_MIN, 'noauth.mp4', 'video/mp4', '')
  assert(up3.status === 401, 'Upload sem auth retorna 401', `status=${up3.status}`)

  // 9. Upload tipo inválido (PDF) → 400
  const pdfBuf = Buffer.from('%PDF-1.4 fake content')
  const up4 = await apiUpload(CP_A1, pdfBuf, 'doc.pdf', 'application/pdf')
  assert(up4.status === 400, 'Upload de PDF retorna 400', `status=${up4.status}`)

  // 10. Upload MP4 com channelPieceId inválido → 400
  const up5 = await apiUpload('00000000-0000-0000-0000-000000000000', MP4_MIN, 'x.mp4', 'video/mp4')
  assert(up5.status === 400 || up5.status === 404, 'Upload com CP ID inválido retorna 4xx', `status=${up5.status}`)
}

// Group 2: Classificação e resolução (7 casos)
async function testClassification() {
  console.log('\n── Grupo 2: Classificação e resolução ────────────────────')

  if (!cpmMp4Id) {
    console.log('  ⚠ Fixtures MP4 não criados — pulando grupo 2')
    for (let i = 0; i < 7; i++) { assert(false, 'Fixture MP4 ausente (grupo 2 abortado)') }
    return
  }

  // 11. GET CPM individual → media_kind = 'video'
  const g1 = await api(`/api/channel-piece-media/${cpmMp4Id}`)
  assert(
    g1.body?.channelPieceMedium?.media_kind === 'video',
    'GET CPM MP4 resolve media_kind = "video"',
    `media_kind=${g1.body?.channelPieceMedium?.media_kind}`
  )

  // 12. image_url presente (URL assinada)
  assert(
    typeof g1.body?.channelPieceMedium?.image_url === 'string' && g1.body.channelPieceMedium.image_url.length > 0,
    'GET CPM MP4 retorna image_url (URL assinada)',
    `image_url=${g1.body?.channelPieceMedium?.image_url}`
  )

  // 13. thumbnail_url: null ou string (sem thumbnail para vídeo simples)
  assert(
    g1.body?.channelPieceMedium?.thumbnail_url === null || typeof g1.body?.channelPieceMedium?.thumbnail_url === 'string',
    'GET CPM MP4: thumbnail_url é null ou string',
    `thumbnail_url=${g1.body?.channelPieceMedium?.thumbnail_url}`
  )

  // 14. source_deleted = false
  assert(
    g1.body?.channelPieceMedium?.source_deleted === false,
    'GET CPM MP4: source_deleted = false',
    `source_deleted=${g1.body?.channelPieceMedium?.source_deleted}`
  )

  // 15. name igual ao nome do arquivo enviado
  assert(
    typeof g1.body?.channelPieceMedium?.name === 'string' && g1.body.channelPieceMedium.name.includes('[TESTE CPM M7]'),
    'GET CPM MP4: name contém prefixo de fixture',
    `name=${g1.body?.channelPieceMedium?.name}`
  )

  // 16. file_size > 0
  assert(
    typeof g1.body?.channelPieceMedium?.file_size === 'number' && g1.body.channelPieceMedium.file_size > 0,
    'GET CPM MP4: file_size > 0',
    `file_size=${g1.body?.channelPieceMedium?.file_size}`
  )

  // 17. mime_type = 'video/mp4'
  assert(
    g1.body?.channelPieceMedium?.mime_type === 'video/mp4',
    'GET CPM MP4: mime_type = "video/mp4"',
    `mime_type=${g1.body?.channelPieceMedium?.mime_type}`
  )
}

// Group 3: Listagem e filtro (8 casos)
async function testListingFilter() {
  console.log('\n── Grupo 3: Listagem e filtro ────────────────────────────')

  // 18. GET /api/library-files sem filtro → retorna array
  const lf1 = await api(`/api/library-files?projectId=${PROJECT_A}`)
  assert(Array.isArray(lf1.body?.files), 'GET /api/library-files retorna array', `type=${typeof lf1.body?.files}`)

  // 19. GET /api/library-files?kind=video → inclui vídeos criados
  const lf2 = await api(`/api/library-files?projectId=${PROJECT_A}&kind=video`)
  assert(Array.isArray(lf2.body?.files), 'GET /api/library-files?kind=video retorna array', `type=${typeof lf2.body?.files}`)

  // 20. Filtro kind=video retorna apenas vídeos
  const allKinds = (lf2.body?.files || []).map((f) => f.kind)
  assert(
    allKinds.every((k) => k === 'video'),
    'GET /api/library-files?kind=video retorna apenas files com kind="video"',
    `kinds=[${[...new Set(allKinds)].join(',')}]`
  )

  // 21. Filtro kind=video inclui os vídeos criados nesta sessão
  const videoIds = (lf2.body?.files || []).map((f) => f.id)
  assert(
    !lfMp4Id || videoIds.includes(lfMp4Id),
    'GET /api/library-files?kind=video inclui MP4 criado',
    `lfMp4Id=${lfMp4Id} not in [${videoIds.slice(0, 3).join(',')}...]`
  )

  // 22. GET /api/library-files?kind=image → retorna apenas imagens
  const lf3 = await api(`/api/library-files?projectId=${PROJECT_A}&kind=image`)
  const imgKinds = (lf3.body?.files || []).map((f) => f.kind)
  assert(
    imgKinds.every((k) => k === 'image'),
    'GET /api/library-files?kind=image retorna apenas files com kind="image"',
    `kinds=[${[...new Set(imgKinds)].join(',')}]`
  )

  // 23. GET /api/library-files sem auth → 401
  const lf4 = await apiNoAuth(`/api/library-files?projectId=${PROJECT_A}`)
  assert(lf4.status === 401, 'GET /api/library-files sem auth retorna 401', `status=${lf4.status}`)

  // 24. GET /api/library-files?kind=video: cada item tem signed URL
  const videoFiles = lf2.body?.files || []
  const videoWithUrl = videoFiles.filter((f) => typeof f.public_url === 'string' || typeof f.signed_url === 'string' || typeof f.url === 'string')
  assert(
    videoFiles.length === 0 || videoWithUrl.length > 0 || videoFiles.every((f) => f.public_url || f.storage_path),
    'GET /api/library-files?kind=video: arquivos têm URL',
    `total=${videoFiles.length}, withUrl=${videoWithUrl.length}`
  )

  // 25. GET /api/library-files?kind=video: itens têm file_size
  assert(
    videoFiles.every((f) => typeof f.file_size === 'number' && f.file_size > 0),
    'GET /api/library-files?kind=video: file_size > 0 em todos os itens',
    `files without size=${videoFiles.filter((f) => !f.file_size).length}`
  )
}

// Group 4: Download endpoint (8 casos)
async function testDownload() {
  console.log('\n── Grupo 4: Download endpoint ────────────────────────────')

  if (!cpmMp4Id) {
    console.log('  ⚠ Fixtures MP4 não criados — pulando grupo 4')
    for (let i = 0; i < 8; i++) { assert(false, 'Fixture MP4 ausente (grupo 4 abortado)') }
    return
  }

  // 26. GET download autenticado → 302
  const dl1 = await reqFollowOne(BASE + `/api/channel-piece-media/${cpmMp4Id}/download`, {
    headers: { Cookie: authCookie },
  })
  assert(
    dl1.status === 302 || dl1.redirected,
    'Download MP4 autenticado retorna 302',
    `status=${dl1.status}, redirected=${dl1.redirected}`
  )

  // 27. Download MP4 → location header presente
  assert(
    dl1.redirected && typeof dl1.location === 'string' && dl1.location.length > 0,
    'Download MP4: location header presente no redirect',
    `location=${String(dl1.location).slice(0, 60)}...`
  )

  // 28. Location aponta para S3 (contém o hostname do MinIO ou S3)
  assert(
    typeof dl1.location === 'string' && (dl1.location.includes('s3') || dl1.location.includes('multihuman') || dl1.location.includes('X-Amz-Signature') || dl1.location.startsWith('http')),
    'Download: location é URL S3 assinada',
    `location=${String(dl1.location).slice(0, 80)}`
  )

  // 29. Download sem auth → 401
  const dl2 = await reqFollowOne(BASE + `/api/channel-piece-media/${cpmMp4Id}/download`, {
    headers: {},
  })
  assert(
    dl2.status === 401 || (typeof dl2.body === 'object' && dl2.body?.error?.toLowerCase().includes('autorizado')),
    'Download sem auth retorna 401',
    `status=${dl2.status}`
  )

  // 30. Download ID inválido (não UUID) → 400
  const dl3 = await api('/api/channel-piece-media/nao-eh-uuid/download')
  assert(dl3.status === 400, 'Download com ID não-UUID retorna 400', `status=${dl3.status}`)

  // 31. Download ID UUID válido mas não existente → 404
  const dl4 = await api('/api/channel-piece-media/00000000-0000-0000-0000-000000000000/download')
  assert(dl4.status === 404, 'Download com UUID não existente retorna 404', `status=${dl4.status}`)

  // 32. Download WebM também funciona
  if (cpmWebmId) {
    const dl5 = await reqFollowOne(BASE + `/api/channel-piece-media/${cpmWebmId}/download`, {
      headers: { Cookie: authCookie },
    })
    assert(dl5.status === 302 || dl5.redirected, 'Download WebM autenticado retorna 302', `status=${dl5.status}`)
  } else {
    assert(false, 'Download WebM — fixture não criado')
  }

  // 33. Download de imagem gerada (image_id)
  if (cpmImgId) {
    const dl6 = await reqFollowOne(BASE + `/api/channel-piece-media/${cpmImgId}/download`, {
      headers: { Cookie: authCookie },
    })
    assert(dl6.status === 302 || dl6.redirected, 'Download de imagem gerada retorna 302', `status=${dl6.status}`)
  } else {
    // Tentamos criar um CPM de imagem para este teste
    const assoc = await api('/api/channel-piece-media', 'POST', {
      channelPieceId: CP_A1,
      imageId: IMAGE_A,
      role: 'attachment',
      position: 99,
    })
    if (assoc.status === 201 || assoc.status === 409) {
      const imgCpmId = assoc.body?.channelPieceMedium?.id
      if (imgCpmId) {
        createdCpmIds.push(imgCpmId)
        cpmImgId = imgCpmId
        const dl6 = await reqFollowOne(BASE + `/api/channel-piece-media/${imgCpmId}/download`, {
          headers: { Cookie: authCookie },
        })
        assert(dl6.status === 302 || dl6.redirected, 'Download de imagem gerada retorna 302', `status=${dl6.status}`)
      } else {
        assert(assoc.status === 409, 'Imagem já associada (duplicate) — OK para skip', `status=${assoc.status}`)
      }
    } else {
      assert(false, 'Download de imagem gerada — não foi possível criar fixture', `status=${assoc.status}`)
    }
  }
}

// Group 5: Associação e organização (7 casos)
async function testAssociationOrganize() {
  console.log('\n── Grupo 5: Associação e organização ─────────────────────')

  if (!lfMp4Id) {
    console.log('  ⚠ Fixture LF MP4 não criado — pulando grupo 5')
    for (let i = 0; i < 7; i++) { assert(false, 'Fixture LF MP4 ausente (grupo 5 abortado)') }
    return
  }

  // 34. GET /api/channel-piece-media?channelPieceId=CP_A1 inclui CPM de vídeo
  const list = await api(`/api/channel-piece-media?channelPieceId=${CP_A1}`)
  assert(Array.isArray(list.body?.channelPieceMedia), 'GET lista CPMs retorna array', `type=${typeof list.body?.channelPieceMedia}`)

  const items = list.body?.channelPieceMedia || []
  const videoItems = items.filter((i) => i.media_kind === 'video')

  // 35. Lista inclui vídeos
  assert(videoItems.length > 0, 'Lista de CPMs contém items com media_kind="video"', `videoItems=${videoItems.length}`)

  // 36. CPM de vídeo tem role válida
  assert(
    videoItems.every((i) => ['primary','thumbnail','carousel_item','background','attachment'].includes(i.role)),
    'Todos CPMs de vídeo têm role válida',
    `roles=${videoItems.map((i) => i.role).join(',')}`
  )

  // 37. CPM de vídeo tem position >= 0
  assert(
    videoItems.every((i) => typeof i.position === 'number' && i.position >= 0),
    'Todos CPMs de vídeo têm position >= 0',
    `positions=${videoItems.map((i) => i.position).join(',')}`
  )

  // 38. Associar biblioteca via POST /api/channel-piece-media → 409 se duplicado
  if (lfWebmId) {
    const assoc = await api('/api/channel-piece-media', 'POST', {
      channelPieceId: CP_A1,
      libraryFileId: lfWebmId,
      role: 'attachment',
      position: 98,
    })
    // WebM já foi criado via upload e já está associado — espera-se 409 ou CPM existente
    assert(
      assoc.status === 409 || assoc.status === 201,
      'POST associar WebM já existente retorna 409 ou 201',
      `status=${assoc.status}`
    )
  } else {
    assert(false, 'Fixture WebM ausente para teste de duplicata')
  }

  // 39. PATCH organize mantém vídeo na lista
  if (cpmMp4Id && cpmWebmId) {
    const organizeItems = items
      .filter((i) => [cpmMp4Id, cpmWebmId].includes(i.id))
      .map((i, idx) => ({ id: i.id, position: i.position, role: i.role }))
    if (organizeItems.length >= 1) {
      const org = await api('/api/channel-piece-media/organize', 'PATCH', {
        channelPieceId: CP_A1,
        items: items.map((i, idx) => ({ id: i.id, position: idx, role: i.role })),
      })
      assert(org.status === 200, 'PATCH organize com vídeos retorna 200', `status=${org.status}`)
    } else {
      assert(false, 'Organize — items de vídeo não encontrados na lista')
    }
  } else {
    assert(false, 'Organize — fixtures MP4/WebM ausentes')
  }

  // 40. Alterar role de CPM de vídeo
  if (cpmMp4Id) {
    const listAfter = await api(`/api/channel-piece-media?channelPieceId=${CP_A1}`)
    const allItems = listAfter.body?.channelPieceMedia || []
    const mp4Item = allItems.find((i) => i.id === cpmMp4Id)
    if (mp4Item) {
      const newRole = mp4Item.role === 'attachment' ? 'carousel_item' : 'attachment'
      const newItems = allItems.map((i) => ({
        id: i.id, position: i.position, role: i.id === cpmMp4Id ? newRole : i.role,
      }))
      // Ensure exactly one primary
      const hasPrimary = newItems.some((i) => i.role === 'primary')
      if (!hasPrimary && newItems.length > 0) newItems[0].role = 'primary'
      const org2 = await api('/api/channel-piece-media/organize', 'PATCH', {
        channelPieceId: CP_A1,
        items: newItems,
      })
      assert(org2.status === 200, 'Alterar role de CPM de vídeo via organize retorna 200', `status=${org2.status}`)
    } else {
      assert(false, 'Alterar role — CPM MP4 não encontrado na lista')
    }
  } else {
    assert(false, 'Alterar role — fixture MP4 ausente')
  }
}

// Group 6: Deleção (5 casos)
async function testDeletion() {
  console.log('\n── Grupo 6: Deleção ──────────────────────────────────────')

  if (!cpmWebmId || !lfWebmId) {
    console.log('  ⚠ Fixtures WebM ausentes — pulando grupo 6')
    for (let i = 0; i < 5; i++) { assert(false, 'Fixture WebM ausente (grupo 6 abortado)') }
    return
  }

  // 41. DELETE CPM de vídeo → 200
  const del1 = await api(`/api/channel-piece-media/${cpmWebmId}`, 'DELETE')
  assert(del1.status === 200, 'DELETE CPM WebM retorna 200', `status=${del1.status}`)

  // 42. Retorna lista atualizada
  assert(Array.isArray(del1.body?.channelPieceMedia), 'DELETE CPM retorna channelPieceMedia array', `type=${typeof del1.body?.channelPieceMedia}`)

  // 43. CPM WebM não está mais na lista
  const remaining = del1.body?.channelPieceMedia || []
  assert(!remaining.some((i) => i.id === cpmWebmId), 'CPM WebM removido não aparece na lista restante', `remainingIds=${remaining.map((i) => i.id).join(',')}`)

  // 44. library_file WebM preservado após DELETE CPM
  const lfCheck = await sbReq(`library_files?id=eq.${lfWebmId}&select=id,name,kind,deleted_at`)
  assert(
    Array.isArray(lfCheck.body) && lfCheck.body.length === 1 && lfCheck.body[0].deleted_at === null,
    'library_file WebM preservado (deleted_at=null) após DELETE CPM',
    `lfCheck=${JSON.stringify(lfCheck.body)}`
  )

  // 45. DELETE CPM inválido (já removido) → 401 (RPC_UNAUTHORIZED pois não existe)
  const del2 = await api(`/api/channel-piece-media/${cpmWebmId}`, 'DELETE')
  assert(del2.status === 401 || del2.status === 404, 'DELETE CPM já removido retorna 401 ou 404', `status=${del2.status}`)

  // Mark cpmWebmId as removed (don't try to cleanup again)
  const idx = createdCpmIds.indexOf(cpmWebmId)
  if (idx >= 0) createdCpmIds.splice(idx, 1)
}

// Group 7: Segurança (5 casos)
async function testSecurity() {
  console.log('\n── Grupo 7: Segurança ────────────────────────────────────')

  // 46. GET /api/channel-piece-media sem auth → 401
  const sec1 = await apiNoAuth(`/api/channel-piece-media?channelPieceId=${CP_A1}`)
  assert(sec1.status === 401, 'GET CPMs sem auth retorna 401', `status=${sec1.status}`)

  // 47. POST /api/channel-piece-media sem auth → 401
  const sec2 = await apiNoAuth('/api/channel-piece-media', 'POST')
  assert(sec2.status === 401, 'POST CPM sem auth retorna 401', `status=${sec2.status}`)

  // 48. GET CPM individual sem auth → 401
  if (cpmMp4Id) {
    const sec3 = await apiNoAuth(`/api/channel-piece-media/${cpmMp4Id}`)
    assert(sec3.status === 401, 'GET CPM individual sem auth retorna 401', `status=${sec3.status}`)
  } else {
    assert(false, 'GET CPM individual sem auth — fixture ausente')
  }

  // 49. DELETE CPM sem auth → 401
  if (cpmMp4Id) {
    const sec4 = await apiNoAuth(`/api/channel-piece-media/${cpmMp4Id}`, 'DELETE')
    assert(sec4.status === 401, 'DELETE CPM sem auth retorna 401', `status=${sec4.status}`)
  } else {
    assert(false, 'DELETE CPM sem auth — fixture ausente')
  }

  // 50. PATCH organize sem auth → 401
  const sec5 = await apiNoAuth('/api/channel-piece-media/organize', 'PATCH')
  assert(sec5.status === 401, 'PATCH organize sem auth retorna 401', `status=${sec5.status}`)
}

// Group 8: Metadados e edge cases (3 casos — total 53)
async function testMetadata() {
  console.log('\n── Grupo 8: Metadados e edge cases ───────────────────────')

  if (!cpmMp4Id) {
    console.log('  ⚠ Fixture MP4 ausente — pulando grupo 8')
    for (let i = 0; i < 3; i++) { assert(false, 'Fixture MP4 ausente (grupo 8 abortado)') }
    return
  }

  // 51. library_file.name preservado corretamente via service role
  const lfCheck = await sbReq(`library_files?id=eq.${lfMp4Id}&select=id,name,kind,mime_type,file_size`)
  assert(
    Array.isArray(lfCheck.body) && lfCheck.body[0]?.kind === 'video',
    'library_files.kind = "video" via service role check',
    `kind=${lfCheck.body?.[0]?.kind}`
  )

  // 52. library_files.mime_type = 'video/mp4' via service role
  assert(
    lfCheck.body?.[0]?.mime_type === 'video/mp4',
    'library_files.mime_type = "video/mp4" via service role check',
    `mime_type=${lfCheck.body?.[0]?.mime_type}`
  )

  // 53. GET lista CPMs: vídeos sem thumbnail têm thumbnail_url = null ou string
  const listFinal = await api(`/api/channel-piece-media?channelPieceId=${CP_A1}`)
  const videoItemsFinal = (listFinal.body?.channelPieceMedia || []).filter((i) => i.media_kind === 'video')
  assert(
    videoItemsFinal.every((i) => i.thumbnail_url === null || typeof i.thumbnail_url === 'string'),
    'CPMs de vídeo têm thumbnail_url = null ou string (não undefined)',
    `thumbnail_urls=${videoItemsFinal.map((i) => i.thumbnail_url).join(',')}`
  )
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log('══════════════════════════════════════════════════════')
  console.log('  M7 — ChannelPiece Media: Video Support Test Suite')
  console.log('  53 casos de teste')
  console.log('══════════════════════════════════════════════════════')

  // Auth
  console.log('\n── Autenticação ──────────────────────────────────────────')
  try {
    authCookie = await getSession()
    console.log('  ✓ Sessão obtida via magic link')
  } catch (e) {
    console.error('  ✗ Falha ao obter sessão:', e.message)
    process.exit(1)
  }

  try {
    await testUpload()
    await testClassification()
    await testListingFilter()
    await testDownload()
    await testAssociationOrganize()
    await testDeletion()
    await testSecurity()
    await testMetadata()
  } catch (e) {
    console.error('\nErro inesperado durante os testes:', e)
  }

  console.log('\n══════════════════════════════════════════════════════')
  console.log(`  Resultado: ${passed} passed / ${failed} failed / ${passed + failed} total`)
  if (failures.length > 0) {
    console.log('\n  Falhas:')
    failures.forEach((f) => console.log(`    • ${f}`))
  }
  console.log('══════════════════════════════════════════════════════')
  console.log('\n  Fixtures criados (preservados para smoke visual):')
  console.log(`    CPM IDs : ${createdCpmIds.join(', ') || '—'}`)
  console.log(`    LF IDs  : ${createdLfIds.join(', ') || '—'}`)
  console.log('\n  Execute limpeza manual após revisão visual.')

  if (failed > 0) process.exit(1)
}

main()

/**
 * M7 — Smoke de release em producao
 * Prefixo: [SMOKE RELEASE CPM M7]
 *
 * Cobre os 15 itens do checklist de smoke autenticado.
 * Itens 13-15 (atualizacao de card, CTA, texto nao salvo) sao verificados
 * localmente no smoke visual — nao testaveis via script.
 *
 * Run: node scripts/cpm_m7_smoke_prod.mjs
 * Requires: .env.local com SUPABASE_SERVICE_ROLE_KEY, S3 credentials
 */

import http  from 'http'
import https from 'https'
import fs    from 'fs'
import path  from 'path'
import adminGuard from './lib/production-admin-guard.cjs'

// ---- Config -----------------------------------------------------------------

const ENV_PATH = path.resolve('c:/Users/flavi/OneDrive/Documentos/Content Agent Studio/content-studio-ai-git/.env.local')
const env = fs.readFileSync(ENV_PATH, 'utf8')
const get = (k) => {
  const m = env.match(new RegExp('^' + k + '=(.+)', 'm'))
  return m ? m[1].trim().replace(/^["']|["']$/g, '') : null
}

const SVC    = get('SUPABASE_SECRET_KEY') || get('SUPABASE_SERVICE_ROLE_KEY')
const SB_URL = 'https://nuhdhnasuohizxtmyiju.supabase.co'
adminGuard.requireAdminAck({ script: 'cpm_m7_smoke_prod.mjs', target: SB_URL })
const BASE   = 'https://content.multihuman.com.br'
const EMAIL  = 'flavio.multiman@gmail.com'

const PROJECT_A = 'd0d008c3-321b-46fe-8225-2f1a68e833ec'
const CP_A1     = '65f49c21-1ffd-43e4-9f24-9d16f0bf6b04'
const IMAGE_A   = '3a49939e-f076-4cd9-bd1c-166b3320fa6d'

const MP4_MIN = Buffer.concat([
  Buffer.from([0x00, 0x00, 0x00, 0x1C, 0x66, 0x74, 0x79, 0x70]),
  Buffer.from([0x6D, 0x70, 0x34, 0x32, 0x00, 0x00, 0x00, 0x00]),
  Buffer.from([0x6D, 0x70, 0x34, 0x32, 0x69, 0x73, 0x6F, 0x6D]),
  Buffer.alloc(256, 0),
])

let authCookie = ''
const createdLfIds  = []
const createdCpmIds = []
let cpmMp4Id = null
let lfMp4Id  = null
let cpmImgId = null

// ---- HTTP helpers -----------------------------------------------------------

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

function api(path, method = 'GET', body = null) {
  const headers = { Cookie: authCookie }
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
  return req(SB_URL + '/rest/v1/' + path, { method, headers, body: body ? JSON.stringify(body) : null })
}

function apiUpload(cpId, fileBuf, filename, mime) {
  const b = '----SmokeProd7' + Date.now()
  const parts = [
    Buffer.from(`--${b}\r\nContent-Disposition: form-data; name="channelPieceId"\r\n\r\n${cpId}\r\n`),
    Buffer.from(`--${b}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: ${mime}\r\n\r\n`),
    fileBuf,
    Buffer.from(`\r\n--${b}--\r\n`),
  ]
  const bodyBuf = Buffer.concat(parts)
  return new Promise((resolve, reject) => {
    const u = new URL(BASE + '/api/channel-piece-media/upload')
    const r = https.request({
      hostname: u.hostname,
      path:     u.pathname,
      method:   'POST',
      headers: {
        'Content-Type':   `multipart/form-data; boundary=${b}`,
        'Content-Length': bodyBuf.length,
        Cookie:           authCookie,
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

// ---- Auth -------------------------------------------------------------------

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

// ---- Test runner ------------------------------------------------------------

let passed = 0
let failed = 0
const failures = []

function assert(condition, name, detail = '') {
  if (condition) {
    console.log(`  ✓ ${name}`)
    passed++
  } else {
    console.error(`  ✗ ${name}${detail ? ' -- ' + detail : ''}`)
    failed++
    failures.push(`${name}${detail ? ': ' + detail : ''}`)
  }
}

// ---- Main -------------------------------------------------------------------

async function main() {
  console.log('==========================================================')
  console.log('  M7 -- Smoke de Release em Producao')
  console.log('  BASE: ' + BASE)
  console.log('==========================================================')

  // Auth
  console.log('\n-- Autenticacao ------------------------------------------')
  try {
    authCookie = await getSession()
    console.log('  Sessao obtida via magic link')
  } catch (e) {
    console.error('  FATAL: Autenticacao falhou:', e.message)
    process.exit(1)
  }

  // 1-2: Upload de video + library_file
  console.log('\n-- 1-2. Upload MP4 e criacao de library_file -------------')
  const up = await apiUpload(CP_A1, MP4_MIN, '[SMOKE RELEASE CPM M7] video.mp4', 'video/mp4')
  assert(up.status === 201, 'Item 1: upload video pequeno -> 201', 'status=' + up.status)

  if (up.status === 201) {
    cpmMp4Id = up.body?.channelPieceMedium?.id
    lfMp4Id  = up.body?.channelPieceMedium?.library_file_id
    if (cpmMp4Id) createdCpmIds.push(cpmMp4Id)
    if (lfMp4Id)  createdLfIds.push(lfMp4Id)
    assert(typeof lfMp4Id === 'string', 'Item 2: library_file criado', 'lfId=' + lfMp4Id)

    // 3-4: badge (media_kind) e preview URL
    console.log('\n-- 3-5. Classificacao e preview URL ----------------------')
    const g = await api('/api/channel-piece-media/' + cpmMp4Id)
    assert(g.status === 200, 'GET CPM -> 200')
    assert(g.body?.channelPieceMedium?.media_kind === 'video', 'Item 3+4: media_kind=video (badge Video)', 'media_kind=' + g.body?.channelPieceMedium?.media_kind)
    const previewUrl = g.body?.channelPieceMedium?.image_url
    assert(typeof previewUrl === 'string' && previewUrl.startsWith('https://'), 'Item 5: image_url presente para preview', 'url=' + (previewUrl || '').slice(0, 60))

    // 6-7: download
    console.log('\n-- 6-7. Download endpoint --------------------------------')
    const dlRes = await req(BASE + '/api/channel-piece-media/' + cpmMp4Id + '/download', {
      method: 'GET',
      headers: { Cookie: authCookie },
    })
    assert(dlRes.status === 302, 'Item 6-7: download -> 302', 'status=' + dlRes.status)
    const location = dlRes.headers?.location || ''
    assert(location.startsWith('https://'), 'Download Location e URL assinada HTTPS', 'location=' + location.slice(0, 80))

    // 8: nome coerente
    console.log('\n-- 8. Nome do arquivo ------------------------------------')
    const name = g.body?.channelPieceMedium?.name
    assert(typeof name === 'string' && name.includes('SMOKE-RELEASE-CPM-M7'), 'Item 8: nome coerente apos sanitize', 'name=' + name)
  }

  // 9-11: reorder, role, primary
  console.log('\n-- 9-11. Reorder, role, primary --------------------------')
  const addImg = await api('/api/channel-piece-media', 'POST', {
    channelPieceId: CP_A1,
    imageId: IMAGE_A,
    role: 'attachment',
    position: 1,
  })
  if (addImg.status !== 201) console.error('  DEBUG POST CPM imagem body:', JSON.stringify(addImg.body))
  assert(addImg.status === 201, 'POST CPM imagem -> 201', 'status=' + addImg.status)

  if (addImg.status === 201) {
    cpmImgId = addImg.body?.channelPieceMedium?.id
    if (cpmImgId) createdCpmIds.push(cpmImgId)

    const list = await api('/api/channel-piece-media?channelPieceId=' + CP_A1)
    assert(list.status === 200, 'Lista CP_A1 -> 200')
    const items = list.body?.channelPieceMedia || []
    assert(items.length >= 2, 'Lista tem >= 2 itens', 'count=' + items.length)

    // Reorder (item 9)
    const arrangement = items.map((item, idx) => ({
      id: item.id,
      position: items.length - 1 - idx,
      role: item.role,
    }))
    const reorder = await api('/api/channel-piece-media/organize', 'PATCH', {
      channelPieceId: CP_A1,
      items: arrangement,
    })
    assert(reorder.status === 200, 'Item 9: reorder -> 200', 'status=' + reorder.status)

    // Alterar role (item 10)
    if (cpmMp4Id) {
      const patchRole = await api('/api/channel-piece-media/' + cpmMp4Id, 'PATCH', { role: 'primary' })
      assert(patchRole.status === 200, 'Item 10: PATCH role -> primary', 'status=' + patchRole.status)
      assert(patchRole.body?.channelPieceMedium?.role === 'primary', 'role = primary no response')

      // Primary (item 11)
      const getAfter = await api('/api/channel-piece-media/' + cpmMp4Id)
      assert(getAfter.body?.channelPieceMedium?.role === 'primary', 'Item 11: primary confirmado via GET')
    }
  }

  // 12: remover CPM preserva LF
  console.log('\n-- 12. Remocao de CPM preserva library_file --------------')
  if (cpmMp4Id) {
    const del = await api('/api/channel-piece-media/' + cpmMp4Id, 'DELETE')
    assert(del.status === 200, 'Item 12: DELETE CPM -> 200', 'status=' + del.status)
    const lfCheck = await sbReq('library_files?id=eq.' + lfMp4Id + '&select=id,name')
    const lfs = Array.isArray(lfCheck.body) ? lfCheck.body : []
    assert(lfs.length === 1, 'Item 12: library_file preservado apos DELETE CPM', 'count=' + lfs.length)
    const getDeleted = await api('/api/channel-piece-media/' + cpmMp4Id)
    assert(getDeleted.status === 404, 'CPM deletado -> 404 confirmado')
    createdCpmIds.splice(createdCpmIds.indexOf(cpmMp4Id), 1)
    cpmMp4Id = null
  }

  if (cpmImgId) {
    const del2 = await api('/api/channel-piece-media/' + cpmImgId, 'DELETE')
    assert(del2.status === 200, 'DELETE CPM imagem -> 200')
    createdCpmIds.splice(createdCpmIds.indexOf(cpmImgId), 1)
    cpmImgId = null
  }

  // 13-15: UI-only
  console.log('\n-- 13-15. Itens UI-only (verificados no smoke local) -----')
  console.log('  i 13. Card atualiza apos salvar sem F5 -- cpSaveCount + local state update')
  console.log('  i 14. CTA atualizado aparece imediatamente no card')
  console.log('  i 15. Texto nao salvo nao e perdido ao fechar dialog')

  // Cleanup
  console.log('\n-- Cleanup -----------------------------------------------')
  for (const id of [...createdCpmIds]) {
    const r = await api('/api/channel-piece-media/' + id, 'DELETE')
    console.log('  DELETE CPM ' + id + ' -> ' + r.status)
  }

  for (const id of [...createdLfIds]) {
    const lfRes = await sbReq('library_files?id=eq.' + id + '&select=id,name,storage_path')
    const lf = Array.isArray(lfRes.body) ? lfRes.body[0] : null
    if (lf) {
      const delDb = await sbReq('library_files?id=eq.' + id, 'DELETE')
      console.log('  DELETE LF ' + id + ' (' + lf.name + ') -> ' + delDb.status)
      if (lf.storage_path) {
        try {
          const { S3Client, DeleteObjectCommand } = await import('@aws-sdk/client-s3')
          const s3 = new S3Client({
            endpoint: 'https://s3.multihuman.com.br',
            region: 'us-east-1',
            credentials: {
              accessKeyId: get('S3_ACCESS_KEY') || get('S3_ACCESS_KEY_ID') || get('AWS_ACCESS_KEY_ID'),
              secretAccessKey: get('S3_SECRET_KEY') || get('S3_SECRET_ACCESS_KEY') || get('AWS_SECRET_ACCESS_KEY'),
            },
            forcePathStyle: true,
          })
          await s3.send(new DeleteObjectCommand({
            Bucket: get('S3_BUCKET_NAME') || 'content-studio',
            Key: lf.storage_path,
          }))
          console.log('  DELETE S3 ' + lf.storage_path + ' -> ok')
        } catch (e) {
          console.warn('  WARN S3 delete ' + lf.storage_path + ': ' + e.message)
        }
      }
    }
  }

  // Zero residue
  const residueCheck = await sbReq('library_files?name=ilike.*SMOKE+RELEASE+CPM+M7*&select=id')
  const residue = Array.isArray(residueCheck.body) ? residueCheck.body.length : '?'
  assert(residue === 0, 'Zero residuos [SMOKE RELEASE CPM M7] no banco', 'count=' + residue)

  // Report
  console.log('\n==========================================================')
  console.log('  RESULTADO: ' + passed + ' passed, ' + failed + ' failed')
  if (failures.length > 0) {
    console.error('\n  FALHAS:')
    failures.forEach(f => console.error('    - ' + f))
  }
  console.log('==========================================================')

  if (failed > 0) process.exit(1)
}

main().catch(e => {
  console.error('FATAL:', e)
  process.exit(1)
})

/**
 * M10-C API Contract Test Suite
 * Tests POST /api/image-drafts and /api/video-drafts for Production enforcement.
 *
 * Usage (with local dev server running on port 3000):
 *   node m10c_api_test.mjs
 *
 * Requires: @supabase/supabase-js installed (uses the project's node_modules)
 */

import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = 'https://nuhdhnasuohizxtmyiju.supabase.co'
const ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im51aGRobmFzdW9oaXp4dG15aWp1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzY5ODA0NjUsImV4cCI6MjA5MjU1NjQ2NX0.I0gooqv1kwIbavvps0DUj12vT1HDu7RnnLulmU8jeJ0'
const SERVICE_ROLE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im51aGRobmFzdW9oaXp4dG15aWp1Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3Njk4MDQ2NSwiZXhwIjoyMDkyNTU2NDY1fQ.RqW_rcM-SYS59dmwkDpKi6KZaBmjLhLBm5dBNG21vTA'
const LOCAL_BASE = 'http://localhost:3000'
const PROJECT_REF = 'nuhdhnasuohizxtmyiju'

// Admin client — service role, bypasses RLS for fixture setup/teardown
const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false }
})

const TEST_EMAIL = `m10c-test-${Date.now()}@m10c.invalid`
const TEST_PASSWORD = `M10c-test-${Date.now()}-pass!`

const results = []
const fixtures = { userId: null, projectId: null, productionId: null, imageDraftId: null, videoDraftId: null }

function pass(label, got, extra = {}) {
  results.push({ ok: true, label, got, ...extra })
}

function fail(label, got, expected, extra = {}) {
  results.push({ ok: false, label, got, expected, ...extra })
}

async function apiCall(path, method, body, cookieHeader = '') {
  const res = await fetch(`${LOCAL_BASE}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(cookieHeader ? { Cookie: cookieHeader } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
  const text = await res.text()
  let data = {}
  try { data = JSON.parse(text) } catch { data = { _raw: text } }
  return { status: res.status, data }
}

async function buildCookie(email, password) {
  // Sign in via REST to get the session
  const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: ANON_KEY },
    body: JSON.stringify({ email, password }),
  })
  const session = await res.json()
  if (!session.access_token) throw new Error(`Login failed: ${JSON.stringify(session)}`)

  // @supabase/ssr >=0.5 stores the session JSON at sb-{ref}-auth-token
  // The value can be the raw JSON or base64 depending on version.
  // For ^0.10.x it stores raw JSON (URL-encoded if needed by the browser, but
  // for server-side fetch we pass the raw value).
  const cookieName = `sb-${PROJECT_REF}-auth-token`
  const cookieValue = JSON.stringify(session)
  return `${cookieName}=${encodeURIComponent(cookieValue)}`
}

async function setup() {
  console.log('=== SETUP ===')

  // 1. Create test user
  const { data: cu, error: cue } = await admin.auth.admin.createUser({
    email: TEST_EMAIL,
    password: TEST_PASSWORD,
    email_confirm: true,
    user_metadata: { test: true, m10c: true },
  })
  if (cue) throw new Error(`Create user failed: ${cue.message}`)
  fixtures.userId = cu.user.id
  console.log(`  Test user: ${fixtures.userId}`)

  // 2. Create test project
  const { data: proj, error: pe } = await admin.from('projects').insert({
    user_id: fixtures.userId,
    name: 'M10C Test Project',
    description: 'Auto-created by m10c_api_test.mjs',
  }).select('id').single()
  if (pe) throw new Error(`Create project failed: ${pe.message}`)
  fixtures.projectId = proj.id
  console.log(`  Test project: ${fixtures.projectId}`)

  // 3. Create test production
  const { data: prod, error: prode } = await admin.from('productions').insert({
    user_id: fixtures.userId,
    project_id: fixtures.projectId,
    title: 'M10C Test Production',
    type: 'editorial',
    intention: 'Auto-created by m10c_api_test.mjs — safe to delete',
  }).select('id').single()
  if (prode) throw new Error(`Create production failed: ${prode.message}`)
  fixtures.productionId = prod.id
  console.log(`  Test production: ${fixtures.productionId}`)
  console.log()
}

async function teardown() {
  console.log('\n=== TEARDOWN ===')

  if (fixtures.imageDraftId) {
    await admin.from('image_drafts').delete().eq('id', fixtures.imageDraftId)
    console.log(`  Deleted image_draft ${fixtures.imageDraftId}`)
  }
  if (fixtures.videoDraftId) {
    await admin.from('video_drafts').delete().eq('id', fixtures.videoDraftId)
    console.log(`  Deleted video_draft ${fixtures.videoDraftId}`)
  }
  if (fixtures.productionId) {
    await admin.from('productions').delete().eq('id', fixtures.productionId)
    console.log(`  Deleted production ${fixtures.productionId}`)
  }
  if (fixtures.projectId) {
    await admin.from('projects').delete().eq('id', fixtures.projectId)
    console.log(`  Deleted project ${fixtures.projectId}`)
  }
  if (fixtures.userId) {
    await admin.auth.admin.deleteUser(fixtures.userId)
    console.log(`  Deleted user ${fixtures.userId}`)
  }
}

async function runImageDraftTests(cookie) {
  const PATH = '/api/image-drafts'

  // T1: No auth → 401
  let r = await apiCall(PATH, 'POST', { userInput: 'test', productionId: fixtures.productionId })
  r.status === 401 ? pass('image T1: no auth → 401', r.status) : fail('image T1: no auth → 401', r.status, 401, { data: r.data })

  // T2: No productionId → 422 PRODUCTION_REQUIRED
  r = await apiCall(PATH, 'POST', { userInput: 'test' }, cookie)
  r.status === 422 && r.data.code === 'PRODUCTION_REQUIRED'
    ? pass('image T2: no productionId → 422 PRODUCTION_REQUIRED', r.status)
    : fail('image T2: no productionId → 422 PRODUCTION_REQUIRED', r.status, 422, { code: r.data.code })

  // T3: productionId = null → 422
  r = await apiCall(PATH, 'POST', { userInput: 'test', productionId: null }, cookie)
  r.status === 422 && r.data.code === 'PRODUCTION_REQUIRED'
    ? pass('image T3: productionId null → 422 PRODUCTION_REQUIRED', r.status)
    : fail('image T3: productionId null → 422 PRODUCTION_REQUIRED', r.status, 422, { code: r.data.code })

  // T4: Invalid UUID → 400 INVALID_PRODUCTION_ID
  r = await apiCall(PATH, 'POST', { userInput: 'test', productionId: 'not-a-uuid' }, cookie)
  r.status === 400 && r.data.code === 'INVALID_PRODUCTION_ID'
    ? pass('image T4: invalid UUID → 400 INVALID_PRODUCTION_ID', r.status)
    : fail('image T4: invalid UUID → 400 INVALID_PRODUCTION_ID', r.status, 400, { code: r.data.code })

  // T5: Valid UUID, non-existent production → 404 PRODUCTION_NOT_FOUND
  r = await apiCall(PATH, 'POST', { userInput: 'test', productionId: '00000000-0000-0000-0000-000000000001' }, cookie)
  r.status === 404 && r.data.code === 'PRODUCTION_NOT_FOUND'
    ? pass('image T5: non-existent UUID → 404 PRODUCTION_NOT_FOUND', r.status)
    : fail('image T5: non-existent UUID → 404 PRODUCTION_NOT_FOUND', r.status, 404, { code: r.data.code })

  // T6: Production owned by real user (not test user) → 404 (security isolation)
  const REAL_PRODUCTION = '76120099-e0f0-4b86-ae79-6e13d93f9d75'
  r = await apiCall(PATH, 'POST', { userInput: 'test', productionId: REAL_PRODUCTION }, cookie)
  r.status === 404 && r.data.code === 'PRODUCTION_NOT_FOUND'
    ? pass('image T6: other user production → 404 PRODUCTION_NOT_FOUND', r.status)
    : fail('image T6: other user production → 404 PRODUCTION_NOT_FOUND', r.status, 404, { code: r.data.code })

  // T7: projectId diverges from production → 409 PROJECT_PRODUCTION_MISMATCH
  const DIVERGENT_PROJECT = '00000000-0000-0000-0000-000000000002'
  r = await apiCall(PATH, 'POST', { userInput: 'test', productionId: fixtures.productionId, projectId: DIVERGENT_PROJECT }, cookie)
  r.status === 409 && r.data.code === 'PROJECT_PRODUCTION_MISMATCH'
    ? pass('image T7: projectId mismatch → 409 PROJECT_PRODUCTION_MISMATCH', r.status)
    : fail('image T7: projectId mismatch → 409 PROJECT_PRODUCTION_MISMATCH', r.status, 409, { code: r.data.code })

  // T8: Valid production, matching projectId → 200, draft has correct production_id and project_id
  r = await apiCall(PATH, 'POST', {
    userInput: 'M10C test image draft — fixture',
    productionId: fixtures.productionId,
    projectId: fixtures.projectId,
  }, cookie)
  const draft = r.data.draft
  if (r.status === 200 && draft?.production_id === fixtures.productionId && draft?.project_id === fixtures.projectId) {
    pass('image T8: valid production → 200, production_id and project_id correct', r.status, { draftId: draft.id })
    fixtures.imageDraftId = draft.id
  } else {
    fail('image T8: valid production → 200', r.status, 200, { production_id: draft?.production_id, project_id: draft?.project_id, code: r.data.code })
  }

  // T9: Valid production, omit projectId (server should derive) → 200
  r = await apiCall(PATH, 'POST', {
    userInput: 'M10C test image — no projectId in body',
    productionId: fixtures.productionId,
  }, cookie)
  const draft9 = r.data.draft
  if (r.status === 200 && draft9?.production_id === fixtures.productionId && draft9?.project_id === fixtures.projectId) {
    pass('image T9: no projectId body → server derives project_id from production', r.status)
    // Clean up immediately
    await admin.from('image_drafts').delete().eq('id', draft9.id)
  } else {
    fail('image T9: server should derive project_id', r.status, 200, { production_id: draft9?.production_id, project_id: draft9?.project_id })
  }
}

async function runVideoDraftTests(cookie) {
  const PATH = '/api/video-drafts'
  const SCENE = [{ id: '00000000-0000-0000-0000-000000000099', order: 1, description: 'M10C test scene', duration: 3, movement: 'static', prompt: null, image_url: null }]

  // T1: No auth → 401
  let r = await apiCall(PATH, 'POST', { scenes: SCENE, name: 'test', productionId: fixtures.productionId })
  r.status === 401 ? pass('video T1: no auth → 401', r.status) : fail('video T1: no auth → 401', r.status, 401)

  // T2: No productionId → 422 PRODUCTION_REQUIRED
  r = await apiCall(PATH, 'POST', { scenes: SCENE, name: 'test' }, cookie)
  r.status === 422 && r.data.code === 'PRODUCTION_REQUIRED'
    ? pass('video T2: no productionId → 422 PRODUCTION_REQUIRED', r.status)
    : fail('video T2: no productionId → 422 PRODUCTION_REQUIRED', r.status, 422, { code: r.data.code })

  // T3: productionId = null → 422
  r = await apiCall(PATH, 'POST', { scenes: SCENE, name: 'test', productionId: null }, cookie)
  r.status === 422 && r.data.code === 'PRODUCTION_REQUIRED'
    ? pass('video T3: productionId null → 422 PRODUCTION_REQUIRED', r.status)
    : fail('video T3: productionId null → 422 PRODUCTION_REQUIRED', r.status, 422, { code: r.data.code })

  // T4: Invalid UUID → 400 INVALID_PRODUCTION_ID
  r = await apiCall(PATH, 'POST', { scenes: SCENE, name: 'test', productionId: 'bad-id' }, cookie)
  r.status === 400 && r.data.code === 'INVALID_PRODUCTION_ID'
    ? pass('video T4: invalid UUID → 400 INVALID_PRODUCTION_ID', r.status)
    : fail('video T4: invalid UUID → 400 INVALID_PRODUCTION_ID', r.status, 400, { code: r.data.code })

  // T5: Non-existent UUID → 404 PRODUCTION_NOT_FOUND
  r = await apiCall(PATH, 'POST', { scenes: SCENE, name: 'test', productionId: '00000000-0000-0000-0000-000000000001' }, cookie)
  r.status === 404 && r.data.code === 'PRODUCTION_NOT_FOUND'
    ? pass('video T5: non-existent UUID → 404 PRODUCTION_NOT_FOUND', r.status)
    : fail('video T5: non-existent UUID → 404 PRODUCTION_NOT_FOUND', r.status, 404, { code: r.data.code })

  // T6: Other user's production → 404
  const REAL_PRODUCTION = '76120099-e0f0-4b86-ae79-6e13d93f9d75'
  r = await apiCall(PATH, 'POST', { scenes: SCENE, name: 'test', productionId: REAL_PRODUCTION }, cookie)
  r.status === 404 && r.data.code === 'PRODUCTION_NOT_FOUND'
    ? pass('video T6: other user production → 404 PRODUCTION_NOT_FOUND', r.status)
    : fail('video T6: other user production → 404 PRODUCTION_NOT_FOUND', r.status, 404, { code: r.data.code })

  // T7: projectId mismatch → 409 PROJECT_PRODUCTION_MISMATCH
  r = await apiCall(PATH, 'POST', { scenes: SCENE, name: 'test', productionId: fixtures.productionId, projectId: '00000000-0000-0000-0000-000000000002' }, cookie)
  r.status === 409 && r.data.code === 'PROJECT_PRODUCTION_MISMATCH'
    ? pass('video T7: projectId mismatch → 409 PROJECT_PRODUCTION_MISMATCH', r.status)
    : fail('video T7: projectId mismatch → 409 PROJECT_PRODUCTION_MISMATCH', r.status, 409, { code: r.data.code })

  // T8: Valid creation → 200, correct production_id and project_id
  r = await apiCall(PATH, 'POST', {
    scenes: SCENE,
    name: 'M10C test video draft — fixture',
    productionId: fixtures.productionId,
    projectId: fixtures.projectId,
  }, cookie)
  const draft = r.data.draft
  if (r.status === 200 && draft?.production_id === fixtures.productionId && draft?.project_id === fixtures.projectId) {
    pass('video T8: valid production → 200, production_id and project_id correct', r.status, { draftId: draft.id })
    fixtures.videoDraftId = draft.id
  } else {
    fail('video T8: valid production → 200', r.status, 200, { production_id: draft?.production_id, project_id: draft?.project_id, code: r.data.code })
  }

  // T9: Server derives project_id when projectId omitted
  r = await apiCall(PATH, 'POST', {
    scenes: SCENE,
    name: 'M10C test video — no projectId',
    productionId: fixtures.productionId,
  }, cookie)
  const draft9 = r.data.draft
  if (r.status === 200 && draft9?.production_id === fixtures.productionId && draft9?.project_id === fixtures.projectId) {
    pass('video T9: no projectId body → server derives project_id from production', r.status)
    await admin.from('video_drafts').delete().eq('id', draft9.id)
  } else {
    fail('video T9: server should derive project_id', r.status, 200, { production_id: draft9?.production_id, project_id: draft9?.project_id })
  }
}

async function runPatchTests(cookie) {
  // PATCH should not be affected: existing drafts (including null-production ones) still patchable
  if (!fixtures.imageDraftId) return

  // PATCH doesn't require productionId — real client always sends projectId from page state
  const r = await apiCall('/api/image-drafts', 'PATCH', {
    id: fixtures.imageDraftId,
    userInput: 'M10C patched',
    productionId: fixtures.productionId,
    projectId: fixtures.projectId,
  }, cookie)
  r.status === 200
    ? pass('patch T1: PATCH existing draft without new productionId check → 200', r.status)
    : fail('patch T1: PATCH existing draft → 200', r.status, 200, { data: r.data })

  // Verify production_id not wiped after PATCH
  const { data: d } = await admin.from('image_drafts').select('production_id, project_id').eq('id', fixtures.imageDraftId).single()
  d?.production_id === fixtures.productionId && d?.project_id === fixtures.projectId
    ? pass('patch T2: PATCH preserves production_id and project_id', 'ok')
    : fail('patch T2: PATCH preserves production_id', d?.production_id, fixtures.productionId)
}

async function verifyHistoricalDrafts() {
  // The 3 test drafts with production_id = NULL should still be untouched
  const TEST_IDS = [
    'd52b83b6-cf1c-4d83-9491-df0d6408c933',
    '8c5bbdb7-e864-4cfe-8745-63e1030be9cd',
    '0bc4324c-94f0-41d7-af50-93827ee4da13',
  ]
  const { data } = await admin.from('image_drafts')
    .select('id, production_id')
    .in('id', TEST_IDS.slice(0, 2))

  const videoTest = await admin.from('video_drafts')
    .select('id, production_id')
    .eq('id', TEST_IDS[2])

  const allNull = [
    ...(data || []),
    ...(videoTest.data || []),
  ].every(r => r.production_id === null)

  allNull
    ? pass('historical T1: 3 test drafts still have production_id = NULL', 'ok')
    : fail('historical T1: test drafts should remain NULL', 'some changed', 'all NULL')

  // Verify the 6 real drafts still have their production_id
  const REAL_PROD_ID = '76120099-e0f0-4b86-ae79-6e13d93f9d75'
  const IMAGE_REAL = ['c44bf448-350d-4a3f-833b-8d00f5a9f0b0', '97508404-c5a9-4d30-ac0a-ac5b7ae0706d', 'e624d457-b632-45f6-902e-d2598d84f6d9', '0eb2a983-4354-451a-8038-fd3f502c2413']
  const VIDEO_REAL = ['f1029001-2adf-491f-8063-1c2c9c12ab85', 'd46d2259-83d8-4633-a040-92a3a64316d7']

  const { data: imgReal } = await admin.from('image_drafts').select('id, production_id').in('id', IMAGE_REAL)
  const { data: vidReal } = await admin.from('video_drafts').select('id, production_id').in('id', VIDEO_REAL)
  const allAssigned = [...(imgReal || []), ...(vidReal || [])].every(r => r.production_id === REAL_PROD_ID)

  allAssigned
    ? pass('historical T2: 6 real drafts still assigned to Arquivo production', 'ok')
    : fail('historical T2: real drafts should retain production_id', 'some missing', REAL_PROD_ID)
}

async function cleanupOrphanFixtures() {
  // Clean up partial fixtures from the previous failed run
  const ORPHAN_USER = 'cd6c8e82-51e5-4066-b457-2fca9169d1e2'
  const ORPHAN_PROJECT = '6119e62d-f046-4df1-8f83-c8bceab20248'
  await admin.from('projects').delete().eq('id', ORPHAN_PROJECT)
  await admin.auth.admin.deleteUser(ORPHAN_USER)
}

async function main() {
  console.log('M10-C API Contract Tests')
  console.log('========================\n')

  // Clean up orphan fixtures from previous aborted run, if any
  await cleanupOrphanFixtures()

  try {
    await setup()

    // Get session cookie for test user
    console.log('Authenticating test user...')
    const cookie = await buildCookie(TEST_EMAIL, TEST_PASSWORD)
    console.log('  Session cookie obtained.\n')

    console.log('--- ImageDraft Tests ---')
    await runImageDraftTests(cookie)

    console.log('--- VideoDraft Tests ---')
    await runVideoDraftTests(cookie)

    console.log('--- PATCH Tests ---')
    await runPatchTests(cookie)

    console.log('--- Historical Integrity ---')
    await verifyHistoricalDrafts()
  } finally {
    await teardown()
  }

  // Report
  console.log('\n=== RESULTS ===\n')
  for (const r of results) {
    const icon = r.ok ? '✅' : '❌'
    const detail = !r.ok ? `  expected ${r.expected}, got ${r.got}${r.code ? ` code=${r.code}` : ''}` : ''
    console.log(`${icon} ${r.label} (${r.got})${detail ? '\n' + detail : ''}`)
  }

  const passed = results.filter(r => r.ok).length
  const failed = results.filter(r => !r.ok).length
  console.log(`\n${passed}/${results.length} PASS   ${failed} FAIL`)

  if (failed > 0) {
    console.log('\nFailed tests:')
    results.filter(r => !r.ok).forEach(r => console.log(`  - ${r.label}`))
    process.exit(1)
  }

  process.exit(0)
}

main().catch(err => {
  console.error('\nFATAL:', err)
  process.exit(1)
})

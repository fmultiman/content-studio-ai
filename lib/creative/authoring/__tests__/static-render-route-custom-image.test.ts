import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createFakeDb, type FakeDb } from '@/lib/__tests__/helpers/fake-db'
import { createInitialAuthoringState, deriveManifestFromState } from '../authoring-state'
import { addFreeImageElement, addFreeTextElement, createFreeScene, freeElements } from '@/lib/creative/video-editor/free-composition'
import { classifyTemplateManifestAssets } from '../custom-image-assets'

/**
 * STATIC_TEMPLATE_CUSTOM_ELEMENTS_V1 — POST /api/creative/static-authoring/render.
 *
 * Found by the production smoke: a Template slide with a Custom Image was
 * refused with UNSUPPORTED_ASSET_REF before any render was queued. The fix
 * must be structurally narrow: the ONLY non-fixture Template asset accepted is
 * the backing library_file of a Custom Image in manifest.elements, and that
 * file passes the same ownership authority as a Free image.
 */

const USER = '11111111-1111-4111-8111-111111111111'
const OTHER_USER = '22222222-2222-4222-8222-222222222222'
const PROJECT = '33333333-3333-4333-8333-333333333333'
const OTHER_PROJECT = '44444444-4444-4444-8444-444444444444'
const CONTENT = '55555555-5555-4555-8555-555555555555'
const PIECE = '66666666-6666-4666-8666-666666666666'
const FILE = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const FILE_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'

const IDENTITY = {
  schema_version: 1,
  foundation: { purpose: 'Rota de render' },
  visuals: {
    colors: { background: '#101820', foreground: '#F5F0E6', accent: '#D2691E' },
    typography: { display_font: 'Fraunces', body_font: 'Inter' },
  },
}

let db: FakeDb

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: { id: USER } }, error: null }) },
    from: (table: string) => db.from(table),
  }),
}))
// Server-only execution writer (pre-existing): backed by the same fake DB here.
vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({ from: (table: string) => db.from(table) }),
}))

const file = (over: Record<string, unknown> = {}) => ({
  id: FILE, user_id: USER, project_id: PROJECT, kind: 'image', mime_type: 'image/png', deleted_at: null, name: 'foto.png', ...over,
})

function seed(files: Array<Record<string, unknown>>) {
  db = createFakeDb({
    generatedId: ['render_executions'],
    seed: {
      projects: [{ id: PROJECT, user_id: USER, identity: IDENTITY }],
      editorial_contents: [{ id: CONTENT, user_id: USER, project_id: PROJECT, production_id: null }],
      channel_pieces: [{ id: PIECE, user_id: USER, editorial_content_id: CONTENT, channel: 'instagram', format: 'carousel' }],
      library_files: files,
      render_executions: [],
    },
  })
}

function templateBody(mutate?: (manifest: any) => void, withImage = true) {
  let scene = createFreeScene(0, 'scene-1', 5)
  scene = addFreeTextElement(scene, 'txt-1')
  if (withImage) scene = addFreeImageElement(scene, 'img-1', FILE)
  const state = { ...createInitialAuthoringState('cover'), elements: freeElements(scene) }
  const manifest: any = JSON.parse(JSON.stringify(deriveManifestFromState(state)))
  manifest.canvas = { width: 1080, height: 1350, unit: 'px' }
  mutate?.(manifest)
  return { manifest, context: { projectId: PROJECT, editorialContentId: CONTENT, channelPieceId: PIECE } }
}

async function post(body: unknown) {
  const { POST } = await import('@/app/api/creative/static-authoring/render/route')
  const response = await POST(new Request('http://localhost/api/creative/static-authoring/render', { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' } }))
  return { status: response.status, json: (await response.json()) as Record<string, any> }
}

beforeEach(() => {
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://test.invalid')
  vi.stubEnv('SUPABASE_SECRET_KEY', `sb_secret_${'t'.repeat(32)}`) // fake, correctly shaped
  seed([file()])
})

describe('POST static-authoring/render — Template assets', () => {
  it('1. a Template without Custom Elements and only fixtures is still accepted and queued', async () => {
    const { status, json } = await post(templateBody(undefined, false))
    expect(status).toBe(201)
    expect(json.status).toBe('queued')
    expect(db.tables.render_executions).toHaveLength(1)
  })

  it('2. a Template with the user\'s own Custom Image is accepted, queued and frozen without a signed URL', async () => {
    const { status, json } = await post(templateBody())
    expect(status).toBe(201)
    expect(json.status).toBe('queued')
    const snapshot = JSON.stringify(db.tables.render_executions[0].input_snapshot)
    expect(snapshot).toContain(`library_file:${FILE}`)
    expect(snapshot).not.toMatch(/https?:\/\//)
  })

  it.each([
    ['3. another user\'s file', { user_id: OTHER_USER }],
    ['4. a file of another Project', { project_id: OTHER_PROJECT }],
    ['5. a deleted file', { deleted_at: '2026-09-29T00:00:00.000Z' }],
    ['6a. a non-image file', { kind: 'video', mime_type: 'video/mp4' }],
    ['6b. an unsupported mime type', { mime_type: 'image/svg+xml' }],
    ['6c. a file without a mime type', { mime_type: null }],
  ])('%s is rejected (403) and nothing is queued', async (_label, override) => {
    seed([file(override)])
    const { status, json } = await post(templateBody())
    expect(status).toBe(403)
    expect(json.code).toBe('CUSTOM_IMAGE_FORBIDDEN')
    expect(db.tables.render_executions).toHaveLength(0)
  })

  it('a Custom Image file that does not exist at all is rejected', async () => {
    seed([])
    const { status, json } = await post(templateBody())
    expect(status).toBe(403)
    expect(json.code).toBe('CUSTOM_IMAGE_FORBIDDEN')
  })

  it('7. an owned library_file asset NOT referenced by a Custom Image element is rejected', async () => {
    seed([file(), file({ id: FILE_B })])
    const orphan = await post(templateBody((manifest) => {
      manifest.assets[`library_file:${FILE_B}`] = { type: 'library_file', ref: FILE_B, fit: 'cover' }
    }))
    expect(orphan.status).toBe(400)
    expect(orphan.json.code).toBe('UNSUPPORTED_ASSET_REF')

    // ...nor when there is no Custom Image element at all
    const noElements = await post(templateBody((manifest) => {
      manifest.assets[`library_file:${FILE}`] = { type: 'library_file', ref: FILE, fit: 'cover' }
    }, false))
    expect(noElements.status).toBe(400)
    expect(noElements.json.code).toBe('UNSUPPORTED_ASSET_REF')
    expect(db.tables.render_executions).toHaveLength(0)
  })

  it('8. a key/uuid mismatch is rejected even when both files are the user\'s own', async () => {
    seed([file(), file({ id: FILE_B })])
    const { status, json } = await post(templateBody((manifest) => {
      manifest.assets[`library_file:${FILE}`] = { type: 'library_file', ref: FILE_B, fit: 'cover' }
    }))
    expect(status).toBe(400)
    expect(json.code).toBe('UNSUPPORTED_ASSET_REF')
    expect(db.tables.render_executions).toHaveLength(0)
  })

  it.each([
    ['hero swapped for a library_file', 'hero', { type: 'library_file', ref: FILE, fit: 'cover' }],
    ['logo swapped for a library_file', 'logo', { type: 'library_file', ref: FILE, fit: 'contain' }],
    ['a structural slot as another asset type', 'hero', { type: 'external', ref: 'https://example.invalid/x.png' }],
    ['a non-uuid library_file key', 'library_file:not-a-uuid', { type: 'library_file', ref: 'not-a-uuid' }],
    ['a library_file key of the wrong type', `library_file:${FILE}`, { type: 'external', ref: FILE }],
    ['an upper-case (non-canonical) key', `library_file:${FILE.toUpperCase()}`, { type: 'library_file', ref: FILE.toUpperCase() }],
  ])('9. %s stays rejected (400)', async (_label, key, asset) => {
    const { status, json } = await post(templateBody((manifest) => { manifest.assets[key] = asset }))
    expect(status).toBe(400)
    expect(json.code).toBe('UNSUPPORTED_ASSET_REF')
    expect(db.tables.render_executions).toHaveLength(0)
  })
})

describe('POST static-authoring/render — Free composition is unchanged', () => {
  const freeBody = (id: string) => {
    let scene = createFreeScene(0, 'scene-1', 5)
    scene = addFreeImageElement(scene, 'img-1', id)
    return { composition: { kind: 'free', elements: freeElements(scene) }, context: { projectId: PROJECT, editorialContentId: CONTENT, channelPieceId: PIECE } }
  }

  it('10a. a Free composition with the user\'s own image is still queued', async () => {
    const { status, json } = await post(freeBody(FILE))
    expect(status).toBe(201)
    expect(json.status).toBe('queued')
  })

  it.each([
    ['another user', { user_id: OTHER_USER }],
    ['another Project', { project_id: OTHER_PROJECT }],
    ['deleted', { deleted_at: '2026-09-29T00:00:00.000Z' }],
    ['a non-image', { kind: 'video', mime_type: 'video/mp4' }],
    ['an unsupported mime', { mime_type: 'image/svg+xml' }],
  ])('10b. a Free image that is %s keeps returning FREE_IMAGE_FORBIDDEN (403)', async (_label, override) => {
    seed([file(override)])
    const { status, json } = await post(freeBody(FILE))
    expect(status).toBe(403)
    expect(json.code).toBe('FREE_IMAGE_FORBIDDEN')
  })
})

describe('classifyTemplateManifestAssets (structural rule)', () => {
  const image = { kind: 'image', asset_ref: `library_file:${FILE}` }

  it('accepts fixtures alone, and a Custom Image asset referenced by an image element', () => {
    expect(classifyTemplateManifestAssets({ assets: { hero: { type: 'fixture', ref: 'fixture:x' } } })).toEqual({ ok: true, libraryFileIds: [] })
    expect(classifyTemplateManifestAssets({ assets: { hero: { type: 'fixture', ref: 'x' }, [`library_file:${FILE}`]: { type: 'library_file', ref: FILE } }, elements: [image] })).toEqual({ ok: true, libraryFileIds: [FILE] })
  })

  it('rejects a text element (or a missing element) as the backing reference', () => {
    const assets = { [`library_file:${FILE}`]: { type: 'library_file', ref: FILE } }
    expect(classifyTemplateManifestAssets({ assets, elements: [{ kind: 'text', asset_ref: `library_file:${FILE}` }] }).ok).toBe(false)
    expect(classifyTemplateManifestAssets({ assets }).ok).toBe(false)
  })
})

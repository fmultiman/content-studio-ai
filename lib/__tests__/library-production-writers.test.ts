import { randomUUID } from 'node:crypto'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createFakeDb, type FakeDb } from './helpers/fake-db'

// MEDIA_LIBRARY_PRODUCTION_SCOPING_V1 — every LibraryFile writer stamps production_id from a SERVER relationship only.
// In-memory DB and S3; every id is synthetic. No provider, storage or paid call exists in this file.

vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))
vi.mock('@/lib/supabase/service-role', async (importActual) => ({
  ...(await importActual<typeof import('@/lib/supabase/service-role')>()),
  createServiceRoleSupabase: vi.fn(),
}))

const serviceClients: { current: FakeDb | null } = { current: null }
vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(() => ({ from: (table: string) => serviceClients.current!.from(table) })),
}))

vi.mock('@/lib/storage/s3', () => ({
  copyS3ObjectToLibrary: vi.fn(),
  deleteS3Object: vi.fn(),
  uploadLibraryFile: vi.fn(),
  headS3Object: vi.fn(),
  moveLibraryS3Object: vi.fn(),
  buildStoragePublicUrl: vi.fn(),
  createPresignedReadUrl: vi.fn(async (path: string) => `https://s3.example.test/${path}?sig=1`),
}))

const providerCalls: string[] = []
vi.mock('@/lib/providers/kling/adapter', () => ({ KlingAdapter: class { constructor() { providerCalls.push('KlingAdapter') } } }))
vi.mock('@/lib/provider-connections/kling-mcp-client', () => ({
  createKlingMcpClient: vi.fn(() => {
    providerCalls.push('createKlingMcpClient')
    throw new Error('provider must not be contacted')
  }),
}))

import * as server from '@/lib/supabase/server'
import * as serviceRole from '@/lib/supabase/service-role'
import { buildStoragePublicUrl, copyS3ObjectToLibrary, deleteS3Object, headS3Object, moveLibraryS3Object, uploadLibraryFile } from '@/lib/storage/s3'
import { buildScratchOutputTarget } from '@/lib/render-execution/scratch-output-target'
import { POST as saveVideoGeneration } from '@/app/api/video-generations/[id]/save-to-library/route'
import { POST as saveImage } from '@/app/api/images/[id]/save-to-library/route'
import { POST as saveRender } from '@/app/api/render-executions/[id]/save-to-library/route'
import { POST as uploadToPiece } from '@/app/api/channel-piece-media/upload/route'
import { PATCH, POST as registerFile } from '@/app/api/library-files/route'

const USER = '11111111-1111-4111-8111-111111111111'
const PROJECT_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const PROJECT_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const PROD_A1 = 'a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1'
const PROD_A2 = 'a2a2a2a2-a2a2-4a2a-8a2a-a2a2a2a2a2a2'
const PROD_B1 = 'b1b1b1b1-b1b1-4b1b-8b1b-b1b1b1b1b1b1'
const GEN = '55555555-5555-4555-8555-555555555555'
const IMAGE = '66666666-6666-4666-8666-666666666666'
const EXEC = '77777777-7777-4777-8777-777777777777'
const DRAFT = '88888888-8888-4888-8888-888888888888'
const EC = '99999999-9999-4999-8999-999999999999'
const CP = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
const BLOB = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
const SIZE = 4_096_000

const productions = [
  { id: PROD_A1, user_id: USER, project_id: PROJECT_A },
  { id: PROD_A2, user_id: USER, project_id: PROJECT_A },
  { id: PROD_B1, user_id: USER, project_id: PROJECT_B },
]

let db: FakeDb
let authedUser: { id: string } | null

const baseTables = () => ({
  projects: [{ id: PROJECT_A, user_id: USER }, { id: PROJECT_B, user_id: USER }],
  productions,
  library_folders: [
    { project_id: PROJECT_A, user_id: USER, is_project_root: true, path: '/Projetos/A' },
    { project_id: PROJECT_B, user_id: USER, is_project_root: true, path: '/Projetos/B' },
  ],
  library_files: [] as Array<Record<string, unknown>>,
})

function boot(tables: Record<string, Array<Record<string, unknown>>>) {
  db = createFakeDb({ seed: { ...baseTables(), ...tables }, generatedId: ['library_files', 'channel_piece_media'] })
  serviceClients.current = db
  vi.mocked(server.createClient).mockResolvedValue({ auth: { getUser: async () => ({ data: { user: authedUser }, error: authedUser ? null : { message: 'no' } }) }, from: db.from } as any)
  vi.mocked(serviceRole.createServiceRoleSupabase).mockReturnValue({ from: db.from } as any)
}

const files = () => db.tables.library_files ?? []
const ctx = (id: string) => ({ params: Promise.resolve({ id }) })
const post = (handler: (r: Request, c: any) => Promise<Response>, id: string) => handler(new Request('http://localhost/x', { method: 'POST' }), ctx(id))
const json = (body: unknown, method = 'POST') => new Request('http://localhost/x', { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })

beforeEach(() => {
  vi.clearAllMocks()
  providerCalls.length = 0
  authedUser = { id: USER }
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.test'
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-test-key'
  vi.mocked(copyS3ObjectToLibrary).mockImplementation(async (input: any) => {
    const storagePath = `users/${input.userId}/library/${randomUUID()}/${input.filename}`
    const isVideo = String(input.mimeType).startsWith('video/')
    return { storagePath, publicUrl: `https://cdn.example.test/${storagePath}`, fileSize: isVideo ? SIZE : 812_345, mimeType: input.mimeType }
  })
  vi.mocked(deleteS3Object).mockResolvedValue(undefined as never)
  vi.mocked(uploadLibraryFile).mockImplementation(async (input: any) => {
    const storagePath = `users/${input.userId}/library/${randomUUID()}/${input.filename}`
    return { storagePath, publicUrl: `https://cdn.example.test/${storagePath}`, fileSize: input.buffer.length } as any
  })
  vi.mocked(headS3Object).mockResolvedValue({ size: 2048, contentType: 'image/png' } as any)
  vi.mocked(buildStoragePublicUrl).mockImplementation((path: string) => `https://s3.example.test/bucket/${path}`)
  vi.mocked(moveLibraryS3Object).mockImplementation(async (input: any) => ({ storagePath: `users/${input.userId}/library/${BLOB}/moved.png`, publicUrl: 'https://s3.example.test/moved' }))
})

// ---------------------------------------------------------------------------------------------------------------------
describe('generated VIDEO -> Library promotion', () => {
  const generation = (overrides: Record<string, unknown> = {}) => ({
    id: GEN,
    user_id: USER,
    project_id: PROJECT_A,
    production_id: PROD_A1,
    status: 'succeeded',
    storage_path: `${USER}/videos/ai/${PROJECT_A}/${GEN}.mp4`,
    library_file_id: null,
    provider: 'kling',
    transport: 'mcp',
    result_metadata: { mime: 'video/mp4', size: SIZE, completed_at: '2026-09-29T20:01:46.000Z' },
    created_at: '2026-09-29T20:00:00.000Z',
    ...overrides,
  })

  it('writes the VideoGeneration’s own Production', async () => {
    boot({ video_generations: [generation()] })
    const response = await post(saveVideoGeneration, GEN)
    expect(response.status).toBeLessThan(300)
    expect(files()).toHaveLength(1)
    expect(files()[0]).toMatchObject({ project_id: PROJECT_A, production_id: PROD_A1 })
    expect(providerCalls).toEqual([])
  })

  it('never writes a Production that is not valid for the owner+Project (stale/foreign pointer becomes NULL)', async () => {
    boot({ video_generations: [generation({ production_id: PROD_B1 })] })
    const response = await post(saveVideoGeneration, GEN)
    expect(response.status).toBeLessThan(300)
    expect(files()[0]).toMatchObject({ project_id: PROJECT_A, production_id: null })
  })
})

// ---------------------------------------------------------------------------------------------------------------------
describe('generated IMAGE -> Library promotion', () => {
  const image = () => ({ id: IMAGE, user_id: USER, project_id: PROJECT_A, storage_path: `users/${USER}/images/${BLOB}/original.png`, mime_type: 'image/png', file_size: 812_345, status: 'approved' })
  const draft = (overrides: Record<string, unknown>) => ({ id: randomUUID(), user_id: USER, production_id: null, current_image_id: null, generation_attempts: [], ...overrides })

  it('writes the draft Production when exactly one trustworthy Production is derivable', async () => {
    boot({ images: [image()], image_drafts: [draft({ production_id: PROD_A1, current_image_id: IMAGE })] })
    const response = await post(saveImage, IMAGE)
    expect(response.status).toBeLessThan(300)
    expect(files()[0]).toMatchObject({ project_id: PROJECT_A, production_id: PROD_A1, source_image_id: IMAGE })
  })

  it('leaves the file unscoped (NULL) when no draft references the image', async () => {
    boot({ images: [image()], image_drafts: [] })
    const response = await post(saveImage, IMAGE)
    expect(response.status).toBeLessThan(300)
    expect(files()[0]).toMatchObject({ project_id: PROJECT_A, production_id: null })
  })

  it('leaves the file unscoped (NULL) when two Productions claim the image — never newest/first', async () => {
    boot({ images: [image()], image_drafts: [draft({ production_id: PROD_A1, current_image_id: IMAGE }), draft({ production_id: PROD_A2, generation_attempts: [{ imageId: IMAGE }] })] })
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const response = await post(saveImage, IMAGE)
    warn.mockRestore()
    expect(response.status).toBeLessThan(300)
    expect(files()[0]).toMatchObject({ project_id: PROJECT_A, production_id: null })
  })
})

// ---------------------------------------------------------------------------------------------------------------------
describe('video RENDER -> Library promotion', () => {
  const execution = () => {
    const target = buildScratchOutputTarget({ userId: USER, executionId: EXEC, kind: 'video' })
    return {
      id: EXEC,
      user_id: USER,
      project_id: PROJECT_A,
      video_draft_id: DRAFT,
      kind: 'video',
      status: 'completed',
      output_bucket: target.bucket,
      output_storage_path: target.key,
      output_mime_type: 'video/mp4',
      output_size_bytes: SIZE,
    }
  }

  it('render_execution -> video_draft -> Production', async () => {
    boot({ render_executions: [execution()], video_drafts: [{ id: DRAFT, user_id: USER, production_id: PROD_A2 }] })
    const response = await post(saveRender, EXEC)
    expect(response.status).toBeLessThan(300)
    expect(files()[0]).toMatchObject({ project_id: PROJECT_A, production_id: PROD_A2, origin: 'studio_render', source_render_execution_id: EXEC })
  })

  it('a draft Production of another Project is not propagated', async () => {
    boot({ render_executions: [execution()], video_drafts: [{ id: DRAFT, user_id: USER, production_id: PROD_B1 }] })
    const response = await post(saveRender, EXEC)
    expect(response.status).toBeLessThan(300)
    expect(files()[0]).toMatchObject({ production_id: null })
  })
})

// ---------------------------------------------------------------------------------------------------------------------
describe('ChannelPiece upload and static "Salvar nesta peça"', () => {
  const tables = (ecProduction: string | null) => ({
    channel_pieces: [{ id: CP, user_id: USER, editorial_content_id: EC }],
    editorial_contents: [{ id: EC, user_id: USER, project_id: PROJECT_A, production_id: ecProduction }],
    channel_piece_media: [],
  })
  const form = (extra: Record<string, string> = {}) => {
    const data = new FormData()
    data.set('channelPieceId', CP)
    data.set('file', new File([new Uint8Array([137, 80, 78, 71])], 'arte.png', { type: 'image/png' }))
    // a hostile browser tries to choose the Production itself
    data.set('productionId', PROD_A2)
    for (const [key, value] of Object.entries(extra)) data.set(key, value)
    return new Request('http://localhost/x', { method: 'POST', body: data })
  }

  it('upload to a ChannelPiece takes the EditorialContent’s Production and ignores any browser-supplied one', async () => {
    boot(tables(PROD_A1))
    const response = await uploadToPiece(form())
    expect(response.status).toBeLessThan(300)
    expect(files()[0]).toMatchObject({ project_id: PROJECT_A, production_id: PROD_A1 })
  })

  it('a piece whose EditorialContent has no Production yields an unscoped file', async () => {
    boot(tables(null))
    const response = await uploadToPiece(form())
    expect(response.status).toBeLessThan(300)
    expect(files()[0]).toMatchObject({ project_id: PROJECT_A, production_id: null })
  })

  it('static "Salvar nesta peça" (verified render) also carries the piece’s Production', async () => {
    boot({
      ...tables(PROD_A1),
      render_executions: [{ id: EXEC, user_id: USER, kind: 'static_still', status: 'completed', channel_piece_id: CP }],
    })
    const response = await uploadToPiece(form({ renderExecutionId: EXEC }))
    expect(response.status).toBeLessThan(300)
    expect(files()[0]).toMatchObject({ production_id: PROD_A1, origin: 'studio_render', source_render_execution_id: EXEC })
  })

  it('a stale EditorialContent Production from another Project is dropped, not stamped', async () => {
    boot(tables(PROD_B1))
    const response = await uploadToPiece(form())
    expect(response.status).toBeLessThan(300)
    expect(files()[0]).toMatchObject({ project_id: PROJECT_A, production_id: null })
  })
})

// ---------------------------------------------------------------------------------------------------------------------
describe('generic registration (POST /api/library-files)', () => {
  const registration = (overrides: Record<string, unknown> = {}) => ({
    projectId: PROJECT_A,
    folder: '/Projetos/A',
    name: 'foto.png',
    kind: 'image',
    mimeType: 'image/png',
    fileSize: 1,
    storageProvider: 's3',
    storagePath: `users/${USER}/library/${BLOB}/foto.png`,
    ...overrides,
  })

  it('defaults to NULL when no Production is named', async () => {
    boot({})
    const response = await registerFile(json(registration()))
    expect(response.status).toBe(200)
    expect(files()[0]).toMatchObject({ project_id: PROJECT_A, production_id: null })
  })

  it('accepts a verified optional Production of THIS Project', async () => {
    boot({})
    const response = await registerFile(json(registration({ productionId: PROD_A1 })))
    expect(response.status).toBe(200)
    expect(files()[0]).toMatchObject({ project_id: PROJECT_A, production_id: PROD_A1 })
  })

  it.each([
    ['a Production of another Project', PROD_B1],
    ['an unknown Production', '12345678-1234-4234-8234-123456789012'],
    ['a malformed Production', 'nope'],
  ])('refuses %s with 404 PRODUCTION_NOT_FOUND and writes nothing', async (_name, productionId) => {
    boot({})
    const response = await registerFile(json(registration({ productionId })))
    expect(response.status).toBe(404)
    expect((await response.json()).code).toBe('PRODUCTION_NOT_FOUND')
    expect(files()).toHaveLength(0)
  })

  it('a Production without a Project is refused', async () => {
    boot({})
    const response = await registerFile(json(registration({ projectId: null, productionId: PROD_A1 })))
    expect(response.status).toBe(404)
    expect(files()).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------------------------------------------------
describe('moves (PATCH /api/library-files)', () => {
  const row = () => ({
    id: 'file-1',
    user_id: USER,
    project_id: PROJECT_A,
    production_id: PROD_A1,
    folder: '/Projetos/A',
    name: 'foto.png',
    kind: 'image',
    mime_type: 'image/png',
    file_size: 10,
    storage_provider: 's3',
    storage_path: `users/${USER}/library/${BLOB}/foto.png`,
    public_url: 'https://s3.example.test/x',
    thumbnail_url: null,
    origin: 'upload',
    deleted_at: null,
  })

  it('a move inside the SAME Project keeps the Production', async () => {
    boot({ library_files: [row()] })
    db.tables.library_folders.push({ id: 'folder-sub', user_id: USER, project_id: PROJECT_A, path: '/Projetos/A/Sub' })
    const response = await PATCH(json({ ids: ['file-1'], targetFolder: '/Projetos/A/Sub', targetProjectId: PROJECT_A }, 'PATCH'))
    expect(response.status).toBe(200)
    expect(files()[0]).toMatchObject({ project_id: PROJECT_A, production_id: PROD_A1 })
  })

  it('a move to ANOTHER Project clears the Production', async () => {
    boot({ library_files: [row()] })
    const response = await PATCH(json({ ids: ['file-1'], targetFolder: '/Projetos/B', targetProjectId: PROJECT_B }, 'PATCH'))
    expect(response.status).toBe(200)
    expect(files()[0]).toMatchObject({ project_id: PROJECT_B, production_id: null })
  })
})

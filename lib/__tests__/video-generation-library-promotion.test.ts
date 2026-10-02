import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createFakeDb, type FakeDb } from './helpers/fake-db'

// VIDEO_GENERATION_LIBRARY_PROMOTION_V1 — explicit VideoGeneration -> LibraryFile promotion.
//
// Everything is in memory: fake DB, fake S3 copy, and provider modules that would fail the
// test if they were ever touched. No real provider, storage or paid call exists here.

vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))
vi.mock('@/lib/supabase/service-role', async (importActual) => ({
  ...(await importActual<typeof import('@/lib/supabase/service-role')>()),
  createServiceRoleSupabase: vi.fn(),
}))
vi.mock('@/lib/storage/s3', () => ({
  copyS3ObjectToLibrary: vi.fn(),
  deleteS3Object: vi.fn(),
  createPresignedReadUrl: vi.fn(async (path: string) => `https://s3.example.test/${path}?sig=1`),
}))

const providerCalls: string[] = []
vi.mock('@/lib/providers/kling/adapter', () => ({
  KlingAdapter: class {
    constructor() {
      providerCalls.push('KlingAdapter')
    }
  },
}))
vi.mock('@/lib/provider-connections/kling-mcp-client', () => ({
  createKlingMcpClient: vi.fn(() => {
    providerCalls.push('createKlingMcpClient')
    throw new Error('provider must not be contacted')
  }),
}))

import * as server from '@/lib/supabase/server'
import * as serviceRole from '@/lib/supabase/service-role'
import { copyS3ObjectToLibrary, deleteS3Object } from '@/lib/storage/s3'
import { POST } from '@/app/api/video-generations/[id]/save-to-library/route'
import { GET as listGenerations } from '@/app/api/video-generations/route'
import { MAX_LIBRARY_FILE_SIZE_BYTES, validateGenerationForLibrary, videoGenerationLibraryFilename } from '@/lib/video-generation/library-promotion'

const USER = '11111111-1111-4111-8111-111111111111'
const OTHER_USER = '22222222-2222-4222-8222-222222222222'
const PROJECT = '33333333-3333-4333-8333-333333333333'
const OTHER_PROJECT = '44444444-4444-4444-8444-444444444444'
const GEN = '55555555-5555-4555-8555-555555555555'
const SIZE = 4_096_000

const sourcePath = (user = USER, project = PROJECT, id = GEN) => `${user}/videos/ai/${project}/${id}.mp4`

function generationRow(overrides: Record<string, unknown> = {}) {
  return {
    id: GEN,
    user_id: USER,
    project_id: PROJECT,
    production_id: 'prod-1',
    status: 'succeeded',
    storage_path: sourcePath(),
    library_file_id: null,
    provider: 'kling',
    transport: 'mcp',
    result_metadata: { mime: 'video/mp4', size: SIZE, completed_at: '2026-09-29T20:01:46.000Z' },
    created_at: '2026-09-29T20:00:00.000Z',
    ...overrides,
  }
}

let db: FakeDb
let authedUser: { id: string } | null
let copyCount: number
let copyDelay = 0

function seed(generation: Record<string, unknown> = generationRow(), extra: Record<string, any[]> = {}) {
  db = createFakeDb({
    seed: {
      video_generations: [generation],
      projects: [{ id: PROJECT, user_id: USER }],
      library_folders: [{ project_id: PROJECT, user_id: USER, is_project_root: true, path: '/Projetos/Maitê' }],
      library_files: [],
      ...extra,
    },
    generatedId: ['library_files', 'video_generations'],
  })
  vi.mocked(server.createClient).mockResolvedValue({ auth: { getUser: async () => ({ data: { user: authedUser }, error: authedUser ? null : { message: 'no' } }) }, from: db.from } as any)
  vi.mocked(serviceRole.createServiceRoleSupabase).mockReturnValue({ from: db.from } as any)
}

const call = (id = GEN) => POST(new Request('http://localhost/x', { method: 'POST' }), { params: Promise.resolve({ id }) })
const files = () => db.tables.library_files ?? []

beforeEach(() => {
  vi.clearAllMocks()
  providerCalls.length = 0
  authedUser = { id: USER }
  copyCount = 0
  copyDelay = 0
  vi.mocked(copyS3ObjectToLibrary).mockImplementation(async (input: any) => {
    copyCount += 1
    if (copyDelay) await new Promise((resolve) => setTimeout(resolve, copyDelay))
    const storagePath = `users/${input.userId}/library/${randomUUID()}/video-ia.mp4`
    return { storagePath, publicUrl: `https://cdn.example.test/${storagePath}`, fileSize: SIZE, mimeType: 'video/mp4' }
  })
  vi.mocked(deleteS3Object).mockResolvedValue(undefined as never)
  seed()
})

describe('eligibility (pure policy)', () => {
  it.each(['queued', 'submitted', 'processing', 'failed'])('a %s generation is not promotable', (status) => {
    expect(validateGenerationForLibrary(generationRow({ status }) as any)).toEqual({ ok: false, code: 'GENERATION_NOT_COMPLETED' })
  })

  it('a succeeded generation with an in-namespace object is promotable, with the recorded size as a cross-check only', () => {
    expect(validateGenerationForLibrary(generationRow() as any)).toEqual({ ok: true, storagePath: sourcePath(), mimeType: 'video/mp4', expectedSizeBytes: SIZE })
    expect(validateGenerationForLibrary(generationRow({ result_metadata: {} }) as any)).toMatchObject({ ok: true, expectedSizeBytes: null })
  })

  it.each([
    ['a foreign tenant', sourcePath(OTHER_USER)],
    ['a foreign project', sourcePath(USER, OTHER_PROJECT)],
    ['traversal', `${USER}/videos/ai/${PROJECT}/../${OTHER_USER}/x.mp4`],
    ['a nested folder', `${USER}/videos/ai/${PROJECT}/a/b.mp4`],
    ['a non-mp4', `${USER}/videos/ai/${PROJECT}/${GEN}.png`],
    ['an unrelated key', 'users/x/library/y/z.mp4'],
  ])('rejects %s as a source object', (_label, storage_path) => {
    expect(validateGenerationForLibrary(generationRow({ storage_path }) as any)).toEqual({ ok: false, code: 'INVALID_STORAGE_PATH' })
  })

  it('a missing object or project fails closed; an oversized recorded size is refused', () => {
    expect(validateGenerationForLibrary(generationRow({ storage_path: null }) as any)).toEqual({ ok: false, code: 'MISSING_STORAGE_PATH' })
    expect(validateGenerationForLibrary(generationRow({ project_id: null }) as any)).toEqual({ ok: false, code: 'MISSING_PROJECT' })
    expect(validateGenerationForLibrary(generationRow({ result_metadata: { size: MAX_LIBRARY_FILE_SIZE_BYTES + 1 } }) as any)).toEqual({ ok: false, code: 'OUTPUT_TOO_LARGE' })
  })

  it('the default name is readable and never a provider task id', () => {
    expect(videoGenerationLibraryFilename(GEN)).toBe('video-ia-55555555.mp4')
  })
})

describe('POST /api/video-generations/:id/save-to-library', () => {
  it('rejects an unauthenticated request before touching data or storage', async () => {
    authedUser = null
    const response = await call()
    expect(response.status).toBe(401)
    expect(copyS3ObjectToLibrary).not.toHaveBeenCalled()
    expect(files()).toHaveLength(0)
  })

  it('rejects a malformed id', async () => {
    expect((await call('not-a-uuid')).status).toBe(400)
  })

  it("does not let a user promote another user's generation (and reveals nothing)", async () => {
    authedUser = { id: OTHER_USER }
    const response = await call()
    expect(response.status).toBe(404)
    expect(copyS3ObjectToLibrary).not.toHaveBeenCalled()
    expect(files()).toHaveLength(0)
  })

  it('rejects when the generation’s Project is not accessible to the caller', async () => {
    seed(generationRow(), {})
    db.tables.projects = [{ id: OTHER_PROJECT, user_id: USER }]
    const response = await call()
    expect(response.status).toBe(404)
    expect((await response.json()).code).toBe('PROJECT_NOT_FOUND')
    expect(copyS3ObjectToLibrary).not.toHaveBeenCalled()
  })

  it.each(['queued', 'submitted', 'processing', 'failed'])('rejects a %s generation with a stable error and does not sync the provider', async (status) => {
    seed(generationRow({ status, storage_path: null }))
    const response = await call()
    expect(response.status).toBe(409)
    expect((await response.json()).code).toBe('GENERATION_NOT_COMPLETED')
    expect(copyS3ObjectToLibrary).not.toHaveBeenCalled()
    expect(providerCalls).toEqual([])
  })

  it('rejects a stored path outside the owner’s namespace: nothing is copied', async () => {
    seed(generationRow({ storage_path: sourcePath(OTHER_USER) }))
    const response = await call()
    expect(response.status).toBe(422)
    expect((await response.json()).code).toBe('INVALID_STORAGE_PATH')
    expect(copyS3ObjectToLibrary).not.toHaveBeenCalled()
  })

  it('promotes a succeeded generation: one video LibraryFile, owned and scoped server-side, linked durably', async () => {
    const response = await call()
    expect(response.status).toBe(201)
    const body = await response.json()
    expect(body.result).toBe('created')

    // Only the server-resolved trusted key is ever copied, into the caller's Library namespace.
    expect(copyS3ObjectToLibrary).toHaveBeenCalledTimes(1)
    expect(vi.mocked(copyS3ObjectToLibrary).mock.calls[0][0]).toMatchObject({ userId: USER, sourcePath: sourcePath(), mimeType: 'video/mp4' })

    expect(files()).toHaveLength(1)
    expect(files()[0]).toMatchObject({
      user_id: USER,
      project_id: PROJECT,
      folder: '/Projetos/Maitê',
      name: 'video-ia-55555555.mp4',
      kind: 'video',
      mime_type: 'video/mp4',
      file_size: SIZE,
      storage_provider: 's3',
      thumbnail_url: null,
    })
    expect(files()[0].storage_path).toMatch(new RegExp(`^users/${USER}/library/`))
    expect(files()[0].storage_path).not.toBe(sourcePath())
    // The pointer is the provenance: generation -> LibraryFile.
    expect(db.tables.video_generations[0].library_file_id).toBe(files()[0].id)
    expect(body.libraryFile.id).toBe(files()[0].id)
    expect(body.generation).toEqual({ id: GEN, library_file_id: files()[0].id })
  })

  it('never puts secrets, signed URLs or task ids on the LibraryFile', async () => {
    await call()
    const serialised = JSON.stringify(files()[0])
    expect(serialised).not.toMatch(/sig=|token|task/i)
  })

  it('a repeated request reuses the same LibraryFile and copies nothing', async () => {
    const first = await (await call()).json()
    vi.mocked(copyS3ObjectToLibrary).mockClear()
    const second = await call()
    expect(second.status).toBe(200)
    const body = await second.json()
    expect(body.result).toBe('already_saved')
    expect(body.libraryFile.id).toBe(first.libraryFile.id)
    expect(files()).toHaveLength(1)
    expect(copyS3ObjectToLibrary).not.toHaveBeenCalled()
  })

  it('CONCURRENT requests can never leave two LibraryFiles: the loser removes its own copy and returns the winner’s', async () => {
    copyDelay = 5
    const [a, b] = await Promise.all([call(), call()])
    const bodies = [await a.json(), await b.json()]

    expect([a.status, b.status].sort()).toEqual([200, 201])
    expect(copyCount).toBe(2)
    expect(files()).toHaveLength(1)
    expect(bodies[0].libraryFile.id).toBe(bodies[1].libraryFile.id)
    expect(db.tables.video_generations[0].library_file_id).toBe(files()[0].id)

    // The loser deleted exactly its own object, never the winner's.
    const deleted = vi.mocked(deleteS3Object).mock.calls.map(([path]) => path)
    expect(deleted).toHaveLength(1)
    expect(deleted[0]).not.toBe(files()[0].storage_path)
  })

  it('many simultaneous clicks still yield a single LibraryFile', async () => {
    copyDelay = 3
    const responses = await Promise.all(Array.from({ length: 6 }, () => call()))
    expect(responses.filter((response) => response.status === 201)).toHaveLength(1)
    expect(files()).toHaveLength(1)
  })

  it('a trashed LibraryFile means "no current file": saving again creates ONE new file and repoints', async () => {
    const first = await (await call()).json()
    files()[0].deleted_at = '2026-09-30T00:00:00.000Z'

    const again = await call()
    expect(again.status).toBe(201)
    const second = await again.json()
    expect(second.libraryFile.id).not.toBe(first.libraryFile.id)
    expect(files().filter((file) => file.deleted_at == null)).toHaveLength(1)
    expect(db.tables.video_generations[0].library_file_id).toBe(second.libraryFile.id)
  })

  it('a hard-deleted LibraryFile (pointer cleared by ON DELETE SET NULL) can be saved again', async () => {
    await call()
    db.tables.library_files = []
    db.tables.video_generations[0].library_file_id = null
    expect((await call()).status).toBe(201)
    expect(files()).toHaveLength(1)
  })

  it('a live file with inconsistent provenance is refused rather than reused', async () => {
    seed(generationRow({ library_file_id: 'lf-1' }), { library_files: [{ id: 'lf-1', user_id: USER, project_id: OTHER_PROJECT, kind: 'video', deleted_at: null }] })
    const response = await call()
    expect(response.status).toBe(409)
    expect((await response.json()).code).toBe('PROVENANCE_CONFLICT')
  })
})

describe('storage / lifecycle', () => {
  it('COPIES the object into the Library namespace (independent of the generation row) and never deletes the source', async () => {
    await call()
    expect(vi.mocked(copyS3ObjectToLibrary).mock.calls[0][0].sourcePath).toBe(sourcePath())
    expect(vi.mocked(deleteS3Object).mock.calls.map(([path]) => path)).not.toContain(sourcePath())
    // Deleting the generation history row leaves the LibraryFile row and its own object untouched.
    db.tables.video_generations = []
    expect(files()).toHaveLength(1)
    expect(files()[0].storage_path).not.toBe(sourcePath())
  })

  it('a missing source object leaves no row and no pointer', async () => {
    vi.mocked(copyS3ObjectToLibrary).mockRejectedValueOnce(new Error('NoSuchKey'))
    const response = await call()
    expect(response.status).toBe(409)
    expect((await response.json()).code).toBe('OUTPUT_UNAVAILABLE')
    expect(files()).toHaveLength(0)
    expect(db.tables.video_generations[0].library_file_id).toBeNull()
  })

  it('unconfigured storage is reported as unavailable, without a row', async () => {
    vi.mocked(copyS3ObjectToLibrary).mockResolvedValueOnce(null)
    expect((await call()).status).toBe(503)
    expect(files()).toHaveLength(0)
  })

  it('a copied object whose size disagrees with the recorded output is removed, not registered', async () => {
    vi.mocked(copyS3ObjectToLibrary).mockResolvedValueOnce({ storagePath: `users/${USER}/library/x/v.mp4`, publicUrl: 'https://cdn/x', fileSize: SIZE + 1, mimeType: 'video/mp4' })
    const response = await call()
    expect(response.status).toBe(409)
    expect((await response.json()).code).toBe('OUTPUT_METADATA_MISMATCH')
    expect(files()).toHaveLength(0)
    expect(deleteS3Object).toHaveBeenCalledWith(`users/${USER}/library/x/v.mp4`)
  })

  it('a failed row insert compensates by deleting the copied object (no orphan object)', async () => {
    const realFrom = db.from
    vi.mocked(server.createClient).mockResolvedValue({
      auth: { getUser: async () => ({ data: { user: authedUser }, error: null }) },
      from: (table: string) => {
        if (table !== 'library_files') return realFrom(table)
        const real = realFrom(table)
        return { ...real, insert: () => ({ select: () => ({ single: async () => ({ data: null, error: { message: 'boom' } }) }) }) }
      },
    } as any)
    const response = await call()
    expect(response.status).toBe(500)
    expect(deleteS3Object).toHaveBeenCalledTimes(1)
    expect(files()).toHaveLength(0)
    expect(db.tables.video_generations[0].library_file_id).toBeNull()
  })
})

describe('promotion stays a storage-only, non-authoring, non-provider operation', () => {
  it('contacts no provider, creates no VideoDraft / VideoScene / ChannelPieceMedia and writes no usage event', async () => {
    await call()
    await call()
    expect(providerCalls).toEqual([])
    for (const table of ['video_drafts', 'video_scenes', 'channel_piece_media', 'provider_usage_events', 'render_executions']) {
      expect(db.tables[table] ?? []).toHaveLength(0)
      expect(db.log.filter((entry) => entry.endsWith(`:${table}`))).toEqual([])
    }
    // The only generation write is the promotion pointer.
    expect(db.log.filter((entry) => entry === 'update:video_generations')).toHaveLength(1)
  })

  it('the route and policy import nothing provider-, authoring- or ledger-related', () => {
    const sources = [
      'app/api/video-generations/[id]/save-to-library/route.ts',
      'lib/video-generation/library-promotion.ts',
      'components/videos/save-generation-to-library.tsx',
    ].map((path) => readFileSync(join(process.cwd(), path), 'utf8'))
    for (const source of sources) {
      const imports = source.match(/from '[^']+'/g) ?? []
      // The ONE allowed edge: the navigation-only "Abrir no editor" control (GENERATED_MEDIA_TO_CREATIVE_EDITOR_HANDOFF_V1, read-only).
      for (const specifier of imports.filter((entry) => entry !== "from '@/components/creative/handoff/open-in-editor'")) {
        expect(specifier).not.toMatch(/providers|provider-connections|transport|polling|completion|provider-usage|creative|video-drafts|video-scene/)
      }
    }
  })

  it('the server route accepts no client-supplied storage path or body', () => {
    const source = readFileSync(join(process.cwd(), 'app/api/video-generations/[id]/save-to-library/route.ts'), 'utf8')
    expect(source).not.toMatch(/request\.json\(|formData\(|searchParams/)
    expect(source).toMatch(/_request: Request/)
  })
})

describe('GET /api/video-generations — durable saved state', () => {
  const list = async () => (await (await listGenerations(new Request('http://localhost/api/video-generations') as any)).json()).generations as Array<Record<string, any>>

  it('reports the promotion pointer while its LibraryFile is live (so a reload still shows "saved")', async () => {
    await call()
    const [generation] = await list()
    expect(generation.library_file_id).toBe(files()[0].id)
  })

  it('a trashed LibraryFile reads as not saved, so the action is offered again', async () => {
    await call()
    files()[0].deleted_at = '2026-09-30T00:00:00.000Z'
    const [generation] = await list()
    expect(generation.library_file_id).toBeNull()
  })

  it('an unsaved generation has no pointer', async () => {
    const [generation] = await list()
    expect(generation.library_file_id).toBeNull()
  })
})

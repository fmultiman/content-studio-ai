import { createHash } from 'node:crypto'
import { Readable } from 'node:stream'
import { describe, expect, it, vi } from 'vitest'
import { ensureVideoArtifact, registerVideoArtifact, resolveVideoArtifactSource } from '../video'
import { MediaArtifactError } from '../errors'
import type { ObjectStreamOpener } from '../streaming'
import { makeMp4 } from './mp4-fixture'

const OWNER = '11111111-1111-4111-8111-111111111111'
const OTHER = '99999999-9999-4999-8999-999999999999'
const PROJECT = '22222222-2222-4222-8222-222222222222'
const PRODUCTION = '33333333-3333-4333-8333-333333333333'
const GEN = '44444444-4444-4444-8444-444444444444'
const EXEC = '55555555-5555-4555-8555-555555555555'
const DRAFT = '66666666-6666-4666-8666-666666666666'
const FILE = '77777777-7777-4777-8777-777777777777'
const LIB_UUID = '88888888-8888-4888-8888-888888888888'

const GEN_PATH = `${OWNER}/videos/ai/${PROJECT}/${GEN}.mp4`
const SCRATCH_PATH = `users/${OWNER}/renders/scratch/${EXEC}/output.mp4`
const LIB_PATH = `users/${OWNER}/library/${LIB_UUID}/clip.mp4`

type Row = Record<string, any>

// ── In-memory stand-in for the Supabase tables the registration touches ──────

function fakeDb(seed: Record<string, Row[]> = {}, hooks: { beforeInsert?: (table: string, tables: Record<string, Row[]>) => void } = {}) {
  const tables: Record<string, Row[]> = {}
  for (const [name, rows] of Object.entries(seed)) tables[name] = rows.map((row) => ({ ...row }))
  const inserted: Array<{ table: string; row: Row }> = []
  let serial = 0

  function conflict(table: string, row: Row) {
    if (table !== 'media_artifacts') return false
    return (tables.media_artifacts ?? []).some((other) =>
      other.user_id === row.user_id && other.media_type === row.media_type && other.storage_provider === row.storage_provider
      && other.storage_path === row.storage_path
      && (other.version === row.version || (row.content_hash && other.content_hash === row.content_hash)))
  }

  return {
    tables,
    inserted,
    from(table: string) {
      const eqs: Array<[string, unknown]> = []
      const ins: Array<[string, unknown[]]> = []
      const match = () => (tables[table] ?? []).filter((row) =>
        eqs.every(([k, v]) => row[k] === v) && ins.every(([k, values]) => values.includes(row[k])))
      const builder: any = {
        select: () => builder,
        eq: (column: string, value: unknown) => { eqs.push([column, value]); return builder },
        in: (column: string, values: unknown[]) => { ins.push([column, values]); return builder },
        maybeSingle: async () => ({ data: match()[0] ?? null, error: null }),
        then: (resolve: (value: unknown) => unknown) => resolve({ data: match(), error: null }),
        insert: (values: Row) => ({
          select: () => ({
            single: async () => {
              hooks.beforeInsert?.(table, tables)
              if (conflict(table, values)) return { data: null, error: { code: '23505' } }
              serial += 1
              const row = { id: `artifact-${serial}`, created_at: 't', updated_at: 't', ...values }
              ;(tables[table] ??= []).push(row)
              inserted.push({ table, row })
              return { data: row, error: null }
            },
          }),
        }),
        upsert: async (values: Row, options: { onConflict: string; ignoreDuplicates?: boolean }) => {
          // Mirror migration 057: provenance_key is NOT NULL and (artifact_id, provenance_key) is the only conflict target.
          if (table === 'media_artifact_provenance') {
            if (!values.provenance_key) return { error: { code: '23502' } }
            if (options.onConflict !== 'artifact_id,provenance_key') return { error: { code: '42P10' } }
            const dup = (tables[table] ?? []).some((row) => row.artifact_id === values.artifact_id && row.provenance_key === values.provenance_key)
            if (dup) return { error: null }
          }
          ;(tables[table] ??= []).push({ ...values })
          inserted.push({ table, row: values })
          return { error: null }
        },
      }
      return builder
    },
  } as any
}

// ── Streaming storage stand-in (virtual objects, lazily produced) ────────────

type VirtualObject = { size: number; slice(start: number, end: number): AsyncIterable<Buffer> }

function bufferObject(bytes: Buffer): VirtualObject {
  return {
    size: bytes.length,
    async *slice(start, end) {
      for (let at = start; at <= end && at < bytes.length; at += 65536) yield bytes.subarray(at, Math.min(at + 65536, end + 1, bytes.length))
    },
  }
}

const MEBIBYTE = Buffer.alloc(1024 * 1024)
function zeroObject(size: number): VirtualObject {
  return {
    size,
    async *slice(start, end) {
      for (let at = start; at <= end && at < size; at += MEBIBYTE.length) yield MEBIBYTE.subarray(0, Math.min(MEBIBYTE.length, end + 1 - at, size - at))
    },
  }
}

function storage(objects: Record<string, VirtualObject>) {
  const opens: Array<{ path: string; range?: { start: number; end: number } }> = []
  const maxPiece = { value: 0 }
  const open: ObjectStreamOpener = async (path, options) => {
    opens.push({ path, range: options?.range })
    const object = objects[path]
    if (!object) return null
    const start = options?.range?.start ?? 0
    const end = Math.min(options?.range?.end ?? object.size - 1, object.size - 1)
    const source = object.slice(start, end)
    const tracked: AsyncIterable<Uint8Array> = {
      async *[Symbol.asyncIterator]() {
        for await (const piece of source) { maxPiece.value = Math.max(maxPiece.value, piece.byteLength); yield piece }
      },
    }
    return { stream: Object.assign(tracked, { destroy: vi.fn() }), contentLength: end - start + 1, contentType: 'video/mp4' }
  }
  return { open: vi.fn(open) as unknown as ObjectStreamOpener & ReturnType<typeof vi.fn>, opens, maxPiece }
}

function sha(bytes: Buffer) { return createHash('sha256').update(bytes).digest('hex') }

const mp4 = makeMp4({ durationMs: 8000, width: 1280, height: 720 })

function generationRow(overrides: Row = {}): Row {
  return {
    id: GEN, user_id: OWNER, project_id: PROJECT, production_id: PRODUCTION, status: 'succeeded',
    storage_path: GEN_PATH, result_metadata: { mime: 'video/mp4', size: mp4.length }, ...overrides,
  }
}

function renderRow(overrides: Row = {}): Row {
  return {
    id: EXEC, user_id: OWNER, project_id: PROJECT, video_draft_id: DRAFT, kind: 'video', status: 'completed',
    output_bucket: process.env.RENDER_EXECUTION_SCRATCH_BUCKET || process.env.S3_BUCKET_NAME || process.env.S3_BUCKET || 'content-studio',
    output_storage_path: SCRATCH_PATH, output_mime_type: 'video/mp4', output_size_bytes: mp4.length,
    // output_duration_ms is the renderer's WALL-CLOCK time, not the media duration: deliberately != the MP4's 8000 ms.
    output_duration_ms: 10_896, output_width: 1280, output_height: 720, ...overrides,
  }
}

function libraryRow(overrides: Row = {}): Row {
  return {
    id: FILE, user_id: OWNER, project_id: PROJECT, production_id: null, kind: 'video', mime_type: 'video/mp4', file_size: mp4.length,
    storage_provider: 's3', storage_path: LIB_PATH, origin: 'upload', deleted_at: null, ...overrides,
  }
}

const seedProduction = { productions: [{ id: PRODUCTION, user_id: OWNER, project_id: PROJECT }], video_drafts: [{ id: DRAFT, user_id: OWNER, production_id: PRODUCTION }] }

describe('Video Generation artifact registration', () => {
  it('creates one sha256 artifact with factual metadata and typed provenance', async () => {
    const db = fakeDb({ video_generations: [generationRow()] })
    const s = storage({ [GEN_PATH]: bufferObject(mp4) })
    const artifact = await ensureVideoArtifact(db, { userId: OWNER, source: { kind: 'video_generation', videoGenerationId: GEN } }, { openObject: s.open })

    expect(artifact).toMatchObject({
      user_id: OWNER, project_id: PROJECT, production_id: PRODUCTION, media_type: 'video', identity_mode: 'sha256',
      storage_provider: 's3', storage_path: GEN_PATH, content_hash: sha(mp4), version: 1, mime_type: 'video/mp4',
      byte_size: mp4.length, duration_ms: 8000, width: 1280, height: 720,
    })
    expect(db.tables.media_artifacts).toHaveLength(1)
    expect(db.tables.media_artifact_provenance).toEqual([expect.objectContaining({
      artifact_id: artifact.id, user_id: OWNER, project_id: PROJECT, production_id: PRODUCTION,
      provenance_kind: 'video_generation', video_generation_id: GEN, provenance_key: `video_generation:${GEN}`,
    })])
  })

  it('keeps duration and dimensions null when the container cannot prove them (never guesses)', async () => {
    const opaque = Buffer.alloc(4096, 3)
    const db = fakeDb({ video_generations: [generationRow({ result_metadata: { mime: 'video/mp4', size: opaque.length } })] })
    const artifact = await ensureVideoArtifact(db, { userId: OWNER, source: { kind: 'video_generation', videoGenerationId: GEN } }, { openObject: storage({ [GEN_PATH]: bufferObject(opaque) }).open })
    expect(artifact).toMatchObject({ byte_size: 4096, duration_ms: null, width: null, height: null, content_hash: sha(opaque) })
  })

  it('is idempotent: a second registration reuses the artifact and reads no storage', async () => {
    const db = fakeDb({ video_generations: [generationRow()] })
    const s = storage({ [GEN_PATH]: bufferObject(mp4) })
    const source = { kind: 'video_generation', videoGenerationId: GEN } as const
    const first = await ensureVideoArtifact(db, { userId: OWNER, source }, { openObject: s.open })
    const opensAfterFirst = s.opens.length
    const second = await ensureVideoArtifact(db, { userId: OWNER, source }, { openObject: s.open })
    expect(second.id).toBe(first.id)
    expect(s.opens).toHaveLength(opensAfterFirst)
    expect(db.tables.media_artifacts).toHaveLength(1)
    expect(db.tables.media_artifact_provenance).toHaveLength(1)
  })

  it('repairs a crash between artifact insert and provenance: reuses the artifact, adds only the missing row', async () => {
    const db = fakeDb({ video_generations: [generationRow()] })
    const s = storage({ [GEN_PATH]: bufferObject(mp4) })
    const source = { kind: 'video_generation', videoGenerationId: GEN } as const
    const first = await ensureVideoArtifact(db, { userId: OWNER, source }, { openObject: s.open })
    db.tables.media_artifact_provenance.length = 0
    const again = await ensureVideoArtifact(db, { userId: OWNER, source }, { openObject: s.open })
    expect(again.id).toBe(first.id)
    expect(db.tables.media_artifacts).toHaveLength(1)
    expect(db.tables.media_artifact_provenance).toHaveLength(1)
  })

  it('converges concurrent registrations on one artifact and one provenance row', async () => {
    const db = fakeDb({ video_generations: [generationRow()] })
    const s = storage({ [GEN_PATH]: bufferObject(mp4) })
    const source = { kind: 'video_generation', videoGenerationId: GEN } as const
    const results = await Promise.all([1, 2, 3].map(() => ensureVideoArtifact(db, { userId: OWNER, source }, { openObject: s.open })))
    expect(new Set(results.map((row) => row.id)).size).toBe(1)
    expect(db.tables.media_artifacts).toHaveLength(1)
    expect(db.tables.media_artifact_provenance).toHaveLength(1)
  })

  it('recovers when another writer wins the insert race between lookup and insert', async () => {
    let raced = false
    const db = fakeDb({ video_generations: [generationRow()] }, {
      beforeInsert: (table, tables) => {
        if (table !== 'media_artifacts' || raced) return
        raced = true
        ;(tables.media_artifacts ??= []).push({
          id: 'winner', user_id: OWNER, project_id: PROJECT, production_id: PRODUCTION, media_type: 'video', identity_mode: 'sha256',
          storage_provider: 's3', storage_path: GEN_PATH, content_hash: sha(mp4), version: 1, mime_type: 'video/mp4', byte_size: mp4.length,
          width: 1280, height: 720, duration_ms: 8000,
        })
      },
    })
    const artifact = await ensureVideoArtifact(db, { userId: OWNER, source: { kind: 'video_generation', videoGenerationId: GEN } }, { openObject: storage({ [GEN_PATH]: bufferObject(mp4) }).open })
    expect(artifact.id).toBe('winner')
    expect(db.tables.media_artifacts).toHaveLength(1)
    expect(db.tables.media_artifact_provenance).toHaveLength(1)
  })

  it('creates the next immutable version when different bytes appear at the same key', async () => {
    const earlier = { id: 'v1', user_id: OWNER, project_id: PROJECT, production_id: PRODUCTION, media_type: 'video', identity_mode: 'sha256', storage_provider: 's3', storage_path: GEN_PATH, content_hash: 'b'.repeat(64), version: 1, mime_type: 'video/mp4', byte_size: 10, width: null, height: null, duration_ms: null }
    const db = fakeDb({ video_generations: [generationRow()], media_artifacts: [earlier] })
    const artifact = await ensureVideoArtifact(db, { userId: OWNER, source: { kind: 'video_generation', videoGenerationId: GEN } }, { openObject: storage({ [GEN_PATH]: bufferObject(mp4) }).open })
    expect(artifact).toMatchObject({ version: 2, content_hash: sha(mp4) })
    expect(db.tables.media_artifacts).toHaveLength(2)
    expect(db.tables.media_artifacts[0].content_hash).toBe('b'.repeat(64))
  })

  it('refuses a stored object whose length differs from the recorded size', async () => {
    const db = fakeDb({ video_generations: [generationRow({ result_metadata: { mime: 'video/mp4', size: mp4.length + 1 } })] })
    await expect(ensureVideoArtifact(db, { userId: OWNER, source: { kind: 'video_generation', videoGenerationId: GEN } }, { openObject: storage({ [GEN_PATH]: bufferObject(mp4) }).open }))
      .rejects.toMatchObject({ code: 'SIZE_MISMATCH' })
    expect(db.tables.media_artifacts ?? []).toHaveLength(0)
  })

  it('reports missing or failing storage without creating anything', async () => {
    const db = fakeDb({ video_generations: [generationRow()] })
    const source = { kind: 'video_generation', videoGenerationId: GEN } as const
    await expect(ensureVideoArtifact(db, { userId: OWNER, source }, { openObject: storage({}).open })).rejects.toMatchObject({ code: 'STORAGE_UNAVAILABLE' })
    await expect(ensureVideoArtifact(db, { userId: OWNER, source }, { openObject: async () => { throw new Error('s3 down') } })).rejects.toMatchObject({ code: 'STORAGE_UNAVAILABLE' })
    expect(db.tables.media_artifacts ?? []).toHaveLength(0)
    expect(db.tables.media_artifact_provenance ?? []).toHaveLength(0)
  })

  it('does not register a generation that has not succeeded', async () => {
    const db = fakeDb({ video_generations: [generationRow({ status: 'processing', storage_path: null })] })
    await expect(ensureVideoArtifact(db, { userId: OWNER, source: { kind: 'video_generation', videoGenerationId: GEN } }, { openObject: storage({}).open }))
      .rejects.toMatchObject({ code: 'SOURCE_NOT_READY' })
  })
})

describe('authorization and trusted storage', () => {
  it('treats another user\'s source exactly like a missing one and never touches storage', async () => {
    const db = fakeDb({ video_generations: [generationRow()], render_executions: [renderRow()], library_files: [libraryRow()] })
    const s = storage({ [GEN_PATH]: bufferObject(mp4) })
    for (const source of [
      { kind: 'video_generation', videoGenerationId: GEN },
      { kind: 'render_execution', renderExecutionId: EXEC },
      { kind: 'library', libraryFileId: FILE },
    ] as const) {
      await expect(ensureVideoArtifact(db, { userId: OTHER, source }, { openObject: s.open })).rejects.toMatchObject({ code: 'SOURCE_NOT_FOUND' })
    }
    expect(s.opens).toHaveLength(0)
    expect(db.tables.media_artifacts ?? []).toHaveLength(0)
  })

  it('rejects storage keys outside the source owner\'s own namespace before any read', async () => {
    const s = storage({})
    const cases: Array<[Row, Row | null, Row | null, Parameters<typeof ensureVideoArtifact>[1]['source']]> = [
      [generationRow({ storage_path: `${OTHER}/videos/ai/${PROJECT}/${GEN}.mp4` }), null, null, { kind: 'video_generation', videoGenerationId: GEN }],
      [generationRow({ storage_path: `${OWNER}/videos/ai/${PROJECT}/../x/${GEN}.mp4` }), null, null, { kind: 'video_generation', videoGenerationId: GEN }],
      [generationRow({ storage_path: 'https://evil.example/video.mp4' }), null, null, { kind: 'video_generation', videoGenerationId: GEN }],
      [{}, renderRow({ output_storage_path: `users/${OWNER}/renders/scratch/${OTHER}/output.mp4` }), null, { kind: 'render_execution', renderExecutionId: EXEC }],
      [{}, null, libraryRow({ storage_path: `users/${OTHER}/library/${LIB_UUID}/clip.mp4` }), { kind: 'library', libraryFileId: FILE }],
      [{}, null, libraryRow({ storage_path: 'http://169.254.169.254/latest/meta-data' }), { kind: 'library', libraryFileId: FILE }],
      [{}, null, libraryRow({ storage_provider: 'external' }), { kind: 'library', libraryFileId: FILE }],
    ]
    for (const [gen, render, library, source] of cases) {
      const db = fakeDb({
        video_generations: Object.keys(gen).length ? [gen] : [],
        render_executions: render ? [render] : [],
        library_files: library ? [library] : [],
        ...seedProduction,
      })
      await expect(ensureVideoArtifact(db, { userId: OWNER, source }, { openObject: s.open })).rejects.toMatchObject({ code: 'UNTRUSTED_STORAGE_PATH' })
    }
    expect(s.opens).toHaveLength(0)
  })

  it('normalizes errors without leaking storage keys', async () => {
    const db = fakeDb({ video_generations: [generationRow()] })
    const error = await ensureVideoArtifact(db, { userId: OWNER, source: { kind: 'video_generation', videoGenerationId: GEN } }, { openObject: async () => { throw new Error(`secret ${GEN_PATH}`) } }).catch((e) => e)
    expect(error).toBeInstanceOf(MediaArtifactError)
    expect(String(error.message)).not.toContain(GEN_PATH)
  })
})

describe('RenderExecution video artifact registration', () => {
  it('registers a completed render with the duration of the STORED BYTES, ignoring the recorded render wall-clock time', async () => {
    const db = fakeDb({ render_executions: [renderRow()], ...seedProduction })
    const s = storage({ [SCRATCH_PATH]: bufferObject(mp4) })
    const artifact = await ensureVideoArtifact(db, { userId: OWNER, source: { kind: 'render_execution', renderExecutionId: EXEC } }, { openObject: s.open })
    expect(artifact).toMatchObject({ storage_path: SCRATCH_PATH, production_id: PRODUCTION, duration_ms: 8000, width: 1280, height: 720, content_hash: sha(mp4), mime_type: 'video/mp4' })
    expect(artifact.duration_ms).not.toBe(10_896)
    // The duration came from the file itself: bounded ranged reads of the container, never a whole-object join.
    expect(s.opens.some((open) => open.range)).toBe(true)
    expect(db.tables.media_artifact_provenance[0]).toMatchObject({ provenance_kind: 'render_execution', render_execution_id: EXEC, provenance_key: `render_execution:${EXEC}` })
  })

  it('reproduces the live mismatch: recorded 10896 ms vs a 3051 ms file -> the artifact says 3051', async () => {
    const live = makeMp4({ durationMs: 3051, width: 1080, height: 1920 })
    const db = fakeDb({ render_executions: [renderRow({ output_size_bytes: live.length, output_duration_ms: 10_896, output_width: 1080, output_height: 1920 })], ...seedProduction })
    const artifact = await ensureVideoArtifact(db, { userId: OWNER, source: { kind: 'render_execution', renderExecutionId: EXEC } }, { openObject: storage({ [SCRATCH_PATH]: bufferObject(live) }).open })
    expect(artifact).toMatchObject({ duration_ms: 3051, width: 1080, height: 1920 })
  })

  it('never falls back to the recorded value when the container cannot prove a duration (fail closed: null)', async () => {
    const opaque = Buffer.alloc(4096, 3)
    const db = fakeDb({ render_executions: [renderRow({ output_size_bytes: opaque.length, output_duration_ms: 10_896 })], ...seedProduction })
    const artifact = await ensureVideoArtifact(db, { userId: OWNER, source: { kind: 'render_execution', renderExecutionId: EXEC } }, { openObject: storage({ [SCRATCH_PATH]: bufferObject(opaque) }).open })
    expect(artifact.duration_ms).toBeNull()
  })

  it('a transient storage failure while probing refuses registration instead of freezing an unknown into an immutable artifact', async () => {
    const db = fakeDb({ render_executions: [renderRow()], ...seedProduction })
    const s = storage({ [SCRATCH_PATH]: bufferObject(mp4) })
    const flaky: ObjectStreamOpener = async (path, options) => {
      if (options?.range) throw new Error(`s3 down ${path}`)
      return s.open(path, options)
    }
    const error = await ensureVideoArtifact(db, { userId: OWNER, source: { kind: 'render_execution', renderExecutionId: EXEC } }, { openObject: flaky }).catch((e) => e)
    expect(error).toMatchObject({ name: 'MediaArtifactError', code: 'STORAGE_UNAVAILABLE' })
    expect(String(error.message)).not.toContain(SCRATCH_PATH)
    expect(db.tables.media_artifacts ?? []).toHaveLength(0)
    expect(db.tables.media_artifact_provenance ?? []).toHaveLength(0)
  })

  it('takes dimensions from the container when the worker recorded none', async () => {
    const db = fakeDb({ render_executions: [renderRow({ output_width: null, output_height: null })], ...seedProduction })
    const s = storage({ [SCRATCH_PATH]: bufferObject(mp4) })
    const artifact = await ensureVideoArtifact(db, { userId: OWNER, source: { kind: 'render_execution', renderExecutionId: EXEC } }, { openObject: s.open })
    expect(artifact).toMatchObject({ duration_ms: 8000, width: 1280, height: 720 })
  })

  it('does not register queued, claimed, failed or still-image executions', async () => {
    for (const overrides of [{ status: 'claimed' }, { status: 'failed' }, { kind: 'static_still' }, { output_storage_path: null }]) {
      const db = fakeDb({ render_executions: [renderRow(overrides)], ...seedProduction })
      await expect(ensureVideoArtifact(db, { userId: OWNER, source: { kind: 'render_execution', renderExecutionId: EXEC } }, { openObject: storage({}).open }))
        .rejects.toMatchObject({ code: 'SOURCE_NOT_READY' })
    }
  })

  it('drops a Production that is not the owner\'s instead of widening scope', async () => {
    const db = fakeDb({ render_executions: [renderRow()], productions: [], video_drafts: [{ id: DRAFT, user_id: OWNER, production_id: PRODUCTION }] })
    const resolved = await resolveVideoArtifactSource(db, { userId: OWNER, source: { kind: 'render_execution', renderExecutionId: EXEC } })
    expect(resolved.scope.productionId).toBeNull()
  })
})

describe('Library video artifact registration', () => {
  it('registers an uploaded Library video with upload provenance and no storage mutation', async () => {
    const db = fakeDb({ library_files: [libraryRow()] })
    const s = storage({ [LIB_PATH]: bufferObject(mp4) })
    const artifact = await ensureVideoArtifact(db, { userId: OWNER, source: { kind: 'library', libraryFileId: FILE } }, { openObject: s.open })
    expect(artifact).toMatchObject({ storage_path: LIB_PATH, project_id: PROJECT, production_id: null, byte_size: mp4.length, duration_ms: 8000 })
    expect(db.tables.media_artifact_provenance[0]).toMatchObject({ provenance_kind: 'upload', library_file_id: FILE, provenance_key: `library:${FILE}` })
    // Reads only: the Library object is never rewritten or moved.
    expect(s.opens.every((open) => open.path === LIB_PATH)).toBe(true)
  })

  it('uses library provenance for a studio render saved to Library', async () => {
    const db = fakeDb({ library_files: [libraryRow({ origin: 'studio_render' })] })
    await ensureVideoArtifact(db, { userId: OWNER, source: { kind: 'library', libraryFileId: FILE } }, { openObject: storage({ [LIB_PATH]: bufferObject(mp4) }).open })
    expect(db.tables.media_artifact_provenance[0]).toMatchObject({ provenance_kind: 'library', provenance_key: `library:${FILE}` })
  })

  it('rejects images, trashed files and non-video MIME types', async () => {
    for (const overrides of [{ kind: 'image', mime_type: 'image/png' }, { deleted_at: '2026-10-01T00:00:00Z' }, { mime_type: 'application/octet-stream' }]) {
      const db = fakeDb({ library_files: [libraryRow(overrides)] })
      await expect(ensureVideoArtifact(db, { userId: OWNER, source: { kind: 'library', libraryFileId: FILE } }, { openObject: storage({}).open }))
        .rejects.toMatchObject({ code: 'SOURCE_NOT_READY' })
    }
  })

  it('does not resurrect an artifact for a Library key that has since moved', async () => {
    const moved = `users/${OWNER}/library/folder/${LIB_UUID}/clip.mp4`
    const stale = { id: 'stale', user_id: OWNER, project_id: PROJECT, production_id: null, media_type: 'video', identity_mode: 'sha256', storage_provider: 's3', storage_path: LIB_PATH, content_hash: sha(mp4), version: 1, mime_type: 'video/mp4', byte_size: mp4.length, width: null, height: null, duration_ms: null }
    const db = fakeDb({
      library_files: [libraryRow({ storage_path: moved })],
      media_artifacts: [stale],
      media_artifact_provenance: [{ artifact_id: 'stale', user_id: OWNER, library_file_id: FILE, provenance_key: `library:${FILE}` }],
    })
    const artifact = await ensureVideoArtifact(db, { userId: OWNER, source: { kind: 'library', libraryFileId: FILE } }, { openObject: storage({ [moved]: bufferObject(mp4) }).open })
    expect(artifact.id).not.toBe('stale')
    expect(artifact.storage_path).toBe(moved)
  })
})

describe('large object registration is bounded-memory', () => {
  it('hashes a 128 MiB object in small pieces without ever joining the object', async () => {
    const size = 128 * 1024 * 1024
    const db = fakeDb({ video_generations: [generationRow({ result_metadata: { mime: 'video/mp4', size } })] })
    const s = storage({ [GEN_PATH]: zeroObject(size) })
    const concat = vi.spyOn(Buffer, 'concat')
    const artifact = await ensureVideoArtifact(db, { userId: OWNER, source: { kind: 'video_generation', videoGenerationId: GEN } }, { openObject: s.open })

    const expected = createHash('sha256')
    for (let i = 0; i < 128; i += 1) expected.update(MEBIBYTE)
    expect(artifact).toMatchObject({ byte_size: size, content_hash: expected.digest('hex') })
    expect(s.maxPiece.value).toBeLessThanOrEqual(1024 * 1024)
    const widest = Math.max(0, ...concat.mock.results.map((result) => (result.value as Buffer).byteLength))
    expect(widest).toBeLessThan(1024 * 1024)
    concat.mockRestore()
  })
})

describe('cross-source identity: duration never depends on which source registered the bytes first', () => {
  const REAL_MS = 3051
  const real = makeMp4({ durationMs: REAL_MS, width: 1080, height: 1920 })
  const COPY_PATH = `users/${OWNER}/library/${LIB_UUID}/render-${EXEC}.mp4`

  const viaRender = (db: ReturnType<typeof fakeDb>, s: ReturnType<typeof storage>) =>
    ensureVideoArtifact(db, { userId: OWNER, source: { kind: 'render_execution', renderExecutionId: EXEC } }, { openObject: s.open })
  const viaLibrary = (db: ReturnType<typeof fakeDb>, s: ReturnType<typeof storage>) =>
    ensureVideoArtifact(db, { userId: OWNER, source: { kind: 'library', libraryFileId: FILE } }, { openObject: s.open })

  function seeded() {
    // A Library copy of the render: byte-identical, different physical key (this is what "Save to Library" produces).
    const db = fakeDb({
      render_executions: [renderRow({ output_size_bytes: real.length, output_duration_ms: 10_896, output_width: 1080, output_height: 1920 })],
      library_files: [libraryRow({ file_size: real.length, storage_path: COPY_PATH, origin: 'studio_render', project_id: PROJECT, production_id: PRODUCTION })],
      ...seedProduction,
    })
    const s = storage({ [SCRATCH_PATH]: bufferObject(real), [COPY_PATH]: bufferObject(real) })
    return { db, s }
  }

  it('A. Library -> RenderExecution: both families report the real duration', async () => {
    const { db, s } = seeded()
    const fromLibrary = await viaLibrary(db, s)
    const fromRender = await viaRender(db, s)
    expect(fromLibrary.duration_ms).toBe(REAL_MS)
    expect(fromRender.duration_ms).toBe(REAL_MS)
    expect(fromRender.content_hash).toBe(fromLibrary.content_hash)
  })

  it('B. RenderExecution -> Library: the same, in the other order', async () => {
    const { db, s } = seeded()
    const fromRender = await viaRender(db, s)
    const fromLibrary = await viaLibrary(db, s)
    expect(fromRender.duration_ms).toBe(REAL_MS)
    expect(fromLibrary.duration_ms).toBe(REAL_MS)
    expect(fromRender.content_hash).toBe(fromLibrary.content_hash)
  })

  it('a Library copy is a different physical object, so it is a different artifact under the existing identity contract (key + hash), not a duplicate', async () => {
    const { db, s } = seeded()
    const a = await viaRender(db, s)
    const b = await viaLibrary(db, s)
    expect(a.id).not.toBe(b.id)
    expect([a.storage_path, b.storage_path]).toEqual([SCRATCH_PATH, COPY_PATH])
    // Re-registering either source adds nothing: one artifact per physical object.
    await viaRender(db, s)
    await viaLibrary(db, s)
    expect(db.tables.media_artifacts).toHaveLength(2)
    expect(db.tables.media_artifact_provenance).toHaveLength(2)
  })

  it('the same key reached through two source families converges on ONE artifact whichever registers first', async () => {
    // The trusted-path rules make this impossible through the public API (a Library key and a render scratch key live in
    // different namespaces), so it is exercised at the registration boundary with two resolved sources on one key.
    const KEY = `users/${OWNER}/library/${LIB_UUID}/shared.mp4`
    const scope = { userId: OWNER, projectId: PROJECT, productionId: PRODUCTION }
    const common = { scope, storageProvider: 's3' as const, storagePath: KEY, mimeType: 'video/mp4', known: { byteSize: real.length, width: null, height: null } }
    const asLibrary = { ...common, ref: { kind: 'library' as const, libraryFileId: FILE } }
    const asRender = { ...common, ref: { kind: 'render_execution' as const, renderExecutionId: EXEC } }
    for (const order of [[asLibrary, asRender], [asRender, asLibrary]]) {
      const db = fakeDb()
      const s = storage({ [KEY]: bufferObject(real) })
      const first = await registerVideoArtifact(db, order[0], { openObject: s.open })
      const second = await registerVideoArtifact(db, order[1], { openObject: s.open })
      expect(second.id).toBe(first.id)
      expect(first.duration_ms).toBe(REAL_MS)
      expect(second.duration_ms).toBe(REAL_MS)
      expect(db.tables.media_artifacts).toHaveLength(1)
      expect(db.tables.media_artifact_provenance.map((r: Row) => r.provenance_kind).sort()).toEqual(['library', 'render_execution'])
    }
  })
})

describe('registerVideoArtifact input contract', () => {
  it('accepts only an already-resolved source, never a URL', async () => {
    // The public surface takes typed ids (ensureVideoArtifact) or a ResolvedVideoSource built server-side.
    const resolved = await resolveVideoArtifactSource(fakeDb({ video_generations: [generationRow()] }), { userId: OWNER, source: { kind: 'video_generation', videoGenerationId: GEN } })
    expect(Object.keys(resolved).sort()).toEqual(['known', 'mimeType', 'ref', 'scope', 'storagePath', 'storageProvider'])
    const db = fakeDb()
    const artifact = await registerVideoArtifact(db, resolved, { openObject: storage({ [GEN_PATH]: bufferObject(mp4) }).open })
    expect(artifact.storage_path).toBe(GEN_PATH)
  })
})

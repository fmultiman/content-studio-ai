import { describe, expect, it, vi } from 'vitest'
import { completeVideoGeneration, failVideoGeneration, isSafeResultUrl } from '@/lib/video-generation/completion'
import { createFakeDb } from './helpers/fake-db'

const NOW = new Date('2026-09-29T12:00:00.000Z')
const RESULT_URL = 'https://cdn.example.test/temp/result.mp4?sig=abc'

function seed(row: Record<string, unknown> = {}) {
  return createFakeDb({
    seed: {
      video_generations: [
        { id: 'gen-1', user_id: 'user-a', project_id: 'proj-1', status: 'processing', task_id: 'task-1', transport: 'mcp', storage_path: null, ...row },
      ],
      // Tables that must NEVER be written by completion (Generation != Composition).
      video_drafts: [],
      video_scenes: [],
      library_files: [],
      channel_piece_media: [],
    },
    unique: { library_files: [['id']] },
  }) as any
}

const stored = () => ({ storagePath: 'user-a/videos/ai/proj-1/gen-1.mp4', publicUrl: 'https://s3.example.test/gen-1.mp4', mime: 'video/mp4', size: 1234 })
const identity = { generationId: 'gen-1', taskId: 'task-1', transport: 'mcp' as const }

describe('completeVideoGeneration — the shared completion boundary', () => {
  it('copies the result to app-owned storage FIRST, then marks succeeded; the temporary provider URL is never persisted', async () => {
    const db = seed()
    const download = vi.fn(async () => stored())

    const result = await completeVideoGeneration(db, { ...identity, resultUrl: RESULT_URL, providerState: 'succeed' }, { download, now: () => NOW })

    expect(result.outcome).toBe('completed')
    expect(download).toHaveBeenCalledTimes(1)
    // Deterministic object name = the generation id (idempotent promotion).
    expect(download).toHaveBeenCalledWith(RESULT_URL, 'user-a/videos/ai/proj-1', { objectName: 'gen-1.mp4' })

    const row = db.tables.video_generations[0]
    expect(row).toMatchObject({
      status: 'succeeded',
      storage_path: 'user-a/videos/ai/proj-1/gen-1.mp4',
      public_url: 'https://s3.example.test/gen-1.mp4',
      error_details: null,
      next_poll_at: null,
      result_metadata: { mime: 'video/mp4', size: 1234, transport: 'mcp', provider_task_id: 'task-1', provider_state: 'succeed', completed_at: NOW.toISOString() },
    })
    expect(JSON.stringify(row)).not.toContain('cdn.example.test')
    expect(JSON.stringify(row)).not.toContain('sig=abc')
  })

  it('creates NOTHING else: no VideoDraft, scene, LibraryFile or ChannelPieceMedia', async () => {
    const db = seed()
    await completeVideoGeneration(db, { ...identity, resultUrl: RESULT_URL }, { download: async () => stored() })
    const writes = db.log.filter((entry: string) => /^(insert|upsert|update|delete):/.test(entry))
    // The only other write is the usage-ledger event (AI_PROVIDER_USAGE_LEDGER_AND_HISTORY_V1).
    expect(new Set(writes.map((entry: string) => entry.split(':')[1]))).toEqual(new Set(['video_generations', 'provider_usage_events']))
    for (const table of ['video_drafts', 'video_scenes', 'library_files', 'channel_piece_media']) expect(db.tables[table]).toEqual([])
    expect(db.tables.video_generations[0].library_file_id).toBeUndefined()
  })

  it('is idempotent: a duplicate completion of a terminal row downloads nothing and mutates nothing', async () => {
    const db = seed()
    const download = vi.fn(async () => stored())
    await completeVideoGeneration(db, { ...identity, resultUrl: RESULT_URL }, { download, now: () => NOW })
    const snapshot = JSON.stringify(db.tables.video_generations)
    const writesBefore = db.log.filter((entry: string) => entry.startsWith('update:')).length

    const again = await completeVideoGeneration(db, { ...identity, resultUrl: RESULT_URL }, { download, now: () => new Date(NOW.getTime() + 1000) })

    expect(again.outcome).toBe('already_terminal')
    expect(download).toHaveBeenCalledTimes(1)
    expect(JSON.stringify(db.tables.video_generations)).toBe(snapshot)
    expect(db.log.filter((entry: string) => entry.startsWith('update:')).length).toBe(writesBefore)
  })

  it('concurrent completions: exactly ONE wins the compare-and-swap; the loser changes nothing and stores the same object key', async () => {
    const db = seed()
    const keys: string[] = []
    const download = vi.fn(async (_url: string, _prefix: string, options?: { objectName?: string }) => {
      keys.push(options?.objectName ?? '')
      await new Promise((resolve) => setTimeout(resolve, 5))
      return stored()
    })

    const results = await Promise.all([
      completeVideoGeneration(db, { ...identity, resultUrl: RESULT_URL }, { download, now: () => NOW }),
      completeVideoGeneration(db, { ...identity, resultUrl: RESULT_URL }, { download, now: () => NOW }),
      completeVideoGeneration(db, { ...identity, resultUrl: RESULT_URL }, { download, now: () => NOW }),
    ])

    expect(results.filter((entry) => entry.outcome === 'completed')).toHaveLength(1)
    expect(results.filter((entry) => entry.outcome === 'already_terminal')).toHaveLength(2)
    // Every racer wrote the SAME deterministic object → one durable object, never duplicates.
    expect(new Set(keys)).toEqual(new Set(['gen-1.mp4']))
    expect(db.tables.video_generations).toHaveLength(1)
    expect(db.tables.video_generations[0].status).toBe('succeeded')
  })

  it('a failed download leaves the row NON-terminal (retryable) — success is never recorded without app-owned media', async () => {
    const db = seed()
    await expect(
      completeVideoGeneration(db, { ...identity, resultUrl: RESULT_URL }, { download: async () => { throw new Error('S3 down') } }),
    ).rejects.toThrow('S3 down')
    expect(db.tables.video_generations[0]).toMatchObject({ status: 'processing', storage_path: null })

    const retry = await completeVideoGeneration(db, { ...identity, resultUrl: RESULT_URL }, { download: async () => stored(), now: () => NOW })
    expect(retry.outcome).toBe('completed')
  })

  it.each([
    ['another task id', { taskId: 'task-OTHER' }],
    ['another transport (a REST callback cannot complete an MCP row)', { transport: 'rest' as const }],
  ])('rejects identity mismatch: %s — downloads and mutates nothing', async (_name, override) => {
    const db = seed()
    const download = vi.fn(async () => stored())
    const before = JSON.stringify(db.tables.video_generations)

    const result = await completeVideoGeneration(db, { ...identity, ...override, resultUrl: RESULT_URL }, { download })

    expect(result.outcome).toBe('identity_mismatch')
    expect(download).not.toHaveBeenCalled()
    expect(JSON.stringify(db.tables.video_generations)).toBe(before)
  })

  it('legacy rows without a transport are REST', async () => {
    const db = seed({ transport: null })
    expect((await completeVideoGeneration(db, { ...identity, transport: 'rest', resultUrl: RESULT_URL }, { download: async () => stored() })).outcome).toBe('completed')
    const db2 = seed({ transport: null })
    expect((await completeVideoGeneration(db2, { ...identity, transport: 'mcp', resultUrl: RESULT_URL }, { download: async () => stored() })).outcome).toBe('identity_mismatch')
  })

  it('unknown generation → not_found', async () => {
    const result = await completeVideoGeneration(seed(), { ...identity, generationId: 'nope', resultUrl: RESULT_URL }, { download: async () => stored() })
    expect(result.outcome).toBe('not_found')
  })

  it.each(['http://cdn.example.test/v.mp4', 'https://localhost/v.mp4', 'https://127.0.0.1/v.mp4', 'https://10.0.0.5/v.mp4', 'https://[::1]/v.mp4', 'https://user:pw@cdn.example.test/v.mp4', 'file:///etc/passwd', 'ftp://x/y', 'not a url', 'https://svc.internal/v.mp4', 'https://printer.local/v.mp4'])(
    'unsafe result URL %s is never fetched; the generation is failed with a safe code',
    async (url) => {
      const db = seed()
      const download = vi.fn(async () => stored())
      const result = await completeVideoGeneration(db, { ...identity, resultUrl: url }, { download })
      expect(result.outcome).toBe('unsafe_result_url')
      expect(download).not.toHaveBeenCalled()
      expect(db.tables.video_generations[0]).toMatchObject({ status: 'failed', error_details: { code: 'PROVIDER_RESULT_URL_UNSAFE' } })
      expect(JSON.stringify(db.tables.video_generations[0])).not.toContain(url)
    },
  )

  it('isSafeResultUrl accepts a normal https CDN URL', () => {
    expect(isSafeResultUrl('https://cdn.klingai.com/bs2/x/y.mp4?token=1')).toBe(true)
  })

  it('a store read error is retryable (throws), never silently treated as "not found"', async () => {
    const failing: any = { from: () => { const chain: any = { select: () => chain, eq: () => chain, maybeSingle: () => Promise.resolve({ data: null, error: { message: 'down' } }) }; return chain } }
    await expect(completeVideoGeneration(failing, { ...identity, resultUrl: RESULT_URL }, { download: async () => stored() })).rejects.toMatchObject({ name: 'CompletionStoreError' })
  })
})

describe('failVideoGeneration', () => {
  it('records a safe normalized failure once and stops polling', async () => {
    const db = seed({ next_poll_at: NOW.toISOString() })
    const result = await failVideoGeneration(db, { ...identity, code: 'PROVIDER_FAILED', message: 'nope' })
    expect(result.outcome).toBe('failed_recorded')
    expect(db.tables.video_generations[0]).toMatchObject({ status: 'failed', next_poll_at: null, error_details: { code: 'PROVIDER_FAILED', message: 'nope' } })
  })

  it('never overwrites a row that already succeeded (a late failure callback cannot undo a finished video)', async () => {
    const db = seed({ status: 'succeeded', storage_path: 'x.mp4' })
    const before = JSON.stringify(db.tables.video_generations)
    expect((await failVideoGeneration(db, { ...identity, code: 'PROVIDER_FAILED', message: 'late' })).outcome).toBe('already_terminal')
    expect(JSON.stringify(db.tables.video_generations)).toBe(before)
  })

  it('identity mismatch fails nothing', async () => {
    const db = seed()
    expect((await failVideoGeneration(db, { ...identity, taskId: 'x', code: 'C', message: 'm' })).outcome).toBe('identity_mismatch')
    expect(db.tables.video_generations[0].status).toBe('processing')
  })
})

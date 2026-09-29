import * as crypto from 'node:crypto'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { createFakeDb } from './helpers/fake-db'

// The callback builds its own service-role client from supabase-js; hand it the in-memory database.
let db: any
vi.mock('@supabase/supabase-js', () => ({ createClient: () => db }))
vi.mock('@/lib/storage/video-downloader', () => ({ downloadAndStoreVideo: vi.fn() }))

import { downloadAndStoreVideo } from '@/lib/storage/video-downloader'
import { POST } from '@/app/api/kling/callback/route'

const RAW_SECRET = Buffer.from('rest-webhook-secret-material').toString('base64')
const RESULT_URL = 'https://cdn.example.test/kling/result.mp4?sig=1'

function sign(body: string, overrides: { id?: string; timestamp?: string; secret?: string } = {}) {
  const id = overrides.id ?? 'msg_1'
  const timestamp = overrides.timestamp ?? String(Math.floor(Date.now() / 1000))
  const key = Buffer.from(overrides.secret ?? RAW_SECRET, 'base64')
  const signature = crypto.createHmac('sha256', key).update(`${id}.${timestamp}.${body}`).digest('base64')
  return { 'webhook-id': id, 'webhook-timestamp': timestamp, 'webhook-signature': `v1,${signature}` }
}

const send = (payload: unknown, headers?: Record<string, string>) => {
  const body = JSON.stringify(payload)
  return POST(new NextRequest('http://localhost/api/kling/callback', { method: 'POST', body, headers: headers ?? sign(body) }))
}

const succeeded = (taskId = 'task-1', extra: Record<string, unknown> = {}) => ({ id: taskId, status: 'succeeded', outputs: [{ type: 'video', url: RESULT_URL }], ...extra })

function seed(row: Record<string, unknown> = {}) {
  db = createFakeDb({
    seed: {
      video_generations: [{ id: 'gen-1', user_id: 'user-a', project_id: 'proj-1', status: 'submitted', task_id: 'task-1', transport: 'rest', ...row }],
      video_drafts: [],
      library_files: [],
      channel_piece_media: [],
    },
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  process.env.KLING_WEBHOOK_SECRET = `whsec_${RAW_SECRET}`
  vi.mocked(downloadAndStoreVideo).mockResolvedValue({ storagePath: 'user-a/videos/ai/proj-1/gen-1.mp4', publicUrl: 'https://s3.example.test/gen-1.mp4', mime: 'video/mp4', size: 42 })
  seed()
})

describe('Kling REST callback → shared completion', () => {
  it('a valid signature completes the generation through the shared boundary (app-owned storage, deterministic key)', async () => {
    const response = await send(succeeded())

    expect(response.status).toBe(200)
    expect(downloadAndStoreVideo).toHaveBeenCalledTimes(1)
    expect(downloadAndStoreVideo).toHaveBeenCalledWith(RESULT_URL, 'user-a/videos/ai/proj-1', { objectName: 'gen-1.mp4' })
    expect(db.tables.video_generations[0]).toMatchObject({
      status: 'succeeded',
      storage_path: 'user-a/videos/ai/proj-1/gen-1.mp4',
      public_url: 'https://s3.example.test/gen-1.mp4',
      result_metadata: { mime: 'video/mp4', size: 42, transport: 'rest', provider_task_id: 'task-1' },
    })
    // The temporary provider URL is not persisted.
    expect(JSON.stringify(db.tables.video_generations[0])).not.toContain('cdn.example.test')
  })

  it.each([
    ['missing headers', {}],
    ['a wrong signature', { 'webhook-id': 'm', 'webhook-timestamp': String(Math.floor(Date.now() / 1000)), 'webhook-signature': 'v1,AAAA' }],
  ])('%s: rejected BEFORE any completion work', async (_name, headers) => {
    const response = await send(succeeded(), headers as any)
    expect(response.status).toBe(400)
    expect(downloadAndStoreVideo).not.toHaveBeenCalled()
    expect(db.tables.video_generations[0].status).toBe('submitted')
  })

  it('a signature made with the WRONG secret is rejected (an MCP-side actor cannot forge completion)', async () => {
    const body = JSON.stringify(succeeded())
    const forged = sign(body, { secret: Buffer.from('some-other-secret').toString('base64') })
    expect((await POST(new NextRequest('http://localhost/api/kling/callback', { method: 'POST', body, headers: forged }))).status).toBe(400)
    expect(downloadAndStoreVideo).not.toHaveBeenCalled()
  })

  it('an expired timestamp is rejected even with a valid signature', async () => {
    const body = JSON.stringify(succeeded())
    const stale = sign(body, { timestamp: String(Math.floor(Date.now() / 1000) - 3600) })
    expect((await POST(new NextRequest('http://localhost/api/kling/callback', { method: 'POST', body, headers: stale }))).status).toBe(400)
    expect(downloadAndStoreVideo).not.toHaveBeenCalled()
  })

  it('fails closed (500) when the webhook secret is not configured, completing nothing', async () => {
    delete process.env.KLING_WEBHOOK_SECRET
    expect((await send(succeeded())).status).toBe(500)
    expect(downloadAndStoreVideo).not.toHaveBeenCalled()
  })

  it('at-least-once delivery: a duplicate callback downloads once and leaves the terminal row untouched', async () => {
    await send(succeeded())
    const snapshot = JSON.stringify(db.tables.video_generations)

    const second = await send(succeeded())

    expect(second.status).toBe(200)
    expect((await second.json()).warning).toBe('Already resolved')
    expect(downloadAndStoreVideo).toHaveBeenCalledTimes(1)
    expect(JSON.stringify(db.tables.video_generations)).toBe(snapshot)
  })

  it('two callbacks racing: one durable copy, one terminal transition', async () => {
    const results = await Promise.all([send(succeeded()), send(succeeded())])
    expect(results.every((response) => response.status === 200)).toBe(true)
    expect(db.tables.video_generations).toHaveLength(1)
    expect(db.tables.video_generations[0].status).toBe('succeeded')
    const objectNames = vi.mocked(downloadAndStoreVideo).mock.calls.map((call) => (call[2] as any).objectName)
    expect(new Set(objectNames)).toEqual(new Set(['gen-1.mp4']))
  })

  it('a failed callback records the failure once; a later "succeeded" callback cannot resurrect it', async () => {
    await send({ id: 'task-1', status: 'failed', message: 'content blocked' })
    expect(db.tables.video_generations[0]).toMatchObject({ status: 'failed', error_details: { code: 'PROVIDER_FAILED', message: 'content blocked' } })

    await send(succeeded())
    expect(db.tables.video_generations[0].status).toBe('failed')
    expect(downloadAndStoreVideo).not.toHaveBeenCalled()
  })

  it('a succeeded callback without a video URL fails the generation with a normalized code', async () => {
    await send({ id: 'task-1', status: 'succeeded', outputs: [] })
    expect(db.tables.video_generations[0]).toMatchObject({ status: 'failed', error_details: { code: 'PROVIDER_RESULT_MISSING' } })
    expect(downloadAndStoreVideo).not.toHaveBeenCalled()
  })

  it('an unknown task id is acknowledged and ignored', async () => {
    const response = await send(succeeded('no-such-task'))
    expect(response.status).toBe(200)
    expect(downloadAndStoreVideo).not.toHaveBeenCalled()
    expect(db.tables.video_generations[0].status).toBe('submitted')
  })

  it('a validly signed callback naming an MCP generation’s id is IGNORED: MCP has no callbacks and is not completed by the REST webhook secret', async () => {
    seed({ transport: 'mcp', task_id: 'mcp-task', connection_id: 'conn-1' })
    const response = await send(succeeded('mcp-task'))
    expect(response.status).toBe(200)
    expect((await response.json()).warning).toMatch(/not a REST generation/)
    expect(downloadAndStoreVideo).not.toHaveBeenCalled()
    expect(db.tables.video_generations[0].status).toBe('submitted')
  })

  it('legacy rows (no transport) complete through the REST callback exactly as before', async () => {
    seed({ transport: undefined })
    delete db.tables.video_generations[0].transport
    expect((await send(succeeded())).status).toBe(200)
    expect(db.tables.video_generations[0].status).toBe('succeeded')
  })

  it('creates no VideoDraft, LibraryFile or ChannelPieceMedia', async () => {
    await send(succeeded())
    for (const table of ['video_drafts', 'library_files', 'channel_piece_media']) expect(db.tables[table]).toEqual([])
    const written = new Set(db.log.filter((entry: string) => /^(insert|upsert|update|delete):/.test(entry)).map((entry: string) => entry.split(':')[1]))
    // The only other write is the usage-ledger event (AI_PROVIDER_USAGE_LEDGER_AND_HISTORY_V1).
    expect(written).toEqual(new Set(['video_generations', 'provider_usage_events']))
  })

  it('duplicate callbacks for one generation leave exactly ONE usage event, with unknown usage (the webhook reports no cost)', async () => {
    seed({ user_id: 'user-a', project_id: 'proj-1' })
    await send(succeeded())
    await send(succeeded())
    const ledger = db.tables.provider_usage_events ?? []
    expect(ledger).toHaveLength(1)
    expect(ledger[0]).toMatchObject({ transport: 'rest', quantity: null, unit: null, measurement_source: 'unknown', resource_id: 'gen-1' })
  })

  it('a storage failure surfaces as 500 so Kling retries the callback; the row stays non-terminal', async () => {
    vi.mocked(downloadAndStoreVideo).mockRejectedValueOnce(new Error('S3 unavailable'))
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    expect((await send(succeeded())).status).toBe(500)
    expect(db.tables.video_generations[0].status).toBe('submitted')
    consoleError.mockRestore()

    expect((await send(succeeded())).status).toBe(200)
    expect(db.tables.video_generations[0].status).toBe('succeeded')
  })
})

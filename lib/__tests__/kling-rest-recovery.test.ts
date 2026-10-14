import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import * as crypto from 'crypto'
import { pollDueMcpGenerations } from '@/lib/video-generation/polling'
import { readKlingBilling } from '@/lib/video-generation/kling-billing'
import { KlingRestTransport } from '@/lib/video-generation/transport'
import { completeVideoGeneration } from '@/lib/video-generation/completion'
import { createFakeDb } from './helpers/fake-db'

// KLING_REST_RECOVERY_V1 - the signed webhook stays the primary completion path; the existing poller recovers a Kling REST
// generation whose callback never arrived. Everything is mocked: the Kling API is a stubbed global fetch (GET /tasks only).

vi.mock('@/lib/supabase/service-role', () => ({ createServiceRoleSupabase: vi.fn() }))
vi.mock('@/lib/storage/video-downloader', () => ({ downloadAndStoreVideo: vi.fn() }))
import * as serviceRole from '@/lib/supabase/service-role'
import { downloadAndStoreVideo } from '@/lib/storage/video-downloader'

const NOW = new Date('2026-10-14T12:00:00.000Z')
const iso = (offsetMs: number) => new Date(NOW.getTime() + offsetMs).toISOString()
const KEY = 'kling-owner-key-FIXTURE'
const TASK = '933999000000000001'
const GEN = '50000000-0000-4000-8000-000000000001'
const RESULT = 'https://cdn.example.test/kling/result.mp4?sig=abc'
const stored = { storagePath: `user-a/videos/ai/proj-1/${GEN}.mp4`, publicUrl: 'https://s3.example.test/x.mp4', mime: 'video/mp4', size: 123 }

const restRow = (overrides: Record<string, unknown> = {}) => ({
  id: GEN, user_id: 'user-a', project_id: 'proj-1', production_id: 'prod-1', mode: 'image_to_video', provider: 'kling', transport: 'rest', model: 'kling-v3',
  status: 'submitted', task_id: TASK, created_at: iso(-60_000), next_poll_at: iso(-1_000), poll_attempts: 0,
  request_config: { duration: 5, resolution: '720p', audio: 'off', multi_shot: false, output_count: 1, first_frame: { type: 'library', id: 'a' }, last_frame: { type: 'library', id: 'b' } },
  ...overrides,
})
const dbWith = (rows: Array<Record<string, unknown>>, withKey = true) =>
  createFakeDb({ seed: { video_generations: rows, user_settings: withKey ? [{ user_id: 'user-a', kling_api_key: KEY }] : [], provider_usage_events: [] } }) as any

let apiCalls: Array<{ url: string; method: string; auth: string | undefined }> = []
let apiReply: () => unknown = () => ({ data: [{ id: TASK, status: 'processing', created_at: 1, updated_at: 1 }] })
beforeEach(() => {
  apiCalls = []
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: any) => {
    apiCalls.push({ url: String(url), method: init?.method ?? 'GET', auth: init?.headers?.Authorization })
    return { ok: true, status: 200, json: async () => apiReply() }
  }))
})
afterEach(() => vi.unstubAllGlobals())

const succeededItem = (billing?: unknown) => ({ data: [{ id: TASK, status: 'succeeded', outputs: [{ type: 'video', url: RESULT }], ...(billing === undefined ? {} : { billing }), created_at: 1, updated_at: 2 }] })

describe('what Kling states about the cost is read defensively', () => {
  it('a valid `unit` charge becomes provider-reported units (never money); the stated facts are kept', () => {
    expect(readKlingBilling({ amount: 3, charge_type: 'unit', package_type: 'video' })).toEqual({
      usage: { quantity: 3, unit: 'units', source: 'provider_reported' },
      facts: { amount: 3, charge_type: 'unit', package_type: 'video' },
    })
  })

  it('anything else is UNKNOWN usage - never 0, never converted: cash, missing/negative/non-numeric amounts, junk, absent billing', () => {
    expect(readKlingBilling({ amount: 0.42, charge_type: 'cash' })).toEqual({ usage: null, facts: { amount: 0.42, charge_type: 'cash' } })
    for (const bad of [{ charge_type: 'unit' }, { amount: -1, charge_type: 'unit' }, { amount: '3', charge_type: 'unit' }, { amount: Number.NaN, charge_type: 'unit' }]) {
      expect(readKlingBilling(bad).usage).toBeNull()
    }
    for (const junk of [undefined, null, 'unit', 3, [], {}, { amount: 1e9, charge_type: 'a b' }]) expect(readKlingBilling(junk)).toEqual({ usage: null, facts: null })
  })
})

describe('the REST transport reads the official task states', () => {
  const transport = () => new KlingRestTransport(KEY)
  it('submitted / processing are in flight; failed carries Kling’s message; succeeded carries the video URL', async () => {
    apiReply = () => ({ data: [{ id: TASK, status: 'submitted', created_at: 1, updated_at: 1 }] })
    expect(await transport().getStatus(TASK)).toMatchObject({ state: 'processing', rawState: 'submitted' })
    apiReply = () => ({ data: [{ id: TASK, status: 'processing', created_at: 1, updated_at: 1 }] })
    expect(await transport().getStatus(TASK)).toMatchObject({ state: 'processing', rawState: 'processing' })
    apiReply = () => ({ data: [{ id: TASK, status: 'failed', message: 'content rejected', created_at: 1, updated_at: 1 }] })
    expect(await transport().getStatus(TASK)).toMatchObject({ state: 'failed', message: 'content rejected' })
    apiReply = () => succeededItem({ amount: 3, charge_type: 'unit', package_type: 'video' })
    expect(await transport().getStatus(TASK)).toEqual({
      state: 'succeeded', resultUrl: RESULT, rawState: 'succeeded',
      usage: { quantity: 3, unit: 'units', source: 'provider_reported' }, providerBilling: { amount: 3, charge_type: 'unit', package_type: 'video' },
    })
    // Only GETs on /tasks: reading a task can never create (or bill) a generation.
    expect(apiCalls.every((call) => call.method === 'GET' && call.url.startsWith('https://api-singapore.klingai.com/tasks?task_ids='))).toBe(true)
  })

  it('a succeeded task without billing keeps usage unknown (nothing invented)', async () => {
    apiReply = () => succeededItem()
    const status = await transport().getStatus(TASK)
    expect(status).toMatchObject({ state: 'succeeded' })
    expect('usage' in status).toBe(false)
    expect('providerBilling' in status).toBe(false)
  })
})

describe('the poller recovers a Kling REST generation whose webhook never arrived', () => {
  it('reads the task with the OWNER’s key, completes the SAME attempt, copies the video to private storage and records provider units', async () => {
    const db = dbWith([restRow()])
    apiReply = () => succeededItem({ amount: 3, charge_type: 'unit', package_type: 'video' })
    const download = vi.fn(async () => stored)

    const summary = await pollDueMcpGenerations(db, { now: () => NOW, download: download as any })

    expect(summary.outcomes).toMatchObject({ completed: 1 })
    expect(apiCalls).toEqual([{ url: `https://api-singapore.klingai.com/tasks?task_ids=${TASK}`, method: 'GET', auth: `Bearer ${KEY}` }])
    expect(download).toHaveBeenCalledTimes(1)
    expect(download).toHaveBeenCalledWith(RESULT, 'user-a/videos/ai/proj-1', { objectName: `${GEN}.mp4` })
    expect(db.tables.video_generations).toHaveLength(1)
    const row = db.tables.video_generations[0]
    expect(row).toMatchObject({ id: GEN, status: 'succeeded', storage_path: stored.storagePath, next_poll_at: null, result_metadata: { provider_billing: { amount: 3, charge_type: 'unit', package_type: 'video' } } })
    // The temporary Kling URL and the key are never persisted.
    expect(JSON.stringify(row)).not.toContain('cdn.example.test')
    expect(JSON.stringify(row)).not.toContain(KEY)
    expect(db.tables.provider_usage_events).toHaveLength(1)
    expect(db.tables.provider_usage_events[0]).toMatchObject({ provider: 'kling', transport: 'rest', operation: 'image_to_video', model: 'kling-v3', quantity: 3, unit: 'units', measurement_source: 'provider_reported', resource_id: GEN, provider_task_id: TASK })
    expect(db.tables.provider_usage_events[0].provider_metadata).toMatchObject({ provider_billing: { amount: 3, charge_type: 'unit', package_type: 'video' } })
    expect(JSON.stringify(db.tables.provider_usage_events)).not.toContain(KEY)
  })

  it('submitted and processing keep the row in flight and rescheduled; no paid call exists in the flow', async () => {
    const db = dbWith([restRow()])
    for (const status of ['submitted', 'processing']) {
      apiReply = () => ({ data: [{ id: TASK, status, created_at: 1, updated_at: 1 }] })
      db.tables.video_generations[0].next_poll_at = iso(-1000)
      await pollDueMcpGenerations(db, { now: () => NOW, download: vi.fn() as any })
    }
    expect(db.tables.video_generations[0]).toMatchObject({ status: 'processing', poll_attempts: 2 })
    expect(apiCalls.every((call) => call.method === 'GET')).toBe(true)
    expect(apiCalls.some((call) => /image-to-video|text-to-video|image2video|text2video/.test(call.url))).toBe(false)
  })

  it('a failed task fails the same attempt with Kling’s message and records no usage', async () => {
    const db = dbWith([restRow()])
    apiReply = () => ({ data: [{ id: TASK, status: 'failed', message: 'generation failed upstream', created_at: 1, updated_at: 1 }] })
    const summary = await pollDueMcpGenerations(db, { now: () => NOW, download: vi.fn() as any })
    expect(summary.outcomes).toMatchObject({ failed: 1 })
    expect(db.tables.video_generations[0]).toMatchObject({ status: 'failed', error_details: { code: 'PROVIDER_FAILED', message: 'generation failed upstream' } })
    expect(db.tables.provider_usage_events).toHaveLength(0)
  })

  it('a succeeded task with NO billing is recorded with unknown usage (the event exists, the quantity does not)', async () => {
    const db = dbWith([restRow()])
    apiReply = () => succeededItem()
    await pollDueMcpGenerations(db, { now: () => NOW, download: (async () => stored) as any })
    expect(db.tables.provider_usage_events).toHaveLength(1)
    expect(db.tables.provider_usage_events[0]).toMatchObject({ measurement_source: 'unknown', quantity: null })
    expect(db.tables.video_generations[0].result_metadata).not.toHaveProperty('provider_billing')
  })

  it('a non-`unit` charge is shown as stated but never turned into a quantity', async () => {
    const db = dbWith([restRow()])
    apiReply = () => succeededItem({ amount: 0.42, charge_type: 'cash' })
    await pollDueMcpGenerations(db, { now: () => NOW, download: (async () => stored) as any })
    expect(db.tables.provider_usage_events[0]).toMatchObject({ measurement_source: 'unknown', quantity: null })
    expect(db.tables.video_generations[0].result_metadata.provider_billing).toEqual({ amount: 0.42, charge_type: 'cash' })
  })

  it('webhook AFTER the poll (and poll AFTER the webhook) never finalizes or records usage twice', async () => {
    const db = dbWith([restRow()])
    apiReply = () => succeededItem({ amount: 3, charge_type: 'unit', package_type: 'video' })
    const download = vi.fn(async () => stored)
    await pollDueMcpGenerations(db, { now: () => NOW, download: download as any })

    // The webhook's completion for the same task arrives late: the shared boundary reports it terminal and downloads nothing.
    const late = await completeVideoGeneration(db, { generationId: GEN, taskId: TASK, transport: 'rest', resultUrl: RESULT, providerState: 'succeeded', usage: { quantity: 3, unit: 'units', source: 'provider_reported' } }, { download: download as any })
    expect(late.outcome).toBe('already_terminal')
    expect(download).toHaveBeenCalledTimes(1)
    expect(db.tables.provider_usage_events).toHaveLength(1)

    // And a later poll finds nothing to do for a terminal row.
    db.tables.video_generations[0].next_poll_at = iso(-1000)
    const again = await pollDueMcpGenerations(db, { now: () => NOW, download: download as any })
    expect(again.due).toBe(0)
    expect(download).toHaveBeenCalledTimes(1)
  })

  it('the signed webhook still completes it first and records the stated units; the poller then has nothing to do', async () => {
    const db = dbWith([restRow()])
    vi.mocked(serviceRole.createServiceRoleSupabase).mockReturnValue(db)
    vi.mocked(downloadAndStoreVideo).mockResolvedValue(stored)
    const secretB64 = 'bXlzZWNyZXRiYXNlNjRzdHJpbmc='
    process.env.KLING_WEBHOOK_SECRET = `whsec_${secretB64}`
    const body = JSON.stringify({ data: { id: TASK, status: 'succeeded', outputs: [{ type: 'video', url: RESULT }], billing: { amount: 3, charge_type: 'unit', package_type: 'video' } } })
    const ts = Math.floor(Date.now() / 1000).toString()
    const sig = crypto.createHmac('sha256', Buffer.from(secretB64, 'base64')).update(`msg_1.${ts}.${body}`).digest('base64')
    const { POST } = await import('@/app/api/kling/callback/route')

    const response = await POST(new NextRequest('http://localhost/api/kling/callback', { method: 'POST', body, headers: { 'webhook-id': 'msg_1', 'webhook-timestamp': ts, 'webhook-signature': `v1,${sig}` } }))

    expect(response.status).toBe(200)
    expect(db.tables.video_generations[0]).toMatchObject({ status: 'succeeded', next_poll_at: null, result_metadata: { provider_billing: { amount: 3, charge_type: 'unit', package_type: 'video' } } })
    expect(db.tables.provider_usage_events).toHaveLength(1)
    expect(db.tables.provider_usage_events[0]).toMatchObject({ quantity: 3, unit: 'units', measurement_source: 'provider_reported' })

    // The recovery poller finds nothing due for the finished attempt: no Kling call, no second copy, no second usage event.
    const summary = await pollDueMcpGenerations(db, { now: () => NOW, download: vi.fn() as any })
    expect(summary.due).toBe(0)
    expect(apiCalls).toEqual([])
    expect(vi.mocked(downloadAndStoreVideo)).toHaveBeenCalledTimes(1)
    expect(db.tables.provider_usage_events).toHaveLength(1)
    delete process.env.KLING_WEBHOOK_SECRET
  })

  it('without the owner’s Kling key the job is ended explicitly (nothing to read it with) and Kling is never contacted', async () => {
    const db = dbWith([restRow()], false)
    const summary = await pollDueMcpGenerations(db, { now: () => NOW, download: vi.fn() as any })
    expect(summary.outcomes).toMatchObject({ connection_unavailable: 1 })
    expect(db.tables.video_generations[0]).toMatchObject({ status: 'failed', error_details: { code: 'CONNECTION_UNAVAILABLE' } })
    expect(db.tables.video_generations[0].error_details.message).toMatch(/chave da API Kling/)
    expect(apiCalls).toEqual([])
  })

  it('a Kling outage is not a verdict: the row stays in flight and is retried later', async () => {
    const db = dbWith([restRow()])
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 503, statusText: 'Service Unavailable', json: async () => ({}) })))
    const summary = await pollDueMcpGenerations(db, { now: () => NOW, download: vi.fn() as any })
    expect(summary.outcomes).toMatchObject({ transient_error: 1 })
    expect(db.tables.video_generations[0].status).not.toBe('failed')
  })
})

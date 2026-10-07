// Shared harness for Video Review tests: virtual storage, a mocked Gemini HTTP surface, seeded source rows.
// Test-only; no network. The importing test file mocks credentials and the default S3 readers.
import { createHash } from 'node:crypto'
import { vi } from 'vitest'
import { createVideoReviewExecution } from '../video-service'
import { createGeminiClient } from '@/lib/providers/gemini/client'
import { createGeminiReviewProvider } from '@/lib/providers/gemini/review-provider'
import type { ObjectStreamOpener } from '@/lib/media-artifacts/streaming'
import { makeMp4 } from '@/lib/media-artifacts/__tests__/mp4-fixture'
import { createReviewTestDb, type FakeDbOptions, type Row } from './review-test-db'

export const OWNER = '11111111-1111-4111-8111-111111111111'
export const OTHER = '99999999-9999-4999-8999-999999999999'
export const PROJECT = '22222222-2222-4222-8222-222222222222'
export const PRODUCTION = '33333333-3333-4333-8333-333333333333'
export const GEN = '44444444-4444-4444-8444-444444444444'
export const EXEC = '55555555-5555-4555-8555-555555555555'
export const DRAFT = '66666666-6666-4666-8666-666666666666'
export const FILE = '77777777-7777-4777-8777-777777777777'
export const LIB_UUID = '88888888-8888-4888-8888-888888888888'
export const REQ = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`

export const API_KEY = 'AIza-test-secret-key'
export const HOST = 'https://generativelanguage.googleapis.com'
export const UPLOAD_URL = `${HOST}/upload/v1beta/files/session-1`
export const MIB = 1024 * 1024

export const GEN_PATH = `${OWNER}/videos/ai/${PROJECT}/${GEN}.mp4`
export const SCRATCH_PATH = `users/${OWNER}/renders/scratch/${EXEC}/output.mp4`
export const LIB_PATH = `users/${OWNER}/library/${LIB_UUID}/clip.mp4`

export const genMp4 = makeMp4({ durationMs: 8000, width: 1280, height: 720 })
export const libMp4 = makeMp4({ durationMs: 5000, width: 720, height: 1280, payloadBytes: 512 })
export const sha = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex')

// ── storage ────────────────────────────────────────────────────────────────

type VirtualObject = { size: number; slice(start: number, end: number): AsyncIterable<Uint8Array> }
export const bufferObject = (bytes: Buffer): VirtualObject => ({
  size: bytes.length,
  async *slice(start, end) { for (let at = start; at <= end && at < bytes.length; at += 65536) yield bytes.subarray(at, Math.min(at + 65536, end + 1, bytes.length)) },
})
export const ZEROS = Buffer.alloc(MIB)
export const zeroObject = (size: number): VirtualObject => ({
  size,
  async *slice(start, end) { for (let at = start; at <= end && at < size; at += MIB) yield ZEROS.subarray(0, Math.min(MIB, end + 1 - at, size - at)) },
})

export function storage(objects: Record<string, VirtualObject>, behavior: { failStreamOpensAfter?: number } = {}) {
  const opens: Array<{ path: string; ranged: boolean }> = []
  let streamOpens = 0
  const destroyed = { count: 0 }
  const open: ObjectStreamOpener = async (path, options) => {
    opens.push({ path, ranged: Boolean(options?.range) })
    if (!options?.range) {
      streamOpens += 1
      if (behavior.failStreamOpensAfter !== undefined && streamOpens > behavior.failStreamOpensAfter) throw new Error(`s3 down ${path}`)
    }
    const object = objects[path]
    if (!object) return null
    const start = options?.range?.start ?? 0
    const end = Math.min(options?.range?.end ?? object.size - 1, object.size - 1)
    return {
      stream: Object.assign(object.slice(start, end), { destroy: () => { destroyed.count += 1 } }),
      contentLength: end - start + 1,
      contentType: 'video/mp4',
    }
  }
  return { open, opens, objects, destroyed, fullStreamOpens: () => opens.filter((o) => !o.ranged).length }
}

// ── Gemini (mocked HTTP) ───────────────────────────────────────────────────

export function geminiHarness(options: { states?: Array<'PROCESSING' | 'ACTIVE' | 'FAILED'>; deleteStatus?: number; startStatus?: number; modelResponse?: () => Response; modelText?: string } = {}) {
  const calls: Array<{ method: string; url: string; headers: Record<string, string>; bodyBytes: number }> = []
  const uploaded = createHash('sha256')
  let uploadedBytes = 0
  const states = [...(options.states ?? ['ACTIVE'])]
  const fileJson = (state: string) => ({ name: 'files/abc', uri: `${HOST}/v1beta/files/abc`, mimeType: 'video/mp4', state, expirationTime: '2026-10-09T00:00:00Z' })
  const defaultText = JSON.stringify({
    score: 82, feedback: 'Smooth and coherent.', improvements: ['Tighten the ending'], refinedPrompt: 'A calm sunrise, slower pan',
    summary: 'Solid clip.', strengths: ['Consistent lighting'], issues: ['Slight flicker at 3s'], recommendations: ['Trim the last second'],
    criteria: [{ key: 'visual_consistency', label: 'Consistência visual', score: 85, assessment: 'strong', evidence: ['Lighting stable'], applicable: true }],
  })
  const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const u = String(url)
    const method = init?.method ?? 'GET'
    const headers = (init?.headers ?? {}) as Record<string, string>
    const body = init?.body
    const bodyBytes = body && typeof body !== 'string' ? (body as Uint8Array).byteLength : 0
    calls.push({ method, url: u, headers, bodyBytes })
    if (u.endsWith('/upload/v1beta/files')) {
      return options.startStatus && options.startStatus !== 200
        ? new Response(JSON.stringify({ error: { message: 'boom' } }), { status: options.startStatus })
        : new Response('{}', { status: 200, headers: { 'x-goog-upload-url': UPLOAD_URL } })
    }
    if (u === UPLOAD_URL) {
      uploaded.update(body as Uint8Array)
      uploadedBytes += bodyBytes
      return headers['X-Goog-Upload-Command'] === 'upload, finalize'
        ? new Response(JSON.stringify({ file: fileJson('PROCESSING') }), { status: 200 })
        : new Response('{}', { status: 200, headers: { 'x-goog-upload-status': 'active' } })
    }
    if (u.endsWith('/v1beta/files/abc') && method === 'GET') return new Response(JSON.stringify(fileJson(states.shift() ?? 'ACTIVE')), { status: 200 })
    if (u.endsWith('/v1beta/files/abc') && method === 'DELETE') return new Response('{}', { status: options.deleteStatus ?? 200 })
    if (u.includes(':generateContent')) {
      return options.modelResponse?.() ?? new Response(JSON.stringify({
        responseId: 'resp-1', candidates: [{ finishReason: 'STOP', content: { parts: [{ text: options.modelText ?? defaultText }] } }],
      }), { status: 200 })
    }
    return new Response('{}', { status: 500 })
  }) as unknown as typeof fetch
  let clock = 0
  const client = createGeminiClient({ fetchImpl, sleep: async (ms) => { clock += ms }, now: () => clock })
  return {
    calls, fetchImpl,
    provider: createGeminiReviewProvider({ client }),
    uploadedHash: () => uploaded.digest('hex'),
    uploadedBytes: () => uploadedBytes,
    chunkCalls: () => calls.filter((c) => c.url === UPLOAD_URL),
    modelCalls: () => calls.filter((c) => c.url.includes(':generateContent')),
    deleteCalls: () => calls.filter((c) => c.method === 'DELETE'),
    finalizeCalls: () => calls.filter((c) => c.headers['X-Goog-Upload-Command'] === 'upload, finalize'),
  }
}

// ── seed ───────────────────────────────────────────────────────────────────

export function seed(overrides: { generation?: Row; render?: Row; library?: Row } = {}): Record<string, Row[]> {
  return {
    projects: [{ id: PROJECT, user_id: OWNER, context: 'Brand X launch', evaluation_mode: 'default', identity: null }],
    productions: [{ id: PRODUCTION, user_id: OWNER, project_id: PROJECT, title: 'Spring', intention: 'Promote', type: 'video' }],
    video_drafts: [{ id: DRAFT, user_id: OWNER, production_id: PRODUCTION }],
    video_generations: [{
      id: GEN, user_id: OWNER, project_id: PROJECT, production_id: PRODUCTION, status: 'succeeded', storage_path: GEN_PATH,
      result_metadata: { mime: 'video/mp4', size: genMp4.length }, prompt: 'A calm sunrise over the sea', mode: 'text_to_video', provider: 'kling', model: 'kling-v2',
      ...overrides.generation,
    }],
    render_executions: [{
      id: EXEC, user_id: OWNER, project_id: PROJECT, video_draft_id: DRAFT, kind: 'video', status: 'completed',
      output_bucket: process.env.RENDER_EXECUTION_SCRATCH_BUCKET || process.env.S3_BUCKET_NAME || process.env.S3_BUCKET || 'content-studio',
      output_storage_path: SCRATCH_PATH, output_mime_type: 'video/mp4', output_size_bytes: genMp4.length,
      output_duration_ms: 8000, output_width: 1280, output_height: 720, ...overrides.render,
    }],
    library_files: [{
      id: FILE, user_id: OWNER, project_id: null, production_id: null, kind: 'video', mime_type: 'video/mp4', file_size: libMp4.length,
      storage_provider: 's3', storage_path: LIB_PATH, origin: 'upload', deleted_at: null, ...overrides.library,
    }],
  }
}

export const GEN_SOURCE = { kind: 'video_generation', id: GEN } as const
export const RENDER_SOURCE = { kind: 'render_execution', id: EXEC } as const
export const LIB_SOURCE = { kind: 'library_file', id: FILE } as const

export function setup(options: { seedOverrides?: Parameters<typeof seed>[0]; db?: FakeDbOptions; objects?: Record<string, VirtualObject>; storage?: Parameters<typeof storage>[1]; gemini?: Parameters<typeof geminiHarness>[0] } = {}) {
  const db = createReviewTestDb(seed(options.seedOverrides), options.db)
  const store = storage(options.objects ?? { [GEN_PATH]: bufferObject(genMp4), [SCRATCH_PATH]: bufferObject(genMp4), [LIB_PATH]: bufferObject(libMp4) }, options.storage)
  const gemini = geminiHarness(options.gemini)
  const run = (source: { kind: 'video_generation' | 'render_execution' | 'library_file'; id: string }, n = 1, userId = OWNER) =>
    createVideoReviewExecution({ userId, source, clientRequestId: REQ(n), db, providers: { gemini: gemini.provider }, openObject: store.open })
  return { db, store, gemini, run }
}


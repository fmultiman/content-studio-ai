// VIDEO_GENERATION_CONNECTION_CAPABILITY_ROUTING_V1
//
// Pure interpretation of Kling MCP generation responses. No I/O, no logging.
//
// EVIDENCE STATUS — read this before trusting it. The discovery task could not
// observe a real generation, so the exact response shapes of `text_to_video` /
// `image_to_video` (where the generation id sits) and `query_tasks` (the raw
// state vocabulary, where `works[].url` sits) are UNVERIFIED. These parsers are
// deliberately TOLERANT and CONSERVATIVE:
//   - an unrecognised state is treated as "still processing" (never terminal),
//   - success requires a result URL,
//   - the raw state string is surfaced (safe, short) so the first real proof
//     records the true vocabulary and this file is then tightened.
// The first controlled paid proof (KLING_MCP_REAL_GENERATION_PROOF_V1) must
// capture the real payloads and update the contract tests with them.

export type KlingMcpTaskState = 'processing' | 'succeeded' | 'failed'

export interface KlingMcpTaskReading {
  state: KlingMcpTaskState
  /** The provider's own state string, trimmed and bounded — for evidence, never for logic outside this file. */
  rawState: string | null
  resultUrl: string | null
  /** Safe, bounded provider message for failed tasks. */
  message: string | null
}

const SUCCESS_STATES = new Set(['succeed', 'succeeded', 'success', 'successful', 'completed', 'complete', 'done', 'finished'])
const FAILURE_STATES = new Set(['fail', 'failed', 'failure', 'error', 'errored', 'timeout', 'timed_out', 'cancelled', 'canceled', 'rejected'])

const MAX_TEXT = 300

function bounded(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed ? trimmed.slice(0, MAX_TEXT) : null
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null
}

/** Finds the generation id in a submit response. Returns null when nothing usable is present. */
export function parseGenerationId(payload: unknown): string | null {
  const record = asRecord(payload)
  if (!record) return null

  const direct = [record.generationId, record.generation_id, record.id, record.taskId, record.task_id]
  for (const candidate of direct) {
    if ((typeof candidate === 'string' && candidate.trim()) || typeof candidate === 'number') return String(candidate).trim()
  }

  for (const key of ['data', 'result', 'generation']) {
    const nested = parseGenerationId(record[key])
    if (nested) return nested
  }

  const list = record.generations ?? record.generationIds ?? record.tasks
  if (Array.isArray(list) && list.length > 0) {
    const first = list[0]
    if (typeof first === 'string' || typeof first === 'number') return String(first)
    return parseGenerationId(first)
  }
  return null
}

function findWorks(record: Record<string, unknown>): unknown[] {
  if (Array.isArray(record.works)) return record.works
  for (const key of ['data', 'result']) {
    const nested = asRecord(record[key])
    if (nested) {
      const found = findWorks(nested)
      if (found.length > 0) return found
    }
  }
  const tasks = record.tasks ?? record.generations
  if (Array.isArray(tasks)) {
    for (const task of tasks) {
      const nested = asRecord(task)
      if (nested) {
        const found = findWorks(nested)
        if (found.length > 0) return found
      }
    }
  }
  return []
}

/** First video result URL. Prefers the URL without the provider watermark when one is offered. */
function findResultUrl(record: Record<string, unknown>): string | null {
  for (const work of findWorks(record)) {
    const entry = asRecord(work)
    if (!entry) continue
    const resource = asRecord(entry.resource)
    for (const candidate of [entry.urlWithoutWatermark, entry.url, entry.videoUrl, resource?.url]) {
      if (typeof candidate === 'string' && /^https:\/\//i.test(candidate.trim())) return candidate.trim()
    }
  }
  return null
}

function findRawState(record: Record<string, unknown>): string | null {
  for (const key of ['status', 'state', 'taskStatus', 'task_status']) {
    const value = bounded(record[key])
    if (value) return value
  }
  for (const key of ['data', 'result']) {
    const nested = asRecord(record[key])
    if (nested) {
      const found = findRawState(nested)
      if (found) return found
    }
  }
  const work = asRecord(findWorks(record)[0])
  if (work) {
    const found = findRawState(work)
    if (found) return found
  }
  const tasks = record.tasks ?? record.generations
  if (Array.isArray(tasks)) {
    const nested = asRecord(tasks[0])
    if (nested) return findRawState(nested)
  }
  return null
}

function findMessage(record: Record<string, unknown>): string | null {
  for (const key of ['message', 'errorMessage', 'error_message', 'failReason', 'reason']) {
    const value = bounded(record[key])
    if (value) return value
  }
  const error = asRecord(record.error)
  if (error) return bounded(error.message)
  return null
}

export function parseTaskReading(payload: unknown): KlingMcpTaskReading {
  const record = asRecord(payload)
  if (!record) return { state: 'processing', rawState: null, resultUrl: null, message: null }

  const rawState = findRawState(record)
  const normalized = rawState?.toLowerCase().replace(/[\s-]+/g, '_') ?? null
  const resultUrl = findResultUrl(record)

  if (normalized && FAILURE_STATES.has(normalized)) {
    return { state: 'failed', rawState, resultUrl: null, message: findMessage(record) }
  }
  if ((normalized && SUCCESS_STATES.has(normalized)) || (!normalized && resultUrl)) {
    return { state: 'succeeded', rawState, resultUrl, message: null }
  }
  // An unrecognised state with a result URL is not assumed final; keep waiting.
  return { state: 'processing', rawState, resultUrl: null, message: null }
}

/**
 * Task-level errors the tool documents for `query_tasks` (moderation, credits,
 * unsupported combination, timeout, service error, bad parameter). These say
 * the GENERATION failed. Anything else (e.g. "Invalid generationId.") is
 * treated as transient by the poller.
 */
const TASK_FAILURE_TEXT =
  /disallowed content|insufficient|credits|does not support this parameter|timed out|temporarily unavailable|parameter format is invalid/i

export function isTaskFailureText(text: string | null): boolean {
  return !!text && TASK_FAILURE_TEXT.test(text)
}

export type SubmitFailureClass = 'PROVIDER_QUOTA_EXCEEDED' | 'PROVIDER_CONTENT_REJECTED' | 'PROVIDER_REJECTED'

/** Classifies a provider rejection so the UI can tell a credit problem from a content problem. */
export function classifyProviderRejection(text: string | null): SubmitFailureClass {
  if (text && /insufficient|credits|top up|quota/i.test(text)) return 'PROVIDER_QUOTA_EXCEEDED'
  if (text && /moderation|disallowed|violat|sensitive/i.test(text)) return 'PROVIDER_CONTENT_REJECTED'
  return 'PROVIDER_REJECTED'
}

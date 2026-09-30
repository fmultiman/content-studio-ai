// NANOBANANA_CALLBACK_AUTHENTICATION_V1
//
// The authoritative view of a Nano Banana generation: the provider's own "Get Task Details"
// endpoint, queried with the task OWNER's credential.
//
// Why this exists: the official Nano Banana callback carries NO signature, secret or header that
// can be verified (docs.nanobananaapi.ai, "Image Generation or Editing Callbacks": POST JSON only;
// the single security advice is "Verify Source", with no mechanism). So a callback body can never
// be trusted. It is treated as a wake-up signal only; what it CLAIMS (status, image_url, errors)
// is ignored, and the task is reconciled from this provider query instead.
//
//   GET https://api.nanobananaapi.ai/api/v1/nanobanana/record-info?taskId=...
//   Authorization: Bearer <owner's key>
//   -> { code, msg, data: { taskId, successFlag, response: { resultImageUrl }, errorCode, errorMessage } }
//   successFlag: 0 GENERATING, 1 SUCCESS, 2 CREATE_TASK_FAILED, 3 GENERATE_FAILED

const NANOBANANA_RECORD_INFO_URL = 'https://api.nanobananaapi.ai/api/v1/nanobanana/record-info'

export type NanoBananaTaskState =
  | { state: 'generating' }
  | { state: 'succeeded'; resultImageUrl: string }
  | { state: 'failed'; message: string }
  | { state: 'unusable'; reason: string }

export type NanoBananaTaskQuery = { ok: true; task: NanoBananaTaskState } | { ok: false; reason: 'PROVIDER_UNAVAILABLE' | 'PROVIDER_REJECTED_CREDENTIAL' | 'TASK_MISMATCH' }

const FAILURE_MESSAGE = 'A geração falhou no provedor.'
const MAX_FAILURE_MESSAGE = 200

/** Pure: turns the provider's record-info JSON into a bounded state, binding it to the requested task id. */
export function normalizeTaskDetails(payload: unknown, expectedTaskId: string): NanoBananaTaskQuery {
  if (!payload || typeof payload !== 'object') return { ok: false, reason: 'PROVIDER_UNAVAILABLE' }
  const root = payload as { code?: unknown; data?: unknown }
  if (root.code !== 200 || !root.data || typeof root.data !== 'object') return { ok: false, reason: 'PROVIDER_UNAVAILABLE' }

  const data = root.data as {
    taskId?: unknown
    successFlag?: unknown
    response?: { resultImageUrl?: unknown } | null
    errorMessage?: unknown
  }

  // The answer must be ABOUT the task we asked for; anything else mutates nothing.
  if (data.taskId !== expectedTaskId) return { ok: false, reason: 'TASK_MISMATCH' }

  switch (data.successFlag) {
    case 0:
      return { ok: true, task: { state: 'generating' } }
    case 1: {
      const url = data.response?.resultImageUrl
      if (typeof url !== 'string' || url.length === 0) return { ok: true, task: { state: 'unusable', reason: 'success without result url' } }
      return { ok: true, task: { state: 'succeeded', resultImageUrl: url } }
    }
    case 2:
    case 3: {
      const provided = typeof data.errorMessage === 'string' ? data.errorMessage.trim().slice(0, MAX_FAILURE_MESSAGE) : ''
      return { ok: true, task: { state: 'failed', message: provided || FAILURE_MESSAGE } }
    }
    default:
      return { ok: true, task: { state: 'unusable', reason: 'unknown successFlag' } }
  }
}

export interface NanoBananaQueryDependencies {
  fetchImpl?: typeof fetch
  timeoutMs?: number
}

/** The provider query. The key is used for this one request and never logged or persisted. */
export async function queryNanoBananaTask(apiKey: string, providerTaskId: string, deps: NanoBananaQueryDependencies = {}): Promise<NanoBananaTaskQuery> {
  const doFetch = deps.fetchImpl ?? fetch
  const url = `${NANOBANANA_RECORD_INFO_URL}?${new URLSearchParams({ taskId: providerTaskId })}`
  try {
    const response = await doFetch(url, {
      method: 'GET',
      headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' },
      signal: AbortSignal.timeout(deps.timeoutMs ?? 10_000),
      redirect: 'error',
    })
    if (response.status === 401 || response.status === 403) return { ok: false, reason: 'PROVIDER_REJECTED_CREDENTIAL' }
    if (!response.ok) return { ok: false, reason: 'PROVIDER_UNAVAILABLE' }
    return normalizeTaskDetails(await response.json(), providerTaskId)
  } catch {
    return { ok: false, reason: 'PROVIDER_UNAVAILABLE' }
  }
}

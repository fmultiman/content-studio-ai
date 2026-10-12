// FUTURE-064 Slice A — release switch for official Gemini image generation. SERVER ONLY.
//
// The route ships DISABLED. It is enabled only by an operator setting this exact acknowledgement string in the
// deployment environment at the later release gate (after Slice B and an authorized paid smoke). A boolean-ish value
// ("1", "true") is rejected on purpose, so a stray variable cannot turn paid execution on. This is independent of,
// and additional to, the FUTURE-050 execution policy (Preview/local/unknown runtimes stay blocked either way).
import { decideProviderExecution } from '@/lib/providers/execution-policy'
import type { GeminiImageAvailability } from '@/lib/images/gemini-availability'

export const GEMINI_IMAGE_GENERATION_FLAG = 'CONTENT_STUDIO_GEMINI_IMAGE_GENERATION'
export const GEMINI_IMAGE_GENERATION_FLAG_VALUE = 'enabled'
export const GEMINI_IMAGE_GENERATION_DISABLED_CODE = 'GEMINI_IMAGE_GENERATION_DISABLED'

export function isGeminiImageGenerationEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return env[GEMINI_IMAGE_GENERATION_FLAG] === GEMINI_IMAGE_GENERATION_FLAG_VALUE
}

// ---------------------------------------------------------------------------------------------------------------------
// FUTURE-064 release-gate CANARY — a restricted, self-expiring authorization for ONE owner, ONE request and ONE model.
//
// The global switch above stays OFF. This is NOT a second switch for users: it authorizes exactly the verified owner id, the
// fixed clientRequestId, the single approved alias `gemini-nb-2.1` at 1:1 (the backend owns the 1K size), and only until the
// stated expiry (at most 24 h ahead, so a forgotten grant lapses on its own). Anything else — absent, malformed, expired,
// far-future, another user, another request id, another model or ratio — leaves the route exactly as disabled as before. It
// opens no UI (availability for the browser still derives from the global switch only) and, because the request id is fixed
// and the Attempt is idempotent, a replay can never trigger a second provider execution.
//
// Value format (all fields required, exactly five, '|' separated):
//   v1|<owner user uuid>|<client request uuid>|gemini-nb-2.1|<expiry, YYYY-MM-DDTHH:MM:SSZ>
// Revocation: delete the variable (and redeploy), or let it expire.
// ---------------------------------------------------------------------------------------------------------------------
export const GEMINI_IMAGE_CANARY_ENV = 'CONTENT_STUDIO_GEMINI_IMAGE_CANARY'
export const GEMINI_IMAGE_CANARY_MODEL = 'gemini-nb-2.1' as const
export const GEMINI_IMAGE_CANARY_MAX_WINDOW_MS = 24 * 60 * 60 * 1000

export type GeminiImageCanary = { userId: string; clientRequestId: string; model: typeof GEMINI_IMAGE_CANARY_MODEL; expiresAtMs: number }

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
const EXPIRY = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/

/** Strict parser. Returns null (canary INACTIVE) for anything but a well-formed, unexpired grant no more than 24 h ahead. */
export function parseGeminiImageCanary(env: Record<string, string | undefined> = process.env, nowMs: number = Date.now()): GeminiImageCanary | null {
  const raw = env[GEMINI_IMAGE_CANARY_ENV]
  if (typeof raw !== 'string' || raw.length === 0 || raw.length > 200) return null
  const parts = raw.split('|')
  if (parts.length !== 5) return null
  const [version, userId, clientRequestId, model, expiry] = parts
  if (version !== 'v1' || !UUID.test(userId) || !UUID.test(clientRequestId) || model !== GEMINI_IMAGE_CANARY_MODEL || !EXPIRY.test(expiry)) return null
  const expiresAtMs = Date.parse(expiry)
  if (Number.isNaN(expiresAtMs) || expiresAtMs <= nowMs || expiresAtMs > nowMs + GEMINI_IMAGE_CANARY_MAX_WINDOW_MS) return null
  return { userId, clientRequestId, model: GEMINI_IMAGE_CANARY_MODEL, expiresAtMs }
}

/** Does this exact request match the grant? Every field must match; the expiry is re-checked at call time. */
export function geminiImageCanaryAllows(
  canary: GeminiImageCanary,
  request: { userId: string; clientRequestId: string; model: string; aspectRatio: string },
  nowMs: number = Date.now(),
): boolean {
  return request.userId === canary.userId
    && request.clientRequestId === canary.clientRequestId
    && request.model === canary.model
    && request.aspectRatio === '1:1'
    && nowMs < canary.expiresAtMs
}

/**
 * FUTURE-064 Slice B — the browser-safe availability class the UI may show (never the variable name or value).
 * Available only when the release switch is on AND the FUTURE-050 policy lets this runtime spend, i.e. exactly when
 * the route itself would not answer 403. It says nothing about the user's credential (that is a separate status).
 */
export function describeGeminiImageAvailability(env: Record<string, string | undefined> = process.env): GeminiImageAvailability {
  if (!isGeminiImageGenerationEnabled(env)) return { available: false, reason: 'release_switch_off' }
  const decision = decideProviderExecution({ provider: 'gemini', operation: 'image_generation' }, env)
  return decision.allowed ? { available: true, reason: 'available' } : { available: false, reason: 'environment_blocked' }
}

import { createHash } from 'node:crypto'

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  const entries = Object.entries(value as Record<string, unknown>)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, child]) => `${JSON.stringify(key)}:${canonicalJson(child)}`)
  return `{${entries.join(',')}}`
}

export function generateImageAttemptFingerprint(input: {
  sessionId: string
  submittedPrompt: string
  provider: string | null
  model: string | null
  submittedConfig: Record<string, unknown>
  sourceSnapshot: Record<string, unknown> | null
}) {
  const canonical = canonicalJson([
    input.sessionId,
    input.submittedPrompt,
    input.provider,
    input.model,
    input.submittedConfig,
    input.sourceSnapshot,
  ])
  return createHash('sha256').update(canonical).digest('hex')
}

export function classifyExistingImageAttempt(existing: { request_fingerprint: string | null }, fingerprint: string) {
  return existing.request_fingerprint === fingerprint ? 'replay' as const : 'conflict' as const
}

// VIDEO_GENERATION_SESSION_PERSISTENCE_AND_API_V1 - server-owned Generate idempotency.
//
// One logical Generate submit = one caller-supplied `clientRequestId` (a UUID the caller keeps stable across
// network retries). The database enforces `UNIQUE (user_id, client_request_id)`, so the key can never cross
// users and two concurrent requests can never both create a row. The route consults it BEFORE any credential,
// source or provider work, so a replay can never reach the provider.
//
// `request_fingerprint` is a SHA-256 of the canonical request the key first carried. A reused key with a
// different request is a conflict, never a silent replay of the first attempt.
//
// A key names ONE submit, including a failed one: replaying it returns that row (failed rows included) and never
// submits again. A deliberate new try needs a new key. Requests without a key keep today's behavior (no
// server-side de-duplication) - the key is optional until every caller sends one.

import { createHash } from 'node:crypto'
import { REST_CONNECTION_REF } from './connection-ref'
import { isUuid } from './session'

export const isClientRequestId = isUuid

const nullable = (value: unknown) => (value === undefined ? null : value)

/**
 * Canonical fingerprint of what the caller asked to be generated: every body field that influences the
 * submission (owner scope, lineage, operation, prompt, source, connection pointer and every control).
 * Built from an explicit list in a fixed order, so key order and extra unknown fields never matter.
 */
export function generateRequestFingerprint(body: Record<string, any>): string {
  const canonical: unknown[] = [
    body.projectId,
    body.productionId,
    body.sessionId,
    body.mode,
    body.prompt,
    body.sourceImageId,
    body.sourceLibraryFileId,
    body.connectionRef ?? REST_CONNECTION_REF,
    body.model,
    body.duration,
    body.resolution,
    body.aspect_ratio,
    body.audio,
    body.multi_shot,
    body.asmr,
    body.audio_prompt,
    body.music_prompt,
    body.outputCount ?? body.imageCount,
  ].map(nullable)
  // VEO_KLING_FIRST_LAST_FRAME_V1: the LAST frame is part of what was asked for, so a key can never be replayed for a
  // different end frame. Appended ONLY when present: the fingerprint of every request without one is byte-identical to
  // what it always was, so an attempt created before this change still replays under its own key.
  if (body.lastFrameImageId || body.lastFrameLibraryFileId) {
    canonical.push(body.lastFrameImageId ?? null, body.lastFrameLibraryFileId ?? null)
  }
  return createHash('sha256').update(JSON.stringify(canonical)).digest('hex')
}

/** The attempt as the browser may see it: the internal fingerprint is never echoed. */
export function toClientGeneration<T extends Record<string, any>>(row: T): Omit<T, 'request_fingerprint'> {
  const { request_fingerprint: _fingerprint, ...rest } = row
  return rest
}

export type IdempotentReplay =
  | { kind: 'replay'; generation: Record<string, any>; outcomeUnknown: boolean }
  | { kind: 'conflict' }

/** Decides what an already-existing row means for a request that carries the same key. */
export function classifyExistingSubmission(existing: Record<string, any>, fingerprint: string): IdempotentReplay {
  if (existing.request_fingerprint !== fingerprint) return { kind: 'conflict' }
  return {
    kind: 'replay',
    generation: toClientGeneration(existing),
    outcomeUnknown: existing.error_details?.outcome_unknown === true,
  }
}

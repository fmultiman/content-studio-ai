// GEMINI_VIDEO_REVIEW_ADAPTER_V1
//
// Canonical Video Review execution:
//
//   typed source -> owner-scoped source resolution -> media artifact (ensure/reuse + provenance)
//     -> trusted media authorization (limits, trusted path) -> server context
//     -> immutable media_review row (pending) -> Gemini execution provider
//     -> authorized byte STREAM -> Files API -> strict structured result -> completed/failed row
//
// The Review is advisory. It never approves, blocks or mutates the video or its source, and one
// artifact may carry many completed Reviews over time (migration 060 allows only ONE in-flight
// Video Review per artifact). Whole-video buffering is impossible on this path: media bytes only
// ever flow through `AuthorizedReviewMedia.openStream()`.
//
// Kept in its own module on purpose: the Image Review service is unchanged by this slice.

import type { SupabaseClient } from '@supabase/supabase-js'
import { resolveProviderExecution } from '@/lib/credentials/provider-execution'
import { isProviderCredentialUnavailableError } from '@/lib/credentials/api-credential-store'
import { recordGeminiReviewUsage, type GeminiReviewUsageContext } from '@/lib/usage/gemini-review-usage'
import { MediaArtifactError } from '@/lib/media-artifacts/errors'
import type { ObjectStreamOpener } from '@/lib/media-artifacts/streaming'
import { registerVideoArtifact, resolveVideoArtifactSource, type KnownVideoFacts, type VideoArtifactSource } from '@/lib/media-artifacts/video'
import { createServiceRoleSupabase } from '@/lib/supabase/service-role'
import type { VideoReviewSource } from './contracts'
import {
  VIDEO_EVALUATOR_PROMPT_VERSION,
  VIDEO_EVALUATOR_RESPONSE_SCHEMA,
  VIDEO_REVIEW_ADAPTER_KEY,
  VIDEO_REVIEW_ADAPTER_VERSION,
  buildVideoEvaluationPrompt,
  mapVideoEvaluatorResult,
  parseVideoEvaluatorResponse,
} from './adapters/video'
import { ReviewServiceError, assertReviewExecutionAllowed } from './errors'
import { ReviewProviderError, parseProviderJson, toReviewServiceError } from './execution-provider'
import { resolveAuthorizedReviewMedia } from './media'
import { REVIEW_VIDEO_MAX_BYTES } from './media-limits'
import { assertProviderModelSupportsMedia, getReviewExecutionProvider, resolveReviewModelId, type ReviewProviderOverrides } from './provider-registry'
import {
  findActiveReviewByArtifact,
  findReviewByClientRequest,
  insertPendingReview,
  markReviewCompleted,
  markReviewFailed,
  markReviewRunning,
} from './repository'
import { recoverStaleActiveReview } from './stale-recovery'
import { buildVideoRequestFingerprint, resolveVideoReviewContext } from './video-context'

/** Video Review runs on the official Gemini API. The provider is a SERVER decision, never a request field. */
const VIDEO_REVIEW_PROVIDER = 'gemini' as const

function storeError(error: unknown) {
  if (error instanceof ReviewServiceError) return error
  return new ReviewServiceError(503, 'REVIEW_STORE_UNAVAILABLE', 'Review storage operation failed.')
}

function toArtifactSource(source: VideoReviewSource): VideoArtifactSource {
  if (source.kind === 'video_generation') return { kind: 'video_generation', videoGenerationId: source.id }
  if (source.kind === 'render_execution') return { kind: 'render_execution', renderExecutionId: source.id }
  return { kind: 'library', libraryFileId: source.id }
}

/** Normalizes any pre-execution failure into the existing Review error vocabulary (no keys, no provider bodies). */
function normalizePreflightError(error: unknown): ReviewServiceError {
  if (error instanceof ReviewServiceError) return error
  if (error instanceof ReviewProviderError) return toReviewServiceError(error)
  if (error instanceof MediaArtifactError) {
    switch (error.code) {
      case 'SOURCE_NOT_FOUND':
        // Cross-user and unknown ids are indistinguishable by design.
        return new ReviewServiceError(404, 'REVIEW_SUBJECT_NOT_FOUND', 'Review source was not found.')
      case 'SOURCE_NOT_READY':
        return new ReviewServiceError(422, 'REVIEW_OUTPUT_UNAVAILABLE', 'The source is not a completed video.')
      case 'UNTRUSTED_STORAGE_PATH':
        return new ReviewServiceError(422, 'REVIEW_OUTPUT_UNAVAILABLE', 'The stored video path is not trusted.')
      case 'STORAGE_UNAVAILABLE':
        return new ReviewServiceError(422, 'REVIEW_OUTPUT_UNAVAILABLE', 'Review media could not be read from storage.')
      case 'SIZE_MISMATCH':
        return new ReviewServiceError(422, 'REVIEW_OUTPUT_UNAVAILABLE', 'Review media no longer matches its recorded size.')
      default:
        return new ReviewServiceError(503, 'REVIEW_STORE_UNAVAILABLE', 'Review storage operation failed.')
    }
  }
  return new ReviewServiceError(500, 'REVIEW_INTERNAL_ERROR', 'Review could not be completed.')
}

/**
 * Cheap guardrail on the recorded SIZE, before the object is read and hashed: an oversized video is rejected
 * without streaming hundreds of MB. Duration is deliberately not pre-checked from any source record (none is
 * authoritative); it is read from the stored bytes during registration and enforced by
 * `resolveAuthorizedReviewMedia` (unknown or over-long fails closed).
 */
function assertKnownFactsWithinLimits(known: KnownVideoFacts) {
  if (known.byteSize !== null && known.byteSize > REVIEW_VIDEO_MAX_BYTES) {
    throw new ReviewProviderError('media_limit_exceeded', 'Video exceeds the Review size limit (500 MB).')
  }
}

function failureCodeFor(code: ReviewServiceError['code']) {
  if (code === 'REVIEW_INVALID_EVALUATOR_RESPONSE') return 'invalid_evaluator_response'
  if (code === 'REVIEW_PROVIDER_TIMEOUT') return 'provider_timeout'
  if (code === 'REVIEW_IDENTITY_INVALID') return 'project_identity_invalid'
  if (code === 'REVIEW_OUTPUT_UNAVAILABLE') return 'media_unavailable'
  return 'provider_error'
}

export async function createVideoReviewExecution(params: {
  userId: string
  source: VideoReviewSource
  clientRequestId: string
  db?: SupabaseClient
  /** Test seams. Never read from a request. */
  providers?: ReviewProviderOverrides
  openObject?: ObjectStreamOpener
  /** Test seam for the stale-recovery clock (epoch ms). Never read from a request. */
  clock?: () => number
}) {
  // FUTURE-050: refuse BEFORE the artifact, provenance or Review row exist when this environment may not spend.
  assertReviewExecutionAllowed(VIDEO_REVIEW_PROVIDER, 'video_review')
  const db = params.db ?? createServiceRoleSupabase()

  // 1-3. Source -> trusted coordinates -> canonical artifact (idempotent) -> authorized media (limits, trusted path).
  let artifact
  let media
  try {
    const resolvedSource = await resolveVideoArtifactSource(db, { userId: params.userId, source: toArtifactSource(params.source) })
    assertKnownFactsWithinLimits(resolvedSource.known)
    artifact = await registerVideoArtifact(db, resolvedSource, { openObject: params.openObject })
    media = await resolveAuthorizedReviewMedia(db, { userId: params.userId, artifactId: artifact.id, expectedKind: 'video', openObject: params.openObject })
  } catch (error) {
    throw normalizePreflightError(error)
  }

  // 4. Server context (scope = the artifact's own scope) and request identity.
  const resolved = await resolveVideoReviewContext(db, { userId: params.userId, source: params.source, artifact })
  const fingerprint = buildVideoRequestFingerprint(params.source, artifact.id, resolved.contextFingerprint)

  // 5. Idempotency (clientRequestId) and the single in-flight Review per artifact. Repeated Reviews are legitimate.
  const existing = await findReviewByClientRequest(db, params.userId, params.clientRequestId)
  if (existing.error) throw storeError(existing.error)
  if (existing.data) {
    if (existing.data.request_fingerprint !== fingerprint) throw new ReviewServiceError(409, 'REVIEW_IDEMPOTENCY_CONFLICT', 'clientRequestId was used for another Review.')
    return { row: existing.data, replayed: true }
  }
  const active = await findActiveReviewByArtifact(db, params.userId, artifact.id)
  if (active.error) throw storeError(active.error)
  if (active.data) {
    // FUTURE-046: recover an abandoned in-flight Review before it blocks this artifact forever. A legitimately slow
    // one (younger than the stale policy) still answers 409. Runs before any insert or provider call.
    const recovery = await recoverStaleActiveReview(db, active.data, { userId: params.userId, nowMs: (params.clock ?? Date.now)() })
    if (recovery === 'in_flight') throw new ReviewServiceError(409, 'REVIEW_IN_PROGRESS', 'A Review is already running for this video.', { reviewId: active.data.id })
  }

  const inserted = await insertPendingReview(db, {
    user_id: params.userId,
    subject_media_type: 'video',
    // Migration 060: a Video Review carries NO image links and is bound only to its artifact.
    image_attempt_id: null,
    image_output_id: null,
    media_artifact_id: artifact.id,
    project_id: artifact.project_id,
    production_id: artifact.production_id,
    adapter_key: VIDEO_REVIEW_ADAPTER_KEY,
    adapter_version: VIDEO_REVIEW_ADAPTER_VERSION,
    review_schema_version: 1,
    origin: 'live',
    client_request_id: params.clientRequestId,
    request_fingerprint: fingerprint,
    subject_snapshot: {
      schemaVersion: 1,
      source: params.source,
      artifact: { id: artifact.id, version: artifact.version, identityMode: artifact.identity_mode, contentHash: artifact.content_hash },
      media: resolved.subject.media,
      sourceContext: resolved.subject.sourceContext,
    },
    context_snapshot: { ...resolved.context, fingerprint: resolved.contextFingerprint },
    result_payload: {},
  })
  if (inserted.error || !inserted.data) {
    if (inserted.error?.code === '23505') {
      if (String(inserted.error.message ?? '').includes('media_reviews_active_video_artifact_key')) {
        const raced = await findActiveReviewByArtifact(db, params.userId, artifact.id)
        throw new ReviewServiceError(409, 'REVIEW_IN_PROGRESS', 'A Review is already running for this video.', raced.data ? { reviewId: raced.data.id } : undefined)
      }
      const raced = await findReviewByClientRequest(db, params.userId, params.clientRequestId)
      if (raced.data && raced.data.request_fingerprint === fingerprint) return { row: raced.data, replayed: true }
    }
    throw storeError(inserted.error)
  }
  const row = inserted.data

  // 6. Credential (user BYOK, resolved server-side). A missing credential is a recorded failure, like Image.
  let execution: Awaited<ReturnType<typeof resolveProviderExecution>>
  try {
    execution = await resolveProviderExecution(db, { userId: params.userId, provider: VIDEO_REVIEW_PROVIDER })
  } catch (error) {
    if (!isProviderCredentialUnavailableError(error)) throw error
    // The credential store could not be read: a retryable pre-provider failure, NOT "provider not configured".
    const failed = await markReviewFailed(db, row.id, 'provider_error', 'Video evaluator credentials could not be read.')
    if (failed.error || !failed.data) throw storeError(failed.error)
    throw new ReviewServiceError(503, 'REVIEW_STORE_UNAVAILABLE', 'Video evaluator credentials could not be read.', { reviewId: failed.data.id })
  }
  if (execution.status !== 'ready') {
    const failed = await markReviewFailed(db, row.id, 'provider_error', 'Video evaluator provider is not configured.')
    if (failed.error || !failed.data) throw storeError(failed.error)
    throw new ReviewServiceError(422, 'REVIEW_PROVIDER_NOT_CONFIGURED', 'Video evaluator provider is not configured.', { reviewId: failed.data.id })
  }

  const model = resolveReviewModelId(VIDEO_REVIEW_PROVIDER)
  const running = await markReviewRunning(db, row.id, { evaluator_provider: VIDEO_REVIEW_PROVIDER, evaluator_model: model, evaluator_prompt_version: VIDEO_EVALUATOR_PROMPT_VERSION })
  if (running.error || !running.data) throw storeError(running.error)

  // Usage observability (FUTURE-043): attribution of THIS provider execution. Recorded as soon as Gemini answered,
  // before Review parsing, because the execution happened whatever the Review outcome.
  const usageContext = (providerResponse: GeminiReviewUsageContext['providerResponse'], providerRequestId?: string | null): GeminiReviewUsageContext => ({
    userId: params.userId, reviewId: row.id, mediaType: 'video', projectId: row.project_id, productionId: row.production_id,
    artifactId: artifact.id, model, funding: execution.executionMode, credentialSource: execution.credentialSource, providerRequestId, providerResponse,
  })

  // 7. Execute through the provider boundary; the provider streams the video and cleans up its remote file.
  try {
    const provider = getReviewExecutionProvider(VIDEO_REVIEW_PROVIDER, params.providers)
    assertProviderModelSupportsMedia(provider, model, 'video')
    const prompt = buildVideoEvaluationPrompt(resolved.context, resolved.subject)
    const response = await provider.execute({
      model,
      apiKey: execution.secret,
      instructions: prompt.system,
      input: prompt.input,
      media: [media],
      responseSchema: VIDEO_EVALUATOR_RESPONSE_SCHEMA,
    })
    const warnings = response.warnings
    await recordGeminiReviewUsage(db, usageContext('received', response.providerRequestId), response.usage)
    const parsed = parseVideoEvaluatorResponse(parseProviderJson(response.rawText))
    const result = mapVideoEvaluatorResult(parsed, resolved.context, resolved.subject)
    const completed = await markReviewCompleted(db, row.id, {
      overall_score: result.overall.score,
      overall_assessment: result.overall.assessment,
      summary: result.summary,
      result_payload: result,
      refined_prompt: result.refinedPrompt,
    })
    if (completed.error || !completed.data) throw storeError(completed.error)
    // Cleanup problems are warnings only: they never change an otherwise successful Review. Codes only, never ids or keys.
    if (warnings.length) console.warn('[reviews] provider cleanup warning', { reviewId: row.id, providerId: VIDEO_REVIEW_PROVIDER, warnings: warnings.map((w) => w.code) })
    return { row: completed.data, replayed: false, warnings }
  } catch (error) {
    const normalized = toReviewServiceError(error)
    // Gemini answered with usage but the response was unusable (blocked / truncated / empty): still a metered execution.
    if (error instanceof ReviewProviderError && error.usage) await recordGeminiReviewUsage(db, usageContext('received_rejected', error.providerRequestId), error.usage)
    if (error instanceof ReviewProviderError && error.warnings.length) {
      console.warn('[reviews] provider cleanup warning', { reviewId: row.id, providerId: VIDEO_REVIEW_PROVIDER, warnings: error.warnings.map((w) => w.code) })
    }
    const failed = await markReviewFailed(db, row.id, failureCodeFor(normalized.code), normalized.message)
    if (failed.error || !failed.data) throw storeError(failed.error)
    throw new ReviewServiceError(normalized.status, normalized.code, normalized.message, { reviewId: failed.data.id })
  }
}

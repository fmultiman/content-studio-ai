import type { SupabaseClient } from '@supabase/supabase-js'
import { resolveProviderExecution } from '@/lib/credentials/provider-execution'
import { isProviderCredentialUnavailableError } from '@/lib/credentials/api-credential-store'
import { recordGeminiReviewUsage, type GeminiReviewUsageContext } from '@/lib/usage/gemini-review-usage'
import { createServiceRoleSupabase } from '@/lib/supabase/service-role'
import { buildRequestFingerprint, resolveImageReviewContext } from './context'
import { resolveImageArtifact } from '@/lib/media-artifacts/image'
import { buildImageEvaluationPrompt, IMAGE_EVALUATOR_PROMPT_VERSION, IMAGE_EVALUATOR_RESPONSE_SCHEMA, IMAGE_REVIEW_ADAPTER_KEY, IMAGE_REVIEW_ADAPTER_VERSION, mapImageEvaluatorResult, parseImageEvaluatorResponse } from './adapters/image'
import { ReviewServiceError, assertReviewExecutionAllowed } from './errors'
import { ReviewProviderError, parseProviderJson, toReviewServiceError, type AuthorizedReviewMedia, type ReviewProviderId } from './execution-provider'
import { resolveAuthorizedReviewMedia, type ReviewObjectReader } from './media'
import { DEFAULT_REVIEW_PROVIDER_ID, assertProviderModelSupportsMedia, getReviewExecutionProvider, resolveReviewModelId, type ReviewProviderOverrides } from './provider-registry'
import { findActiveReviewByAttempt, findReviewByClientRequest, insertPendingReview, listReviewsByAttempt, markReviewCompleted, markReviewFailed, markReviewRunning, toReviewRecord, type MediaReviewRow } from './repository'
import { recoverStaleActiveReview } from './stale-recovery'
import type { ReviewHistoryV1 } from './contracts'

export type ImageReviewEvaluator = (input: {
  apiKey: string
  prompt: ReturnType<typeof buildImageEvaluationPrompt>
  imageUrl: string
  model: string
}) => Promise<unknown>

function storeError(error: unknown) {
  if (error instanceof ReviewServiceError) return error
  return new ReviewServiceError(503, 'REVIEW_STORE_UNAVAILABLE', 'Review storage operation failed.')
}

export async function createImageReviewExecution(params: {
  userId: string
  attemptId: string
  clientRequestId: string
  db?: SupabaseClient
  /** Legacy OpenAI-only evaluator seam (tests). Bypasses the provider boundary. */
  evaluator?: ImageReviewEvaluator
  /** Server-decided Review execution provider. Never read from the client request. Defaults to OpenAI. */
  providerId?: ReviewProviderId
  providers?: ReviewProviderOverrides
  readObject?: ReviewObjectReader
  now?: () => string
  /** Test seam for the stale-recovery clock (epoch ms). Never read from a request. */
  clock?: () => number
}) {
  // FUTURE-050: refuse BEFORE touching the database or the provider when this environment may not spend.
  assertReviewExecutionAllowed(params.providerId ?? DEFAULT_REVIEW_PROVIDER_ID, 'image_review')
  const db = params.db ?? createServiceRoleSupabase()
  const resolved = await resolveImageReviewContext(db, params.userId, params.attemptId)
  const artifact = await resolveImageArtifact(db, {
    userId: params.userId,
    projectId: resolved.subject.projectId,
    productionId: resolved.subject.productionId,
    attemptId: resolved.subject.attemptId,
    outputId: resolved.subject.outputId,
    storageProvider: resolved.output.storage_provider ?? null,
    storagePath: resolved.subject.outputStoragePath ?? '',
    mimeType: resolved.output.mime_type,
    fileSize: resolved.output.file_size,
    metadata: resolved.output.metadata,
  })
  const fingerprint = buildRequestFingerprint(params.attemptId, resolved.subject.outputId, resolved.contextFingerprint, artifact.id)
  const existing = await findReviewByClientRequest(db, params.userId, params.clientRequestId)
  if (existing.error) throw storeError(existing.error)
  if (existing.data) {
    if (existing.data.request_fingerprint !== fingerprint) throw new ReviewServiceError(409, 'REVIEW_IDEMPOTENCY_CONFLICT', 'clientRequestId was used for another Review.')
    return { row: existing.data, replayed: true }
  }
  const active = await findActiveReviewByAttempt(db, params.userId, params.attemptId)
  if (active.error) throw storeError(active.error)
  if (active.data) {
    // FUTURE-046: an abandoned in-flight Review (process died) must not block this Attempt forever. Only a Review
    // older than the stale policy is recovered; a legitimately slow one still answers 409.
    const recovery = await recoverStaleActiveReview(db, active.data, { userId: params.userId, nowMs: (params.clock ?? Date.now)() })
    if (recovery === 'in_flight') throw new ReviewServiceError(409, 'REVIEW_IN_PROGRESS', 'A Review is already running for this Attempt.', { reviewId: active.data.id })
  }

  const subjectSnapshot = {
    schemaVersion: 1,
    attemptId: resolved.subject.attemptId,
    outputId: resolved.subject.outputId,
    submittedPrompt: resolved.subject.submittedPrompt,
    provider: resolved.subject.provider,
    model: resolved.subject.model,
    submittedConfig: resolved.subject.submittedConfig,
    sourceSnapshot: resolved.subject.sourceSnapshot,
    output: { id: resolved.subject.outputId, storagePath: resolved.subject.outputStoragePath, metadata: resolved.subject.outputMetadata },
  }
  const contextSnapshot = { ...resolved.context, fingerprint: resolved.contextFingerprint }
  const clientRequestId = params.clientRequestId
  const inserted = await insertPendingReview(db, {
    user_id: params.userId,
    subject_media_type: 'image',
    image_attempt_id: params.attemptId,
    image_output_id: resolved.subject.outputId,
    media_artifact_id: artifact.id,
    project_id: resolved.subject.projectId,
    production_id: resolved.subject.productionId,
    adapter_key: IMAGE_REVIEW_ADAPTER_KEY,
    adapter_version: IMAGE_REVIEW_ADAPTER_VERSION,
    review_schema_version: 1,
    origin: 'live',
    client_request_id: clientRequestId,
    request_fingerprint: fingerprint,
    subject_snapshot: subjectSnapshot,
    context_snapshot: contextSnapshot,
    result_payload: {},
  })
  if (inserted.error || !inserted.data) {
    if (inserted.error?.code === '23505') {
      // The partial unique in-flight index is the final authority when two requests race to start a Review.
      if (String(inserted.error.message ?? '').includes('media_reviews_active_attempt_key')) {
        const racedActive = await findActiveReviewByAttempt(db, params.userId, params.attemptId)
        throw new ReviewServiceError(409, 'REVIEW_IN_PROGRESS', 'A Review is already running for this Attempt.', racedActive.data ? { reviewId: racedActive.data.id } : undefined)
      }
      const raced = await findReviewByClientRequest(db, params.userId, clientRequestId)
      if (raced.data && raced.data.request_fingerprint === fingerprint) return { row: raced.data, replayed: true }
    }
    throw storeError(inserted.error)
  }
  const row = inserted.data
  const providerId = params.providerId ?? DEFAULT_REVIEW_PROVIDER_ID
  let execution: Awaited<ReturnType<typeof resolveProviderExecution>>
  try {
    execution = await resolveProviderExecution(db, { userId: params.userId, provider: providerId })
  } catch (error) {
    if (!isProviderCredentialUnavailableError(error)) throw error
    // The credential store could not be read: a retryable pre-provider failure, NOT "provider not configured".
    const failed = await markReviewFailed(db, row.id, 'provider_error', 'Image evaluator credentials could not be read.')
    if (failed.error || !failed.data) throw storeError(failed.error)
    throw new ReviewServiceError(503, 'REVIEW_STORE_UNAVAILABLE', 'Image evaluator credentials could not be read.', { reviewId: failed.data.id })
  }
  if (execution.status !== 'ready') {
    const failed = await markReviewFailed(db, row.id, 'provider_error', 'Image evaluator provider is not configured.')
    if (failed.error || !failed.data) throw storeError(failed.error)
    throw new ReviewServiceError(422, 'REVIEW_PROVIDER_NOT_CONFIGURED', 'Image evaluator provider is not configured.', { reviewId: failed.data.id })
  }
  const model = resolveReviewModelId(providerId)
  const running = await markReviewRunning(db, row.id, { evaluator_provider: providerId, evaluator_model: model, evaluator_prompt_version: IMAGE_EVALUATOR_PROMPT_VERSION })
  if (running.error || !running.data) throw storeError(running.error)
  // Usage observability (FUTURE-043), Gemini only: OpenAI Review usage is a separate integration.
  const usageContext = (providerResponse: GeminiReviewUsageContext['providerResponse'], providerRequestId?: string | null): GeminiReviewUsageContext => ({
    userId: params.userId, reviewId: row.id, mediaType: 'image', projectId: row.project_id, productionId: row.production_id,
    artifactId: artifact.id, model, funding: execution.executionMode, credentialSource: execution.credentialSource, providerRequestId, providerResponse,
  })
  try {
    let raw: unknown
    let warnings: Array<{ code: string; message: string }> = []
    if (params.evaluator && providerId === 'openai') {
      raw = await params.evaluator({ apiKey: execution.secret, prompt: buildImageEvaluationPrompt(resolved.context, resolved.subject), imageUrl: resolved.subject.outputUrl, model })
    } else {
      const provider = getReviewExecutionProvider(providerId, params.providers)
      assertProviderModelSupportsMedia(provider, model, 'image')
      let media: AuthorizedReviewMedia
      let subject = resolved.subject
      if (providerId === 'openai') {
        // OpenAI keeps its historical delivery: the server-resolved output URL.
        media = {
          kind: 'image', artifactId: artifact.id, mimeType: resolved.output.mime_type ?? 'image/png', byteSize: null, durationMs: null,
          url: resolved.subject.outputUrl,
          load: () => Promise.reject(new ReviewServiceError(422, 'REVIEW_OUTPUT_UNAVAILABLE', 'Direct byte access is not used for this provider.')),
        }
      } else {
        // Other providers receive artifact bytes authorized server-side; the delivery URL is not disclosed in the prompt.
        media = await resolveAuthorizedReviewMedia(db, { userId: params.userId, artifactId: artifact.id, expectedKind: 'image', readObject: params.readObject })
        subject = { ...resolved.subject, outputUrl: '[image attached as media input]' }
      }
      const prompt = buildImageEvaluationPrompt(resolved.context, subject)
      const response = await provider.execute({
        model,
        apiKey: execution.secret,
        instructions: prompt.system,
        input: prompt.input,
        media: [media],
        responseSchema: providerId === 'gemini' ? IMAGE_EVALUATOR_RESPONSE_SCHEMA : null,
      })
      warnings = response.warnings
      if (providerId === 'gemini') await recordGeminiReviewUsage(db, usageContext('received', response.providerRequestId), response.usage)
      raw = parseProviderJson(response.rawText)
    }
    const parsed = parseImageEvaluatorResponse(raw)
    const result = mapImageEvaluatorResult(parsed, resolved.context, resolved.subject)
    const completed = await markReviewCompleted(db, row.id, {
      overall_score: result.overall.score,
      overall_assessment: result.overall.assessment,
      summary: result.summary,
      result_payload: result,
      refined_prompt: result.refinedPrompt,
    })
    if (completed.error || !completed.data) throw storeError(completed.error)
    if (warnings.length) console.warn('[reviews] provider cleanup warning', { reviewId: row.id, providerId, warnings: warnings.map((w) => w.code) })
    return { row: completed.data, replayed: false, warnings }
  } catch (error) {
    const normalized = toReviewServiceError(error)
    if (providerId === 'gemini' && error instanceof ReviewProviderError && error.usage) await recordGeminiReviewUsage(db, usageContext('received_rejected', error.providerRequestId), error.usage)
    if (error instanceof ReviewProviderError && error.warnings.length) console.warn('[reviews] provider cleanup warning', { reviewId: row.id, providerId, warnings: error.warnings.map((w) => w.code) })
    const failureCode = normalized.code === 'REVIEW_INVALID_EVALUATOR_RESPONSE'
      ? 'invalid_evaluator_response'
      : normalized.code === 'REVIEW_PROVIDER_TIMEOUT'
        ? 'provider_timeout'
        : normalized.code === 'REVIEW_IDENTITY_INVALID'
          ? 'project_identity_invalid'
          : normalized.code === 'REVIEW_OUTPUT_UNAVAILABLE'
            ? 'media_unavailable'
            : 'provider_error'
    const failed = await markReviewFailed(db, row.id, failureCode, normalized.message)
    if (failed.error || !failed.data) throw storeError(failed.error)
    throw new ReviewServiceError(normalized.status, normalized.code, normalized.message, { reviewId: failed.data.id })
  }
}

export async function getImageReviewHistory(params: { userId: string; attemptId: string; db?: SupabaseClient }): Promise<ReviewHistoryV1> {
  const db = params.db ?? createServiceRoleSupabase()
  const result = await listReviewsByAttempt(db, params.userId, params.attemptId)
  if (result.error) throw storeError(result.error)
  const items = result.data.map(toReviewRecord)
  return {
    items,
    latestCompleted: items.find((item) => item.status === 'completed') ?? null,
    latestExecution: items[0] ?? null,
  }
}

import type { SupabaseClient } from '@supabase/supabase-js'
import { resolveProviderExecution } from '@/lib/credentials/provider-execution'
import { createServiceRoleSupabase } from '@/lib/supabase/service-role'
import { buildRequestFingerprint, resolveImageReviewContext } from './context'
import { buildImageEvaluationPrompt, IMAGE_EVALUATOR_PROMPT_VERSION, IMAGE_REVIEW_ADAPTER_KEY, IMAGE_REVIEW_ADAPTER_VERSION, mapImageEvaluatorResult, parseImageEvaluatorResponse } from './adapters/image'
import { ReviewServiceError } from './errors'
import { findActiveReviewByAttempt, findReviewByClientRequest, insertPendingReview, listReviewsByAttempt, markReviewCompleted, markReviewFailed, markReviewRunning, toReviewRecord, type MediaReviewRow } from './repository'
import type { ReviewHistoryV1 } from './contracts'

export type ImageReviewEvaluator = (input: {
  apiKey: string
  prompt: ReturnType<typeof buildImageEvaluationPrompt>
  imageUrl: string
  model: string
}) => Promise<unknown>

async function openAiEvaluator(input: Parameters<ImageReviewEvaluator>[0]) {
  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${input.apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: input.model,
      messages: [
        { role: 'system', content: input.prompt.system },
        { role: 'user', content: [{ type: 'text', text: input.prompt.input }, { type: 'image_url', image_url: { url: input.imageUrl, detail: 'low' } }] },
      ],
      response_format: { type: 'json_object' },
      max_tokens: 1400,
    }),
  })
  const responseData = await response.json().catch(() => ({})) as Record<string, any>
  if (!response.ok) throw new ReviewServiceError(502, 'REVIEW_PROVIDER_ERROR', 'Image evaluator provider failed.')
  const content = responseData.choices?.[0]?.message?.content
  if (typeof content !== 'string' || !content.trim()) throw new ReviewServiceError(502, 'REVIEW_INVALID_EVALUATOR_RESPONSE', 'Image evaluator returned no result.')
  try {
    return JSON.parse(content) as unknown
  } catch {
    throw new ReviewServiceError(502, 'REVIEW_INVALID_EVALUATOR_RESPONSE', 'Image evaluator returned invalid JSON.')
  }
}

function storeError(error: unknown) {
  if (error instanceof ReviewServiceError) return error
  return new ReviewServiceError(503, 'REVIEW_STORE_UNAVAILABLE', 'Review storage operation failed.')
}

export async function createImageReviewExecution(params: {
  userId: string
  attemptId: string
  clientRequestId: string
  db?: SupabaseClient
  evaluator?: ImageReviewEvaluator
  now?: () => string
}) {
  const db = params.db ?? createServiceRoleSupabase()
  const resolved = await resolveImageReviewContext(db, params.userId, params.attemptId)
  const fingerprint = buildRequestFingerprint(params.attemptId, resolved.subject.outputId, resolved.contextFingerprint)
  const existing = await findReviewByClientRequest(db, params.userId, params.clientRequestId)
  if (existing.error) throw storeError(existing.error)
  if (existing.data) {
    if (existing.data.request_fingerprint !== fingerprint) throw new ReviewServiceError(409, 'REVIEW_IDEMPOTENCY_CONFLICT', 'clientRequestId was used for another Review.')
    return { row: existing.data, replayed: true }
  }
  const active = await findActiveReviewByAttempt(db, params.userId, params.attemptId)
  if (active.error) throw storeError(active.error)
  if (active.data) throw new ReviewServiceError(409, 'REVIEW_IN_PROGRESS', 'A Review is already running for this Attempt.', { reviewId: active.data.id })

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
      const raced = await findReviewByClientRequest(db, params.userId, clientRequestId)
      if (raced.data && raced.data.request_fingerprint === fingerprint) return { row: raced.data, replayed: true }
    }
    throw storeError(inserted.error)
  }
  const row = inserted.data
  const execution = await resolveProviderExecution(db, { userId: params.userId, provider: 'openai' })
  if (execution.status !== 'ready') {
    const failed = await markReviewFailed(db, row.id, 'provider_error', 'Image evaluator provider is not configured.')
    if (failed.error || !failed.data) throw storeError(failed.error)
    throw new ReviewServiceError(422, 'REVIEW_PROVIDER_NOT_CONFIGURED', 'Image evaluator provider is not configured.', { reviewId: failed.data.id })
  }
  const model = process.env.OPENAI_EVALUATION_MODEL || 'gpt-4o-mini'
  const running = await markReviewRunning(db, row.id, { evaluator_provider: 'openai', evaluator_model: model, evaluator_prompt_version: IMAGE_EVALUATOR_PROMPT_VERSION })
  if (running.error || !running.data) throw storeError(running.error)
  try {
    const evaluator = params.evaluator ?? openAiEvaluator
    const raw = await evaluator({ apiKey: execution.secret, prompt: buildImageEvaluationPrompt(resolved.context, resolved.subject), imageUrl: resolved.subject.outputUrl, model })
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
    return { row: completed.data, replayed: false }
  } catch (error) {
    const normalized = error instanceof ReviewServiceError ? error : new ReviewServiceError(502, 'REVIEW_PROVIDER_ERROR', 'Image evaluator failed.')
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

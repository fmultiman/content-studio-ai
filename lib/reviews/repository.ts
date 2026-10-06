import type { SupabaseClient } from '@supabase/supabase-js'
import { ReviewRecordSchema, ReviewResultV1Schema, type ReviewRecordV1 } from './contracts'

export const MEDIA_REVIEW_COLUMNS = [
  'id', 'user_id', 'subject_media_type', 'image_attempt_id', 'image_output_id',
  'project_id', 'production_id', 'adapter_key', 'adapter_version',
  'review_schema_version', 'origin', 'status', 'client_request_id',
  'request_fingerprint', 'subject_snapshot', 'context_snapshot',
  'evaluator_provider', 'evaluator_model', 'evaluator_prompt_version',
  'overall_score', 'overall_assessment', 'summary', 'result_payload',
  'refined_prompt', 'failure_code', 'failure_details', 'legacy_source_key',
  'created_at', 'started_at', 'completed_at', 'failed_at', 'updated_at',
].join(',')

export type MediaReviewRow = {
  id: string
  user_id: string
  subject_media_type: 'image'
  image_attempt_id: string
  image_output_id: string
  project_id: string | null
  production_id: string | null
  adapter_key: string
  adapter_version: string
  review_schema_version: 1
  origin: 'live' | 'legacy_import'
  status: 'pending' | 'running' | 'completed' | 'failed'
  client_request_id: string
  request_fingerprint: string
  subject_snapshot: Record<string, unknown>
  context_snapshot: Record<string, unknown>
  evaluator_provider: string | null
  evaluator_model: string | null
  evaluator_prompt_version: string | null
  overall_score: number | null
  overall_assessment: string | null
  summary: string | null
  result_payload: Record<string, unknown>
  refined_prompt: string | null
  failure_code: string | null
  failure_details: Record<string, unknown> | null
  legacy_source_key: string | null
  created_at: string
  started_at: string | null
  completed_at: string | null
  failed_at: string | null
  updated_at: string
}

function normalizeFailureCode(code: string) {
  if (code === 'invalid_evaluator_response' || code === 'review_invalid_evaluator_response') return 'invalid_evaluator_response' as const
  if (code === 'provider_timeout' || code === 'review_provider_timeout') return 'provider_timeout' as const
  if (code === 'provider_error' || code === 'review_provider_error' || code === 'provider_not_configured' || code === 'review_provider_not_configured') return 'provider_error' as const
  if (code === 'media_unavailable' || code === 'review_output_unavailable') return 'media_unavailable' as const
  if (code === 'project_identity_invalid' || code === 'review_identity_invalid') return 'project_identity_invalid' as const
  return 'validation_error' as const
}

export function toReviewRecord(row: MediaReviewRow): ReviewRecordV1 {
  const result = ReviewResultV1Schema.safeParse(row.result_payload)
  const record = {
    id: row.id,
    status: row.status,
    subject: { mediaType: 'image' as const, attemptId: row.image_attempt_id, outputId: row.image_output_id },
    projectId: row.project_id,
    productionId: row.production_id,
    adapter: { key: row.adapter_key, version: row.adapter_version },
    reviewSchemaVersion: 1 as const,
    evaluator: { provider: row.evaluator_provider, model: row.evaluator_model, promptVersion: row.evaluator_prompt_version },
    contextFingerprint: typeof row.context_snapshot.fingerprint === 'string' ? row.context_snapshot.fingerprint : 'legacy',
    result: result.success ? result.data : null,
    failure: row.failure_code ? {
      schemaVersion: 1 as const,
      status: 'failed' as const,
      code: normalizeFailureCode(row.failure_code),
      message: typeof row.failure_details?.message === 'string' ? row.failure_details.message : 'Review execution failed.',
    } : null,
    refinedPrompt: row.refined_prompt,
    origin: row.origin,
    createdAt: row.created_at,
    completedAt: row.completed_at,
  }
  return ReviewRecordSchema.parse(record)
}

export async function findReviewByClientRequest(db: SupabaseClient, userId: string, clientRequestId: string) {
  const result = await db.from('media_reviews').select(MEDIA_REVIEW_COLUMNS).eq('user_id', userId).eq('client_request_id', clientRequestId).maybeSingle()
  return { data: result.data as MediaReviewRow | null, error: result.error }
}

export async function findActiveReviewByAttempt(db: SupabaseClient, userId: string, attemptId: string) {
  const result = await db.from('media_reviews').select(MEDIA_REVIEW_COLUMNS).eq('user_id', userId).eq('image_attempt_id', attemptId).in('status', ['pending', 'running']).maybeSingle()
  return { data: result.data as MediaReviewRow | null, error: result.error }
}

export async function listReviewsByAttempt(db: SupabaseClient, userId: string, attemptId: string) {
  const result = await db.from('media_reviews').select(MEDIA_REVIEW_COLUMNS).eq('user_id', userId).eq('image_attempt_id', attemptId).order('created_at', { ascending: false }).limit(50)
  return { data: (result.data ?? []) as unknown as MediaReviewRow[], error: result.error }
}

export async function insertPendingReview(db: SupabaseClient, values: Record<string, unknown>) {
  const result = await db.from('media_reviews').insert({ ...values, status: 'pending' }).select(MEDIA_REVIEW_COLUMNS).single()
  return { data: result.data as MediaReviewRow | null, error: result.error }
}

export async function markReviewRunning(db: SupabaseClient, id: string, values: Record<string, unknown>) {
  const result = await db.from('media_reviews').update({ ...values, status: 'running', started_at: new Date().toISOString() }).eq('id', id).in('status', ['pending']).select(MEDIA_REVIEW_COLUMNS).single()
  return { data: result.data as MediaReviewRow | null, error: result.error }
}

export async function markReviewCompleted(db: SupabaseClient, id: string, values: Record<string, unknown>) {
  const result = await db.from('media_reviews').update({ ...values, status: 'completed', completed_at: new Date().toISOString() }).eq('id', id).eq('status', 'running').select(MEDIA_REVIEW_COLUMNS).single()
  return { data: result.data as MediaReviewRow | null, error: result.error }
}

export async function markReviewFailed(db: SupabaseClient, id: string, code: string, message: string) {
  const result = await db.from('media_reviews').update({ status: 'failed', failure_code: code, failure_details: { message }, failed_at: new Date().toISOString() }).eq('id', id).in('status', ['pending', 'running']).select(MEDIA_REVIEW_COLUMNS).single()
  return { data: result.data as MediaReviewRow | null, error: result.error }
}

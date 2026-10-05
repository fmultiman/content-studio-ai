import { z } from 'zod'
import { isUuid } from './session'

export const ATTEMPT_STATUSES = ['queued', 'submitted', 'processing', 'succeeded', 'failed', 'legacy'] as const
export const AttemptSourceSnapshotSchema = z.object({
  references: z.array(z.object({ type: z.enum(['image', 'library_file']), id: z.string().refine(isUuid, 'reference id must be a UUID') }).strict()).default([]),
  metadata: z.record(z.string(), z.unknown()).default({}),
}).strict()

export const CreateAttemptBodySchema = z.object({
  sessionId: z.string().refine(isUuid, 'sessionId must be a UUID'),
  submittedPrompt: z.string().max(20_000),
  provider: z.string().max(120).nullable().default(null),
  model: z.string().max(200).nullable().default(null),
  submittedConfig: z.record(z.string(), z.unknown()).default({}),
  sourceSnapshot: AttemptSourceSnapshotSchema.nullable().default(null),
  clientRequestId: z.string().refine(isUuid, 'clientRequestId must be a UUID').nullable().default(null),
}).strict()

export const AttemptLifecyclePatchSchema = z.object({
  status: z.enum(ATTEMPT_STATUSES).optional(),
  providerTaskId: z.string().max(500).nullable().optional(),
  resultImageId: z.string().refine(isUuid, 'resultImageId must be a UUID').nullable().optional(),
  resultMetadata: z.record(z.string(), z.unknown()).nullable().optional(),
  failureDetails: z.record(z.string(), z.unknown()).nullable().optional(),
  completedAt: z.string().datetime().nullable().optional(),
}).strict()

export interface ImageGenerationAttemptRow {
  id: string
  session_id: string | null
  user_id: string
  project_id: string | null
  production_id: string | null
  sequence: number
  submitted_prompt: string | null
  provider: string | null
  model: string | null
  submitted_config: Record<string, unknown>
  source_snapshot: Record<string, unknown> | null
  client_request_id: string | null
  request_fingerprint: string | null
  status: (typeof ATTEMPT_STATUSES)[number]
  provider_task_id: string | null
  result_image_id: string | null
  result_metadata: Record<string, unknown> | null
  failure_details: Record<string, unknown> | null
  legacy_image_draft_id: string | null
  legacy_attempt_key: string | null
  legacy_evaluation: unknown
  submitted_at: string | null
  completed_at: string | null
  created_at: string
  updated_at: string
}

export const ATTEMPT_COLUMNS = [
  'id', 'session_id', 'user_id', 'project_id', 'production_id', 'sequence', 'submitted_prompt', 'provider', 'model',
  'submitted_config', 'source_snapshot', 'client_request_id', 'request_fingerprint', 'status', 'provider_task_id',
  'result_image_id', 'result_metadata', 'failure_details', 'legacy_image_draft_id', 'legacy_attempt_key',
  'legacy_evaluation', 'submitted_at', 'completed_at', 'created_at', 'updated_at',
].join(',')

export function toAttemptResponse(row: ImageGenerationAttemptRow) {
  return {
    id: row.id,
    sessionId: row.session_id,
    projectId: row.project_id,
    productionId: row.production_id,
    sequence: row.sequence,
    submittedPrompt: row.submitted_prompt,
    provider: row.provider,
    model: row.model,
    submittedConfig: row.submitted_config,
    sourceSnapshot: row.source_snapshot,
    clientRequestId: row.client_request_id,
    status: row.status,
    providerTaskId: row.provider_task_id,
    resultImageId: row.result_image_id,
    resultMetadata: row.result_metadata,
    failureDetails: row.failure_details,
    legacyImageDraftId: row.legacy_image_draft_id,
    legacyAttemptKey: row.legacy_attempt_key,
    legacyEvaluation: row.legacy_evaluation,
    submittedAt: row.submitted_at,
    completedAt: row.completed_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

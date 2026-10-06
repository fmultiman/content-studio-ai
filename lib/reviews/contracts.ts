import { z } from 'zod'

export const REVIEW_STATUSES = ['pending', 'running', 'completed', 'failed'] as const
export const REVIEW_ASSESSMENTS = ['strong', 'mixed', 'needs_revision', 'insufficient_evidence'] as const
export const REVIEW_ORIGINS = ['live', 'legacy_import'] as const

export const ReviewCriterionSchema = z.object({
  key: z.string().min(1).max(120),
  label: z.string().min(1).max(200),
  score: z.number().int().min(0).max(100).nullable(),
  assessment: z.enum(REVIEW_ASSESSMENTS).nullable(),
  evidence: z.array(z.string().max(2_000)).max(20),
  applicable: z.boolean(),
}).strict()

export const ReviewResultV1Schema = z.object({
  schemaVersion: z.literal(1),
  status: z.literal('completed'),
  adapter: z.object({ key: z.string().min(1).max(120), version: z.string().min(1).max(120) }).strict(),
  overall: z.object({ score: z.number().int().min(0).max(100), assessment: z.enum(REVIEW_ASSESSMENTS) }).strict(),
  summary: z.string().max(10_000),
  criteria: z.array(ReviewCriterionSchema).max(20),
  strengths: z.array(z.string().max(2_000)).max(20),
  issues: z.array(z.string().max(2_000)).max(20),
  recommendations: z.array(z.string().max(2_000)).max(20),
  refinedPrompt: z.string().max(20_000).nullable(),
  adapterResult: z.record(z.string(), z.unknown()),
}).strict()

export const ReviewFailureV1Schema = z.object({
  schemaVersion: z.literal(1),
  status: z.literal('failed'),
  code: z.enum([
    'invalid_evaluator_response',
    'provider_error',
    'provider_timeout',
    'media_unavailable',
    'project_identity_invalid',
    'validation_error',
  ]),
  message: z.string().min(1).max(2_000),
}).strict()

export const ReviewRecordSchema = z.object({
  id: z.string().uuid(),
  status: z.enum(REVIEW_STATUSES),
  subject: z.object({ mediaType: z.literal('image'), attemptId: z.string().uuid(), outputId: z.string().uuid(), artifactId: z.string().uuid().nullable() }).strict(),
  projectId: z.string().uuid().nullable(),
  productionId: z.string().uuid().nullable(),
  adapter: z.object({ key: z.string(), version: z.string() }).strict(),
  reviewSchemaVersion: z.literal(1),
  evaluator: z.object({ provider: z.string().nullable(), model: z.string().nullable(), promptVersion: z.string().nullable() }).strict(),
  contextFingerprint: z.string().min(1),
  result: ReviewResultV1Schema.nullable(),
  failure: ReviewFailureV1Schema.nullable(),
  refinedPrompt: z.string().nullable(),
  origin: z.enum(REVIEW_ORIGINS),
  createdAt: z.string(),
  completedAt: z.string().nullable(),
})

export const ReviewRequestSchema = z.object({
  attemptId: z.string().uuid(),
  clientRequestId: z.string().uuid(),
}).strict()

export type ReviewStatus = typeof REVIEW_STATUSES[number]
export type ReviewAssessment = typeof REVIEW_ASSESSMENTS[number]
export type ReviewCriterionV1 = z.infer<typeof ReviewCriterionSchema>
export type ReviewResultV1 = z.infer<typeof ReviewResultV1Schema>
export type ReviewFailureV1 = z.infer<typeof ReviewFailureV1Schema>
export type ReviewRecordV1 = z.infer<typeof ReviewRecordSchema>

export type ImageReviewContext = {
  schemaVersion: 1
  capturedAt: string
  project: {
    id: string | null
    context: string | null
    evaluationMode: string | null
    identity: Record<string, unknown> | null
  }
  production: { id: string; title: string; intention: string; type: string } | null
}

export type ImageReviewSubject = {
  attemptId: string
  outputId: string
  projectId: string | null
  productionId: string | null
  submittedPrompt: string
  provider: string | null
  model: string | null
  submittedConfig: Record<string, unknown>
  sourceSnapshot: Record<string, unknown> | null
  outputUrl: string
  outputStoragePath: string | null
  outputMetadata: Record<string, unknown>
}

export type ImageEvaluatorParsed = {
  score: number
  feedback: string
  improvements: string[]
  refinedPrompt: string | null
  criteria?: Array<z.infer<typeof ReviewCriterionSchema>>
  summary?: string
  strengths?: string[]
  issues?: string[]
  recommendations?: string[]
}

export type ReviewHistoryV1 = {
  items: ReviewRecordV1[]
  latestCompleted: ReviewRecordV1 | null
  latestExecution: ReviewRecordV1 | null
}

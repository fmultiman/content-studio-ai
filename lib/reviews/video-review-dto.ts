// VIDEO_REVIEW_UI_AND_HISTORY_V1
//
// The product-facing shape of a Video Review. Pure (no server imports) so client components can import its
// types and presentation helpers. It carries only what the UI renders: no storage coordinates, no provider
// payload, no prompt version, no context fingerprint, no artifact or source row ids.

import type { ReviewAssessment, ReviewCriterionV1 } from './contracts'
import { toReviewRecord, type MediaReviewRow } from './repository'

export type VideoReviewHistoryItem = {
  id: string
  status: 'pending' | 'running' | 'completed' | 'failed'
  createdAt: string
  completedAt: string | null
  /** Factual execution metadata as persisted (no selector exists; the provider is a server decision). */
  evaluator: { provider: string | null; model: string | null }
  result: null | {
    overall: { score: number; assessment: ReviewAssessment }
    summary: string
    criteria: ReviewCriterionV1[]
    strengths: string[]
    issues: string[]
    recommendations: string[]
    /** A SUGGESTION only. Never applied to a generation, prompt, VideoDraft or any other state. */
    refinedPrompt: string | null
    /** `visual_only` when the adapter evaluated visuals only. Audio is never claimed. */
    analyzed: 'visual_only' | null
  }
  failure: null | { code: string; message: string }
}

export function toVideoReviewHistoryItem(row: MediaReviewRow): VideoReviewHistoryItem {
  const record = toReviewRecord(row)
  const result = record.result
  return {
    id: record.id,
    status: record.status,
    createdAt: record.createdAt,
    completedAt: record.completedAt,
    evaluator: { provider: record.evaluator.provider, model: record.evaluator.model },
    result: result
      ? {
          overall: result.overall,
          summary: result.summary,
          criteria: result.criteria,
          strengths: result.strengths,
          issues: result.issues,
          recommendations: result.recommendations,
          refinedPrompt: result.refinedPrompt,
          analyzed: result.adapterResult?.analyzed === 'visual_only' ? 'visual_only' : null,
        }
      : null,
    failure: record.failure ? { code: record.failure.code, message: record.failure.message } : null,
  }
}

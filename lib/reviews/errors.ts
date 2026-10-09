import { PROVIDER_EXECUTION_DISABLED_CODE, decideProviderExecution } from '@/lib/providers/execution-policy'

export type ReviewErrorCode =
  | 'INVALID_BODY'
  | 'REVIEW_NOT_FOUND'
  | 'REVIEW_SUBJECT_NOT_FOUND'
  | 'REVIEW_OUTPUT_UNAVAILABLE'
  | 'REVIEW_PROJECT_SCOPE_MISMATCH'
  | 'REVIEW_PRODUCTION_SCOPE_MISMATCH'
  | 'REVIEW_IN_PROGRESS'
  | 'REVIEW_IDEMPOTENCY_CONFLICT'
  | 'REVIEW_IDENTITY_INVALID'
  | 'REVIEW_PROVIDER_NOT_CONFIGURED'
  | 'REVIEW_PROVIDER_ERROR'
  | 'REVIEW_PROVIDER_TIMEOUT'
  | 'REVIEW_PROVIDER_UNSUPPORTED'
  | 'REVIEW_INVALID_EVALUATOR_RESPONSE'
  | 'REVIEW_STORE_UNAVAILABLE'
  | 'PROVIDER_EXECUTION_DISABLED_IN_ENVIRONMENT'
  | 'REVIEW_INTERNAL_ERROR'

/**
 * FUTURE-050: Review execution is paid. Called FIRST in every Review execution service, before source resolution,
 * artifact registration or any Review row exists, so a blocked environment leaves no durable execution state and
 * no immutable failed-Review history for an execution that never reached a provider.
 */
export function assertReviewExecutionAllowed(provider: string, operation: 'image_review' | 'video_review'): void {
  const decision = decideProviderExecution({ provider, operation })
  if (decision.allowed) return
  throw new ReviewServiceError(
    403,
    PROVIDER_EXECUTION_DISABLED_CODE,
    `A execução de provedores externos está desativada neste ambiente (${decision.environment}).`,
    { environment: decision.environment, provider },
  )
}

export class ReviewServiceError extends Error {
  readonly status: number
  readonly code: ReviewErrorCode
  readonly details?: Record<string, unknown>

  constructor(status: number, code: ReviewErrorCode, message: string, details?: Record<string, unknown>) {
    super(message)
    this.name = 'ReviewServiceError'
    this.status = status
    this.code = code
    this.details = details
  }
}

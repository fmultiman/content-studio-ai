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
  | 'REVIEW_INVALID_EVALUATOR_RESPONSE'
  | 'REVIEW_STORE_UNAVAILABLE'
  | 'REVIEW_INTERNAL_ERROR'

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

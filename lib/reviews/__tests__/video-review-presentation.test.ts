import { describe, expect, it } from 'vitest'
import {
  ASSESSMENT_LABEL,
  ASSESSMENT_TONE,
  GEMINI_NOT_CONFIGURED_COPY,
  VIDEO_REVIEW_NETWORK_NOTICE,
  describeFailureCode,
  describeVideoReviewError,
  isGenerationReviewable,
  isInFlightReview,
  isLibraryFileReviewable,
  isStaleInFlightReview,
  sourceQuery,
} from '../video-review-presentation'

describe('eligibility', () => {
  it('a generation is reviewable only when completed AND it still has a usable persisted result', () => {
    expect(isGenerationReviewable({ status: 'succeeded', public_url: 'https://signed.example/v.mp4' })).toBe(true)
    expect(isGenerationReviewable({ status: 'succeeded', storage_path: 'u/videos/ai/p/g.mp4' })).toBe(true)
    // Completed but the result is gone or its path was refused by the list route: nothing to review.
    expect(isGenerationReviewable({ status: 'succeeded', storage_path: null, public_url: null })).toBe(false)
    expect(isGenerationReviewable({ status: 'succeeded' })).toBe(false)
    for (const status of ['queued', 'submitted', 'processing', 'failed', undefined, null]) {
      expect(isGenerationReviewable({ status, public_url: 'https://signed.example/v.mp4' })).toBe(false)
    }
  })

  it('a Library file is reviewable only when it is a live video', () => {
    expect(isLibraryFileReviewable({ kind: 'video', deleted_at: null })).toBe(true)
    expect(isLibraryFileReviewable({ kind: 'video' })).toBe(true)
    expect(isLibraryFileReviewable({ kind: 'video', deleted_at: '2026-10-01T00:00:00Z' })).toBe(false)
    for (const kind of ['image', 'audio', 'document', 'other', null, undefined]) {
      expect(isLibraryFileReviewable({ kind, deleted_at: null })).toBe(false)
    }
  })

  it('builds the history query from the typed source only', () => {
    expect(sourceQuery({ kind: 'library_file', id: '00000000-0000-4000-8000-000000000001' })).toBe('kind=library_file&id=00000000-0000-4000-8000-000000000001')
  })
})

describe('in-flight state', () => {
  const now = Date.parse('2026-10-07T12:00:00Z')
  it('knows pending and running, and calls an old in-flight Review possibly interrupted', () => {
    expect(isInFlightReview({ status: 'pending' })).toBe(true)
    expect(isInFlightReview({ status: 'running' })).toBe(true)
    expect(isInFlightReview({ status: 'completed' })).toBe(false)
    expect(isInFlightReview({ status: 'failed' })).toBe(false)
    expect(isStaleInFlightReview({ status: 'running', createdAt: '2026-10-07T11:50:00Z' }, now)).toBe(false)
    // 20 min is still inside the provider execution envelope (FUTURE-046), so it is NOT called interrupted yet.
    expect(isStaleInFlightReview({ status: 'running', createdAt: '2026-10-07T11:40:00Z' }, now)).toBe(false)
    expect(isStaleInFlightReview({ status: 'running', createdAt: '2026-10-07T11:20:00Z' }, now)).toBe(true)
    expect(isStaleInFlightReview({ status: 'completed', createdAt: '2026-10-01T00:00:00Z' }, now)).toBe(false)
  })
})

describe('wording', () => {
  it('words and tones every assessment, with insufficient evidence neutral rather than a failure', () => {
    expect(ASSESSMENT_LABEL).toEqual({ strong: 'Forte', mixed: 'Misto', needs_revision: 'Precisa de revisão', insufficient_evidence: 'Evidência insuficiente' })
    expect(ASSESSMENT_TONE.insufficient_evidence).toBe('neutral')
    expect(ASSESSMENT_TONE.needs_revision).toBe('destructive')
  })
})

describe('describeVideoReviewError', () => {
  const copy = (status: number, code?: string, error?: string) => describeVideoReviewError(status, { code, error })

  it('explains a missing Gemini credential and points to Configurações → API', () => {
    const notice = copy(422, 'REVIEW_PROVIDER_NOT_CONFIGURED')
    expect(notice.kind).toBe('provider_not_configured')
    expect(notice.description).toBe(GEMINI_NOT_CONFIGURED_COPY)
    expect(notice.description).toContain('Configurações → API')
    expect(notice.description).toContain('Gemini')
  })

  it('maps 409 in progress to a controlled, non-error notice', () => {
    expect(copy(409, 'REVIEW_IN_PROGRESS')).toMatchObject({ kind: 'in_progress', title: 'Revisão em andamento' })
    expect(copy(409, 'REVIEW_IDEMPOTENCY_CONFLICT')).toMatchObject({ kind: 'error', definitive: true })
  })

  it('distinguishes the media guardrails instead of one generic message', () => {
    expect(copy(422, 'REVIEW_PROVIDER_UNSUPPORTED', 'Video exceeds the Review size limit (500 MB).').description).toContain('500 MB')
    expect(copy(422, 'REVIEW_PROVIDER_UNSUPPORTED', 'Video exceeds the Review duration limit (10 minutes).').description).toContain('10 minutos')
    expect(copy(422, 'REVIEW_PROVIDER_UNSUPPORTED', 'Video size and duration must be known before Review.').description).toMatch(/medir a duração/)
    expect(copy(422, 'REVIEW_PROVIDER_UNSUPPORTED', 'something else').description).toBe('Este vídeo não é compatível com a revisão.')
  })

  it('maps each backend status/code to specific safe copy', () => {
    const titles = new Set([
      copy(401, 'UNAUTHORIZED').title,
      copy(400, 'INVALID_BODY').title,
      copy(404, 'REVIEW_SUBJECT_NOT_FOUND').title,
      copy(422, 'REVIEW_OUTPUT_UNAVAILABLE').title,
      copy(502, 'REVIEW_INVALID_EVALUATOR_RESPONSE').title,
      copy(502, 'REVIEW_PROVIDER_ERROR').title,
      copy(503, 'REVIEW_STORE_UNAVAILABLE').title,
      copy(504, 'REVIEW_PROVIDER_TIMEOUT').title,
      copy(500, 'REVIEW_INTERNAL_ERROR').title,
    ])
    expect(titles.size).toBe(9)
    expect(copy(401).title).toBe('Sessão expirada')
    expect(copy(404).title).toBe('Vídeo não encontrado')
    expect(copy(504).title).toBe('O Gemini demorou demais')
    expect(copy(502).title).toBe('O Gemini não concluiu a revisão')
    expect(copy(503).title).toBe('Serviço de revisão indisponível')
  })

  it('never echoes a raw server message other than the guardrail reason, and treats every answer as definitive', () => {
    const notice = copy(502, 'REVIEW_PROVIDER_ERROR', 'secret users/abc/library/x/clip.mp4 AIza-key')
    expect(JSON.stringify(notice)).not.toMatch(/secret|users\/abc|AIza/)
    expect(notice.definitive).toBe(true)
    expect(describeVideoReviewError(500, null).definitive).toBe(true)
  })

  it('a dropped connection is NOT definitive, so the request id is kept for a replay', () => {
    expect(VIDEO_REVIEW_NETWORK_NOTICE.definitive).toBe(false)
  })
})

describe('describeFailureCode', () => {
  it('words every persisted failure code', () => {
    const lines = ['invalid_evaluator_response', 'provider_timeout', 'media_unavailable', 'project_identity_invalid', 'provider_error', 'validation_error', 'execution_stale', ''].map(describeFailureCode)
    expect(new Set(lines).size).toBe(7)
    expect(lines.every((line) => line.length > 10)).toBe(true)
  })

  it('words a recovered stale execution as an interruption, never as a Gemini, media or user failure', () => {
    const line = describeFailureCode('execution_stale')
    expect(line).toContain('interrompida')
    expect(line).not.toMatch(/gemini|vídeo|cancel/i)
  })
})

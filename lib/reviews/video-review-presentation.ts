// VIDEO_REVIEW_UI_AND_HISTORY_V1
//
// Pure presentation rules for the Video Review UI: who may be reviewed, how backend outcomes are explained,
// and how an assessment is worded. No server imports, no I/O, so it is trivially testable and client-safe.

import type { ReviewAssessment, VideoReviewSource } from './contracts'
import type { VideoReviewHistoryItem } from './video-review-dto'

/** How often an in-flight Review is re-read while its panel is open. Deliberately slow. */
export const VIDEO_REVIEW_POLL_MS = 15_000
/** After this age an in-flight Review is called out as possibly interrupted (and polling stops). */
export const VIDEO_REVIEW_STALE_MS = 15 * 60_000

// ── Eligibility ────────────────────────────────────────────────────────────

/** A generation can be reviewed only when it completed AND still has a usable persisted video result. */
export function isGenerationReviewable(generation: { status?: string | null; storage_path?: string | null; public_url?: string | null }): boolean {
  return generation.status === 'succeeded' && Boolean(generation.storage_path || generation.public_url)
}

/** A Library file can be reviewed only when it is a live (not trashed) video. */
export function isLibraryFileReviewable(file: { kind?: string | null; deleted_at?: string | null }): boolean {
  return file.kind === 'video' && !file.deleted_at
}

export function sourceQuery(source: VideoReviewSource): string {
  return `kind=${encodeURIComponent(source.kind)}&id=${encodeURIComponent(source.id)}`
}

export function isInFlightReview(item: Pick<VideoReviewHistoryItem, 'status'>): boolean {
  return item.status === 'pending' || item.status === 'running'
}

export function isStaleInFlightReview(item: Pick<VideoReviewHistoryItem, 'status' | 'createdAt'>, nowMs: number): boolean {
  if (!isInFlightReview(item)) return false
  const created = Date.parse(item.createdAt)
  return Number.isFinite(created) && nowMs - created > VIDEO_REVIEW_STALE_MS
}

// ── Wording ────────────────────────────────────────────────────────────────

export const ASSESSMENT_LABEL: Record<ReviewAssessment, string> = {
  strong: 'Forte',
  mixed: 'Misto',
  needs_revision: 'Precisa de revisão',
  insufficient_evidence: 'Evidência insuficiente',
}

export type AssessmentTone = 'success' | 'warning' | 'destructive' | 'neutral'

export const ASSESSMENT_TONE: Record<ReviewAssessment, AssessmentTone> = {
  strong: 'success',
  mixed: 'warning',
  needs_revision: 'destructive',
  insufficient_evidence: 'neutral',
}

// ── Outcomes ───────────────────────────────────────────────────────────────

export type VideoReviewNoticeKind = 'provider_not_configured' | 'in_progress' | 'error'

export type VideoReviewNotice = {
  kind: VideoReviewNoticeKind
  title: string
  description: string
  /** The server definitively answered: the next intentional action needs a new clientRequestId. */
  definitive: boolean
}

export const GEMINI_NOT_CONFIGURED_COPY = 'A API do Google Gemini precisa estar configurada em Configurações → API para revisar vídeos.'

/** A 422 REVIEW_PROVIDER_UNSUPPORTED carries the guardrail reason in its (already safe) message. */
function describeGuardrail(message: string): string {
  if (/size limit/i.test(message)) return 'O vídeo excede o limite de tamanho da revisão (500 MB).'
  if (/duration limit/i.test(message)) return 'O vídeo excede o limite de duração da revisão (10 minutos).'
  if (/must be known/i.test(message)) return 'Não foi possível medir a duração ou o tamanho deste vídeo, então ele ainda não pode ser revisado.'
  return 'Este vídeo não é compatível com a revisão.'
}

/** Maps the backend contract onto honest, specific copy. Never echoes a raw server message except the guardrail reason. */
export function describeVideoReviewError(status: number, payload: { code?: unknown; error?: unknown } | null): VideoReviewNotice {
  const code = typeof payload?.code === 'string' ? payload.code : ''
  const message = typeof payload?.error === 'string' ? payload.error : ''
  const error = (title: string, description: string, definitive = true): VideoReviewNotice => ({ kind: 'error', title, description, definitive })

  if (status === 401 || code === 'UNAUTHORIZED') return error('Sessão expirada', 'Entre novamente para revisar este vídeo.')
  if (code === 'REVIEW_PROVIDER_NOT_CONFIGURED') {
    return { kind: 'provider_not_configured', title: 'Configure o Google Gemini', description: GEMINI_NOT_CONFIGURED_COPY, definitive: true }
  }
  if (code === 'REVIEW_IN_PROGRESS') {
    return { kind: 'in_progress', title: 'Revisão em andamento', description: 'Já existe uma revisão em andamento para este vídeo. Aguarde a conclusão.', definitive: true }
  }
  if (code === 'REVIEW_IDEMPOTENCY_CONFLICT') return error('Solicitação já utilizada', 'Tente revisar novamente.')
  if (code === 'REVIEW_SUBJECT_NOT_FOUND' || status === 404) return error('Vídeo não encontrado', 'O vídeo não existe mais ou você não tem acesso a ele.')
  if (code === 'REVIEW_OUTPUT_UNAVAILABLE') return error('Vídeo indisponível', 'O vídeo ainda não foi concluído ou o arquivo não está disponível para revisão.')
  if (code === 'REVIEW_PROVIDER_UNSUPPORTED') return error('Vídeo fora dos limites da revisão', describeGuardrail(message))
  if (code === 'REVIEW_INVALID_EVALUATOR_RESPONSE') return error('Resposta inválida do Gemini', 'O Gemini devolveu uma resposta que não pôde ser usada. Tente novamente.')
  if (code === 'REVIEW_PROVIDER_TIMEOUT' || status === 504) return error('O Gemini demorou demais', 'A revisão excedeu o tempo limite. Tente novamente em instantes.')
  if (code === 'REVIEW_PROVIDER_ERROR' || status === 502) return error('O Gemini não concluiu a revisão', 'O serviço do Gemini falhou ou está indisponível agora. Tente novamente em instantes.')
  if (code === 'REVIEW_STORE_UNAVAILABLE' || status === 503) return error('Serviço de revisão indisponível', 'Não foi possível acessar o serviço de revisão agora. Tente novamente em instantes.')
  if (code === 'INVALID_BODY' || status === 400) return error('Não foi possível iniciar a revisão', 'Não foi possível identificar o vídeo selecionado.')
  return error('Não foi possível concluir a revisão', 'Tente novamente em instantes.')
}

/** The connection broke before an answer: the outcome is unknown, so the same request id is kept (a retry replays). */
export const VIDEO_REVIEW_NETWORK_NOTICE: VideoReviewNotice = {
  kind: 'error',
  title: 'Falha de conexão',
  description: 'Não foi possível confirmar se a revisão foi iniciada. Atualize o histórico antes de tentar de novo.',
  definitive: false,
}

/** Explains a persisted failed Review from its normalized failure code. */
export function describeFailureCode(code: string): string {
  switch (code) {
    case 'invalid_evaluator_response': return 'O Gemini devolveu uma resposta inválida.'
    case 'provider_timeout': return 'O Gemini demorou demais para responder.'
    case 'media_unavailable': return 'O arquivo de vídeo não pôde ser lido ou mudou desde o registro.'
    case 'project_identity_invalid': return 'A identidade do Project é inválida para esta revisão.'
    case 'provider_error': return 'O Gemini não concluiu a revisão (ou a API Gemini não está configurada).'
    default: return 'A revisão não pôde ser concluída.'
  }
}

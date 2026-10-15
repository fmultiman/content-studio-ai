// STRUCTURAL_WAVE_0 (D9)
//
// How a video generation's STATUS is presented. Pure and client-safe. The stored value (`video_generations.status`, the API
// payload, the polling rules in status-refresh.ts) is NEVER changed: this module only maps it to a pt-BR label and a tone, so every
// surface (hub, Production, workspace history) says the same thing, and the hub filter is built from the same list.
//
// The database contract (scripts/039_create_video_generations.sql): queued | submitted | processing | succeeded | failed.
// `cancelled` is not stored today but the workspace already treats it defensively, so it has a label instead of leaking English.

export const VIDEO_GENERATION_STATUSES = ['queued', 'submitted', 'processing', 'succeeded', 'failed'] as const
export type VideoGenerationStatus = (typeof VIDEO_GENERATION_STATUSES)[number]

export type GenerationStatusTone = 'neutral' | 'info' | 'warning' | 'success' | 'danger'

export interface GenerationStatusPresentation {
  label: string
  tone: GenerationStatusTone
}

/** A Session with no Attempt yet has no generation status; it is its own, honest state in the hub. */
export const NO_ATTEMPTS_STATUS = 'no_attempts'

/** Creative Editor drafts carry this label as their hub status (lib/draft-hub.ts buildVideoDraftHubCards). */
export const VIDEO_DRAFT_HUB_STATUS = 'Rascunho'

const PRESENTATION: Readonly<Record<string, GenerationStatusPresentation>> = Object.freeze({
  queued: { label: 'Na fila', tone: 'neutral' },
  submitted: { label: 'Enviado', tone: 'info' },
  processing: { label: 'Processando', tone: 'warning' },
  succeeded: { label: 'Concluído', tone: 'success' },
  failed: { label: 'Falhou', tone: 'danger' },
  cancelled: { label: 'Cancelado', tone: 'neutral' },
  [NO_ATTEMPTS_STATUS]: { label: 'Sem tentativas', tone: 'neutral' },
})

/**
 * Label and tone of a stored generation status. A value this build does not know is shown as-is (neutral) rather than hidden or
 * mapped to a state it might not be; a missing value reads "Sem status".
 */
export function describeGenerationStatus(status: string | null | undefined): GenerationStatusPresentation {
  if (typeof status !== 'string' || status.trim() === '') return { label: 'Sem status', tone: 'neutral' }
  return Object.prototype.hasOwnProperty.call(PRESENTATION, status) ? PRESENTATION[status] : { label: status, tone: 'neutral' }
}

/** The status a Session card carries in the hub: the latest Attempt's stored status, or NO_ATTEMPTS_STATUS. */
export function sessionHubStatus(latestAttempt: { status?: string | null } | null | undefined): string {
  return latestAttempt?.status ? latestAttempt.status : NO_ATTEMPTS_STATUS
}

export interface HubStatusFilterOption {
  value: string
  label: string
}

/**
 * Options of the /videos status filter. It covers BOTH kinds of card the hub lists - Creative Editor drafts ("Rascunho") and AI
 * generations (every real state) - so choosing a state never hides a kind that can actually have it by accident.
 */
export function videoHubStatusFilterOptions(): HubStatusFilterOption[] {
  return [
    { value: VIDEO_DRAFT_HUB_STATUS, label: VIDEO_DRAFT_HUB_STATUS },
    ...VIDEO_GENERATION_STATUSES.map((status) => ({ value: status, label: PRESENTATION[status].label })),
    { value: NO_ATTEMPTS_STATUS, label: PRESENTATION[NO_ATTEMPTS_STATUS].label },
  ]
}

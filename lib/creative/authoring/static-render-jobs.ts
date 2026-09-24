/**
 * Static Render Worker V1 — Creative Editor render-job state (pure).
 *
 * "Gerar PNG" is now asynchronous: enqueue -> queued -> rendering (claimed
 * by the VPS worker) -> ready | failed. Jobs are keyed by the ORIGINATING
 * slide id and updated by EXECUTION id — never by whichever slide happens
 * to be selected when a poll response lands — so switching slides while a
 * render runs can never rebind a result to the wrong slide.
 *
 * UI state only: nothing here enters authoring state, persisted slides or
 * the render request.
 */
import type { RenderExecutionSummary } from '@/lib/types'

export type StaticRenderPhase = 'enqueuing' | 'queued' | 'rendering' | 'ready' | 'failed'

export type StaticRenderJob = {
  slideId: string
  slideIndex: number
  slideTotal: number
  executionId: string | null
  phase: StaticRenderPhase
  errorMessage: string | null
  /** Presigned, short-lived display URL for a ready PNG (from output-url). */
  imageUrl: string | null
  save: 'idle' | 'saving' | 'saved' | 'error'
  saveError: string | null
  /** Client clock, for the "PNG pronto · Ns" readout only. */
  startedAt: number
  finishedAt: number | null
  /**
   * Authoring Usability Completion V1 — the slide's authored state this render
   * stands for: the exact state at "Gerar PNG" for a render started in this
   * session, or the state at load for a hydrated one (any later edit is then
   * provably absent from it). `null` = unknown, never shown as stale.
   */
  authoredSignature: string | null
}

export type StaticRenderJobs = Readonly<Record<string, StaticRenderJob>>

export function isActiveRenderPhase(phase: StaticRenderPhase): boolean {
  return phase === 'enqueuing' || phase === 'queued' || phase === 'rendering'
}

export function phaseFromExecutionStatus(status: RenderExecutionSummary['status']): StaticRenderPhase {
  if (status === 'queued') return 'queued'
  if (status === 'claimed') return 'rendering'
  if (status === 'completed') return 'ready'
  return 'failed'
}

export function renderPhaseLabel(phase: StaticRenderPhase): string {
  switch (phase) {
    case 'enqueuing': return 'Enfileirando…'
    case 'queued': return 'Na fila…'
    case 'rendering': return 'Renderizando…'
    case 'ready': return 'PNG pronto'
    case 'failed': return 'Falha ao gerar PNG'
  }
}

/** Safe, user-facing failure text — never a stack trace or internal detail. */
export function safeRenderErrorMessage(execution: Pick<RenderExecutionSummary, 'error_message' | 'error_code'> | null | undefined): string {
  const message = execution?.error_message?.trim()
  if (message) return message.slice(0, 160)
  return 'O render nao foi concluido. Tente novamente.'
}

/**
 * True when the slide's current authored state is not what its visible render
 * represents ("Alterações ainda não renderizadas"). Only for a finished render
 * with a known signature; never auto-re-renders and never invalidates storage.
 */
export function isRenderStale(job: StaticRenderJob | undefined, currentSignature: string): boolean {
  return Boolean(job && job.phase === 'ready' && job.authoredSignature !== null && job.authoredSignature !== currentSignature)
}

export function startRenderJob(jobs: StaticRenderJobs, slide: { id: string; index: number; total: number }, now: number, authoredSignature: string | null = null): StaticRenderJobs {
  return {
    ...jobs,
    [slide.id]: {
      slideId: slide.id,
      slideIndex: slide.index,
      slideTotal: slide.total,
      executionId: null,
      phase: 'enqueuing',
      errorMessage: null,
      imageUrl: null,
      save: 'idle',
      saveError: null,
      startedAt: now,
      finishedAt: null,
      authoredSignature,
    },
  }
}

/** Enqueue response: binds the new execution id to the slide that asked for it. */
export function attachExecution(jobs: StaticRenderJobs, slideId: string, executionId: string, status: RenderExecutionSummary['status']): StaticRenderJobs {
  const job = jobs[slideId]
  if (!job || job.phase !== 'enqueuing') return jobs
  return { ...jobs, [slideId]: { ...job, executionId, phase: phaseFromExecutionStatus(status) } }
}

export function failEnqueue(jobs: StaticRenderJobs, slideId: string, message: string, now: number): StaticRenderJobs {
  const job = jobs[slideId]
  if (!job) return jobs
  return { ...jobs, [slideId]: { ...job, phase: 'failed', errorMessage: message.slice(0, 160), finishedAt: now } }
}

/**
 * Poll response: updates ONLY the job whose executionId matches — found by
 * id, not by slide selection. A stale response for an execution no longer
 * tracked (e.g. superseded by a newer render of that slide) is ignored.
 */
export function applyExecutionUpdate(jobs: StaticRenderJobs, execution: Pick<RenderExecutionSummary, 'id' | 'status' | 'error_message' | 'error_code'>, now: number): StaticRenderJobs {
  const entry = Object.entries(jobs).find(([, job]) => job.executionId === execution.id)
  if (!entry) return jobs
  const [slideId, job] = entry
  const phase = phaseFromExecutionStatus(execution.status)
  if (phase === job.phase) return jobs
  return {
    ...jobs,
    [slideId]: {
      ...job,
      phase,
      errorMessage: phase === 'failed' ? safeRenderErrorMessage(execution) : null,
      finishedAt: phase === 'ready' || phase === 'failed' ? now : null,
    },
  }
}

export function patchJobByExecution(jobs: StaticRenderJobs, executionId: string, patch: Partial<Pick<StaticRenderJob, 'imageUrl' | 'save' | 'saveError'>>): StaticRenderJobs {
  const entry = Object.entries(jobs).find(([, job]) => job.executionId === executionId)
  if (!entry) return jobs
  const [slideId, job] = entry
  return { ...jobs, [slideId]: { ...job, ...patch } }
}

export function activeExecutionIds(jobs: StaticRenderJobs): string[] {
  return Object.values(jobs)
    .filter((job) => job.executionId && (job.phase === 'queued' || job.phase === 'rendering'))
    .map((job) => job.executionId as string)
}

/**
 * Refresh/reopen hydration: newest execution per originating slide, only for
 * slides that still exist in the editor. Never overwrites a job the editor
 * already tracks this session.
 */
export function hydrateRenderJobs(
  jobs: StaticRenderJobs,
  executions: readonly (Pick<RenderExecutionSummary, 'id' | 'status' | 'queued_at' | 'completed_at' | 'failed_at' | 'error_message' | 'error_code' | 'slide' | 'attached_to_piece'>)[],
  existingSlideIds: ReadonlySet<string>,
  /** Slide id -> authored signature at load: the baseline a hydrated render is compared against. */
  signaturesAtLoad: Readonly<Record<string, string>> = {},
): StaticRenderJobs {
  const next: Record<string, StaticRenderJob> = { ...jobs }
  const newestFirst = [...executions].sort((a, b) => Date.parse(b.queued_at) - Date.parse(a.queued_at))
  for (const execution of newestFirst) {
    const slide = execution.slide
    if (!slide || !existingSlideIds.has(slide.id) || next[slide.id]) continue
    const phase = phaseFromExecutionStatus(execution.status)
    const finished = execution.completed_at ?? execution.failed_at
    next[slide.id] = {
      slideId: slide.id,
      slideIndex: slide.index,
      slideTotal: slide.total,
      executionId: execution.id,
      phase,
      errorMessage: phase === 'failed' ? safeRenderErrorMessage(execution) : null,
      imageUrl: null,
      // Server-authoritative: this execution's PNG is already attached to the piece.
      save: execution.attached_to_piece ? 'saved' : 'idle',
      saveError: null,
      startedAt: Date.parse(execution.queued_at),
      finishedAt: finished ? Date.parse(finished) : null,
      authoredSignature: signaturesAtLoad[slide.id] ?? null,
    }
  }
  return next
}

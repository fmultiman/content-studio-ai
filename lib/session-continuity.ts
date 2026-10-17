// STRUCTURAL_WAVE_1A1 - CANONICAL SESSION CONTINUITY V1
//
// One pure, client-safe place for the rules that make the Dashboard and the Production workspace agree about CONTINUITY:
//
//   * Generation SESSIONS are the canonical unit of continuity for Images and Videos.
//   * An ImageDraft is a generation legacy: it never competes with the Session that already carries it.
//   * A VideoDraft stays a legitimate Creative Editor authoring entity (its own destination, its own counter).
//   * Session, Attempt, Draft and Output are DIFFERENT entities: nothing here sums them into one number.
//
// No I/O, no environment, no provider knowledge. Scope (user / Project / Production) is enforced by the callers' queries and, again,
// defensively by the builders that take rows from a list endpoint.

import { describeGenerationStatus } from '@/lib/video-generation/status-presentation'

// -- Canonical destinations ------------------------------------------------------------------------------------------------------

/** ImageGenerationSession -> its canonical workspace. */
export const imageSessionHref = (sessionId: string) => `/imagens/geracoes/${sessionId}`
/** VideoGenerationSession -> its canonical workspace. */
export const videoSessionHref = (sessionId: string) => `/videos/geracoes/${sessionId}`

export type ContinuityTone = 'neutral' | 'positive' | 'success' | 'info' | 'warning' | 'danger'

export interface ContinuityStatus {
  label: string
  tone: ContinuityTone
}

// -- Image sessions --------------------------------------------------------------------------------------------------------------

/** The status an Image session carries in its working state (`working_state.imageStatus`). */
export function imageSessionStatus(imageStatus: string | null | undefined): ContinuityStatus {
  if (imageStatus === 'approved') return { label: 'Aprovada', tone: 'positive' }
  if (imageStatus === 'generating') return { label: 'Gerando', tone: 'warning' }
  if (imageStatus === 'rejected') return { label: 'Rejeitada', tone: 'danger' }
  return { label: 'Rascunho', tone: 'neutral' }
}

export function normalizeText(value: string | null | undefined): string | null {
  const trimmed = value?.trim().replace(/\s+/g, ' ') ?? ''
  return trimmed || null
}

/** Same fallback the hub card uses: name, then the working prompt, then an honest "no description". */
export function imageSessionTitle(session: { name?: string | null; workingPrompt?: string | null }): string {
  return normalizeText(session.name) ?? normalizeText(session.workingPrompt)?.slice(0, 72) ?? 'Geração sem descrição'
}

/** `archived` Sessions are out of continuity (nothing writes that state today; this keeps the rule explicit). */
export function isActiveSession(session: { status?: string | null }): boolean {
  return session.status !== 'archived'
}

// -- Legacy ImageDraft de-duplication ----------------------------------------------------------------------------------------------

/**
 * Ids of the legacy ImageDrafts that a Session already carries (`legacy_image_draft_id`). Archived Sessions count too: a draft whose
 * work lives in an archived Session must not resurface as new continuity. `extra` adds ids a caller resolved with a lookup.
 */
export function linkedImageDraftIds(
  sessions: ReadonlyArray<{ legacyImageDraftId?: string | null }>,
  extra: Iterable<string> = [],
): Set<string> {
  const ids = new Set<string>(extra)
  for (const session of sessions) {
    if (session.legacyImageDraftId) ids.add(session.legacyImageDraftId)
  }
  return ids
}

/** The drafts that are NOT carried by a Session: the only legacy items that still deserve their own place. */
export function excludeLinkedImageDrafts<T extends { id: string }>(drafts: readonly T[], linked: ReadonlySet<string>): T[] {
  return drafts.filter((draft) => !linked.has(draft.id))
}

// -- Counters ----------------------------------------------------------------------------------------------------------------------

/**
 * What a Production holds, by entity. Each number counts ONE kind of thing and is never added to another:
 *   imageSessions  active Image generation sessions
 *   videoSessions  Video generation sessions
 *   videoDrafts    VideoDrafts (Creative Editor edits)
 *   editorial      Editorial contents
 * `null` = unknown (the count could not be read): it is named as unavailable in the text, never shown as 0.
 */
export interface ProductionCounters {
  imageSessions: number | null
  videoSessions: number | null
  videoDrafts: number | null
  editorial: number | null
}

const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`

const COUNTER_CATEGORIES = [
  { key: 'imageSessions', one: 'sessão de imagem', many: 'sessões de imagem' },
  { key: 'videoSessions', one: 'sessão de vídeo', many: 'sessões de vídeo' },
  { key: 'videoDrafts', one: 'edição de vídeo', many: 'edições de vídeo' },
  { key: 'editorial', one: 'conteúdo', many: 'conteúdos' },
] as const satisfies ReadonlyArray<{ key: keyof ProductionCounters; one: string; many: string }>

/**
 * Text for the counters, entity by entity. It only ever speaks about the four categories above:
 *   - a category that could not be read is NAMED as unavailable, so a partial count never looks complete;
 *   - when every counted category is 0 it says so by name, because legacy ImageDrafts no Session carries and standalone historical
 *     video generations are not part of these counters, so "nothing linked" would be a claim this count cannot make.
 */
export function describeProductionCounters(counters: ProductionCounters): string {
  const known = COUNTER_CATEGORIES.filter((category) => counters[category.key] !== null)
  const unavailable = COUNTER_CATEGORIES.filter((category) => counters[category.key] === null)
  if (known.length === 0) return 'Contagem indisponível'

  const positives = known.filter((category) => (counters[category.key] ?? 0) > 0)
  const shown = positives.length > 0 ? positives : unavailable.length > 0 ? known : []
  const parts = shown.map((category) => plural(counters[category.key] ?? 0, category.one, category.many))

  if (unavailable.length > 0) return `${parts.join(' · ')} · sem contagem de: ${unavailable.map((category) => category.many).join(', ')}`
  if (parts.length > 0) return parts.join(' · ')
  return 'Sem sessões de imagem, sessões de vídeo, edições de vídeo ou conteúdos. Rascunhos legados de imagem e gerações de vídeo avulsas não entram nesta contagem.'
}

/** Production overview, Images: sessions are the canonical count; legacy drafts no session carries are named as such. */
export function describeOverviewImages({ sessions, legacyDrafts, hasMore = false }: { sessions: number; legacyDrafts: number; hasMore?: boolean }): string {
  const parts: string[] = []
  if (sessions > 0) parts.push(`${sessions}${hasMore ? '+' : ''} ${sessions === 1 ? 'sessão de imagem' : 'sessões de imagem'}`)
  if (legacyDrafts > 0) parts.push(plural(legacyDrafts, 'rascunho legado', 'rascunhos legados'))
  return parts.length > 0 ? parts.join(' · ') : hasMore ? 'Lista parcial de sessões de imagem' : 'Sem imagens vinculadas'
}

/** Production overview, Videos: generation sessions, Creative Editor edits and standalone historical generations, each on its own. */
export function describeOverviewVideos({
  sessions,
  drafts,
  standaloneGenerations,
  sessionsHasMore = false,
}: {
  sessions: number
  drafts: number
  standaloneGenerations: number
  sessionsHasMore?: boolean
}): string {
  const parts: string[] = []
  if (sessions > 0) parts.push(`${sessions}${sessionsHasMore ? '+' : ''} ${sessions === 1 ? 'sessão de geração' : 'sessões de geração'}`)
  if (drafts > 0) parts.push(plural(drafts, 'edição de vídeo', 'edições de vídeo'))
  if (standaloneGenerations > 0) parts.push(plural(standaloneGenerations, 'geração avulsa (histórico)', 'gerações avulsas (histórico)'))
  return parts.length > 0 ? parts.join(' · ') : 'Sem vídeos vinculados'
}

// -- Video session status (the latest Attempt's STORED status, presented in Portuguese) -------------------------------------------

export function videoSessionStatus(latestAttemptStatus: string | null | undefined): ContinuityStatus & { stored: string } {
  const stored = latestAttemptStatus ? latestAttemptStatus : 'no_attempts'
  const { label, tone } = describeGenerationStatus(stored)
  return { label, tone, stored }
}

// -- Production workspace: Images tab ---------------------------------------------------------------------------------------------

export interface ProductionImageSessionInput {
  id: string
  projectId: string | null
  productionId: string | null
  name?: string | null
  workingPrompt?: string | null
  workingState?: { imageStatus?: string | null } | null
  status?: string | null
  legacyImageDraftId?: string | null
  updatedAt: string
  thumbnailUrl?: string | null
}

export interface ProductionImageSessionItem {
  id: string
  title: string
  status: ContinuityStatus
  updatedAt: string
  thumbnailUrl: string | null
  href: string
}

export interface ProductionLegacyImageDraft {
  id: string
  project_id?: string | null
  production_id?: string | null
  name?: string | null
  user_input?: string | null
  image_status?: string | null
  updated_at: string
}

const byUpdatedDesc = (a: { updatedAt: string }, b: { updatedAt: string }) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()

/**
 * The Images tab of ONE Production:
 *  - the canonical Sessions (active, and strictly this Project AND this Production - a row from a list endpoint is re-checked here,
 *    so a Session is never attributed to a Production it does not carry);
 *  - the legacy ImageDrafts that no Session carries (a draft carried by a Session is NOT shown a second time).
 */
export function buildProductionImageContinuity({
  sessions,
  legacyDrafts,
  projectId,
  productionId,
  linkedLegacyDraftIds: extraLinked = [],
}: {
  sessions: readonly ProductionImageSessionInput[]
  legacyDrafts: readonly ProductionLegacyImageDraft[]
  projectId: string
  productionId: string
  linkedLegacyDraftIds?: Iterable<string>
}): { sessions: ProductionImageSessionItem[]; legacyDrafts: ProductionLegacyImageDraft[]; hiddenLegacyDrafts: number } {
  const inScope = sessions.filter((session) => session.projectId === projectId && session.productionId === productionId)
  const linked = linkedImageDraftIds(inScope, extraLinked)
  const visibleLegacy = excludeLinkedImageDrafts(legacyDrafts.filter((draft) => draft.project_id === projectId && draft.production_id === productionId), linked)
  return {
    sessions: inScope
      .filter(isActiveSession)
      .map((session) => ({
        id: session.id,
        title: imageSessionTitle(session),
        status: imageSessionStatus(session.workingState?.imageStatus),
        updatedAt: session.updatedAt,
        thumbnailUrl: session.thumbnailUrl ?? null,
        href: imageSessionHref(session.id),
      }))
      .sort(byUpdatedDesc),
    legacyDrafts: [...visibleLegacy].sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime()),
    hiddenLegacyDrafts: legacyDrafts.length - visibleLegacy.length,
  }
}

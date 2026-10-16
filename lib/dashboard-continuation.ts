import { videoCreativeEditorHref } from '@/lib/creative/video-editor/video-routes'
import {
  getIdentityStatusLabel,
  resolveInheritedIdentitySummary,
} from '@/lib/inherited-project-identity'
import {
  excludeLinkedImageDrafts,
  imageSessionHref,
  imageSessionStatus,
  imageSessionTitle,
  isActiveSession,
  linkedImageDraftIds,
  normalizeText,
  videoSessionHref,
  videoSessionStatus,
  type ContinuityTone,
  type ProductionCounters,
} from '@/lib/session-continuity'
import type {
  EditorialContentStatus,
  Project,
  Production,
} from '@/lib/types'
import { resolveProductionDisplay } from '@/lib/ux-production-hardening'

export type DashboardProject = Pick<
  Project,
  'id' | 'name' | 'description' | 'context' | 'identity' | 'updated_at'
>

export type DashboardProduction = Pick<
  Production,
  'id' | 'project_id' | 'title' | 'intention' | 'type' | 'updated_at'
>

/** Visual family of a continuity item (icon). The ENTITY is `DashboardWorkEntity`. */
export type DashboardDraftKind = 'image' | 'video' | 'editorial'

/**
 * What a continuity item really is. These are different entities and are never merged:
 *   image_session  ImageGenerationSession  -> /imagens/geracoes/[id]
 *   image_draft    legacy ImageDraft that NO session carries -> /imagens?draft=...
 *   video_session  VideoGenerationSession  -> /videos/geracoes/[id]
 *   video_draft    VideoDraft (Creative Editor) -> /creative-editor/video/[id]
 *   editorial      EditorialContent -> /projetos/[id]/conteudos/[id]
 */
export type DashboardWorkEntity = 'image_session' | 'image_draft' | 'video_session' | 'video_draft' | 'editorial'

export type DashboardImageDraft = {
  id: string
  project_id: string | null
  production_id: string | null
  name: string | null
  user_input?: string | null
  image_status?: string | null
  updated_at: string
}

/** Image generation session columns the Dashboard reads (`image_status` is `working_state->>imageStatus`). */
export type DashboardImageSession = {
  id: string
  project_id: string | null
  production_id: string | null
  name: string | null
  working_prompt?: string | null
  image_status?: string | null
  status?: string | null
  legacy_image_draft_id?: string | null
  updated_at: string
}

export type DashboardVideoDraft = {
  id: string
  project_id: string | null
  production_id: string | null
  name: string | null
  updated_at: string
}

/** Video generation session columns the Dashboard reads (scope is mandatory for these rows). */
export type DashboardVideoSession = {
  id: string
  project_id: string
  production_id: string
  working_prompt?: string | null
  updated_at: string
}

export type DashboardEditorialContent = {
  id: string
  project_id: string
  production_id: string | null
  title: string
  status: EditorialContentStatus
  updated_at: string
}

export type RecentProductionCard = {
  id: string
  projectId: string
  href: string
  title: string
  projectName: string
  intention: string
  type: string
  updatedAt: string
  activityAt: string
  /** One number per entity (see ProductionCounters); never a sum of different things. */
  counters: ProductionCounters
}

export type RecentWorkItem = {
  id: string
  type: DashboardDraftKind
  entity: DashboardWorkEntity
  label: string
  title: string
  projectName: string
  productionName: string | null
  status: string
  statusTone: ContinuityTone
  updatedAt: string
  /** Canonical destination, specific to the nature of the item. */
  href: string
}

export type RecentProjectCard = {
  id: string
  href: string
  name: string
  description: string | null
  updatedAt: string
  productionCount: number | null
  identityLabel: string
}

export type DashboardEmptyStateKind =
  | 'no-projects'
  | 'no-productions'
  | 'no-recent-items'

export type DashboardEmptyState = {
  kind: DashboardEmptyStateKind
  title: string
  description: string
  actionLabel: string
  href: string
}

/** Rows of one Production's own scope: its Production id AND its Project id (a mismatched row is never attributed to it). */
function inProductionScope<T extends { project_id: string | null; production_id: string | null }>(items: readonly T[], production: DashboardProduction) {
  return items.filter((item) => item.production_id === production.id && item.project_id === production.project_id)
}

/**
 * `counters` (exact, from per-Production count queries) wins when the caller has it. Without it, the counters are derived from the
 * rows provided - which are only a recent slice - so the Dashboard page always passes exact counters.
 */
export function buildRecentProductions({
  productions,
  projects,
  imageDrafts,
  videoDrafts,
  editorialContents,
  imageSessions = [],
  videoSessions = [],
  linkedImageDraftIds: extraLinkedImageDraftIds = [],
  counters,
  limit = 4,
}: {
  productions: DashboardProduction[]
  projects: DashboardProject[]
  imageDrafts: DashboardImageDraft[]
  videoDrafts: DashboardVideoDraft[]
  editorialContents: DashboardEditorialContent[]
  imageSessions?: DashboardImageSession[]
  videoSessions?: DashboardVideoSession[]
  linkedImageDraftIds?: Iterable<string>
  counters?: ReadonlyMap<string, ProductionCounters>
  limit?: number
}): RecentProductionCard[] {
  const projectById = mapById(projects)
  const activeImageSessions = imageSessions.filter(isActiveSession)
  const legacyDrafts = excludeLinkedImageDrafts(
    imageDrafts,
    linkedImageDraftIds(imageSessions.map((session) => ({ legacyImageDraftId: session.legacy_image_draft_id })), extraLinkedImageDraftIds),
  )

  return productions
    .map((production) => {
      const project = projectById.get(production.project_id)
      const projectName = project?.name ?? 'Project'
      const display = resolveProductionDisplay({
        title: production.title,
        intention: production.intention,
        projectName,
      })
      const relatedImageSessions = inProductionScope(activeImageSessions, production)
      const relatedLegacyDrafts = inProductionScope(legacyDrafts, production)
      const relatedVideoSessions = inProductionScope(videoSessions, production)
      const relatedVideoDrafts = inProductionScope(videoDrafts, production)
      const relatedEditorial = inProductionScope(editorialContents, production)
      const activityAt = latestDate([
        production.updated_at,
        ...relatedImageSessions.map((item) => item.updated_at),
        ...relatedLegacyDrafts.map((item) => item.updated_at),
        ...relatedVideoSessions.map((item) => item.updated_at),
        ...relatedVideoDrafts.map((item) => item.updated_at),
        ...relatedEditorial.map((item) => item.updated_at),
      ])

      return {
        id: production.id,
        projectId: production.project_id,
        href: productionPath(production.project_id, production.id),
        title: display.title,
        projectName,
        intention: display.intention,
        type: production.type,
        updatedAt: production.updated_at,
        activityAt,
        counters: counters?.get(production.id) ?? {
          imageSessions: relatedImageSessions.length,
          videoSessions: relatedVideoSessions.length,
          videoDrafts: relatedVideoDrafts.length,
          editorial: relatedEditorial.length,
        },
      }
    })
    .sort((a, b) => compareDateDesc(a.activityAt, b.activityAt))
    .slice(0, limit)
}

export function buildRecentWorkItems({
  imageDrafts,
  videoDrafts,
  editorialContents,
  projects,
  productions,
  imageSessions = [],
  videoSessions = [],
  linkedImageDraftIds: extraLinkedImageDraftIds = [],
  videoSessionLatestStatus = {},
  limit = 6,
}: {
  imageDrafts: DashboardImageDraft[]
  videoDrafts: DashboardVideoDraft[]
  editorialContents: DashboardEditorialContent[]
  projects: DashboardProject[]
  productions: DashboardProduction[]
  imageSessions?: DashboardImageSession[]
  videoSessions?: DashboardVideoSession[]
  /** Legacy ImageDraft ids that a lookup found carried by a Session (even one outside `imageSessions`). */
  linkedImageDraftIds?: Iterable<string>
  /** Stored status of each video Session's latest Attempt (`null` = it has none). A missing key = unknown. */
  videoSessionLatestStatus?: Readonly<Record<string, string | null>>
  limit?: number
}): RecentWorkItem[] {
  const projectById = mapById(projects)
  const productionById = mapById(productions)
  const productionName = (productionId: string | null, projectId: string | null) => {
    if (!productionId) return null
    const production = productionById.get(productionId)
    if (!production) return 'Production'
    if (production.project_id !== projectId) return null
    const project = projectById.get(production.project_id)
    return resolveProductionDisplay({
      title: production.title,
      intention: production.intention,
      projectName: project?.name,
    }).title
  }

  const imageSessionItems: RecentWorkItem[] = imageSessions.filter(isActiveSession).map((session) => {
    const status = imageSessionStatus(session.image_status)
    return {
      id: session.id,
      type: 'image',
      entity: 'image_session',
      label: 'Sessão de imagem',
      title: imageSessionTitle({ name: session.name, workingPrompt: session.working_prompt }),
      projectName: getProjectName(projectById, session.project_id),
      productionName: productionName(session.production_id, session.project_id),
      status: status.label,
      statusTone: status.tone,
      updatedAt: session.updated_at,
      href: imageSessionHref(session.id),
    }
  })

  const linked = linkedImageDraftIds(
    imageSessions.map((session) => ({ legacyImageDraftId: session.legacy_image_draft_id })),
    extraLinkedImageDraftIds,
  )
  // A legacy draft that a Session carries is the SAME work: it is not listed a second time.
  const legacyImageItems: RecentWorkItem[] = excludeLinkedImageDrafts(imageDrafts, linked).map((draft) => {
    const status = imageSessionStatus(draft.image_status)
    return {
      id: draft.id,
      type: 'image',
      entity: 'image_draft',
      label: 'Rascunho de imagem',
      title: getDraftTitle(draft.name, draft.user_input, 'Rascunho de imagem'),
      projectName: getProjectName(projectById, draft.project_id),
      productionName: productionName(draft.production_id, draft.project_id),
      status: status.label,
      statusTone: status.tone,
      updatedAt: draft.updated_at,
      href:
        draft.project_id && draft.production_id
          ? `/imagens?draft=${draft.id}&project=${draft.project_id}&production=${draft.production_id}`
          : `/imagens?draft=${draft.id}`,
    }
  })

  const videoSessionItems: RecentWorkItem[] = videoSessions.map((session) => {
    const known = Object.prototype.hasOwnProperty.call(videoSessionLatestStatus, session.id)
    const status = known
      ? videoSessionStatus(videoSessionLatestStatus[session.id])
      : { label: 'Sem status', tone: 'neutral' as const }
    return {
      id: session.id,
      type: 'video',
      entity: 'video_session',
      label: 'Sessão de vídeo',
      title: getDraftTitle(null, session.working_prompt, 'Sessão de geração de vídeo'),
      projectName: getProjectName(projectById, session.project_id),
      productionName: productionName(session.production_id, session.project_id),
      status: status.label,
      statusTone: status.tone,
      updatedAt: session.updated_at,
      href: videoSessionHref(session.id),
    }
  })

  const videoDraftItems: RecentWorkItem[] = videoDrafts.map((draft) => ({
    id: draft.id,
    type: 'video',
    entity: 'video_draft',
    label: 'Edição de vídeo',
    title: getDraftTitle(draft.name, null, 'Rascunho de vídeo'),
    projectName: getProjectName(projectById, draft.project_id),
    productionName: productionName(draft.production_id, draft.project_id),
    status: 'Rascunho',
    statusTone: 'neutral',
    updatedAt: draft.updated_at,
    // VideoDraft single writer: continue in the canonical Creative Editor.
    href: videoCreativeEditorHref(draft.id),
  }))

  const editorialItems: RecentWorkItem[] = editorialContents.map((content) => ({
    id: content.id,
    type: 'editorial',
    entity: 'editorial',
    label: 'Conteúdo',
    title: normalizeText(content.title) || 'Conteúdo editorial',
    projectName: getProjectName(projectById, content.project_id),
    productionName: productionName(content.production_id, content.project_id),
    status: editorialStatusLabel(content.status),
    statusTone: content.status === 'ready' ? 'positive' : 'neutral',
    updatedAt: content.updated_at,
    href: `/projetos/${content.project_id}/conteudos/${content.id}`,
  }))

  return [...imageSessionItems, ...legacyImageItems, ...videoSessionItems, ...videoDraftItems, ...editorialItems]
    .sort((a, b) => compareDateDesc(a.updatedAt, b.updatedAt))
    .slice(0, limit)
}

export function buildRecentProjects({
  projects,
  productions,
  limit = 4,
}: {
  projects: DashboardProject[]
  productions: DashboardProduction[]
  limit?: number
}): RecentProjectCard[] {
  return projects
    .map((project) => {
      const identitySummary = resolveInheritedIdentitySummary({
        identity: project.identity,
        projectName: project.name,
        hasLegacyContext: Boolean(project.context?.trim()),
      })

      return {
        id: project.id,
        href: `/projetos/${project.id}`,
        name: project.name,
        description: normalizeText(project.description),
        updatedAt: project.updated_at,
        productionCount: productions.filter((production) => production.project_id === project.id).length,
        identityLabel: getIdentityStatusLabel(identitySummary),
      }
    })
    .sort((a, b) => compareDateDesc(a.updatedAt, b.updatedAt))
    .slice(0, limit)
}

export function getDashboardEmptyState({
  projectCount,
  productionCount,
  recentItemCount,
}: {
  projectCount: number
  productionCount: number
  recentItemCount: number
}): DashboardEmptyState | null {
  if (projectCount === 0) {
    return {
      kind: 'no-projects',
      title: 'Comece criando um Project',
      description: 'Projects guardam identidade, contexto e histórico do trabalho.',
      actionLabel: 'Criar Project',
      href: '/projetos?new=true',
    }
  }

  if (productionCount === 0) {
    return {
      kind: 'no-productions',
      title: 'Crie uma Production para continuar',
      description: 'Productions organizam imagens, vídeos e conteúdos dentro do contexto do Project.',
      actionLabel: 'Abrir Projects',
      href: '/projetos',
    }
  }

  if (recentItemCount === 0) {
    return {
      kind: 'no-recent-items',
      title: 'Sem itens recentes',
      description: 'Continue uma Production para criar rascunhos e conteúdos conectados.',
      actionLabel: 'Continuar Production',
      href: '/projetos',
    }
  }

  return null
}

export function productionPath(projectId: string, productionId: string): string {
  return `/projetos/${projectId}/producoes/${productionId}`
}

export function compareDateDesc(a: string, b: string): number {
  return new Date(b).getTime() - new Date(a).getTime()
}

function latestDate(values: string[]): string {
  return values.reduce((latest, value) => (
    compareDateDesc(latest, value) > 0 ? value : latest
  ))
}

function getDraftTitle(name: string | null | undefined, fallback: string | null | undefined, empty: string) {
  const cleanName = normalizeText(name)
  if (cleanName) return cleanName
  const cleanFallback = normalizeText(fallback)
  if (cleanFallback) return cleanFallback.split('\n')[0].slice(0, 72)
  return empty
}

function getProjectName(projectById: Map<string, DashboardProject>, projectId: string | null) {
  if (!projectId) return 'Sem Project'
  return projectById.get(projectId)?.name ?? 'Project'
}

function editorialStatusLabel(status: EditorialContentStatus) {
  if (status === 'ready') return 'Pronto'
  if (status === 'archived') return 'Arquivado'
  return 'Rascunho'
}

function mapById<T extends { id: string }>(items: T[]) {
  return new Map(items.map((item) => [item.id, item]))
}

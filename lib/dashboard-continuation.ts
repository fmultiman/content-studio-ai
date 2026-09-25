import { videoCreativeEditorHref } from '@/lib/creative/video-editor/video-routes'
import {
  getIdentityStatusLabel,
  resolveInheritedIdentitySummary,
} from '@/lib/inherited-project-identity'
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

export type DashboardDraftKind = 'image' | 'video' | 'editorial'

export type DashboardImageDraft = {
  id: string
  project_id: string | null
  production_id: string | null
  name: string | null
  user_input?: string | null
  image_status?: string | null
  updated_at: string
}

export type DashboardVideoDraft = {
  id: string
  project_id: string | null
  production_id: string | null
  name: string | null
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
  counters: {
    images: number
    videos: number
    editorial: number
  }
}

export type RecentWorkItem = {
  id: string
  type: DashboardDraftKind
  label: string
  title: string
  projectName: string
  productionName: string | null
  status: string
  updatedAt: string
  href: string
}

export type RecentProjectCard = {
  id: string
  href: string
  name: string
  description: string | null
  updatedAt: string
  productionCount: number
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

export function buildRecentProductions({
  productions,
  projects,
  imageDrafts,
  videoDrafts,
  editorialContents,
  limit = 4,
}: {
  productions: DashboardProduction[]
  projects: DashboardProject[]
  imageDrafts: DashboardImageDraft[]
  videoDrafts: DashboardVideoDraft[]
  editorialContents: DashboardEditorialContent[]
  limit?: number
}): RecentProductionCard[] {
  const projectById = mapById(projects)

  return productions
    .map((production) => {
      const project = projectById.get(production.project_id)
      const projectName = project?.name ?? 'Project'
      const display = resolveProductionDisplay({
        title: production.title,
        intention: production.intention,
        projectName,
      })
      const relatedImages = imageDrafts.filter((draft) => draft.production_id === production.id)
      const relatedVideos = videoDrafts.filter((draft) => draft.production_id === production.id)
      const relatedEditorial = editorialContents.filter(
        (content) => content.production_id === production.id,
      )
      const activityAt = latestDate([
        production.updated_at,
        ...relatedImages.map((item) => item.updated_at),
        ...relatedVideos.map((item) => item.updated_at),
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
        counters: {
          images: relatedImages.length,
          videos: relatedVideos.length,
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
  limit = 6,
}: {
  imageDrafts: DashboardImageDraft[]
  videoDrafts: DashboardVideoDraft[]
  editorialContents: DashboardEditorialContent[]
  projects: DashboardProject[]
  productions: DashboardProduction[]
  limit?: number
}): RecentWorkItem[] {
  const projectById = mapById(projects)
  const productionById = mapById(productions)
  const productionName = (productionId: string | null) => {
    if (!productionId) return null
    const production = productionById.get(productionId)
    if (!production) return 'Production'
    const project = projectById.get(production.project_id)
    return resolveProductionDisplay({
      title: production.title,
      intention: production.intention,
      projectName: project?.name,
    }).title
  }

  const imageItems: RecentWorkItem[] = imageDrafts.map((draft) => ({
    id: draft.id,
    type: 'image',
    label: 'Imagem',
    title: getDraftTitle(draft.name, draft.user_input, 'Rascunho de imagem'),
    projectName: getProjectName(projectById, draft.project_id),
    productionName: productionName(draft.production_id),
    status: imageStatusLabel(draft.image_status),
    updatedAt: draft.updated_at,
    href:
      draft.project_id && draft.production_id
        ? `/imagens?draft=${draft.id}&project=${draft.project_id}&production=${draft.production_id}`
        : `/imagens?draft=${draft.id}`,
  }))

  const videoItems: RecentWorkItem[] = videoDrafts.map((draft) => ({
    id: draft.id,
    type: 'video',
    label: 'Vídeo',
    title: getDraftTitle(draft.name, null, 'Rascunho de vídeo'),
    projectName: getProjectName(projectById, draft.project_id),
    productionName: productionName(draft.production_id),
    status: 'Rascunho',
    updatedAt: draft.updated_at,
    // VideoDraft single writer: continue in the canonical Creative Editor.
    href: videoCreativeEditorHref(draft.id),
  }))

  const editorialItems: RecentWorkItem[] = editorialContents.map((content) => ({
    id: content.id,
    type: 'editorial',
    label: 'Conteúdo',
    title: normalizeText(content.title) || 'Conteúdo editorial',
    projectName: getProjectName(projectById, content.project_id),
    productionName: productionName(content.production_id),
    status: editorialStatusLabel(content.status),
    updatedAt: content.updated_at,
    href: `/projetos/${content.project_id}/conteudos/${content.id}`,
  }))

  return [...imageItems, ...videoItems, ...editorialItems]
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

function imageStatusLabel(status: string | null | undefined) {
  if (status === 'approved') return 'Aprovada'
  if (status === 'generating') return 'Gerando'
  if (status === 'rejected') return 'Rejeitada'
  return 'Rascunho'
}

function editorialStatusLabel(status: EditorialContentStatus) {
  if (status === 'ready') return 'Pronto'
  if (status === 'archived') return 'Arquivado'
  return 'Rascunho'
}

function mapById<T extends { id: string }>(items: T[]) {
  return new Map(items.map((item) => [item.id, item]))
}

function normalizeText(value: string | null | undefined) {
  const trimmed = value?.trim().replace(/\s+/g, ' ') ?? ''
  return trimmed || null
}

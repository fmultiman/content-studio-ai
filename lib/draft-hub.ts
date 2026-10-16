import { videoCreativeEditorHref } from '@/lib/creative/video-editor/video-routes'
import { resolveProductionDisplay } from '@/lib/ux-production-hardening'
import type { ImageDraft, Production, Project, VideoDraft } from '@/lib/types'

export type DraftHubKind = 'image' | 'video'

export type DraftHubProject = Pick<Project, 'id' | 'name'>
export type DraftHubProduction = Pick<Production, 'id' | 'project_id' | 'title' | 'intention' | 'updated_at'>

export type DraftHubCard = {
  id: string
  kind: DraftHubKind
  title: string
  status: string
  projectId: string | null
  projectName: string
  productionId: string | null
  productionName: string | null
  updatedAt: string
  href: string
  productionHref: string | null
  meta: string
}

export type DraftHubEmptyStateKind =
  | 'no-projects'
  | 'no-productions'
  | 'no-drafts'
  | 'no-filter-results'
  | 'load-error'

export type DraftHubEmptyState = {
  kind: DraftHubEmptyStateKind
  title: string
  description: string
  actionLabel?: string
  href?: string
}

export function buildImageDraftHubCards({
  drafts,
  projects,
  productions,
}: {
  drafts: Pick<ImageDraft, 'id' | 'project_id' | 'production_id' | 'name' | 'user_input' | 'generated_prompt' | 'image_status' | 'updated_at'>[]
  projects: DraftHubProject[]
  productions: DraftHubProduction[]
}): DraftHubCard[] {
  const projectById = mapById(projects)
  const productionById = mapById(productions)

  return drafts
    .map((draft) => {
      const project = draft.project_id ? projectById.get(draft.project_id) : null
      const production = draft.production_id ? productionById.get(draft.production_id) : null
      const projectName = project?.name ?? (draft.project_id ? 'Project' : 'Sem Project')
      const productionName = getProductionName(production, projectName)

      return {
        id: draft.id,
        kind: 'image' as const,
        title: getDraftTitle(draft.name, draft.user_input, 'Rascunho de imagem'),
        status: imageStatusLabel(draft.image_status),
        projectId: draft.project_id,
        projectName,
        productionId: draft.production_id,
        productionName,
        updatedAt: draft.updated_at,
        href: draftRoute('image', draft.id, draft.project_id, draft.production_id),
        productionHref: productionHref(draft.project_id, draft.production_id),
        meta: draft.generated_prompt ? 'Prompt gerado' : 'Sem prompt',
      }
    })
    .sort((a, b) => compareDateDesc(a.updatedAt, b.updatedAt))
}

export function buildVideoDraftHubCards({
  drafts,
  projects,
  productions,
}: {
  drafts: Pick<VideoDraft, 'id' | 'project_id' | 'production_id' | 'name' | 'scenes' | 'updated_at'>[]
  projects: DraftHubProject[]
  productions: DraftHubProduction[]
}): DraftHubCard[] {
  const projectById = mapById(projects)
  const productionById = mapById(productions)

  return drafts
    .map((draft) => {
      const project = draft.project_id ? projectById.get(draft.project_id) : null
      const production = draft.production_id ? productionById.get(draft.production_id) : null
      const projectName = project?.name ?? (draft.project_id ? 'Project' : 'Sem Project')
      const productionName = getProductionName(production, projectName)
      const sceneCount = Array.isArray(draft.scenes) ? draft.scenes.length : 0

      return {
        id: draft.id,
        kind: 'video' as const,
        title: getDraftTitle(draft.name, null, 'Rascunho de video'),
        status: 'Rascunho',
        projectId: draft.project_id,
        projectName,
        productionId: draft.production_id,
        productionName,
        updatedAt: draft.updated_at,
        href: draftRoute('video', draft.id, draft.project_id, draft.production_id),
        productionHref: productionHref(draft.project_id, draft.production_id),
        meta: `${sceneCount} ${sceneCount === 1 ? 'cena' : 'cenas'}`,
      }
    })
    .sort((a, b) => compareDateDesc(a.updatedAt, b.updatedAt))
}

export function filterDraftHubCards(
  cards: DraftHubCard[],
  filters: {
    projectId?: string
    productionId?: string
    status?: string
    search?: string
  },
) {
  const normalizedSearch = normalizeText(filters.search).toLocaleLowerCase('pt-BR')

  return cards.filter((card) => {
    if (filters.projectId && filters.projectId !== 'all' && card.projectId !== filters.projectId) {
      return false
    }

    if (filters.productionId && filters.productionId !== 'all' && card.productionId !== filters.productionId) {
      return false
    }

    if (filters.status && filters.status !== 'all' && card.status !== filters.status) {
      return false
    }

    if (normalizedSearch) {
      const haystack = [
        card.title,
        card.projectName,
        card.productionName,
        card.status,
        card.meta,
      ].filter(Boolean).join(' ').toLocaleLowerCase('pt-BR')

      return haystack.includes(normalizedSearch)
    }

    return true
  })
}

export function getProductionsForProject(
  productions: DraftHubProduction[],
  projectId: string | null | undefined,
) {
  if (!projectId) return []
  return productions
    .filter((production) => production.project_id === projectId)
    .sort((a, b) => compareDateDesc(a.updated_at, b.updated_at))
}

/**
 * STRUCTURAL_WAVE_0 (D4): the "Criar nova imagem" context a `/imagens?project=&production=` entry may pre-select.
 *
 * Only identifiers that exist in the lists the signed-in user can actually read are honoured, and a Production only together with
 * the Project it belongs to - a URL can never select a Project or Production the user does not have, nor a mismatched pair.
 *   - valid Project + Production of that Project -> both
 *   - valid Project, missing/invalid/mismatched Production -> the Project only (the user still chooses the Production)
 *   - no Project but a valid Production -> that Production and its own Project
 *   - anything else -> nothing (the hub starts empty, as before)
 */
export function resolveDraftHubCreateContext({
  requestedProjectId,
  requestedProductionId,
  projects,
  productions,
}: {
  requestedProjectId: string | null | undefined
  requestedProductionId: string | null | undefined
  projects: DraftHubProject[]
  productions: DraftHubProduction[]
}): { projectId: string; productionId: string } {
  const none = { projectId: '', productionId: '' }
  const production = requestedProductionId ? productions.find((entry) => entry.id === requestedProductionId) : undefined
  const projectId = requestedProjectId || production?.project_id || ''
  const project = projectId ? projects.find((entry) => entry.id === projectId) : undefined
  if (!project) return none
  return { projectId: project.id, productionId: production && production.project_id === project.id ? production.id : '' }
}

export function getDraftHubProductionLabel(
  production: DraftHubProduction,
  projects: DraftHubProject[],
) {
  const project = projects.find((item) => item.id === production.project_id)
  return getProductionName(production, project?.name ?? null) ?? 'Production'
}

export function getDraftHubEmptyState({
  kind,
  projectCount,
  productionCount,
  totalDraftCount,
  filteredDraftCount,
  hasFilters,
  hasError = false,
}: {
  kind: DraftHubKind
  projectCount: number
  productionCount: number
  totalDraftCount: number
  filteredDraftCount: number
  hasFilters: boolean
  hasError?: boolean
}): DraftHubEmptyState | null {
  if (hasError) {
    return {
      kind: 'load-error',
      title: 'Nao foi possivel carregar os rascunhos',
      description: 'Atualize a pagina ou tente novamente em alguns instantes.',
    }
  }

  if (projectCount === 0) {
    return {
      kind: 'no-projects',
      title: 'Crie um Project para comecar',
      description: 'Projects guardam identidade, contexto e historico do trabalho.',
      actionLabel: 'Criar Project',
      href: '/projetos?new=true',
    }
  }

  if (productionCount === 0) {
    return {
      kind: 'no-productions',
      title: 'Crie uma Production antes de iniciar',
      description: 'Productions organizam imagens, videos e conteudos dentro do contexto do Project.',
      actionLabel: 'Abrir Projects',
      href: '/projetos',
    }
  }

  if (totalDraftCount === 0) {
    return {
      kind: 'no-drafts',
      title: kind === 'image' ? 'Nenhum rascunho de imagem ainda' : 'Nenhum rascunho de video ainda',
      description: kind === 'image'
        ? 'Escolha uma Production para criar a primeira imagem com contexto.'
        : 'Escolha uma Production para criar o primeiro video com contexto.',
    }
  }

  if (filteredDraftCount === 0 && hasFilters) {
    return {
      kind: 'no-filter-results',
      title: 'Nenhum rascunho encontrado',
      description: 'Ajuste ou limpe os filtros para ver outros rascunhos.',
      actionLabel: 'Limpar filtros',
    }
  }

  return null
}

export function draftRoute(
  kind: DraftHubKind,
  draftId: string,
  projectId: string | null,
  productionId: string | null,
) {
  // VideoDraft single writer: a video draft opens ONLY in the canonical Creative Editor.
  if (kind === 'video') return videoCreativeEditorHref(draftId)
  const base = '/imagens'
  const params = new URLSearchParams({ draft: draftId })
  if (projectId) params.set('project', projectId)
  if (productionId) params.set('production', productionId)
  return `${base}?${params.toString()}`
}

export function productionHref(projectId: string | null, productionId: string | null) {
  if (!projectId || !productionId) return null
  return `/projetos/${projectId}/producoes/${productionId}`
}

export function compareDateDesc(a: string, b: string): number {
  return new Date(b).getTime() - new Date(a).getTime()
}

function getProductionName(
  production: DraftHubProduction | null | undefined,
  projectName: string | null,
) {
  if (!production) return null
  return resolveProductionDisplay({
    title: production.title,
    intention: production.intention,
    projectName,
  }).title
}

function getDraftTitle(
  name: string | null | undefined,
  fallback: string | null | undefined,
  empty: string,
) {
  const cleanName = normalizeText(name)
  if (cleanName) return cleanName
  const cleanFallback = normalizeText(fallback)
  if (cleanFallback) return cleanFallback.split('\n')[0].slice(0, 72)
  return empty
}

function imageStatusLabel(status: string | null | undefined) {
  if (status === 'approved') return 'Aprovada'
  if (status === 'generating') return 'Gerando'
  if (status === 'rejected') return 'Rejeitada'
  return 'Rascunho'
}

function mapById<T extends { id: string }>(items: T[]) {
  return new Map(items.map((item) => [item.id, item]))
}

function normalizeText(value: string | null | undefined) {
  return value?.trim().replace(/\s+/g, ' ') ?? ''
}

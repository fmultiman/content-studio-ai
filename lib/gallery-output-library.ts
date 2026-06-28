import type { Image, ImageDraft, Production, Project } from '@/lib/types'
import { productionHref } from '@/lib/draft-hub'
import { resolveProductionDisplay } from '@/lib/ux-production-hardening'

export type GalleryOutputStatus = 'generated' | 'approved' | 'rejected' | 'generating'

export type GalleryOutputItem = {
  id: string
  title: string
  prompt: string
  projectId: string | null
  projectName: string | null
  productionId: string | null
  productionName: string | null
  draftId: string | null
  status: GalleryOutputStatus
  statusLabel: string
  generatedAt: string
  updatedAt: string
  imageUrl: string | null
  thumbnailUrl: string | null
  downloadUrl: string | null
  canDownload: boolean
  previewAlt: string
  productionHref: string | null
  sourceHref: string | null
}

export type GalleryOutputFilters = {
  search?: string
  projectId?: string
  productionId?: string
  status?: GalleryOutputStatus | 'all'
}

export type GalleryEmptyStateKind =
  | 'no-projects'
  | 'no-outputs'
  | 'no-filter-results'

export type GalleryEmptyState = {
  kind: GalleryEmptyStateKind
  title: string
  description: string
  actionLabel: string
  href: string | null
}

export const GALLERY_SIGNED_URL_TIMEOUT_MS = 4000

type ImageDraftSource = Pick<
  ImageDraft,
  'id' | 'project_id' | 'production_id' | 'name' | 'user_input' | 'current_image_id' | 'updated_at'
>

type ProjectSource = Pick<Project, 'id' | 'name'>
type ProductionSource = Pick<Production, 'id' | 'project_id' | 'title' | 'intention'>
type ImageSource = Pick<
  Image,
  | 'id'
  | 'project_id'
  | 'user_input'
  | 'generated_prompt'
  | 'image_url'
  | 'thumbnail_url'
  | 'storage_path'
  | 'thumbnail_path'
  | 'status'
  | 'created_at'
  | 'updated_at'
>

const STATUS_LABELS: Record<GalleryOutputStatus, string> = {
  generated: 'Gerada',
  approved: 'Aprovada',
  rejected: 'Rejeitada',
  generating: 'Gerando',
}

export function isGeneratedVisualOutput(image: ImageSource): boolean {
  return Boolean(
    image.image_url ||
      image.thumbnail_url ||
      image.storage_path ||
      image.thumbnail_path,
  )
}

export function resolveGalleryOutputStatus(status: ImageSource['status']): GalleryOutputStatus {
  if (status === 'approved') return 'approved'
  if (status === 'rejected') return 'rejected'
  if (status === 'generating') return 'generating'
  return 'generated'
}

export function galleryOutputStatusLabel(status: GalleryOutputStatus): string {
  return STATUS_LABELS[status]
}

export function buildGalleryOutputs({
  images,
  drafts = [],
  projects = [],
  productions = [],
}: {
  images: ImageSource[]
  drafts?: ImageDraftSource[]
  projects?: ProjectSource[]
  productions?: ProductionSource[]
}): GalleryOutputItem[] {
  const projectById = new Map(projects.map((project) => [project.id, project]))
  const productionById = new Map(productions.map((production) => [production.id, production]))
  const draftByImageId = new Map(
    drafts
      .filter((draft) => draft.current_image_id)
      .map((draft) => [draft.current_image_id as string, draft]),
  )

  return images
    .filter(isGeneratedVisualOutput)
    .map((image) => {
      const draft = draftByImageId.get(image.id) || null
      const projectId = draft?.project_id || image.project_id || null
      const productionId = draft?.production_id || null
      const project = projectId ? projectById.get(projectId) || null : null
      const production = productionId ? productionById.get(productionId) || null : null
      const status = resolveGalleryOutputStatus(image.status)
      const prompt = image.user_input || draft?.user_input || image.generated_prompt || ''
      const title = resolveGalleryOutputTitle({
        draftName: draft?.name || null,
        prompt,
      })
      const displayProductionTitle = production
        ? resolveProductionDisplay({
          title: production.title,
          intention: production.intention,
          projectName: project?.name,
        }).title
        : null

      return {
        id: image.id,
        title,
        prompt,
        projectId,
        projectName: project?.name || null,
        productionId,
        productionName: displayProductionTitle,
        draftId: draft?.id || null,
        status,
        statusLabel: galleryOutputStatusLabel(status),
        generatedAt: image.created_at,
        updatedAt: image.updated_at,
        imageUrl: image.image_url,
        thumbnailUrl: image.thumbnail_url || image.image_url,
        downloadUrl: image.image_url,
        canDownload: Boolean(image.image_url),
        previewAlt: buildGalleryOutputAlt(title, project?.name || null, displayProductionTitle),
        productionHref: projectId && productionId ? productionHref(projectId, productionId) : null,
        sourceHref: buildGallerySourceHref({
          draftId: draft?.id || null,
          projectId,
          productionId,
        }),
      }
    })
    .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))
}

export function filterGalleryOutputs(
  outputs: GalleryOutputItem[],
  filters: GalleryOutputFilters,
): GalleryOutputItem[] {
  const search = filters.search?.trim().toLowerCase()

  return outputs.filter((output) => {
    if (filters.projectId && filters.projectId !== 'all' && output.projectId !== filters.projectId) {
      return false
    }

    if (filters.productionId && filters.productionId !== 'all' && output.productionId !== filters.productionId) {
      return false
    }

    if (filters.status && filters.status !== 'all' && output.status !== filters.status) {
      return false
    }

    if (!search) return true

    return [
      output.title,
      output.prompt,
      output.projectName,
      output.productionName,
      output.statusLabel,
    ]
      .filter(Boolean)
      .some((value) => value!.toLowerCase().includes(search))
  })
}

export function getGalleryProductionsForProject(
  productions: ProductionSource[],
  projectId: string | null,
): ProductionSource[] {
  if (!projectId || projectId === 'all') return productions

  return productions.filter((production) => production.project_id === projectId)
}

export function getGalleryEmptyState({
  projectCount,
  outputCount,
  filteredCount,
  hasFilters,
}: {
  projectCount: number
  outputCount: number
  filteredCount: number
  hasFilters: boolean
}): GalleryEmptyState | null {
  if (filteredCount > 0) return null

  if (projectCount === 0) {
    return {
      kind: 'no-projects',
      title: 'Crie um Project para começar',
      description: 'Projects guardam identidade, contexto e histórico do trabalho.',
      actionLabel: 'Criar Project',
      href: '/projetos?new=true',
    }
  }

  if (outputCount === 0) {
    return {
      kind: 'no-outputs',
      title: 'Nenhuma imagem gerada ainda',
      description: 'Crie uma imagem dentro de uma Production para que ela apareça na Galeria.',
      actionLabel: 'Criar imagem',
      href: '/imagens',
    }
  }

  if (hasFilters) {
    return {
      kind: 'no-filter-results',
      title: 'Nenhum resultado encontrado',
      description: 'Ajuste os filtros para ver outros outputs visuais gerados.',
      actionLabel: 'Limpar filtros',
      href: null,
    }
  }

  return null
}

export async function resolveGalleryDisplayImages<T>(
  images: T[],
  resolver: (image: T) => Promise<T>,
  timeoutMs = GALLERY_SIGNED_URL_TIMEOUT_MS,
): Promise<T[]> {
  return Promise.all(
    images.map(async (image) => {
      try {
        return await withGalleryTimeout(resolver(image), timeoutMs, image)
      } catch {
        return image
      }
    }),
  )
}

function resolveGalleryOutputTitle({
  draftName,
  prompt,
}: {
  draftName: string | null
  prompt: string
}) {
  const candidate = draftName?.trim() || prompt.trim()

  if (!candidate) return 'Imagem gerada'

  const firstLine = candidate.split('\n')[0].trim()
  return firstLine.length > 72 ? `${firstLine.slice(0, 69).trim()}...` : firstLine
}

function buildGalleryOutputAlt(
  title: string,
  projectName: string | null,
  productionName: string | null,
) {
  const context = [projectName, productionName].filter(Boolean).join(' / ')
  return context ? `${title} - ${context}` : title
}

function buildGallerySourceHref({
  draftId,
  projectId,
  productionId,
}: {
  draftId: string | null
  projectId: string | null
  productionId: string | null
}) {
  const params = new URLSearchParams()

  if (draftId) params.set('draft', draftId)
  if (projectId) params.set('project', projectId)
  if (productionId) params.set('production', productionId)

  const query = params.toString()
  return query ? `/imagens?${query}` : '/imagens'
}

function withGalleryTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  fallback: T,
): Promise<T> {
  return new Promise((resolve) => {
    const timeoutId = setTimeout(() => resolve(fallback), timeoutMs)

    promise
      .then((value) => {
        clearTimeout(timeoutId)
        resolve(value)
      })
      .catch(() => {
        clearTimeout(timeoutId)
        resolve(fallback)
      })
  })
}

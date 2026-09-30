import { videoCreativeEditorHref } from '@/lib/creative/video-editor/video-routes'
import type { Image, ImageDraft, LibraryFile, Production, Project, RenderExecutionSummary, VideoDraft } from '@/lib/types'
import { productionHref } from '@/lib/draft-hub'
import { resolveProductionDisplay } from '@/lib/ux-production-hardening'

export type GalleryOutputStatus = 'generated' | 'approved' | 'rejected' | 'generating'
export type GalleryMediaType = 'image' | 'video'

export type GalleryOutputItem = {
  id: string
  mediaType: GalleryMediaType
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
  /**
   * Phase 2I-C2.2 — set ONLY for video items: the output-url endpoint to
   * fetch a FRESH, transient, INLINE-disposition signed URL from when the
   * Gallery preview modal opens. Deliberately separate from `downloadUrl`
   * (which is the attachment-disposition endpoint) — the two must never be
   * conflated, since an attachment-disposition signed URL is not guaranteed
   * safe/correct for inline `<video>` playback. `null` for image items,
   * which already carry a directly-usable URL in `imageUrl`/`downloadUrl`.
   */
  videoPreviewEndpoint: string | null
  /**
   * Creative Editor Template Foundation V1 — set only on explicitly saved
   * Creative Editor PNGs ('studio_render'). Their `id` is a LibraryFile id,
   * never an `images` id, so no AI-image action may treat it as one.
   */
  source?: 'studio_render'
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

type VideoDraftSource = Pick<
  VideoDraft,
  'id' | 'project_id' | 'production_id' | 'name' | 'updated_at'
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

/** A LibraryFile with origin='studio_render' (already carrying a display URL). */
export type StudioRenderSource = Pick<LibraryFile, 'id' | 'project_id' | 'name' | 'public_url' | 'thumbnail_url' | 'created_at' | 'updated_at'> & Partial<Pick<LibraryFile, 'origin' | 'kind' | 'deleted_at' | 'production_id'>>

type ExecutionSource = Pick<RenderExecutionSummary, 'id' | 'video_draft_id' | 'status' | 'completed_at' | 'queued_at'> & Partial<Pick<RenderExecutionSummary, 'kind'>>

const STATUS_LABELS: Record<GalleryOutputStatus, string> = {
  generated: 'Gerada',
  approved: 'Aprovada',
  rejected: 'Rejeitada',
  generating: 'Gerando',
}

/** Gallery title of a saved Creative Editor render ("Creative Editor · Slide 2/5"). Shared with the I2V source chooser. */
export function galleryStudioRenderTitle(fileName: string): string {
  const slide = /^slide-(\d+)-de-(\d+)-/.exec(fileName)
  return slide ? `Creative Editor · Slide ${slide[1]}/${slide[2]}` : 'Creative Editor · Render'
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
  executions = [],
  videoDrafts = [],
  studioRenders = [],
}: {
  images: ImageSource[]
  drafts?: ImageDraftSource[]
  projects?: ProjectSource[]
  productions?: ProductionSource[]
  executions?: ExecutionSource[]
  videoDrafts?: VideoDraftSource[]
  studioRenders?: StudioRenderSource[]
}): GalleryOutputItem[] {
  const projectById = new Map(projects.map((project) => [project.id, project]))
  const productionById = new Map(productions.map((production) => [production.id, production]))
  const draftByImageId = new Map(
    drafts
      .filter((draft) => draft.current_image_id)
      .map((draft) => [draft.current_image_id as string, draft]),
  )
  const videoDraftById = new Map(videoDrafts.map((vd) => [vd.id, vd]))

  const imageItems = images
    .filter(isGeneratedVisualOutput)
    .map((image): GalleryOutputItem => {
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
        mediaType: 'image',
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
          mediaType: 'image',
          draftId: draft?.id || null,
          projectId,
          productionId,
        }),
        videoPreviewEndpoint: null,
      }
    })

  const videoItems = executions
    // Defense in depth beside the route's kind='video' filter: a static
    // still execution (Static Render Worker V1) is never a Gallery video.
    .filter((exec): exec is typeof exec & { video_draft_id: string } => exec.status === 'completed' && exec.video_draft_id !== null && (exec.kind ?? 'video') === 'video')
    .map((exec): GalleryOutputItem => {
      const draft = videoDraftById.get(exec.video_draft_id) || null
      const projectId = draft?.project_id || null
      const productionId = draft?.production_id || null
      const project = projectId ? projectById.get(projectId) || null : null
      const production = productionId ? productionById.get(productionId) || null : null
      const status = 'generated'
      const title = draft?.name?.trim() || 'Vídeo Renderizado'
      const displayProductionTitle = production
        ? resolveProductionDisplay({
          title: production.title,
          intention: production.intention,
          projectName: project?.name,
        }).title
        : null
        
      return {
        id: exec.id,
        mediaType: 'video',
        title,
        prompt: 'Vídeo a partir de template e cenas',
        projectId,
        projectName: project?.name || null,
        productionId,
        productionName: displayProductionTitle,
        draftId: exec.video_draft_id,
        status,
        statusLabel: galleryOutputStatusLabel(status),
        generatedAt: exec.completed_at || exec.queued_at,
        updatedAt: exec.completed_at || exec.queued_at,
        imageUrl: null,
        thumbnailUrl: null,
        downloadUrl: `/api/render-executions/${exec.id}/output-url?disposition=attachment`,
        canDownload: true,
        previewAlt: buildGalleryOutputAlt(title, project?.name || null, displayProductionTitle),
        productionHref: projectId && productionId ? productionHref(projectId, productionId) : null,
        sourceHref: buildGallerySourceHref({
          mediaType: 'video',
          draftId: exec.video_draft_id,
          projectId,
          productionId,
        }),
        // Inline (no disposition param) — strictly separate from downloadUrl
        // above, which carries the attachment-disposition endpoint.
        videoPreviewEndpoint: `/api/render-executions/${exec.id}/output-url`,
      }
    })

  // Creative Editor Template Foundation V1: studio renders enter the Gallery
  // ONLY after the explicit "Salvar nesta peca" durability boundary (they are
  // LibraryFiles with origin='studio_render'). Scratch executions never do.
  const studioRenderItems = studioRenders
    .filter((file) => file.origin === 'studio_render' && !file.deleted_at && (file.kind ?? 'image') === 'image')
    .map((file): GalleryOutputItem => {
      const project = file.project_id ? projectById.get(file.project_id) || null : null
      // MEDIA_LIBRARY_PRODUCTION_SCOPING_V1 follow-up: the LibraryFile's own stable `production_id` (migration 048) is
      // the canonical Production of a saved render. NULL stays unscoped. It is surfaced only when that Production is
      // loaded AND belongs to the file's Project (fail closed) — never re-derived from a ChannelPiece, folder, name or
      // "the Project's only Production".
      const linkedProduction = file.production_id ? productionById.get(file.production_id) || null : null
      const production = linkedProduction && file.project_id && linkedProduction.project_id === file.project_id ? linkedProduction : null
      const productionId = production ? production.id : null
      const displayProductionTitle = production
        ? resolveProductionDisplay({
          title: production.title,
          intention: production.intention,
          projectName: project?.name,
        }).title
        : null
      const title = galleryStudioRenderTitle(file.name)
      const status = 'generated'
      return {
        id: file.id,
        mediaType: 'image',
        title,
        prompt: 'Render estático do Creative Editor, salvo na peça',
        projectId: file.project_id,
        projectName: project?.name || null,
        productionId,
        productionName: displayProductionTitle,
        draftId: null,
        status,
        statusLabel: galleryOutputStatusLabel(status),
        generatedAt: file.created_at,
        updatedAt: file.updated_at,
        imageUrl: file.public_url || null,
        thumbnailUrl: file.thumbnail_url || file.public_url || null,
        downloadUrl: file.public_url || null,
        canDownload: Boolean(file.public_url),
        previewAlt: buildGalleryOutputAlt(title, project?.name || null, displayProductionTitle),
        productionHref: file.project_id && productionId ? productionHref(file.project_id, productionId) : null,
        sourceHref: null,
        videoPreviewEndpoint: null,
        source: 'studio_render',
      }
    })

  return [...imageItems, ...videoItems, ...studioRenderItems].sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))
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
  mediaType,
  draftId,
  projectId,
  productionId,
}: {
  mediaType: GalleryMediaType
  draftId: string | null
  projectId: string | null
  productionId: string | null
}) {
  const params = new URLSearchParams()

  if (draftId) params.set('draft', draftId)
  if (projectId) params.set('project', projectId)
  if (productionId) params.set('production', productionId)

  // "Abrir origem" of a rendered video = the authored VideoDraft, which opens ONLY in the
  // canonical Creative Editor. Viewing/downloading the MP4 stays on the output endpoints.
  if (mediaType === 'video' && draftId) return videoCreativeEditorHref(draftId)

  const query = params.toString()
  const basePath = mediaType === 'video' ? '/videos' : '/imagens'
  return query ? `${basePath}?${query}` : basePath
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

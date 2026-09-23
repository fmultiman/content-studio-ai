/* eslint-disable @next/next/no-img-element */
'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { AlertCircle, Download, ExternalLink, Eye, ImageIcon, Loader2, RefreshCw, Search, Video as VideoIcon } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import {
  DashboardPage,
  DashboardPageContent,
} from '@/components/layout/dashboard-page'
import { PageHeader } from '@/components/layout/page-header'
import { ViewModeToggle, useViewModePreference } from '@/components/ui/view-mode-toggle'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardActions,
  CardContent,
  CardHeader,
  CardMedia,
  CardTitle,
} from '@/components/ui/card'
import { ContextMetadata } from '@/components/ui/context-metadata'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { StatusBadge } from '@/components/ui/status-badge'
import { StateMessage } from '@/components/ui/state-message'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import type { Image as ImageType, ImageDraft, Production, Project, RenderExecutionSummary, VideoDraft } from '@/lib/types'
import {
  buildGalleryOutputs,
  filterGalleryOutputs,
  getGalleryEmptyState,
  getGalleryProductionsForProject,
  resolveGalleryDisplayImages,
  type GalleryOutputItem,
  type GalleryOutputStatus,
} from '@/lib/gallery-output-library'
import { resolveProductionDisplay } from '@/lib/ux-production-hardening'

type GalleryStatusFilter = GalleryOutputStatus | 'all'

export default function GalleryPage() {
  const router = useRouter()
  const [images, setImages] = useState<ImageType[]>([])
  const [projects, setProjects] = useState<Project[]>([])
  const [productions, setProductions] = useState<Production[]>([])
  const [drafts, setDrafts] = useState<ImageDraft[]>([])
  const [videoDrafts, setVideoDrafts] = useState<VideoDraft[]>([])
  const [executions, setExecutions] = useState<Pick<RenderExecutionSummary, 'id' | 'video_draft_id' | 'status' | 'completed_at' | 'queued_at'>[]>([])
  const [selectedProject, setSelectedProject] = useState('all')
  const [selectedProduction, setSelectedProduction] = useState('all')
  const [statusFilter, setStatusFilter] = useState<GalleryStatusFilter>('all')
  const [search, setSearch] = useState('')
  const [isLoading, setIsLoading] = useState(true)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [videoOutputsUnavailable, setVideoOutputsUnavailable] = useState(false)
  const [retryKey, setRetryKey] = useState(0)
  const [selectedOutput, setSelectedOutput] = useState<GalleryOutputItem | null>(null)
  const [viewMode, setViewMode] = useViewModePreference('gallery-output-view', 'card')

  useEffect(() => {
    const getSignedImageUrls = async (image: ImageType) => {
      if (!image.storage_path && !image.thumbnail_path) return image

      try {
        const response = await fetch(`/api/images/${image.id}/signed-url`)
        const payload = await response.json()

        if (!response.ok) return image

        return {
          ...image,
          image_url: payload.imageUrl || image.image_url,
          thumbnail_url: payload.thumbnailUrl || payload.imageUrl || image.thumbnail_url,
        } as ImageType
      } catch {
        return image
      }
    }

    const fetchGallery = async () => {
      setIsLoading(true)
      setErrorMessage(null)
      setVideoOutputsUnavailable(false)

      try {
        const supabase = createClient()

        // Core Gallery data (images, drafts, Projects, Productions, video
        // draft metadata) — video_drafts itself is browser-readable and
        // unaffected by the render_executions authority fix below.
        const [imagesResult, draftsResult, projectsResult, productionsResult, videoDraftsResult] = await Promise.all([
          supabase
            .from('images')
            .select('*')
            .order('updated_at', { ascending: false }),
          supabase
            .from('image_drafts')
            .select('id, project_id, production_id, name, user_input, current_image_id, updated_at')
            .not('current_image_id', 'is', null),
          supabase
            .from('projects')
            .select('*')
            .order('updated_at', { ascending: false }),
          supabase
            .from('productions')
            .select('*')
            .order('updated_at', { ascending: false }),
          supabase
            .from('video_drafts')
            .select('id, project_id, production_id, name, updated_at'),
        ])

        const coreError =
          imagesResult.error ||
          draftsResult.error ||
          projectsResult.error ||
          productionsResult.error ||
          videoDraftsResult.error

        if (coreError) {
          throw new Error(coreError.message)
        }

        const signedImages = await resolveGalleryDisplayImages(
          (imagesResult.data || []) as ImageType[],
          getSignedImageUrls,
        )

        setImages(signedImages)
        setDrafts((draftsResult.data || []) as ImageDraft[])
        setProjects((projectsResult.data || []) as Project[])
        setProductions((productionsResult.data || []) as Production[])
        setVideoDrafts((videoDraftsResult.data || []) as VideoDraft[])
      } catch (error) {
        console.error('Erro ao carregar Galeria', error)
        setErrorMessage('Não foi possível carregar a Galeria agora.')
        setIsLoading(false)
        return
      }

      // Video outputs come from a narrow, server-authoritative route — the
      // browser has no SELECT policy on render_executions (intentional, see
      // app/api/gallery/video-outputs/route.ts). This fetch is isolated from
      // the core data above ON PURPOSE: a failure here must never blank out
      // images/Projects/Productions that already loaded successfully, and
      // must never be mistaken for "no Projects exist".
      try {
        const response = await fetch('/api/gallery/video-outputs')
        if (!response.ok) throw new Error(`video-outputs fetch failed: ${response.status}`)
        const payload = await response.json()
        setExecutions(payload.executions || [])
      } catch (error) {
        console.error('Erro ao carregar outputs de video da Galeria', error)
        setExecutions([])
        setVideoOutputsUnavailable(true)
      }

      setIsLoading(false)
    }

    fetchGallery()
  }, [retryKey])

  const outputs = useMemo(
    () => buildGalleryOutputs({ images, drafts, projects, productions, executions, videoDrafts }),
    [drafts, executions, images, productions, projects, videoDrafts],
  )

  const availableProductions = useMemo(
    () => getGalleryProductionsForProject(productions, selectedProject),
    [productions, selectedProject],
  )

  const effectiveSelectedProduction = selectedProduction !== 'all' &&
    availableProductions.some((production) => production.id === selectedProduction)
    ? selectedProduction
    : 'all'

  const filteredOutputs = useMemo(
    () => filterGalleryOutputs(outputs, {
      search,
      projectId: selectedProject,
      productionId: effectiveSelectedProduction,
      status: statusFilter,
    }),
    [effectiveSelectedProduction, outputs, search, selectedProject, statusFilter],
  )

  const hasFilters = Boolean(
      search.trim() ||
      selectedProject !== 'all' ||
      effectiveSelectedProduction !== 'all' ||
      statusFilter !== 'all',
  )

  const emptyState = getGalleryEmptyState({
    projectCount: projects.length,
    outputCount: outputs.length,
    filteredCount: filteredOutputs.length,
    hasFilters,
  })

  const approvedCount = outputs.filter((output) => output.status === 'approved').length
  const generatedCount = outputs.filter((output) => output.status === 'generated').length
  const rejectedCount = outputs.filter((output) => output.status === 'rejected').length
  const projectList = [...projects].sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'))

  const clearFilters = () => {
    setSearch('')
    setSelectedProject('all')
    setSelectedProduction('all')
    setStatusFilter('all')
  }

  const handleDownload = async (output: GalleryOutputItem) => {
    if (!output.downloadUrl) return

    if (output.mediaType === 'video') {
      // output.downloadUrl is the attachment-disposition ENDPOINT (returns
      // { url, expiresAt } JSON), not a directly downloadable resource —
      // it must be fetched first to obtain the real, transient signed URL.
      try {
        const response = await fetch(output.downloadUrl)
        if (!response.ok) throw new Error('download url fetch failed')
        const data = await response.json()
        if (!data.url) throw new Error('download url missing')

        const link = document.createElement('a')
        link.href = data.url
        link.download = ''
        document.body.appendChild(link)
        link.click()
        document.body.removeChild(link)
      } catch {
        setErrorMessage('Não foi possível baixar o vídeo.')
      }
      return
    }

    try {
      const response = await fetch(output.downloadUrl)
      if (!response.ok) return

      const blob = await response.blob()
      const extension = blob.type === 'image/jpeg'
        ? 'jpg'
        : blob.type === 'image/webp'
          ? 'webp'
          : 'png'
      const url = window.URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = safeGalleryFilename(output.title, extension)
      document.body.appendChild(link)
      link.click()
      window.URL.revokeObjectURL(url)
      document.body.removeChild(link)
    } catch {
      setErrorMessage('Não foi possível baixar o arquivo.')
    }
  }

  return (
    <>
      <DashboardPage>
        <DashboardPageContent width="7xl" className="space-y-6">
          <PageHeader
            context="Biblioteca"
            title="Galeria"
            description="Explore imagens geradas nos seus Projects e Productions. Uploads, referências e documentos continuam em Arquivos."
          />

          <section className="grid gap-3 sm:grid-cols-3">
            <GalleryMetric label="Outputs visuais" value={outputs.length} />
            <GalleryMetric label="Aprovadas" value={approvedCount} />
            <GalleryMetric
              label={rejectedCount > 0 ? 'Geradas / rejeitadas' : 'Geradas'}
              value={rejectedCount > 0 ? `${generatedCount} / ${rejectedCount}` : generatedCount}
            />
          </section>

          <Card className="border-border/50 bg-card/40">
            <CardHeader>
              <CardTitle className="text-base">Filtrar outputs</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-4 md:grid-cols-2 2xl:grid-cols-[minmax(220px,1.4fr)_minmax(160px,1fr)_minmax(160px,1fr)_minmax(140px,0.8fr)_auto] 2xl:items-end">
              <div className="space-y-2 md:col-span-2 2xl:col-span-1">
                <Label htmlFor="gallery-search">Busca</Label>
                <div className="relative">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    id="gallery-search"
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                    placeholder="Buscar por título, Project ou Production"
                    className="pl-9"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="gallery-project-filter">Project</Label>
                <Select value={selectedProject} onValueChange={setSelectedProject}>
                  <SelectTrigger id="gallery-project-filter">
                    <SelectValue placeholder="Todos os Projects" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Todos os Projects</SelectItem>
                    {projectList.map((project) => (
                      <SelectItem key={project.id} value={project.id}>
                        {project.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="gallery-production-filter">Production</Label>
                <Select value={effectiveSelectedProduction} onValueChange={setSelectedProduction}>
                  <SelectTrigger id="gallery-production-filter">
                    <SelectValue placeholder="Todas as Productions" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Todas as Productions</SelectItem>
                    {availableProductions.map((production) => (
                      <SelectItem key={production.id} value={production.id}>
                        {resolveProductionDisplay(production).title}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="gallery-status-filter">Status</Label>
                <Select
                  value={statusFilter}
                  onValueChange={(value: GalleryStatusFilter) => setStatusFilter(value)}
                >
                  <SelectTrigger id="gallery-status-filter">
                    <SelectValue placeholder="Todos" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Todos</SelectItem>
                    <SelectItem value="generated">Gerada</SelectItem>
                    <SelectItem value="approved">Aprovada</SelectItem>
                    <SelectItem value="rejected">Rejeitada</SelectItem>
                    <SelectItem value="generating">Gerando</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <Button
                type="button"
                variant="outline"
                className="md:col-span-2 md:justify-self-end 2xl:col-span-1 2xl:self-end"
                onClick={clearFilters}
                disabled={!hasFilters}
              >
                Limpar filtros
              </Button>
            </CardContent>
          </Card>

          {errorMessage && (
            <StateMessage
              tone="error"
              title="Falha ao carregar a Galeria"
              description={errorMessage}
              actionLabel="Tentar novamente"
              onAction={() => setRetryKey((value) => value + 1)}
            />
          )}

          {!errorMessage && videoOutputsUnavailable && (
            <StateMessage
              tone="info"
              title="Videos renderizados podem estar ausentes"
              description="Nao foi possivel carregar os outputs de video agora. Imagens continuam disponiveis normalmente."
              actionLabel="Tentar novamente"
              onAction={() => setRetryKey((value) => value + 1)}
              compact
            />
          )}

          {isLoading ? (
            <StateMessage
              tone="loading"
              title="Carregando Galeria..."
              description="Estamos resolvendo outputs, contexto de origem e imagens disponíveis."
              className="py-10"
            />
          ) : emptyState ? (
            <GalleryEmptyStateView
              state={emptyState}
              onAction={() => {
                if (emptyState.href) {
                  router.push(emptyState.href)
                } else {
                  clearFilters()
                }
              }}
            />
          ) : (
            <section className="space-y-4">
              <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <h2 className="text-lg font-semibold">Outputs gerados</h2>
                <p className="text-sm text-muted-foreground">
                  Visualize resultados, baixe arquivos disponíveis e volte ao contexto de origem.
                </p>
              </div>
                <div className="flex flex-col gap-2 sm:items-end">
                  <ViewModeToggle
                    value={viewMode}
                    onValueChange={setViewMode}
                    label="Visualização"
                  />
                  <p className="text-sm text-muted-foreground">
                    {filteredOutputs.length} de {outputs.length} outputs
                  </p>
                </div>
              </div>

              {viewMode === 'card' ? (
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                  {filteredOutputs.map((output) => (
                    <GalleryOutputCard
                      key={output.id}
                      output={output}
                      onPreview={() => setSelectedOutput(output)}
                      onDownload={() => handleDownload(output)}
                      onNavigate={(href) => router.push(href)}
                    />
                  ))}
                </div>
              ) : (
                <div className="space-y-3">
                  <div className="hidden grid-cols-[72px_minmax(180px,1.2fr)_minmax(120px,0.85fr)_minmax(120px,0.85fr)_96px_120px_minmax(250px,auto)] gap-3 rounded-md border bg-muted/30 px-3 py-2 text-xs font-medium text-muted-foreground 2xl:grid">
                    <span>Imagem</span>
                    <span>Título</span>
                    <span>Project</span>
                    <span>Production</span>
                    <span>Status</span>
                    <span>Atualizado</span>
                    <span>Ações</span>
                  </div>
                  {filteredOutputs.map((output) => (
                    <GalleryOutputListItem
                      key={output.id}
                      output={output}
                      onPreview={() => setSelectedOutput(output)}
                      onDownload={() => handleDownload(output)}
                      onNavigate={(href) => router.push(href)}
                    />
                  ))}
                </div>
              )}
            </section>
          )}
        </DashboardPageContent>
      </DashboardPage>

      <GalleryPreviewDialog
        output={selectedOutput}
        onOpenChange={(open) => {
          if (!open) setSelectedOutput(null)
        }}
        onDownload={handleDownload}
        onNavigate={(href) => router.push(href)}
      />
    </>
  )
}

function GalleryMetric({ label, value }: { label: string; value: number | string }) {
  return (
    <Card className="border-border/50 bg-card/30">
      <CardContent className="p-4">
        <p className="text-sm text-muted-foreground">{label}</p>
        <p className="mt-1 text-2xl font-semibold">{value}</p>
      </CardContent>
    </Card>
  )
}

function GalleryOutputCard({
  output,
  onPreview,
  onDownload,
  onNavigate,
}: {
  output: GalleryOutputItem
  onPreview: () => void
  onDownload: () => void
  onNavigate: (href: string) => void
}) {
  return (
    <Card className="overflow-hidden border-border/50 bg-card/30">
      <CardMedia className="aspect-square">
        <GalleryImageFrame output={output} />
      </CardMedia>
      <CardContent className="space-y-4 p-4">
        <div className="space-y-3">
          <div className="flex items-start justify-between gap-3">
            <CardTitle className="line-clamp-2 text-sm" title={output.title}>
              {output.title}
            </CardTitle>
            <StatusBadge
              label={output.statusLabel}
              tone={output.status === 'approved' ? 'positive' : output.status === 'generating' ? 'warning' : output.status === 'rejected' ? 'danger' : 'neutral'}
              className="shrink-0"
            />
          </div>
          <ContextMetadata
            dense
            items={[
              { label: 'Project', value: output.projectName || 'Project não identificado', title: output.projectName || 'Project não identificado' },
              { label: 'Production', value: output.productionName || 'Sem Production associada', title: output.productionName || 'Sem Production associada' },
              { label: 'Atualizado', value: formatDate(output.updatedAt) },
            ]}
          />
        </div>

        <div className="grid gap-2">
          <Button type="button" size="sm" className="gap-2" onClick={onPreview}>
            <Eye className="h-4 w-4" />
            Visualizar
          </Button>
          <CardActions>
            {output.sourceHref && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="gap-2"
                onClick={() => onNavigate(output.sourceHref!)}
              >
                <ExternalLink className="h-4 w-4" />
                Abrir origem
              </Button>
            )}
            {output.productionHref && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="gap-2"
                onClick={() => onNavigate(output.productionHref!)}
              >
                <ExternalLink className="h-4 w-4" />
                Ver Production
              </Button>
            )}
            {output.canDownload && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="gap-2"
                onClick={onDownload}
              >
                <Download className="h-4 w-4" />
                Baixar
              </Button>
            )}
          </CardActions>
        </div>
      </CardContent>
    </Card>
  )
}

function GalleryOutputListItem({
  output,
  onPreview,
  onDownload,
  onNavigate,
}: {
  output: GalleryOutputItem
  onPreview: () => void
  onDownload: () => void
  onNavigate: (href: string) => void
}) {
  return (
    <Card className="border-border/50 bg-card/30">
      <CardContent className="grid gap-3 p-3 md:grid-cols-[72px_minmax(0,1fr)] 2xl:grid-cols-[72px_minmax(180px,1.2fr)_minmax(120px,0.85fr)_minmax(120px,0.85fr)_96px_120px_minmax(250px,auto)] 2xl:items-center">
        <CardMedia className="h-16 w-16 rounded-md md:row-span-3 2xl:row-auto">
          <GalleryImageFrame output={output} compact />
        </CardMedia>

        <div className="min-w-0">
          <CardTitle className="truncate text-sm" title={output.title}>
            {output.title}
          </CardTitle>
          <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">
            {output.prompt || 'Output visual gerado'}
          </p>
        </div>

        <ContextMetadata
          dense
          items={[
            { label: 'Project', value: output.projectName || 'Project não identificado', title: output.projectName || 'Project não identificado' },
            { label: 'Production', value: output.productionName || 'Sem Production associada', title: output.productionName || 'Sem Production associada' },
            { label: 'Status', value: <StatusBadge label={output.statusLabel} tone={output.status === 'approved' ? 'positive' : output.status === 'generating' ? 'warning' : output.status === 'rejected' ? 'danger' : 'neutral'} /> },
            { label: 'Atualizado', value: formatDate(output.updatedAt) },
          ]}
          className="2xl:contents"
          itemClassName="min-w-0"
        />

        <CardActions className="flex flex-col gap-2 sm:flex-row sm:flex-wrap 2xl:justify-end">
          <Button type="button" size="sm" className="w-full gap-2 sm:min-w-max sm:w-auto" onClick={onPreview}>
            <Eye className="h-4 w-4" />
            Visualizar
          </Button>
          {output.sourceHref && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="w-full gap-2 sm:min-w-max sm:w-auto"
              onClick={() => onNavigate(output.sourceHref!)}
            >
              <ExternalLink className="h-4 w-4" />
              Abrir origem
            </Button>
          )}
          {output.productionHref && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="w-full gap-2 sm:min-w-max sm:w-auto"
              onClick={() => onNavigate(output.productionHref!)}
            >
              <ExternalLink className="h-4 w-4" />
              Ver Production
            </Button>
          )}
          {output.canDownload && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="w-full gap-2 sm:min-w-max sm:w-auto"
              onClick={onDownload}
            >
              <Download className="h-4 w-4" />
              Baixar
            </Button>
          )}
        </CardActions>
      </CardContent>
    </Card>
  )
}

function GalleryImageFrame({
  output,
  compact = false,
}: {
  output: GalleryOutputItem
  compact?: boolean
}) {
  const [hasError, setHasError] = useState(false)
  const imageUrl = output.thumbnailUrl || output.imageUrl

  // A completed video has no thumbnail/poster infrastructure (deliberately
  // — no new thumbnail-generation backend, no fake thumbnail). It is a
  // known, valid media item, not a broken/missing image, so it must never
  // fall into the "Imagem indisponível" branch below.
  if (output.mediaType === 'video' && !imageUrl) {
    return (
      <div className="relative flex aspect-square flex-col items-center justify-center gap-2 bg-muted p-4 text-center text-sm text-muted-foreground">
        <VideoIcon className={compact ? 'h-5 w-5' : 'h-10 w-10'} />
        {!compact && 'Vídeo renderizado'}
      </div>
    )
  }

  return (
    <div className="relative aspect-square bg-muted">
      {imageUrl && !hasError ? (
        <img
          src={imageUrl}
          alt={output.previewAlt}
          className="h-full w-full object-cover"
          onError={() => setHasError(true)}
        />
      ) : (
        <div className="flex h-full flex-col items-center justify-center gap-2 p-4 text-center text-sm text-muted-foreground">
          <ImageIcon className={compact ? 'h-5 w-5' : 'h-10 w-10'} />
          {!compact && 'Imagem indisponível'}
        </div>
      )}
    </div>
  )
}

function GalleryEmptyStateView({
  state,
  onAction,
}: {
  state: NonNullable<ReturnType<typeof getGalleryEmptyState>>
  onAction: () => void
}) {
  return (
    <Card className="border-dashed">
      <CardContent className="flex flex-col items-center justify-center py-16 text-center">
        <ImageIcon className="mb-4 h-12 w-12 text-muted-foreground" />
        <h3 className="text-lg font-semibold">{state.title}</h3>
        <p className="mt-1 max-w-md text-sm text-muted-foreground">
          {state.description}
        </p>
        <Button type="button" className="mt-5" onClick={onAction}>
          {state.kind === 'no-outputs' ? 'Ir para Imagens' : state.actionLabel}
        </Button>
      </CardContent>
    </Card>
  )
}

function GalleryPreviewDialog({
  output,
  onOpenChange,
  onDownload,
  onNavigate,
}: {
  output: GalleryOutputItem | null
  onOpenChange: (open: boolean) => void
  onDownload: (output: GalleryOutputItem) => void
  onNavigate: (href: string) => void
}) {
  // Transient client state only — never persisted, never reused across
  // items. Cleared whenever the target item changes OR the dialog closes
  // (output becomes null), and re-fetched fresh every time it reopens.
  const [videoPreviewUrl, setVideoPreviewUrl] = useState<string | null>(null)
  const [videoPreviewError, setVideoPreviewError] = useState<string | null>(null)
  const [isLoadingVideoPreview, setIsLoadingVideoPreview] = useState(false)

  const loadVideoPreview = (endpoint: string) => {
    let cancelled = false
    setVideoPreviewError(null)
    setIsLoadingVideoPreview(true)

    fetch(endpoint)
      .then(async (response) => {
        if (!response.ok) throw new Error('preview url fetch failed')
        const data = await response.json()
        if (cancelled) return
        if (!data.url) throw new Error('preview url missing')
        setVideoPreviewUrl(data.url)
      })
      .catch(() => {
        if (!cancelled) setVideoPreviewError('Não foi possível carregar a prévia do vídeo.')
      })
      .finally(() => {
        if (!cancelled) setIsLoadingVideoPreview(false)
      })

    return () => {
      cancelled = true
    }
  }

  useEffect(() => {
    // Always clear previous item's transient state first — a video URL (or
    // an error) from a DIFFERENT item, or from before the dialog was
    // closed, must never leak into the next one. Synchronous by design
    // (this IS the "reset local state when a prop/id changes" pattern
    // React's own docs describe as correct) — this repo already downgrades
    // this specific React Compiler rule to a warning for exactly this
    // reason (see eslint.config.mjs), so it's suppressed here explicitly.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setVideoPreviewUrl(null)
    setVideoPreviewError(null)
    setIsLoadingVideoPreview(false)

    if (!output || output.mediaType !== 'video' || !output.videoPreviewEndpoint) {
      return
    }

    return loadVideoPreview(output.videoPreviewEndpoint)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [output?.id, output?.mediaType, output?.videoPreviewEndpoint])

  const retryVideoPreview = () => {
    if (output?.videoPreviewEndpoint) loadVideoPreview(output.videoPreviewEndpoint)
  }

  return (
    <Dialog open={Boolean(output)} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-4xl">
        {output && (
          <>
            <DialogHeader>
              <DialogTitle>{output.title}</DialogTitle>
              <DialogDescription>
                Output visual gerado em {formatDate(output.generatedAt)}.
              </DialogDescription>
            </DialogHeader>

            <div className="grid gap-5 lg:grid-cols-[minmax(0,1.4fr)_minmax(260px,0.8fr)]">
              <div className="overflow-hidden rounded-md border bg-muted flex items-center justify-center">
                {output.mediaType === 'video' ? (
                  isLoadingVideoPreview ? (
                    <div className="flex flex-col items-center gap-3 p-6 text-center text-sm text-muted-foreground">
                      <Loader2 className="h-8 w-8 animate-spin" />
                      Carregando prévia...
                    </div>
                  ) : videoPreviewUrl ? (
                    // Always the INLINE endpoint's signed URL — never the
                    // attachment-disposition URL used by Download.
                    <video
                      key={output.id}
                      src={videoPreviewUrl}
                      controls
                      playsInline
                      className="w-full h-full object-contain bg-black"
                      crossOrigin="anonymous"
                    />
                  ) : videoPreviewError ? (
                    <div className="flex flex-col items-center gap-3 p-6 text-center text-sm text-muted-foreground">
                      <AlertCircle className="h-8 w-8 text-red-400" />
                      <p>{videoPreviewError}</p>
                      <Button variant="outline" size="sm" className="gap-2" onClick={retryVideoPreview}>
                        <RefreshCw className="h-3 w-3" />
                        Tentar novamente
                      </Button>
                    </div>
                  ) : (
                    <div className="flex flex-col items-center gap-2 p-6 text-center text-sm text-muted-foreground">
                      <VideoIcon className="h-10 w-10" />
                      Prévia indisponível
                    </div>
                  )
                ) : (
                  <GalleryImageFrame key={output.id} output={output} />
                )}
              </div>

              <div className="space-y-4">
                <div className="flex flex-wrap gap-2">
                  <StatusBadge
                    label={output.statusLabel}
                    tone={output.status === 'approved' ? 'positive' : output.status === 'generating' ? 'warning' : output.status === 'rejected' ? 'danger' : 'neutral'}
                  />
                  {output.projectName && <Badge variant="outline">{output.projectName}</Badge>}
                  {output.productionName && <Badge variant="outline">{output.productionName}</Badge>}
                </div>

                <div className="space-y-2 text-sm">
                  <p>
                    <span className="font-medium">Project:</span>{' '}
                    {output.projectName || 'Project não identificado'}
                  </p>
                  <p>
                    <span className="font-medium">Production:</span>{' '}
                    {output.productionName || 'Sem Production associada'}
                  </p>
                  <p>
                    <span className="font-medium">Atualizada em:</span>{' '}
                    {formatDate(output.updatedAt)}
                  </p>
                </div>

                {output.prompt && (
                  <div className="rounded-md border bg-background/60 p-3">
                    <p className="text-xs font-medium uppercase text-muted-foreground">
                      Prompt associado
                    </p>
                    <p className="mt-2 max-h-32 overflow-auto text-sm text-muted-foreground">
                      {output.prompt}
                    </p>
                  </div>
                )}
              </div>
            </div>

            <DialogFooter>
              {output.sourceHref && (
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => onNavigate(output.sourceHref!)}
                >
                  Abrir origem
                </Button>
              )}
              <Button
                type="button"
                variant="outline"
                disabled={!output.productionHref}
                onClick={() => output.productionHref && onNavigate(output.productionHref)}
              >
                Ver Production
              </Button>
              <Button
                type="button"
                disabled={!output.canDownload}
                onClick={() => onDownload(output)}
              >
                Baixar
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}

function formatDate(date: string) {
  return new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  }).format(new Date(date))
}

function safeGalleryFilename(title: string, extension: string) {
  const slug = title
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase()
    .slice(0, 48)

  return `${slug || 'imagem-gerada'}.${extension}`
}

/* eslint-disable @next/next/no-img-element */
'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { AlertCircle, Download, ExternalLink, Eye, ImageIcon, Loader2, RefreshCw, Search } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { Header } from '@/components/layout/header'
import { PageHeader } from '@/components/layout/page-header'
import { ViewModeToggle, useViewModePreference } from '@/components/ui/view-mode-toggle'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import type { Image as ImageType, ImageDraft, Production, Project } from '@/lib/types'
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
  const [selectedProject, setSelectedProject] = useState('all')
  const [selectedProduction, setSelectedProduction] = useState('all')
  const [statusFilter, setStatusFilter] = useState<GalleryStatusFilter>('all')
  const [search, setSearch] = useState('')
  const [isLoading, setIsLoading] = useState(true)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
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

      try {
        const supabase = createClient()

        const [imagesResult, draftsResult, projectsResult, productionsResult] = await Promise.all([
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
        ])

        const firstError =
          imagesResult.error ||
          draftsResult.error ||
          projectsResult.error ||
          productionsResult.error

        if (firstError) {
          throw new Error(firstError.message)
        }

        const signedImages = await resolveGalleryDisplayImages(
          (imagesResult.data || []) as ImageType[],
          getSignedImageUrls,
        )

        setImages(signedImages)
        setDrafts((draftsResult.data || []) as ImageDraft[])
        setProjects((projectsResult.data || []) as Project[])
        setProductions((productionsResult.data || []) as Production[])
      } catch (error) {
        console.error('Erro ao carregar Galeria', error)
        setErrorMessage('Não foi possível carregar a Galeria agora.')
      } finally {
        setIsLoading(false)
      }
    }

    fetchGallery()
  }, [retryKey])

  const outputs = useMemo(
    () => buildGalleryOutputs({ images, drafts, projects, productions }),
    [drafts, images, productions, projects],
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
      setErrorMessage('Não foi possível baixar esta imagem agora.')
    }
  }

  return (
    <>
      <Header />
      <div className="flex-1 overflow-auto p-6">
        <div className="mx-auto max-w-7xl space-y-6">
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
            <Card className="border-destructive/40">
              <CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex items-start gap-3">
                  <AlertCircle className="mt-0.5 h-4 w-4 text-destructive" />
                  <p className="text-sm">{errorMessage}</p>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="gap-2"
                  onClick={() => setRetryKey((value) => value + 1)}
                >
                  <RefreshCw className="h-4 w-4" />
                  Tentar novamente
                </Button>
              </CardContent>
            </Card>
          )}

          {isLoading ? (
            <div
              className="flex items-center justify-center gap-3 py-16 text-sm text-muted-foreground"
              role="status"
              aria-live="polite"
            >
              <Loader2 className="h-5 w-5 animate-spin" />
              Carregando Galeria...
            </div>
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
        </div>
      </div>

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
      <GalleryImageFrame output={output} />
      <CardContent className="space-y-4 p-4">
        <div className="space-y-3">
          <div className="flex items-start justify-between gap-3">
            <h3 className="line-clamp-2 text-sm font-medium" title={output.title}>
              {output.title}
            </h3>
            <StatusBadge
              label={output.statusLabel}
              tone={output.status === 'approved' ? 'positive' : output.status === 'generating' ? 'warning' : output.status === 'rejected' ? 'danger' : 'neutral'}
              className="shrink-0"
            />
          </div>
          <ContextMetadata
            items={[
              { label: 'Project', value: output.projectName || 'Project não identificado', title: output.projectName || 'Project não identificado' },
              { label: 'Production', value: output.productionName || 'Sem Production associada', title: output.productionName || 'Sem Production associada' },
              { label: 'Atualizado', value: formatDate(output.updatedAt) },
            ]}
            className="text-xs"
          />
        </div>

        <div className="grid gap-2">
          <Button type="button" size="sm" className="gap-2" onClick={onPreview}>
            <Eye className="h-4 w-4" />
            Visualizar
          </Button>
          <div className="flex flex-wrap gap-2">
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
          </div>
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
        <div className="h-16 w-16 overflow-hidden rounded-md bg-muted md:row-span-3 2xl:row-auto">
          <GalleryImageFrame output={output} compact />
        </div>

        <div className="min-w-0">
          <p className="truncate text-sm font-medium" title={output.title}>
            {output.title}
          </p>
          <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">
            {output.prompt || 'Output visual gerado'}
          </p>
        </div>

        <ContextMetadata
          items={[
            { label: 'Project', value: output.projectName || 'Project não identificado', title: output.projectName || 'Project não identificado' },
            { label: 'Production', value: output.productionName || 'Sem Production associada', title: output.productionName || 'Sem Production associada' },
            { label: 'Status', value: <StatusBadge label={output.statusLabel} tone={output.status === 'approved' ? 'positive' : output.status === 'generating' ? 'warning' : output.status === 'rejected' ? 'danger' : 'neutral'} /> },
            { label: 'Atualizado', value: formatDate(output.updatedAt) },
          ]}
          className="2xl:contents"
          itemClassName="min-w-0"
        />

        <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap 2xl:justify-end">
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
        </div>
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
              <div className="overflow-hidden rounded-md border bg-muted">
                <GalleryImageFrame output={output} />
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

'use client'

// STRUCTURAL WAVE 1A-2, STEP S2 - the multimodal Gallery.
//
// The Gallery is a READ-ONLY projection of completed outputs, read from ONE source: GET /api/gallery/outputs (AI images, AI videos,
// Creative Editor video renders and static renders). It never writes, never saves to Arquivos, and shows a saved LibraryFile only as
// a "Salvo em Arquivos" mark on the output it came from.
//   * type / Project / Production are SERVER filters: they restart the list and act on the whole collection;
//   * text search and status act only on the outputs already loaded, and say so;
//   * a total is shown only when the API reported it as exact; an empty Gallery is only claimed when nothing failed and nothing is
//     left to load;
//   * media is resolved on demand through each output's own authenticated endpoint (see components/gallery/gallery-media.tsx).

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Download, ExternalLink, Eye, ImageIcon, Loader2, Search } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { DashboardPage, DashboardPageContent } from '@/components/layout/dashboard-page'
import { PageHeader } from '@/components/layout/page-header'
import { ViewModeToggle, useViewModePreference } from '@/components/ui/view-mode-toggle'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardActions, CardContent, CardHeader, CardMedia, CardTitle } from '@/components/ui/card'
import { ContextMetadata } from '@/components/ui/context-metadata'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { StatusBadge } from '@/components/ui/status-badge'
import { StateMessage } from '@/components/ui/state-message'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { GALLERY_OUTPUT_TYPES, type GalleryOutput, type GalleryOutputStatus, type GalleryOutputType } from '@/lib/gallery/outputs'
import {
  decideGalleryPanel,
  describeCount,
  describeFailedSources,
  exactTypeCount,
  failedSourceTypes,
  filterLoadedOutputs,
  GALLERY_STATUS_LABELS,
  GALLERY_TYPE_LABELS,
  hasLocalFilters,
  hasServerFilters,
  isStandaloneVideo,
  NO_LOCAL_FILTERS,
  occurredAtLabel,
  productionLabel,
  projectLabel,
  savedLabel,
  summarizeCount,
  type LocalFilters,
  type ServerFilters,
} from '@/lib/gallery/ui-model'
import { useGalleryOutputs } from '@/hooks/use-gallery-outputs'
import { downloadOutput, GalleryMediaFrame, GalleryPreviewMedia } from '@/components/gallery/gallery-media'
import { resolveProductionDisplay } from '@/lib/ux-production-hardening'

type GalleryStatusFilter = GalleryOutputStatus | 'all'

interface ProjectOption {
  id: string
  name: string
}

interface ProductionOption {
  id: string
  project_id: string
  title: string | null
  intention: string | null
}

/** Filter options are a small, explicitly bounded read; a list that hits the bound says it may be incomplete. */
const FILTER_OPTION_LIMIT = 500

const statusTone = (status: GalleryOutputStatus) => (status === 'approved' ? 'positive' : status === 'generating' ? 'warning' : status === 'rejected' ? 'danger' : 'neutral')

export default function GalleryPage() {
  const router = useRouter()
  const [serverFilters, setServerFilters] = useState<ServerFilters>({ types: [], projectId: null, productionId: null })
  const [localFilters, setLocalFilters] = useState<LocalFilters>(NO_LOCAL_FILTERS)
  const [projects, setProjects] = useState<ProjectOption[]>([])
  const [productions, setProductions] = useState<ProductionOption[]>([])
  const [optionsState, setOptionsState] = useState<'loading' | 'ready' | 'failed' | 'maybe-incomplete'>('loading')
  const [selectedOutput, setSelectedOutput] = useState<GalleryOutput | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [viewMode, setViewMode] = useViewModePreference('gallery-output-view', 'card')

  const gallery = useGalleryOutputs(serverFilters)

  // Filter options (Projects / Productions). They are NOT outputs: only labels for the server filters.
  useEffect(() => {
    let cancelled = false
    const load = async () => {
      try {
        const supabase = createClient()
        const [projectsResult, productionsResult] = await Promise.all([
          supabase.from('projects').select('id, name').order('name', { ascending: true }).limit(FILTER_OPTION_LIMIT),
          supabase.from('productions').select('id, project_id, title, intention').order('updated_at', { ascending: false }).limit(FILTER_OPTION_LIMIT),
        ])
        if (cancelled) return
        if (projectsResult.error || productionsResult.error) throw new Error('options')
        const projectRows = (projectsResult.data ?? []) as ProjectOption[]
        const productionRows = (productionsResult.data ?? []) as ProductionOption[]
        setProjects(projectRows)
        setProductions(productionRows)
        setOptionsState(projectRows.length >= FILTER_OPTION_LIMIT || productionRows.length >= FILTER_OPTION_LIMIT ? 'maybe-incomplete' : 'ready')
      } catch {
        if (!cancelled) setOptionsState('failed')
      }
    }
    load()
    return () => {
      cancelled = true
    }
  }, [])

  const productionTitle = (production: ProductionOption) =>
    resolveProductionDisplay({ title: production.title, intention: production.intention, projectName: projects.find((project) => project.id === production.project_id)?.name }).title
  const availableProductions = useMemo(
    () => (serverFilters.projectId ? productions.filter((production) => production.project_id === serverFilters.projectId) : productions),
    [productions, serverFilters.projectId],
  )
  const selectedProduction = serverFilters.productionId ? productions.find((production) => production.id === serverFilters.productionId) ?? null : null

  const visibleItems = useMemo(() => filterLoadedOutputs(gallery.items, localFilters), [gallery.items, localFilters])
  const failedTypes = failedSourceTypes(gallery.sources)
  const serverFiltered = hasServerFilters(serverFilters)
  const localFiltered = hasLocalFilters(localFilters)
  const panel = decideGalleryPanel({ phase: gallery.phase, loaded: gallery.items.length, visible: visibleItems.length, partial: gallery.partial, hasMore: gallery.hasMore, serverFiltered })
  const count = summarizeCount({ loaded: gallery.items.length, totals: gallery.totals, hasMore: gallery.hasMore, partial: gallery.partial })
  const shownTypes: readonly GalleryOutputType[] = serverFilters.types.length > 0 ? serverFilters.types : GALLERY_OUTPUT_TYPES

  const toggleType = (type: GalleryOutputType) => {
    setServerFilters((current) => {
      const next = current.types.includes(type) ? current.types.filter((entry) => entry !== type) : [...current.types, type]
      // Every type selected is the same collection as none selected.
      return { ...current, types: next.length === GALLERY_OUTPUT_TYPES.length ? [] : next }
    })
  }
  const changeProject = (value: string) => {
    setServerFilters((current) => {
      const projectId = value === 'all' ? null : value
      const keepProduction = current.productionId && (!projectId || productions.find((production) => production.id === current.productionId)?.project_id === projectId)
      return { ...current, projectId, productionId: keepProduction ? current.productionId : null }
    })
  }
  const changeProduction = (value: string) => {
    setServerFilters((current) => {
      if (value === 'all') return { ...current, productionId: null }
      const production = productions.find((entry) => entry.id === value)
      return { ...current, productionId: value, projectId: production?.project_id ?? current.projectId }
    })
  }
  const clearFilters = () => {
    setServerFilters({ types: [], projectId: null, productionId: null })
    setLocalFilters(NO_LOCAL_FILTERS)
  }

  const handleDownload = async (output: GalleryOutput) => {
    setActionError(null)
    const result = await downloadOutput(output)
    if (!result.ok) setActionError(result.message)
  }

  const retryIncomplete = () => (gallery.hasMore ? gallery.loadMore() : gallery.reload())

  return (
    <>
      <DashboardPage>
        <DashboardPageContent width="7xl" className="space-y-6">
          <PageHeader
            context="Biblioteca"
            title="Galeria"
            description="Todos os outputs concluídos: imagens e vídeos gerados por IA e renders do Creative Editor. Uploads, referências e documentos continuam em Arquivos."
          />

          <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5" aria-label="Totais">
            <GalleryMetric
              label="Outputs"
              value={count.kind === 'exact' ? count.total : '—'}
              hint={count.kind === 'exact' ? null : gallery.phase === 'loading' ? 'Contando…' : 'Total exato indisponível'}
            />
            {shownTypes.map((type) => {
              const exact = exactTypeCount(gallery.totals, type)
              return <GalleryMetric key={type} label={GALLERY_TYPE_LABELS[type]} value={exact === null ? '—' : exact} hint={null} />
            })}
          </section>

          <Card className="border-border/50 bg-card/40">
            <CardHeader>
              <CardTitle className="text-base">Filtrar outputs</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label id="gallery-type-label">Tipo</Label>
                <div role="group" aria-labelledby="gallery-type-label" className="flex flex-wrap gap-2" data-testid="gallery-type-chips">
                  <Button type="button" size="sm" variant={serverFilters.types.length === 0 ? 'default' : 'outline'} aria-pressed={serverFilters.types.length === 0} onClick={() => setServerFilters((current) => ({ ...current, types: [] }))}>
                    Todos os tipos
                  </Button>
                  {GALLERY_OUTPUT_TYPES.map((type) => (
                    <Button key={type} type="button" size="sm" variant={serverFilters.types.includes(type) ? 'default' : 'outline'} aria-pressed={serverFilters.types.includes(type)} onClick={() => toggleType(type)}>
                      {GALLERY_TYPE_LABELS[type]}
                    </Button>
                  ))}
                </div>
              </div>

              <div className="grid gap-4 md:grid-cols-2 2xl:grid-cols-[minmax(220px,1.4fr)_minmax(160px,1fr)_minmax(160px,1fr)_minmax(140px,0.8fr)_auto] 2xl:items-end">
                <div className="space-y-2 md:col-span-2 2xl:col-span-1">
                  <Label htmlFor="gallery-search">Buscar nos itens carregados</Label>
                  <div className="relative">
                    <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      id="gallery-search"
                      value={localFilters.search}
                      onChange={(event) => setLocalFilters((current) => ({ ...current, search: event.target.value }))}
                      placeholder="Título, prompt, Project ou Production (só itens já carregados)"
                      className="pl-9"
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="gallery-project-filter">Project</Label>
                  <Select value={serverFilters.projectId ?? 'all'} onValueChange={changeProject}>
                    <SelectTrigger id="gallery-project-filter">
                      <SelectValue placeholder="Todos os Projects" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">Todos os Projects</SelectItem>
                      {projects.map((project) => (
                        <SelectItem key={project.id} value={project.id}>
                          {project.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="gallery-production-filter">Production</Label>
                  <Select value={serverFilters.productionId ?? 'all'} onValueChange={changeProduction}>
                    <SelectTrigger id="gallery-production-filter">
                      <SelectValue placeholder="Todas as Productions">{selectedProduction ? productionTitle(selectedProduction) : undefined}</SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">Todas as Productions</SelectItem>
                      {availableProductions.map((production) => (
                        <SelectItem key={production.id} value={production.id}>
                          {productionTitle(production)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="gallery-status-filter">Status (itens carregados)</Label>
                  <Select value={localFilters.status} onValueChange={(value: GalleryStatusFilter) => setLocalFilters((current) => ({ ...current, status: value }))}>
                    <SelectTrigger id="gallery-status-filter">
                      <SelectValue placeholder="Todos" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">Todos</SelectItem>
                      {(Object.keys(GALLERY_STATUS_LABELS) as GalleryOutputStatus[]).map((status) => (
                        <SelectItem key={status} value={status}>
                          {GALLERY_STATUS_LABELS[status]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <Button type="button" variant="outline" className="md:col-span-2 md:justify-self-end 2xl:col-span-1 2xl:self-end" onClick={clearFilters} disabled={!serverFiltered && !localFiltered}>
                  Limpar filtros
                </Button>
              </div>

              <p className="text-xs text-muted-foreground" data-testid="gallery-filter-scope">
                Tipo, Project e Production filtram toda a coleção. Busca e status valem apenas para os outputs já carregados nesta página.
              </p>
              {optionsState === 'failed' && <p className="text-xs text-amber-500">Não foi possível carregar a lista de Projects e Productions para filtrar.</p>}
              {optionsState === 'maybe-incomplete' && <p className="text-xs text-amber-500">A lista de Projects/Productions para filtrar pode estar incompleta.</p>}
            </CardContent>
          </Card>

          {gallery.phase === 'error' && gallery.items.length === 0 && (
            <StateMessage
              tone="error"
              title="Falha ao carregar a Galeria"
              description={`${gallery.errorMessage ?? 'Não foi possível carregar a Galeria agora.'}${failedTypes.length > 0 ? ` Fontes com falha: ${describeFailedSources(failedTypes)}.` : ''}`}
              actionLabel="Tentar novamente"
              onAction={gallery.reload}
            />
          )}

          {gallery.phase === 'ready' && gallery.partial && (
            <StateMessage
              tone="info"
              title="Lista incompleta"
              description={`Não foi possível carregar: ${describeFailedSources(failedTypes)}. Os outputs já carregados continuam disponíveis, mas há outputs ainda não exibidos.`}
              actionLabel="Tentar novamente"
              onAction={retryIncomplete}
              compact
            />
          )}

          {actionError && <StateMessage tone="error" title="Ação não concluída" description={actionError} compact />}

          {panel.kind === 'loading' ? (
            <StateMessage tone="loading" title="Carregando Galeria..." description="Estamos carregando os outputs concluídos, o contexto de origem e as contagens." className="py-10" />
          ) : panel.kind === 'error' ? null : panel.kind === 'results' ? (
            <section className="space-y-4">
              <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
                <div>
                  <h2 className="text-lg font-semibold">Outputs gerados</h2>
                  <p className="text-sm text-muted-foreground">Visualize resultados, baixe arquivos disponíveis e volte ao contexto de origem.</p>
                </div>
                <div className="flex flex-col gap-2 sm:items-end">
                  <ViewModeToggle value={viewMode} onValueChange={setViewMode} label="Visualização" />
                  <p className="text-sm text-muted-foreground" data-testid="gallery-count">
                    {describeCount(count)}
                    {localFiltered && ` · ${visibleItems.length} correspondem à busca/status`}
                  </p>
                </div>
              </div>

              {viewMode === 'card' ? (
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                  {visibleItems.map((output) => (
                    <GalleryOutputCard key={output.key} output={output} onPreview={() => setSelectedOutput(output)} onDownload={() => handleDownload(output)} onNavigate={(href) => router.push(href)} />
                  ))}
                </div>
              ) : (
                <div className="space-y-3">
                  <div className="hidden grid-cols-[72px_minmax(180px,1.2fr)_minmax(120px,0.85fr)_minmax(120px,0.85fr)_96px_120px_minmax(250px,auto)] gap-3 rounded-md border bg-muted/30 px-3 py-2 text-xs font-medium text-muted-foreground 2xl:grid">
                    <span>Mídia</span>
                    <span>Título</span>
                    <span>Project</span>
                    <span>Production</span>
                    <span>Tipo</span>
                    <span>Data</span>
                    <span>Ações</span>
                  </div>
                  {visibleItems.map((output) => (
                    <GalleryOutputListItem key={output.key} output={output} onPreview={() => setSelectedOutput(output)} onDownload={() => handleDownload(output)} onNavigate={(href) => router.push(href)} />
                  ))}
                </div>
              )}

              <GalleryPager hasMore={gallery.hasMore} loadingMore={gallery.loadingMore} error={gallery.loadMoreError} complete={!gallery.hasMore && !gallery.partial} onLoadMore={gallery.loadMore} />
            </section>
          ) : (
            <GalleryPanelView
              panel={panel}
              hasMore={gallery.hasMore}
              loadingMore={gallery.loadingMore}
              loadMoreError={gallery.loadMoreError}
              onNavigate={(href) => router.push(href)}
              onClear={clearFilters}
              onLoadMore={gallery.loadMore}
              onRetry={retryIncomplete}
              onClearLocal={() => setLocalFilters(NO_LOCAL_FILTERS)}
            />
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

function GalleryMetric({ label, value, hint }: { label: string; value: number | string; hint: string | null }) {
  return (
    <Card className="border-border/50 bg-card/30">
      <CardContent className="p-4">
        <p className="text-sm text-muted-foreground">{label}</p>
        <p className="mt-1 text-2xl font-semibold">{value}</p>
        {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
      </CardContent>
    </Card>
  )
}

function OutputBadges({ output }: { output: GalleryOutput }) {
  const saved = savedLabel(output)
  return (
    <div className="flex flex-wrap items-center gap-1.5" data-testid="gallery-output-badges">
      <Badge variant="outline" data-testid="gallery-type-chip">{GALLERY_TYPE_LABELS[output.type]}</Badge>
      {output.type === 'image' && <StatusBadge label={GALLERY_STATUS_LABELS[output.status]} tone={statusTone(output.status)} />}
      {isStandaloneVideo(output) && <Badge variant="secondary">Geração avulsa</Badge>}
      {saved && <Badge variant="secondary">{saved}</Badge>}
    </div>
  )
}

function OutputActions({ output, onNavigate, onDownload, className }: { output: GalleryOutput; onNavigate: (href: string) => void; onDownload: () => void; className?: string }) {
  const classes = className ? `gap-2 ${className}` : 'gap-2'
  return (
    <>
      {output.sourceHref && (
        <Button type="button" variant="outline" size="sm" className={classes} onClick={() => onNavigate(output.sourceHref!)}>
          <ExternalLink className="h-4 w-4" />
          Abrir origem
        </Button>
      )}
      {output.productionHref && (
        <Button type="button" variant="outline" size="sm" className={classes} onClick={() => onNavigate(output.productionHref!)}>
          <ExternalLink className="h-4 w-4" />
          Ver Production
        </Button>
      )}
      <Button type="button" variant="outline" size="sm" className={classes} onClick={onDownload}>
        <Download className="h-4 w-4" />
        Baixar
      </Button>
    </>
  )
}

function GalleryOutputCard({ output, onPreview, onDownload, onNavigate }: { output: GalleryOutput; onPreview: () => void; onDownload: () => void; onNavigate: (href: string) => void }) {
  return (
    <Card className="overflow-hidden border-border/50 bg-card/30" data-testid="gallery-output" data-key={output.key} data-type={output.type}>
      <CardMedia className="aspect-square">
        <GalleryMediaFrame output={output} />
      </CardMedia>
      <CardContent className="space-y-4 p-4">
        <div className="space-y-3">
          <CardTitle className="line-clamp-2 text-sm" title={output.title}>
            {output.title}
          </CardTitle>
          <OutputBadges output={output} />
          <ContextMetadata
            dense
            items={[
              { label: 'Project', value: projectLabel(output), title: projectLabel(output) },
              { label: 'Production', value: productionLabel(output), title: productionLabel(output) },
              { label: occurredAtLabel(output.occurredAtKind), value: formatDate(output.occurredAt) },
            ]}
          />
        </div>

        <div className="grid gap-2">
          <Button type="button" size="sm" className="gap-2" onClick={onPreview}>
            <Eye className="h-4 w-4" />
            Visualizar
          </Button>
          <CardActions>
            <OutputActions output={output} onNavigate={onNavigate} onDownload={onDownload} />
          </CardActions>
        </div>
      </CardContent>
    </Card>
  )
}

function GalleryOutputListItem({ output, onPreview, onDownload, onNavigate }: { output: GalleryOutput; onPreview: () => void; onDownload: () => void; onNavigate: (href: string) => void }) {
  return (
    <Card className="border-border/50 bg-card/30" data-testid="gallery-output" data-key={output.key} data-type={output.type}>
      <CardContent className="grid gap-3 p-3 md:grid-cols-[72px_minmax(0,1fr)] 2xl:grid-cols-[72px_minmax(180px,1.2fr)_minmax(120px,0.85fr)_minmax(120px,0.85fr)_96px_120px_minmax(250px,auto)] 2xl:items-center">
        <CardMedia className="h-16 w-16 rounded-md md:row-span-3 2xl:row-auto">
          <GalleryMediaFrame output={output} compact />
        </CardMedia>

        <div className="min-w-0">
          <CardTitle className="truncate text-sm" title={output.title}>
            {output.title}
          </CardTitle>
          <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{output.prompt || GALLERY_TYPE_LABELS[output.type]}</p>
        </div>

        <ContextMetadata
          dense
          items={[
            { label: 'Project', value: projectLabel(output), title: projectLabel(output) },
            { label: 'Production', value: productionLabel(output), title: productionLabel(output) },
            { label: 'Tipo', value: <OutputBadges output={output} /> },
            { label: occurredAtLabel(output.occurredAtKind), value: formatDate(output.occurredAt) },
          ]}
          className="2xl:contents"
          itemClassName="min-w-0"
        />

        <CardActions className="flex flex-col gap-2 sm:flex-row sm:flex-wrap 2xl:justify-end">
          <Button type="button" size="sm" className="w-full gap-2 sm:min-w-max sm:w-auto" onClick={onPreview}>
            <Eye className="h-4 w-4" />
            Visualizar
          </Button>
          <OutputActions output={output} onNavigate={onNavigate} onDownload={onDownload} className="w-full sm:min-w-max sm:w-auto" />
        </CardActions>
      </CardContent>
    </Card>
  )
}

function GalleryPager({ hasMore, loadingMore, error, complete, onLoadMore }: { hasMore: boolean; loadingMore: boolean; error: string | null; complete: boolean; onLoadMore: () => void }) {
  return (
    <div className="flex flex-col items-center gap-2 pt-2">
      {error && <p className="text-sm text-red-400" role="alert">{error}</p>}
      {hasMore && (
        <Button type="button" variant="outline" onClick={onLoadMore} disabled={loadingMore} className="gap-2">
          {loadingMore && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
          {loadingMore ? 'Carregando…' : error ? 'Tentar novamente' : 'Carregar mais'}
        </Button>
      )}
      {complete && <p className="text-xs text-muted-foreground">Todos os outputs foram carregados.</p>}
    </div>
  )
}

function GalleryPanelView({
  panel, hasMore, loadingMore, loadMoreError, onNavigate, onClear, onClearLocal, onLoadMore, onRetry,
}: {
  panel: ReturnType<typeof decideGalleryPanel>
  hasMore: boolean
  loadingMore: boolean
  loadMoreError: string | null
  onNavigate: (href: string) => void
  onClear: () => void
  onClearLocal: () => void
  onLoadMore: () => void
  onRetry: () => void
}) {
  let title = ''
  let description = ''
  const actions: Array<{ label: string; onClick: () => void; primary?: boolean; disabled?: boolean }> = []
  if (panel.kind === 'empty') {
    if (panel.filtered) {
      title = 'Nenhum output encontrado'
      description = 'A coleção foi carregada por completo e nenhum output concluído corresponde a estes filtros.'
      actions.push({ label: 'Limpar filtros', onClick: onClear, primary: true })
    } else {
      title = 'Nenhum output concluído ainda'
      description = 'Imagens e vídeos gerados por IA e renders do Creative Editor concluídos aparecem aqui, sem precisar salvar em Arquivos.'
      actions.push({ label: 'Ir para Imagens', onClick: () => onNavigate('/imagens'), primary: true }, { label: 'Ir para Vídeos', onClick: () => onNavigate('/videos') })
    }
  } else if (panel.kind === 'incomplete-empty') {
    title = 'Ainda não há outputs carregados, mas a lista está incompleta'
    description = panel.failed
      ? 'Alguma fonte falhou ao carregar, então não dá para afirmar que a Galeria está vazia. Tente novamente.'
      : 'Há mais outputs para carregar. A Galeria não está vazia.'
    actions.push({ label: hasMore ? 'Carregar mais' : 'Tentar novamente', onClick: onRetry, primary: true, disabled: loadingMore })
  } else if (panel.kind === 'local-no-match') {
    title = 'Nenhum output carregado corresponde à busca ou ao status'
    description = `${panel.loaded} ${panel.loaded === 1 ? 'output carregado' : 'outputs carregados'} — a busca e o status valem só para o que já foi carregado.${panel.hasMore ? ' Há mais outputs para carregar.' : ''}`
    actions.push({ label: 'Limpar busca e status', onClick: onClearLocal, primary: true })
    if (panel.hasMore) actions.push({ label: 'Carregar mais', onClick: onLoadMore, disabled: loadingMore })
  }
  return (
    <Card className="border-dashed" data-testid="gallery-panel" data-panel={panel.kind}>
      <CardContent className="flex flex-col items-center justify-center py-16 text-center">
        <ImageIcon className="mb-4 h-12 w-12 text-muted-foreground" />
        <h3 className="text-lg font-semibold">{title}</h3>
        <p className="mt-1 max-w-md text-sm text-muted-foreground">{description}</p>
        {loadMoreError && <p className="mt-2 text-sm text-red-400" role="alert">{loadMoreError}</p>}
        <div className="mt-5 flex flex-wrap justify-center gap-2">
          {actions.map((action) => (
            <Button key={action.label} type="button" variant={action.primary ? 'default' : 'outline'} onClick={action.onClick} disabled={action.disabled}>
              {action.label}
            </Button>
          ))}
        </div>
      </CardContent>
    </Card>
  )
}

function GalleryPreviewDialog({ output, onOpenChange, onDownload, onNavigate }: { output: GalleryOutput | null; onOpenChange: (open: boolean) => void; onDownload: (output: GalleryOutput) => void; onNavigate: (href: string) => void }) {
  return (
    <Dialog open={Boolean(output)} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-4xl">
        {output && (
          <>
            <DialogHeader>
              <DialogTitle>{output.title}</DialogTitle>
              <DialogDescription>
                {GALLERY_TYPE_LABELS[output.type]} · {occurredAtLabel(output.occurredAtKind).toLowerCase()} em {formatDate(output.occurredAt)}.
              </DialogDescription>
            </DialogHeader>

            <div className="grid gap-5 lg:grid-cols-[minmax(0,1.4fr)_minmax(260px,0.8fr)]">
              <div className="flex items-center justify-center overflow-hidden rounded-md border bg-muted">
                {/* Keyed by output: nothing of a previous output (URL, error) can leak into the next one. */}
                <GalleryPreviewMedia key={output.key} output={output} />
              </div>

              <div className="space-y-4">
                <OutputBadges output={output} />
                <div className="space-y-2 text-sm">
                  <p><span className="font-medium">Project:</span> {projectLabel(output)}</p>
                  <p><span className="font-medium">Production:</span> {productionLabel(output)}</p>
                  <p><span className="font-medium">{occurredAtLabel(output.occurredAtKind)} em:</span> {formatDate(output.occurredAt)}</p>
                  {output.media.width && output.media.height && <p><span className="font-medium">Dimensões:</span> {output.media.width}×{output.media.height}</p>}
                  {output.media.durationMs && <p><span className="font-medium">Duração:</span> {(output.media.durationMs / 1000).toFixed(1)} s</p>}
                  {output.media.model && <p><span className="font-medium">Modelo:</span> {output.media.model}</p>}
                </div>

                {output.prompt && (
                  <div className="rounded-md border bg-background/60 p-3">
                    <p className="text-xs font-medium uppercase text-muted-foreground">Prompt associado</p>
                    <p className="mt-2 max-h-32 overflow-auto text-sm text-muted-foreground">{output.prompt}</p>
                  </div>
                )}
              </div>
            </div>

            <DialogFooter>
              {output.sourceHref && (
                <Button type="button" variant="outline" onClick={() => onNavigate(output.sourceHref!)}>
                  Abrir origem
                </Button>
              )}
              <Button type="button" variant="outline" disabled={!output.productionHref} onClick={() => output.productionHref && onNavigate(output.productionHref)}>
                Ver Production
              </Button>
              <Button type="button" onClick={() => onDownload(output)}>
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
  return new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' }).format(new Date(date))
}

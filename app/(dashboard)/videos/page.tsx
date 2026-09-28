'use client'

/**
 * /videos — Video hub (VIDEO_DRAFT_SINGLE_WRITER_AND_CANONICAL_ENTRY_V1).
 *
 * This page NEVER authors a VideoDraft. It lists drafts, creates a new one
 * (then hands off) and offers non-authoring actions (Preparar publicação,
 * Ver Production). Every "open draft" goes to the ONE canonical authoring
 * surface, /creative-editor/video/[draftId]. The pre-Creative-Editor
 * workspace that used to live here (SceneCards, Storyboard, 800 ms autosave,
 * render, result player) was removed: `/videos?draft=` is redirected by
 * proxy.ts, with a client-side fallback below.
 *
 * Long-term /videos becomes AI video / clip source-media generation (like
 * /imagens); that does not exist yet and is not simulated here.
 */
import { useState, useEffect, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import {
  DashboardPage,
  DashboardPageBar,
  DashboardPageContent,
} from '@/components/layout/dashboard-page'
import { PageHeader } from '@/components/layout/page-header'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { ViewModeToggle, useViewModePreference } from '@/components/ui/view-mode-toggle'
import { Card, CardActions, CardContent, CardTitle } from '@/components/ui/card'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { ContextMetadata } from '@/components/ui/context-metadata'
import { StateMessage } from '@/components/ui/state-message'
import { StatusBadge } from '@/components/ui/status-badge'
import { Video, Loader2, ChevronRight, ArrowLeft, Search, Zap, Clapperboard } from 'lucide-react'
import { useToast } from '@/hooks/use-toast'
import type { Project, Production, VideoDraft } from '@/lib/types'
import { QuickFlowDialog } from '@/components/publication/quick-flow-dialog'
import { draftLoadingMessage } from '@/lib/ux-production-hardening'
import {
  buildVideoDraftHubCards,
  filterDraftHubCards,
  getDraftHubEmptyState,
  getDraftHubProductionLabel,
  getProductionsForProject,
} from '@/lib/draft-hub'
import { legacyVideoAuthoringRedirect } from '@/lib/creative/video-editor/video-routes'
import { createVideoDraftForCreativeEditor } from '@/lib/creative/video-editor/video-draft-entry'
import { CreateVideoGenerationDialog } from '@/components/videos/create-video-generation-dialog'
import { VideoGenerationPreviewDialog } from '@/components/videos/video-generation-preview-dialog'

function VideosPageContent() {
  const { toast } = useToast()
  const router = useRouter()
  const searchParams = useSearchParams()
  const contextProjectId = searchParams.get('project')
  const contextProductionId = searchParams.get('production')
  const legacyTarget = legacyVideoAuthoringRedirect('/videos', new URLSearchParams(searchParams.toString()))

  const [projects, setProjects] = useState<Project[]>([])
  const [productions, setProductions] = useState<Production[]>([])
  const [drafts, setDrafts] = useState<VideoDraft[]>([])
  const [generations, setGenerations] = useState<any[]>([])
  const [isDataReady, setIsDataReady] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  
  const [retryKey, setRetryKey] = useState(0)
  const [hubProjectFilter, setHubProjectFilter] = useState('all')
  const [hubProductionFilter, setHubProductionFilter] = useState('all')
  const [hubStatusFilter, setHubStatusFilter] = useState('all')
  const [hubSearch, setHubSearch] = useState('')
  // A Production entry (…?project=&production=) preselects the creation context; it never opens an editor here.
  const [hubCreateProjectId, setHubCreateProjectId] = useState(contextProjectId ?? '')
  const [hubCreateProductionId, setHubCreateProductionId] = useState(contextProductionId ?? '')
  const [hubViewMode, setHubViewMode] = useViewModePreference('video-draft-hub-view', 'list')
  const [isCreatingInEditor, setIsCreatingInEditor] = useState(false)
  const [publicationDraft, setPublicationDraft] = useState<VideoDraft | null>(null)
  const [selectedVideoGeneration, setSelectedVideoGeneration] = useState<any | null>(null)
  
  const [showAiModal, setShowAiModal] = useState(false)
  const [klingConfigured, setKlingConfigured] = useState<boolean | null>(null)

  // Fallback for the proxy redirect (e.g. a client-side navigation to a legacy link).
  useEffect(() => {
    if (legacyTarget) router.replace(legacyTarget)
  }, [legacyTarget, router])

  useEffect(() => {
    if (legacyTarget) return
    let cancelled = false
    const fetchData = async () => {
      try {
        const supabase = createClient()
        const [{ data: projectsData }, { data: productionsData }, draftsResponse, generationsResponse, providersResponse] = await Promise.all([
          supabase.from('projects').select('*').order('created_at', { ascending: false }),
          supabase.from('productions').select('*').order('updated_at', { ascending: false }),
          fetch('/api/video-drafts?limit=50'),
          fetch('/api/video-generations'),
          fetch('/api/settings/providers'),
        ])
        const draftsData = await draftsResponse.json()
        const generationsData = await generationsResponse.json()

        if (cancelled) return
        if (projectsData) setProjects(projectsData)
        if (productionsData) setProductions(productionsData)
        if (draftsResponse.ok) setDrafts(draftsData.drafts || [])
        else console.error('[v0] Video drafts load error:', draftsData)

        if (generationsResponse.ok) setGenerations(generationsData.generations || [])
        else console.error('[v0] Video generations load error:', generationsData)

        if (providersResponse.ok) {
          const providersPayload = await providersResponse.json()
          setKlingConfigured(providersPayload?.providers?.kling?.status === 'configured')
        } else {
          console.error('[v0] Provider status load error:', providersResponse.status)
        }

        setLoadError(null)
        setIsDataReady(true)
      } catch (error) {
        console.error('[v0] Video data load error:', error)
        if (!cancelled) setLoadError('Não foi possível carregar os dados. Verifique sua conexão e tente novamente.')
      }
    }
    fetchData()
    return () => { cancelled = true }
  }, [legacyTarget, retryKey])

  const hubCards = buildVideoDraftHubCards({ drafts, projects, productions })
  
  const generationCards = generations.map((g) => {
    const project = projects.find(p => p.id === g.project_id)
    const production = productions.find(p => p.id === g.production_id)
    return {
      id: g.id,
      kind: 'generation' as const,
      title: g.prompt || 'Geraçao IA',
      meta: `IA: ${g.mode === 'image_to_video' ? 'I2V' : 'T2V'}`,
      projectName: project?.name || 'Projeto Desconhecido',
      productionName: production?.title || 'Produção Desconhecida',
      status: g.status,
      updatedAt: g.updated_at,
      projectId: g.project_id || '',
      productionId: g.production_id || '',
      href: g.public_url || '#',
      productionHref: production ? `/projetos/${project?.id}/producoes/${production.id}` : undefined,
      generation: g
    }
  })

  // Mixed list
  const allCards = [
    ...hubCards.map(c => ({ ...c, kind: 'draft' as const })),
    ...generationCards
  ].sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
  
  const hubFilteredProductions = hubProjectFilter === 'all'
    ? productions
    : productions.filter((production) => production.project_id === hubProjectFilter)
  
  // Custom filter for mixed content since filterDraftHubCards expects DraftHubCard format
  const filteredHubCards = allCards.filter(card => {
    if (hubProjectFilter !== 'all' && card.projectId !== hubProjectFilter) return false
    if (hubProductionFilter !== 'all' && card.productionId !== hubProductionFilter) return false
    if (hubStatusFilter !== 'all') {
      if (hubStatusFilter === 'Rascunho' && card.kind !== 'draft') return false
      // maybe map status
    }
    if (hubSearch.trim()) {
      const q = hubSearch.toLowerCase()
      if (!card.title.toLowerCase().includes(q) &&
          !card.projectName.toLowerCase().includes(q) &&
          (!card.productionName || !card.productionName.toLowerCase().includes(q))) {
        return false
      }
    }
    return true
  })
  
  const hasHubFilters = hubProjectFilter !== 'all' || hubProductionFilter !== 'all' || hubStatusFilter !== 'all' || !!hubSearch.trim()
  const hubEmptyState = getDraftHubEmptyState({
    kind: 'video',
    projectCount: projects.length,
    productionCount: productions.length,
    totalDraftCount: allCards.length,
    filteredDraftCount: filteredHubCards.length,
    hasFilters: hasHubFilters,
    hasError: !!loadError,
  })
  const hubCreateProductions = getProductionsForProject(productions, hubCreateProjectId)
  const contextProduction = contextProductionId ? productions.find((production) => production.id === contextProductionId) ?? null : null
  const draftById = new Map(drafts.map((draft) => [draft.id, draft]))

  // CREATE → receive draft id → canonical Creative Editor (creating is not editing).
  const createInCreativeEditor = async () => {
    if (!hubCreateProjectId || !hubCreateProductionId || isCreatingInEditor) return
    setIsCreatingInEditor(true)
    const result = await createVideoDraftForCreativeEditor({ projectId: hubCreateProjectId, productionId: hubCreateProductionId })
    if (result.ok) {
      router.push(result.href)
      return
    }
    toast({ title: 'Erro', description: result.error, variant: 'destructive' })
    setIsCreatingInEditor(false)
  }
  const clearHubFilters = () => {
    setHubProjectFilter('all')
    setHubProductionFilter('all')
    setHubStatusFilter('all')
    setHubSearch('')
  }

  if (legacyTarget) {
    return (
      <div className="flex h-full items-center justify-center py-24" data-testid="legacy-video-redirect">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    )
  }

  const renderDraftActions = (item: (typeof filteredHubCards)[number], size: 'sm' | 'default') => {
    if (item.kind === 'generation') {
      return (
        <>
          <Button size={size} onClick={() => {
            if (item.generation.status === 'succeeded') {
              setSelectedVideoGeneration(item);
            } else {
              toast({ title: 'Aguardando', description: 'O vídeo ainda não está pronto.' })
            }
          }} className="gap-1">
            <Video className="h-4 w-4" />
            {item.generation.status === 'succeeded' ? 'Assistir' : item.generation.status}
          </Button>
          {item.productionHref && (
            <Button size={size} variant="outline" onClick={() => router.push(item.productionHref!)}>
              Ver Production
            </Button>
          )}
        </>
      )
    }

    return (
      <>
        <Button size={size} onClick={() => router.push(item.href)} className="gap-1" data-testid="open-in-creative-editor">
          <Clapperboard className="h-4 w-4" />
          Abrir Rascunho
          <ChevronRight className="h-4 w-4" />
        </Button>
        {draftById.get(item.id) && (
          <Button size={size} variant="outline" onClick={() => setPublicationDraft(draftById.get(item.id) ?? null)} className="gap-1" data-testid="prepare-publication">
            <Zap className="h-4 w-4" />
            Preparar publicação
          </Button>
        )}
        {item.productionHref && (
          <Button size={size} variant="outline" onClick={() => router.push(item.productionHref!)}>
            Ver Production
          </Button>
        )}
      </>
    )
  }

  return (
    <>
      <DashboardPage>
        {contextProductionId && contextProjectId && (
          <DashboardPageBar>
            <div className="flex items-center gap-3">
              <Button
                variant="ghost"
                size="sm"
                className="gap-2 text-muted-foreground hover:text-foreground"
                onClick={() => router.push(`/projetos/${contextProjectId}/producoes/${contextProductionId}`)}
              >
                <ArrowLeft className="h-4 w-4" />
                Voltar para a Produção
              </Button>
              {contextProduction?.title && (
                <span className="text-sm text-muted-foreground">· {contextProduction.title}</span>
              )}
            </div>
          </DashboardPageBar>
        )}
        <DashboardPageContent width="4xl" className="space-y-6">
          <PageHeader
            context="Criação"
            title="Vídeos"
            description="Crie um vídeo no Creative Editor dentro de uma Production ou retome um rascunho existente."
          />

          {loadError && (
            <StateMessage
              tone="error"
              title="Não foi possível carregar os dados de vídeo"
              description={loadError}
              actionLabel="Tentar novamente"
              onAction={() => setRetryKey((k) => k + 1)}
              compact
            />
          )}

          {loadError ? null : !isDataReady ? (
            <div className="flex flex-col items-center justify-center rounded-xl border border-border/50 bg-card/30 p-12 text-center">
              <Loader2 className="mb-3 h-8 w-8 animate-spin text-muted-foreground" />
              <h3 className="text-lg font-semibold text-foreground">{draftLoadingMessage('video', false)}</h3>
            </div>
          ) : (
            <div className="space-y-6">
              <section className="rounded-xl border border-border/50 bg-card/30 p-6 backdrop-blur-sm">
                <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                  <div className="space-y-2">
                    <div className="flex items-center gap-2">
                      <Video className="h-5 w-5 text-pink-300" />
                      <p className="text-sm font-medium text-foreground">Criação contextual</p>
                    </div>
                    <p className="max-w-2xl text-sm text-muted-foreground">
                      Todo vídeo é criado e editado no Creative Editor, dentro de um Project e de uma Production.
                    </p>
                  </div>
                  <div className="w-full rounded-lg border border-border/50 bg-background/40 p-4 lg:max-w-md">
                    <h2 className="text-base font-semibold text-foreground">Criar novo vídeo</h2>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Escolha o Project e a Production; o rascunho abre no Creative Editor.
                    </p>
                    <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-1">
                      <div className="space-y-2">
                        <Label htmlFor="video-hub-project">Project</Label>
                        <Select
                          value={hubCreateProjectId}
                          onValueChange={(value) => {
                            setHubCreateProjectId(value)
                            setHubCreateProductionId('')
                          }}
                        >
                          <SelectTrigger id="video-hub-project" className="bg-background/50">
                            <SelectValue placeholder="Selecione um Project" />
                          </SelectTrigger>
                          <SelectContent>
                            {projects.map((project) => (
                              <SelectItem key={project.id} value={project.id}>
                                {project.name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="video-hub-production">Production</Label>
                        <Select
                          value={hubCreateProductionId}
                          onValueChange={setHubCreateProductionId}
                          disabled={!hubCreateProjectId || hubCreateProductions.length === 0}
                        >
                          <SelectTrigger id="video-hub-production" className="bg-background/50">
                            <SelectValue placeholder="Selecione uma Production" />
                          </SelectTrigger>
                          <SelectContent>
                            {hubCreateProductions.map((production) => (
                              <SelectItem key={production.id} value={production.id}>
                                {getDraftHubProductionLabel(production, projects)}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                    {hubCreateProjectId && hubCreateProductions.length === 0 && (
                      <p className="mt-3 text-xs text-amber-200">
                        Este Project ainda nao possui Production. Crie uma Production antes de iniciar um video.
                      </p>
                    )}
                    
                    {klingConfigured === false && (
                      <StateMessage
                        tone="info"
                        title="Kling não configurado"
                        description="Adicione sua chave de API em Configurações para gerar vídeos com IA (Kling)."
                        actionLabel="Abrir Configurações"
                        onAction={() => router.push('/configuracoes?tab=api')}
                        compact
                        className="mt-3"
                      />
                    )}

                    <div className="flex flex-col gap-2 mt-4">
                      <Button
                        className="w-full gap-2 text-primary-foreground bg-primary hover:bg-primary/90"
                        onClick={() => setShowAiModal(true)}
                        disabled={!hubCreateProjectId || !hubCreateProductionId || klingConfigured === false}
                      >
                        <Zap className="h-4 w-4" />
                        Gerar Vídeo IA (Kling)
                      </Button>

                      <Button
                        variant="outline"
                        className="w-full gap-2 text-[rgb(58_58_72)] disabled:text-[rgb(102_102_118)]"
                        onClick={() => void createInCreativeEditor()}
                        disabled={!hubCreateProjectId || !hubCreateProductionId || isCreatingInEditor}
                        data-testid="create-in-creative-editor"
                      >
                        {isCreatingInEditor ? <Loader2 className="h-4 w-4 animate-spin" /> : <Clapperboard className="h-4 w-4" />}
                        Criar no Creative Editor
                      </Button>
                    </div>
                  </div>
                </div>
              </section>

              <section className="space-y-4" aria-labelledby="video-draft-filters">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
                  <div>
                    <h2 id="video-draft-filters" className="text-lg font-semibold text-foreground">
                      Rascunhos recentes
                    </h2>
                    <p className="text-sm text-muted-foreground">
                      Abra um rascunho no Creative Editor.
                    </p>
                  </div>
                  <ViewModeToggle value={hubViewMode} onValueChange={setHubViewMode} />
                </div>

                <div className="grid gap-3 rounded-xl border border-border/50 bg-card/30 p-4 sm:grid-cols-2 lg:grid-cols-4">
                  <div className="space-y-2">
                    <Label htmlFor="video-filter-search">Buscar</Label>
                    <div className="relative">
                      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                      <Input
                        id="video-filter-search"
                        value={hubSearch}
                        onChange={(event) => setHubSearch(event.target.value)}
                        placeholder="Titulo, Project ou Production"
                        className="bg-background/50 pl-9"
                      />
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="video-filter-project">Project</Label>
                    <Select
                      value={hubProjectFilter}
                      onValueChange={(value) => {
                        setHubProjectFilter(value)
                        setHubProductionFilter('all')
                      }}
                    >
                      <SelectTrigger id="video-filter-project" className="bg-background/50">
                        <SelectValue />
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
                    <Label htmlFor="video-filter-production">Production</Label>
                    <Select value={hubProductionFilter} onValueChange={setHubProductionFilter}>
                      <SelectTrigger id="video-filter-production" className="bg-background/50">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">Todas as Productions</SelectItem>
                        {hubFilteredProductions.map((production) => (
                          <SelectItem key={production.id} value={production.id}>
                            {getDraftHubProductionLabel(production, projects)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="video-filter-status">Status</Label>
                    <Select value={hubStatusFilter} onValueChange={setHubStatusFilter}>
                      <SelectTrigger id="video-filter-status" className="bg-background/50">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">Todos os status</SelectItem>
                        <SelectItem value="Rascunho">Rascunho</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                {hubEmptyState ? (
                  <div className="rounded-xl border border-dashed border-border/50 bg-card/30 p-10 text-center">
                    <h3 className="text-lg font-semibold text-foreground">{hubEmptyState.title}</h3>
                    <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">
                      {hubEmptyState.description}
                    </p>
                    {hubEmptyState.kind === 'no-filter-results' ? (
                      <Button className="mt-4" variant="outline" onClick={clearHubFilters}>
                        Limpar filtros
                      </Button>
                    ) : hubEmptyState.href && hubEmptyState.actionLabel ? (
                      <Button className="mt-4" onClick={() => router.push(hubEmptyState.href!)}>
                        {hubEmptyState.actionLabel}
                      </Button>
                    ) : null}
                  </div>
                ) : hubViewMode === 'list' ? (
                  <div role="list" className="space-y-2">
                    {filteredHubCards.map((item) => (
                      <Card
                        key={`list-${item.kind}-${item.id}`}
                        role="listitem"
                        className="border-border/50 bg-card/30 transition-colors hover:border-border hover:bg-card/50"
                      >
                        <CardContent className="grid gap-3 p-4 md:grid-cols-[minmax(0,1fr)_auto] md:items-start">
                          <div className="min-w-0 space-y-3">
                            <div className="min-w-0">
                              <div className="flex items-center gap-2">
                                <Video className="h-4 w-4 shrink-0 text-pink-300" aria-hidden="true" />
                                <CardTitle className="truncate text-sm" title={item.title}>
                                  {item.title}
                                </CardTitle>
                              </div>
                              <p className="mt-1 text-xs text-muted-foreground">{item.meta}</p>
                            </div>
                            <ContextMetadata
                              dense
                              items={[
                                { label: 'Project', value: item.projectName, title: item.projectName },
                                { label: 'Production', value: item.productionName || 'Sem Production associada', title: item.productionName || 'Sem Production associada' },
                                { label: 'Status', value: <StatusBadge label={item.status} tone="neutral" /> },
                                { label: 'Atualizado', value: new Date(item.updatedAt).toLocaleDateString('pt-BR') },
                              ]}
                            />
                          </div>
                          <CardActions className="flex flex-wrap gap-2 md:justify-end">
                            {renderDraftActions(item, 'sm')}
                          </CardActions>
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                ) : (
                  <div className="grid gap-4 md:grid-cols-2">
                    {filteredHubCards.map((item) => (
                      <Card key={`grid-${item.kind}-${item.id}`} className="border-border/50 bg-card/30 backdrop-blur-sm">
                        <CardContent className="space-y-4 p-4">
                          <div className="flex items-start gap-3">
                            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-pink-500/15">
                              <Video className="h-5 w-5 text-pink-300" />
                            </div>
                            <div className="min-w-0 flex-1">
                              <CardTitle className="line-clamp-2 text-base" title={item.title}>
                                {item.title}
                              </CardTitle>
                              <p className="mt-1 text-xs text-muted-foreground">{item.meta}</p>
                            </div>
                          </div>
                          <ContextMetadata
                            dense
                            items={[
                              { label: 'Project', value: item.projectName, title: item.projectName },
                              { label: 'Production', value: item.productionName || 'Sem Production associada', title: item.productionName || 'Sem Production associada' },
                              { label: 'Status', value: <StatusBadge label={item.status} tone="neutral" /> },
                              { label: 'Atualizado', value: new Date(item.updatedAt).toLocaleString('pt-BR') },
                            ]}
                          />
                          <CardActions className="flex flex-wrap gap-2">
                            {renderDraftActions(item, 'default')}
                          </CardActions>
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                )}
              </section>
            </div>
          )}
        </DashboardPageContent>
      </DashboardPage>

      {/* Publication preparation (non-authoring): the only capability of the retired workspace not owned by the Creative Editor. */}
      <QuickFlowDialog
        open={Boolean(publicationDraft)}
        onOpenChange={(open) => { if (!open) setPublicationDraft(null) }}
        projects={projects}
        lockedProjectId={publicationDraft?.project_id ?? undefined}
        lockedProductionId={publicationDraft?.production_id ?? undefined}
        initialTitle={publicationDraft?.name ?? ''}
        initialBody={(publicationDraft?.scenes ?? [])
          .map((s) => s.description)
          .filter(Boolean)
          .join('\n\n')
          .slice(0, 3000)}
        initialAiContext={(publicationDraft?.scenes ?? [])
          .map((s) => s.prompt)
          .filter(Boolean)
          .join('\n')
          .slice(0, 1500)}
        sourceLabel={publicationDraft?.name || undefined}
      />
      
      <CreateVideoGenerationDialog 
        open={showAiModal}
        onOpenChange={setShowAiModal}
        projectId={hubCreateProjectId}
        productionId={hubCreateProductionId}
        onSuccess={() => setRetryKey((k) => k + 1)}
      />
          <VideoGenerationPreviewDialog
        item={selectedVideoGeneration}
        onOpenChange={(open) => {
          if (!open) setSelectedVideoGeneration(null)
        }}
        onNavigate={(href) => router.push(href)}
      />
    </>
  )
}

export default function VideosPage() {
  return (
    <Suspense fallback={
      <div className="flex h-full items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    }>
      <VideosPageContent />
    </Suspense>
  )
}

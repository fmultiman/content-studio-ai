'use client'

import { useState, useEffect, Suspense, useRef } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Header } from '@/components/layout/header'
import { SceneCard } from '@/components/videos/scene-card'
import { StoryboardModal } from '@/components/videos/storyboard-modal'
import { WorkspaceIdentityContext } from '@/components/projects/inherited-project-identity'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { ViewModeToggle, useViewModePreference } from '@/components/ui/view-mode-toggle'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Plus, Video, Play, Loader2, Save, FileText, ChevronRight, PanelsTopLeft, ArrowLeft, Zap, Search } from 'lucide-react'
import { useToast } from '@/hooks/use-toast'
import type { Project, Production, VideoScene, VideoDraft } from '@/lib/types'
import type { ProjectIdentity } from '@/lib/schemas/project-identity'
import { QuickFlowDialog } from '@/components/publication/quick-flow-dialog'
import { normalizeProjectIdentity } from '@/lib/project-identity-normalizer'
import { resolveInheritedIdentitySummary } from '@/lib/inherited-project-identity'
import { draftLoadingMessage } from '@/lib/ux-production-hardening'
import {
  buildVideoDraftHubCards,
  filterDraftHubCards,
  getDraftHubEmptyState,
  getDraftHubProductionLabel,
  getProductionsForProject,
} from '@/lib/draft-hub'

function VideosPageContent() {
  const { toast } = useToast()
  const router = useRouter()
  const searchParams = useSearchParams()
  
  const [projects, setProjects] = useState<Project[]>([])
  const [productions, setProductions] = useState<Production[]>([])
  const [selectedProject, setSelectedProject] = useState<string | null>(null)
  const [productionId, setProductionId] = useState<string | null>(null)
  const [productionTitle, setProductionTitle] = useState<string | null>(null)
  const [productionProjectId, setProductionProjectId] = useState<string | null>(null)
  const [drafts, setDrafts] = useState<VideoDraft[]>([])
  const [currentDraftId, setCurrentDraftId] = useState<string | null>(null)
  
  const [videoName, setVideoName] = useState('')
  const [scenes, setScenes] = useState<VideoScene[]>([])
  const [isGenerating, setIsGenerating] = useState(false)
  const [isSavingDraft, setIsSavingDraft] = useState(false)
  const [isLoadingProjects, setIsLoadingProjects] = useState(true)
  const [isLoadingDrafts, setIsLoadingDrafts] = useState(true)
  const [isDataReady, setIsDataReady] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [retryKey, setRetryKey] = useState(0)
  const [showStoryboard, setShowStoryboard] = useState(false)
  const [showQuickFlowDialog, setShowQuickFlowDialog] = useState(false)
  const [hubProjectFilter, setHubProjectFilter] = useState('all')
  const [hubProductionFilter, setHubProductionFilter] = useState('all')
  const [hubStatusFilter, setHubStatusFilter] = useState('all')
  const [hubSearch, setHubSearch] = useState('')
  const [hubCreateProjectId, setHubCreateProjectId] = useState('')
  const [hubCreateProductionId, setHubCreateProductionId] = useState('')
  const [hubViewMode, setHubViewMode] = useViewModePreference('video-draft-hub-view', 'list')
  const sceneRefs = useRef<Record<string, HTMLDivElement | null>>({})

  // Fetch projects and drafts on mount
  useEffect(() => {
    let cancelled = false
    setLoadError(null)

    const fetchData = async () => {
      // Apply URL params before any await so the banner and project selector
      // are visible even when subsequent async fetches fail.
      const projectId = searchParams.get('project')
      const prodId = searchParams.get('production')
      if (projectId) setSelectedProject(projectId)
      if (prodId) setProductionId(prodId)

      try {
        const supabase = createClient()

        const { data: projectsData } = await supabase
          .from('projects')
          .select('*')
          .order('created_at', { ascending: false })

        if (!cancelled && projectsData) setProjects(projectsData)

        const { data: productionsData } = await supabase
          .from('productions')
          .select('*')
          .order('updated_at', { ascending: false })

        if (!cancelled && productionsData) setProductions(productionsData)
        if (!cancelled) setIsLoadingProjects(false)

        const draftsResponse = await fetch('/api/video-drafts?limit=50')
        const draftsData = await draftsResponse.json()

        if (!cancelled) {
          if (draftsResponse.ok) {
            setDrafts(draftsData.drafts || [])
          } else {
            console.error('[v0] Video drafts load error:', draftsData)
          }
          setIsLoadingDrafts(false)
        }

        const draftId = searchParams.get('draft')
        if (draftId && !cancelled) {
          const draftResponse = await fetch(`/api/video-drafts?id=${draftId}`)
          const draftPayload = await draftResponse.json()

          if (draftResponse.ok && draftPayload.draft && !cancelled) {
            const draftData = draftPayload.draft as VideoDraft
            setCurrentDraftId(draftData.id)
            setVideoName(draftData.name)
            setSelectedProject(draftData.project_id)
            if (draftData.production_id) setProductionId(draftData.production_id)
            setScenes(draftData.scenes || [])
          } else if (!draftResponse.ok) {
            console.error('[v0] Video draft load error:', draftPayload)
          }
        }

        if (prodId && !cancelled) {
          const prodRes = await fetch(`/api/productions/${prodId}`)
          if (prodRes.ok && !cancelled) {
            const prodData = await prodRes.json()
            if (!cancelled) {
              setProductionTitle(prodData.production?.title || null)
              setProductionProjectId(prodData.production?.project_id || null)
            }
          }
        }

        if (!cancelled) setIsDataReady(true)
      } catch (error) {
        console.error('[v0] Video data load error:', error)
        if (!cancelled) {
          setLoadError('Não foi possível carregar os dados. Verifique sua conexão e tente novamente.')
        }
      } finally {
        if (!cancelled) {
          setIsLoadingProjects(false)
          setIsLoadingDrafts(false)
        }
      }
    }

    fetchData()
    return () => { cancelled = true }
  }, [searchParams, retryKey])

  useEffect(() => {
    if (!isDataReady) return

    const autoSaveDraft = async () => {
      if (!productionId) return
      const hasSceneContent = scenes.some((scene) =>
        scene.description.trim() ||
        scene.prompt?.trim() ||
        scene.image_url
      )

      if (!videoName.trim() && !hasSceneContent) return

      try {
        const firstSceneDescription = scenes
          .find((scene) => scene.description.trim())
          ?.description.trim()

        const draftName =
          videoName.trim() ||
          firstSceneDescription?.slice(0, 50) ||
          'Auto-save'

        const response = await fetch('/api/video-drafts', {
          method: currentDraftId ? 'PATCH' : 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            id: currentDraftId,
            name: draftName,
            projectId: selectedProject,
            productionId,
            scenes,
          }),
        })
        const data = await response.json()

        if (!response.ok) {
          throw new Error(data.error || 'Erro ao salvar rascunho')
        }

        if (data.draft) {
          setCurrentDraftId(data.draft.id)
          setDrafts((prev) => {
            const withoutCurrent = prev.filter((draft) => draft.id !== data.draft.id)
            return [data.draft, ...withoutCurrent].slice(0, 5)
          })
        }
      } catch (error) {
        console.error('[v0] Video auto-save error:', error)
      }
    }

    const timeoutId = window.setTimeout(autoSaveDraft, 800)

    const handleBeforeUnload = () => {
      autoSaveDraft()
    }

    window.addEventListener('beforeunload', handleBeforeUnload)

    return () => {
      window.clearTimeout(timeoutId)
      window.removeEventListener('beforeunload', handleBeforeUnload)
    }
  }, [videoName, scenes, selectedProject, productionId, currentDraftId, isDataReady])

  const addScene = () => {
    const newScene: VideoScene = {
      id: crypto.randomUUID(),
      order: scenes.length + 1,
      description: '',
      prompt: null,
      image_url: null,
      duration: 3,
      movement: 'static',
    }
    setScenes([...scenes, newScene])
  }

  const updateScene = (index: number, updatedScene: VideoScene) => {
    const newScenes = [...scenes]
    newScenes[index] = updatedScene
    setScenes(newScenes)
  }

  const deleteScene = (index: number) => {
    const newScenes = scenes.filter((_, i) => i !== index)
    newScenes.forEach((scene, i) => {
      scene.order = i + 1
    })
    setScenes(newScenes)
  }

  const handleGenerateScenePrompt = async (
    scene: VideoScene,
    sceneNumber: number,
  ) => {
    const response = await fetch('/api/videos/generate-scene-prompt', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        description: scene.description,
        sceneNumber,
        duration: scene.duration,
        movement: scene.movement,
        projectId: selectedProject,
        videoName,
      }),
    })

    const data = await response.json()

    if (!response.ok) {
      throw new Error(data.error || 'Erro ao gerar prompt da cena')
    }

    return data.prompt as string
  }

  const handleSaveDraft = async (showToast = true) => {
    const hasSceneContent = scenes.some((scene) =>
      scene.description.trim() ||
      scene.prompt?.trim() ||
      scene.image_url
    )

    if (!videoName.trim() && !hasSceneContent) {
      if (showToast) {
        toast({
          title: 'Nome obrigatorio',
          description: 'Por favor, insira um nome ou uma cena para o video.',
          variant: 'destructive',
        })
      }
      return null
    }

    if (!productionId) {
      if (showToast) {
        toast({
          title: 'Production obrigatória',
          description: 'Acesse esta página a partir de uma Production para salvar o rascunho.',
          variant: 'destructive',
        })
      }
      return null
    }

    setIsSavingDraft(true)

    try {
      const firstSceneDescription = scenes
        .find((scene) => scene.description.trim())
        ?.description.trim()

      const draftName =
        videoName.trim() ||
        firstSceneDescription?.slice(0, 50) ||
        'Rascunho sem titulo'

      const response = await fetch('/api/video-drafts', {
        method: currentDraftId ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: currentDraftId,
          name: draftName,
          projectId: selectedProject,
          productionId,
          scenes,
        }),
      })
      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || 'Erro ao salvar rascunho')
      }

      if (data.draft) {
        setCurrentDraftId(data.draft.id)
          if (data.draft.production_id) setProductionId(data.draft.production_id)
          setDrafts((prev) => {
          const withoutCurrent = prev.filter((draft) => draft.id !== data.draft.id)
          return [data.draft, ...withoutCurrent].slice(0, 5)
        })
      }

      if (showToast) {
        toast({
          title: currentDraftId ? 'Rascunho atualizado!' : 'Rascunho salvo!',
          description: currentDraftId
            ? 'As alterações foram salvas.'
            : 'Voce pode continuar editando mais tarde.',
        })
      }

      return data.draft || null
    } catch (error) {
      console.error('[v0] Video draft save error:', error)
      if (showToast) {
        toast({
          title: 'Erro',
          description: 'Nao foi possivel salvar o rascunho.',
          variant: 'destructive',
        })
      }
      return null
    } finally {
      setIsSavingDraft(false)
    }
  }

  const loadDraft = async (draft: VideoDraft) => {
    if (currentDraftId !== draft.id) {
      await handleSaveDraft(false)
    }

    setCurrentDraftId(draft.id)
    setVideoName(draft.name)
    setSelectedProject(draft.project_id)
    if (draft.production_id && !productionId) {
      setProductionId(draft.production_id)
      fetch(`/api/productions/${draft.production_id}`)
        .then((r) => r.ok ? r.json() : null)
        .then((d) => {
          if (d?.production) {
            setProductionTitle(d.production.title || null)
            setProductionProjectId(d.production.project_id || null)
          }
        })
        .catch(() => null)
    }
    setScenes(draft.scenes || [])

    toast({
      title: 'Rascunho carregado',
      description: `"${draft.name}" foi carregado para edição.`,
    })
  }

  const handleGenerateVideo = async () => {
    if (!videoName.trim()) {
      toast({
        title: 'Nome obrigatório',
        description: 'Por favor, insira um nome para o vídeo.',
        variant: 'destructive',
      })
      return
    }

    if (scenes.length === 0) {
      toast({
        title: 'Sem cenas',
        description: 'Adicione pelo menos uma cena ao vídeo.',
        variant: 'destructive',
      })
      return
    }

    setIsGenerating(true)

    // Simulate video generation
    await new Promise(resolve => setTimeout(resolve, 3000))

    toast({
      title: 'Vídeo em processamento!',
      description: 'Este é um fluxo simulado. A integração com API real será adicionada em breve.',
    })

    setIsGenerating(false)
  }

  const clearForm = () => {
    setVideoName('')
    setScenes([])
    setCurrentDraftId(null)
    // Production context and project are preserved intentionally:
    // creating a new video within a Production keeps the workspace context.
  }

  const handleNewVideo = async () => {
    await handleSaveDraft(false)
    clearForm()
  }

  const totalDuration = scenes.reduce((acc, scene) => acc + scene.duration, 0)

  const handleSelectStoryboardScene = (index: number) => {
    const scene = scenes[index]
    setShowStoryboard(false)

    window.setTimeout(() => {
      sceneRefs.current[scene.id]?.scrollIntoView({
        behavior: 'smooth',
        block: 'center',
      })
    }, 100)
  }

  const requestedDraftId = searchParams.get('draft')
  const selectedProjectData = selectedProject
    ? projects.find((project) => project.id === selectedProject) ?? null
    : null
  let videoIdentity: ProjectIdentity | null = null
  let videoIdentityReadError = false

  try {
    videoIdentity = normalizeProjectIdentity(selectedProjectData?.identity ?? null)
  } catch {
    videoIdentityReadError = true
  }

  const videoIdentitySummary = resolveInheritedIdentitySummary({
    identity: videoIdentity,
    projectName: selectedProjectData?.name,
    hasLegacyContext: !!selectedProjectData?.context?.trim(),
    readError: videoIdentityReadError,
    isLoading: !isDataReady,
  })
  const projectIdentityHref = selectedProjectData
    ? `/projetos/${selectedProjectData.id}#project-identity`
    : undefined
  const productionHref =
    productionId && (productionProjectId || selectedProject)
      ? `/projetos/${productionProjectId || selectedProject}/producoes/${productionId}`
      : undefined
  const hubCards = buildVideoDraftHubCards({ drafts, projects, productions })
  const hubFilteredProductions = hubProjectFilter === 'all'
    ? productions
    : productions.filter((production) => production.project_id === hubProjectFilter)
  const filteredHubCards = filterDraftHubCards(hubCards, {
    projectId: hubProjectFilter,
    productionId: hubProductionFilter,
    status: hubStatusFilter,
    search: hubSearch,
  })
  const hasHubFilters = hubProjectFilter !== 'all' || hubProductionFilter !== 'all' || hubStatusFilter !== 'all' || !!hubSearch.trim()
  const hubEmptyState = getDraftHubEmptyState({
    kind: 'video',
    projectCount: projects.length,
    productionCount: productions.length,
    totalDraftCount: hubCards.length,
    filteredDraftCount: filteredHubCards.length,
    hasFilters: hasHubFilters,
    hasError: !!loadError,
  })
  const hubCreateProductions = getProductionsForProject(productions, hubCreateProjectId)
  const openVideoWorkspace = () => {
    if (!hubCreateProjectId || !hubCreateProductionId) return
    router.push(`/videos?project=${hubCreateProjectId}&production=${hubCreateProductionId}`)
  }
  const clearHubFilters = () => {
    setHubProjectFilter('all')
    setHubProductionFilter('all')
    setHubStatusFilter('all')
    setHubSearch('')
  }
  const renderVideoHub = () => (
    <div className="space-y-6">
      <section className="rounded-xl border border-border/50 bg-card/30 p-6 backdrop-blur-sm">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <Video className="h-5 w-5 text-pink-300" />
              <p className="text-sm font-medium text-foreground">Criação contextual</p>
            </div>
            <p className="max-w-2xl text-sm text-muted-foreground">
              Crie um novo vídeo dentro de uma Production ou retome um rascunho existente.
            </p>
          </div>
          <div className="w-full rounded-lg border border-border/50 bg-background/40 p-4 lg:max-w-md">
            <h2 className="text-base font-semibold text-foreground">Criar novo vídeo</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              Escolha o Project e a Production para abrir o workspace contextual.
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              A identidade do Project estará disponível como referência na Production.
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
            <Button
              className="mt-4 w-full"
              onClick={openVideoWorkspace}
              disabled={!hubCreateProjectId || !hubCreateProductionId}
            >
              Criar na Production
            </Button>
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
              Retome trabalhos no Project e na Production corretos.
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
          <div className="overflow-hidden rounded-xl border border-border/50 bg-card/30">
            <div className="hidden grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)_minmax(0,1fr)_120px_150px_170px] gap-3 border-b border-border/50 px-4 py-2 text-xs font-medium text-muted-foreground md:grid">
              <span>Titulo</span>
              <span>Project</span>
              <span>Production</span>
              <span>Status</span>
              <span>Atualizado</span>
              <span>Acoes</span>
            </div>
            <div role="list" className="divide-y divide-border/50">
              {filteredHubCards.map((draft) => (
                <div
                  key={draft.id}
                  role="listitem"
                  className="grid gap-3 px-4 py-4 md:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)_minmax(0,1fr)_120px_150px_170px] md:items-center"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <Video className="h-4 w-4 shrink-0 text-pink-300" aria-hidden="true" />
                      <span className="truncate font-medium text-foreground" title={draft.title}>
                        {draft.title}
                      </span>
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground md:hidden">
                      Atualizado em {new Date(draft.updatedAt).toLocaleString('pt-BR')}
                    </p>
                  </div>
                  <div className="min-w-0">
                    <span className="text-xs text-muted-foreground md:hidden">Project: </span>
                    <span className="truncate text-sm text-foreground" title={draft.projectName}>
                      {draft.projectName}
                    </span>
                  </div>
                  <div className="min-w-0">
                    <span className="text-xs text-muted-foreground md:hidden">Production: </span>
                    <span className="truncate text-sm text-foreground" title={draft.productionName || 'Sem Production associada'}>
                      {draft.productionName || 'Sem Production associada'}
                    </span>
                  </div>
                  <div>
                    <Badge variant="outline">{draft.status}</Badge>
                  </div>
                  <div className="hidden text-sm text-muted-foreground md:block">
                    {new Date(draft.updatedAt).toLocaleDateString('pt-BR')}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button size="sm" onClick={() => router.push(draft.href)} className="gap-1">
                      Abrir
                      <ChevronRight className="h-4 w-4" />
                    </Button>
                    {draft.productionHref && (
                      <Button size="sm" variant="outline" onClick={() => router.push(draft.productionHref!)}>
                        Ver Production
                      </Button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div className="grid gap-4 md:grid-cols-2">
            {filteredHubCards.map((draft) => (
              <Card key={draft.id} className="border-border/50 bg-card/30 backdrop-blur-sm">
                <CardContent className="space-y-4 p-4">
                  <div className="flex items-start gap-3">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-pink-500/15">
                      <Video className="h-5 w-5 text-pink-300" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge variant="secondary">Video</Badge>
                        <Badge variant="outline">{draft.status}</Badge>
                      </div>
                      <h3 className="mt-2 line-clamp-2 font-semibold text-foreground" title={draft.title}>
                        {draft.title}
                      </h3>
                      <p className="mt-1 text-xs text-muted-foreground">
                        Atualizado em {new Date(draft.updatedAt).toLocaleString('pt-BR')}
                      </p>
                    </div>
                  </div>
                  <dl className="grid gap-2 text-sm sm:grid-cols-2">
                    <div>
                      <dt className="text-xs text-muted-foreground">Project</dt>
                      <dd className="truncate text-foreground" title={draft.projectName}>{draft.projectName}</dd>
                    </div>
                    <div>
                      <dt className="text-xs text-muted-foreground">Production</dt>
                      <dd className="truncate text-foreground" title={draft.productionName || 'Sem Production associada'}>
                        {draft.productionName || 'Sem Production associada'}
                      </dd>
                    </div>
                  </dl>
                  <p className="text-xs text-muted-foreground">{draft.meta}</p>
                  <div className="flex flex-wrap gap-2">
                    <Button onClick={() => router.push(draft.href)} className="gap-2">
                      Abrir
                      <ChevronRight className="h-4 w-4" />
                    </Button>
                    {draft.productionHref && (
                      <Button variant="outline" onClick={() => router.push(draft.productionHref!)}>
                        Ver Production
                      </Button>
                    )}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </section>
    </div>
  )

  return (
    <>
      <Header title={productionId ? 'Geração de Vídeos' : 'Vídeos'} />
      {productionId && (
        <div className="flex items-center gap-3 border-b border-border/50 bg-card/30 px-6 py-2">
          <Button
            variant="ghost"
            size="sm"
            className="gap-2 text-muted-foreground hover:text-foreground"
            onClick={() => {
              const projId = productionProjectId || selectedProject
              if (projId && productionId) {
                router.push(`/projetos/${projId}/producoes/${productionId}`)
              } else {
                router.back()
              }
            }}
          >
            <ArrowLeft className="h-4 w-4" />
            Voltar para a Produção
          </Button>
          {productionTitle && (
            <span className="text-sm text-muted-foreground">
              · {productionTitle}
            </span>
          )}
        </div>
      )}
      <div className="flex-1 overflow-auto p-6">
        <div className="mx-auto max-w-4xl space-y-6">
          {loadError && (
            <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-4">
              <p className="text-sm text-destructive">{loadError}</p>
              <button
                className="mt-2 rounded border border-destructive/40 px-3 py-1 text-xs text-destructive hover:bg-destructive/20"
                onClick={() => setRetryKey((k) => k + 1)}
              >
                Tentar novamente
              </button>
            </div>
          )}
          {/* Drafts Section */}
          {productionId && !isLoadingDrafts && drafts.length > 0 && (
            <Card className="border-border/50 bg-card/30 backdrop-blur-sm">
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <FileText className="h-5 w-5 text-muted-foreground" />
                    <CardTitle className="text-base">Rascunhos</CardTitle>
                    <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                      {drafts.length}
                    </span>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => router.push('/videos/rascunhos')}
                    className="gap-1 text-sm"
                  >
                    Ver todos
                    <ChevronRight className="h-4 w-4" />
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="pt-0">
                <div className="flex gap-2 overflow-x-auto pb-2">
                  {drafts.slice(0, 3).map((draft) => (
                    <button
                      key={draft.id}
                      onClick={() => loadDraft(draft)}
                      className="flex min-w-[180px] flex-col rounded-lg border border-border/50 bg-background/50 p-3 text-left transition-colors hover:bg-background/80"
                    >
                      <span className="font-medium text-foreground line-clamp-1">
                        {draft.name}
                      </span>
                      <span className="mt-1 text-xs text-muted-foreground">
                        {(draft.scenes || []).length} cenas
                      </span>
                    </button>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {loadError ? null : !isDataReady ? (
            <div className="flex flex-col items-center justify-center rounded-xl border border-border/50 bg-card/30 p-12 text-center">
              <Loader2 className="mb-3 h-8 w-8 animate-spin text-muted-foreground" />
              <h3 className="text-lg font-semibold text-foreground">
                {draftLoadingMessage('video', !!requestedDraftId)}
              </h3>
            </div>
          ) : !productionId ? (
            renderVideoHub()
          ) : (
          <>
          {selectedProjectData && (
            <WorkspaceIdentityContext
              surface="video"
              summary={videoIdentitySummary}
              productionTitle={productionTitle}
              projectHref={projectIdentityHref}
              productionHref={productionHref}
            />
          )}

          {/* Video Settings */}
          <Card className="border-border/50 bg-card/30 backdrop-blur-sm">
            <CardHeader>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-gradient-to-br from-pink-500 to-pink-400">
                    <Video className="h-5 w-5 text-white" />
                  </div>
                  <div>
                    <CardTitle>
                      {currentDraftId ? 'Editando Rascunho' : 'Novo Vídeo'}
                    </CardTitle>
                    <p className="text-sm text-muted-foreground">
                      Crie vídeos a partir de cenas personalizadas
                    </p>
                  </div>
                </div>
                {/* Action Buttons - Fixed Position */}
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    onClick={() => handleSaveDraft()}
                    disabled={isSavingDraft || (!videoName.trim() && scenes.length === 0)}
                    className="gap-2"
                  >
                    {isSavingDraft ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Save className="h-4 w-4" />
                    )}
                    Salvar Rascunho
                  </Button>
                  <Button
                    variant="outline"
                    onClick={handleNewVideo}
                    className="gap-2"
                  >
                    <Plus className="h-4 w-4" />
                    Novo Vídeo
                  </Button>
                  <Button
                    onClick={handleGenerateVideo}
                    disabled={isGenerating || scenes.length === 0 || !videoName.trim()}
                    className="gap-2 bg-gradient-to-r from-pink-500 to-violet-500 text-white hover:from-pink-600 hover:to-violet-600"
                  >
                    {isGenerating ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Play className="h-4 w-4" />
                    )}
                    Gerar Vídeo
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => setShowQuickFlowDialog(true)}
                    disabled={!videoName.trim() && scenes.length === 0}
                    className="gap-2"
                  >
                    <Zap className="h-4 w-4" />
                    Preparar publicação
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Project Selector */}
              <div className="space-y-2">
                <Label htmlFor="project">Projeto</Label>
                <Select
                  value={selectedProject || ''}
                  onValueChange={(value) => setSelectedProject(value || null)}
                  disabled={isLoadingProjects}
                >
                  <SelectTrigger className="bg-background/50">
                    <SelectValue placeholder="Selecione um projeto (opcional)" />
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

              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="video-name">Nome do Vídeo</Label>
                  <Input
                    id="video-name"
                    placeholder="Ex: Teaser Produto X"
                    value={videoName}
                    onChange={(e) => setVideoName(e.target.value)}
                    className="bg-background/50"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Informações</Label>
                  <div className="flex h-10 items-center gap-4 rounded-lg border border-border/50 bg-background/50 px-3">
                    <span className="text-sm text-muted-foreground">
                      {scenes.length} {scenes.length === 1 ? 'cena' : 'cenas'}
                    </span>
                    <span className="text-border">|</span>
                    <span className="text-sm text-muted-foreground">
                      {totalDuration}s total
                    </span>
                  </div>
                </div>
              </div>

              {currentDraftId && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleNewVideo}
                  className="text-muted-foreground"
                >
                  Limpar e criar novo
                </Button>
              )}
            </CardContent>
          </Card>

          {/* Scenes */}
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold text-foreground">Cenas</h2>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  onClick={() => setShowStoryboard(true)}
                  disabled={scenes.length === 0}
                  className="gap-2"
                >
                  <PanelsTopLeft className="h-4 w-4" />
                  Storyboard
                </Button>
                <Button variant="outline" onClick={addScene} className="gap-2">
                  <Plus className="h-4 w-4" />
                  Adicionar Cena
                </Button>
              </div>
            </div>

            {scenes.length === 0 ? (
              <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border/50 bg-card/30 p-12 text-center">
                <Video className="mb-4 h-12 w-12 text-muted-foreground" />
                <h3 className="text-lg font-semibold text-foreground">
                  Nenhuma cena ainda
                </h3>
                <p className="mt-1 text-sm text-muted-foreground">
                  Adicione cenas para começar a criar seu vídeo.
                </p>
                <Button onClick={addScene} className="mt-4 gap-2">
                  <Plus className="h-4 w-4" />
                  Adicionar Primeira Cena
                </Button>
              </div>
            ) : (
              <div className="space-y-4">
                {scenes.map((scene, index) => (
                  <div
                    key={scene.id}
                    ref={(element) => {
                      sceneRefs.current[scene.id] = element
                    }}
                  >
                    <SceneCard
                      scene={scene}
                      sceneNumber={index + 1}
                      onUpdate={(updatedScene) => updateScene(index, updatedScene)}
                      onDelete={() => deleteScene(index)}
                      onGeneratePrompt={handleGenerateScenePrompt}
                    />
                  </div>
                ))}
              </div>
            )}
          </div>

          

          {/* Info Card */}
          <Card className="border-amber-500/20 bg-amber-500/5">
            <CardContent className="p-4">
              <p className="text-sm text-amber-200/80">
                <strong>Nota:</strong> Este módulo está preparado para integração futura com APIs de geração de vídeo.
                Atualmente, o fluxo é simulado para demonstrar a estrutura da interface.
              </p>
            </CardContent>
          </Card>
          </>
          )}
        </div>
      </div>

      <StoryboardModal
        open={showStoryboard}
        onOpenChange={setShowStoryboard}
        scenes={scenes}
        videoName={videoName}
        onSelectScene={handleSelectStoryboardScene}
      />

      <QuickFlowDialog
        open={showQuickFlowDialog}
        onOpenChange={setShowQuickFlowDialog}
        projects={projects}
        lockedProjectId={selectedProject ?? undefined}
        lockedProductionId={productionId ?? undefined}
        initialTitle={videoName}
        initialBody={scenes
          .map((s) => s.description)
          .filter(Boolean)
          .join('\n\n')
          .slice(0, 3000)}
        initialAiContext={scenes
          .map((s) => s.prompt)
          .filter(Boolean)
          .join('\n')
          .slice(0, 1500)}
        sourceLabel={videoName || undefined}
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

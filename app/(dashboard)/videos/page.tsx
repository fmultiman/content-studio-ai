'use client'

import { useState, useEffect, Suspense, useRef } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Header } from '@/components/layout/header'
import { SceneCard } from '@/components/videos/scene-card'
import { StoryboardModal } from '@/components/videos/storyboard-modal'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Plus, Video, Play, Loader2, Save, FileText, ChevronRight, PanelsTopLeft, ArrowLeft } from 'lucide-react'
import { useToast } from '@/hooks/use-toast'
import type { Project, VideoScene, VideoDraft } from '@/lib/types'

function VideosPageContent() {
  const { toast } = useToast()
  const router = useRouter()
  const searchParams = useSearchParams()
  
  const [projects, setProjects] = useState<Project[]>([])
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
        if (!cancelled) setIsLoadingProjects(false)

        const draftsResponse = await fetch('/api/video-drafts?limit=5')
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
            ? 'As alteracoes foram salvas.'
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

  return (
    <>
      <Header title="Geração de Vídeos" />
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
          {!isLoadingDrafts && drafts.length > 0 && (
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
                    Novo VÃ­deo
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
        </div>
      </div>

      <StoryboardModal
        open={showStoryboard}
        onOpenChange={setShowStoryboard}
        scenes={scenes}
        videoName={videoName}
        onSelectScene={handleSelectStoryboardScene}
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

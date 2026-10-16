'use client'

import { useEffect, useRef, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import {
  DashboardPage,
  DashboardPageContent,
} from '@/components/layout/dashboard-page'
import { Button } from '@/components/ui/button'
import { Card, CardActions, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
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
import { ProductionForm } from '@/components/productions/production-form'
import {
  ArrowLeft,
  Loader2,
  Edit2,
  Trash2,
  Calendar,
  Layers,
  ImageIcon,
  Video,
  FileText,
  FolderOpen,
  Plus,
  Link2Off,
  ExternalLink,
  Zap,
  Clapperboard,
  ChevronRight,
} from 'lucide-react'
import { GenerationStatusBadge } from '@/components/videos/generation-status-badge'
import { describeGenerationStatus, sessionHubStatus } from '@/lib/video-generation/status-presentation'
import {
  buildProductionImageContinuity,
  describeOverviewImages,
  describeOverviewVideos,
  type ProductionImageSessionInput,
} from '@/lib/session-continuity'
import { ImageSessionCard } from '@/components/images/image-session-card'
import { StateMessage } from '@/components/ui/state-message'
import { GenerationProvenance } from '@/components/videos/generation-provenance'
import { SaveGenerationToLibrary } from '@/components/videos/save-generation-to-library'
import { VideoGenerationPreviewDialog } from '@/components/videos/video-generation-preview-dialog'
import { connectionNamesById } from '@/lib/video-generation/connection-presentation'
import type { VideoConnectionsResponse } from '@/lib/video-generation/capabilities'
import { describeGenerationNotReady } from '@/lib/video-generation/status-refresh'
import { useToast } from '@/hooks/use-toast'
import type { Project, Production, ImageDraft, VideoDraft, EditorialContent, ChannelPiece } from '@/lib/types'
import type { ProjectIdentity } from '@/lib/schemas/project-identity'
import { QuickFlowDialog } from '@/components/publication/quick-flow-dialog'
import { videoCreativeEditorHref } from '@/lib/creative/video-editor/video-routes'
import { createVideoDraftForCreativeEditor } from '@/lib/creative/video-editor/video-draft-entry'
import { ContextMetadata } from '@/components/ui/context-metadata'
import {
  InheritedIdentityIndicator,
  InheritedIdentitySummaryCard,
} from '@/components/projects/inherited-project-identity'
import { resolveInheritedIdentitySummary } from '@/lib/inherited-project-identity'
import { normalizeProjectIdentity } from '@/lib/project-identity-normalizer'
import {
  PRODUCTION_TABS_GRID_CLASS,
  productionWorkspaceLoadingMessage,
  resolveProductionDisplay,
} from '@/lib/ux-production-hardening'

const CHANNEL_LABELS: Record<string, string> = {
  instagram: 'Instagram',
  youtube: 'YouTube',
  whatsapp: 'WhatsApp',
  linkedin: 'LinkedIn',
  x: 'X',
  tiktok: 'TikTok',
}

const FORMAT_LABELS: Record<string, string> = {
  feed: 'Feed',
  story: 'Story',
  reel: 'Reel',
  short: 'Short',
  video_description: 'Desc. Vídeo',
  post: 'Post',
  channel_message: 'Canal',
  carousel: 'Carrossel',
  article: 'Artigo',
}

const CP_STATUS_LABELS: Record<string, string> = {
  draft: 'Rascunho',
  ready: 'Pronta',
  approved: 'Aprovada',
  archived: 'Arquivada',
}

const PRODUCTION_TYPE_LABELS: Record<string, string> = {
  editorial: 'Editorial',
  branding: 'Branding',
  campaign: 'Campanha',
}

export default function ProductionDetailPage() {
  const params = useParams()
  const router = useRouter()
  const projectId = params.id as string
  const productionId = params.productionId as string
  const { toast } = useToast()

  const [project, setProject] = useState<Project | null>(null)
  const [production, setProduction] = useState<Production | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [showEditForm, setShowEditForm] = useState(false)
  const [showDeleteDialog, setShowDeleteDialog] = useState(false)
  const [isDeleting, setIsDeleting] = useState(false)

  // Workspace data
  const [imageDrafts, setImageDrafts] = useState<ImageDraft[]>([])
  // STRUCTURAL_WAVE_1A1: Image generation SESSIONS are the canonical continuity of the Images tab; `imageDrafts` is the legacy list.
  const [imageSessions, setImageSessions] = useState<ProductionImageSessionInput[]>([])
  const [imageSessionsHasMore, setImageSessionsHasMore] = useState(false)
  const [videoSessionsHasMore, setVideoSessionsHasMore] = useState(false)
  const [linkedLegacyDraftIds, setLinkedLegacyDraftIds] = useState<string[]>([])
  const [legacyLinksUnavailable, setLegacyLinksUnavailable] = useState(false)
  const [imageDraftsHasMore, setImageDraftsHasMore] = useState(false)
  const [videoDraftsHasMore, setVideoDraftsHasMore] = useState(false)
  const [videoGenerationsHasMore, setVideoGenerationsHasMore] = useState(false)
  const [workspaceErrors, setWorkspaceErrors] = useState({
    imageSessions: false,
    imageDrafts: false,
    videoDrafts: false,
    videoSessions: false,
    videoGenerations: false,
  })
  const [workspaceReloadKey, setWorkspaceReloadKey] = useState(0)
  const [videoDrafts, setVideoDrafts] = useState<VideoDraft[]>([])
  const [videoSessions, setVideoSessions] = useState<any[]>([])
  const [videoGenerations, setVideoGenerations] = useState<any[]>([])
  const [selectedVideoGeneration, setSelectedVideoGeneration] = useState<any | null>(null)
  const [connectionNames, setConnectionNames] = useState<ReadonlyMap<string, string>>(new Map())
  const [isLoadingWorkspace, setIsLoadingWorkspace] = useState(false)

  // Editorial contents state
  const [editorialContents, setEditorialContents] = useState<EditorialContent[]>([])
  const [showCreateEcDialog, setShowCreateEcDialog] = useState(false)
  const [createEcTitle, setCreateEcTitle] = useState('')
  const [isCreatingEc, setIsCreatingEc] = useState(false)

  // Channel pieces grouped under ECs
  const [channelPieces, setChannelPieces] = useState<ChannelPiece[]>([])
  const [isLoadingCps, setIsLoadingCps] = useState(false)

  // Quick flow dialog
  const [showQuickFlowDialog, setShowQuickFlowDialog] = useState(false)

  // Unlink state
  const [unlinkTarget, setUnlinkTarget] = useState<{ type: 'image' | 'video'; id: string; name: string } | null>(null)
  const [isUnlinking, setIsUnlinking] = useState(false)
  // VideoDraft single writer: "Criar Vídeo" creates the draft here, then hands off to the canonical Creative Editor.
  const [isCreatingVideo, setIsCreatingVideo] = useState(false)
  const identitySummaryRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    const loadData = async () => {
      try {
        const productionRes = await fetch(`/api/productions/${productionId}`)

        if (!productionRes.ok) {
          if (productionRes.status === 404 || productionRes.status === 401) {
            setError('Produção não encontrada.')
          } else {
            setError('Erro ao carregar Produção.')
          }
          return
        }

        const productionData = await productionRes.json()
        const prod: Production = productionData.production

        if (prod.project_id !== projectId) {
          setError('Produção não encontrada.')
          return
        }

        const supabase = createClient()
        const { data: projectData, error: projectError } = await supabase
          .from('projects')
          .select('*')
          .eq('id', projectId)
          .single()

        if (projectError || !projectData) {
          setError('Projeto não encontrado.')
          return
        }

        setProduction(prod)
        setProject(projectData)
      } catch {
        setError('Erro inesperado. Tente novamente.')
      } finally {
        setIsLoading(false)
      }
    }
    loadData()
  }, [projectId, productionId])

  useEffect(() => {
    if (!production) return
    let cancelled = false
    // Every source is read on its own: one failing never hides the others, and a failure is REMEMBERED (workspaceErrors) so a tab
    // can say "could not load" instead of claiming the Production has nothing.
    const read = async (url: string, collection: string) => {
      try {
        const response = await fetch(url)
        const data = await response.json().catch(() => null)
        return response.ok && Array.isArray(data?.[collection]) ? { ok: true as const, data } : { ok: false as const }
      } catch {
        return { ok: false as const }
      }
    }
    const loadWorkspace = async () => {
      setIsLoadingWorkspace(true)
      setImageSessions([])
      setImageDrafts([])
      setVideoSessions([])
      setVideoDrafts([])
      setVideoGenerations([])
      setEditorialContents([])
      try {
        // The image Sessions are read with the Production's OWN Project and Production (authoritative from the Production record).
        const [imgSessions, imgDrafts, vidDrafts, ecs, vidSessions, vidGenerations] = await Promise.all([
          read(`/api/image-generation-sessions?projectId=${production.project_id}&productionId=${productionId}`, 'sessions'),
          read(`/api/image-drafts?productionId=${productionId}&continuity=true`, 'drafts'),
          read(`/api/video-drafts?productionId=${productionId}`, 'drafts'),
          read(`/api/editorial-contents?productionId=${productionId}`, 'editorialContents'),
          read(`/api/video-generation-sessions?productionId=${productionId}`, 'sessions'),
          read(`/api/video-generations?productionId=${productionId}&continuity=true`, 'generations'),
        ])
        if (cancelled) return
        if (imgSessions.ok) { setImageSessions(imgSessions.data.sessions || []); setImageSessionsHasMore(imgSessions.data.hasMore === true) }
        if (imgDrafts.ok) {
          setImageDrafts(imgDrafts.data.drafts || [])
          setLinkedLegacyDraftIds(imgDrafts.data.linkedLegacyDraftIds ?? [])
          setLegacyLinksUnavailable(imgDrafts.data.linkedLegacyDraftIds === null)
          setImageDraftsHasMore(imgDrafts.data.hasMore === true)
        }
        if (vidDrafts.ok) { setVideoDrafts(vidDrafts.data.drafts || []); setVideoDraftsHasMore(vidDrafts.data.hasMore === true) }
        if (ecs.ok) setEditorialContents(ecs.data.editorialContents || [])
        if (vidSessions.ok) { setVideoSessions(vidSessions.data.sessions || []); setVideoSessionsHasMore(vidSessions.data.hasMore === true) }
        if (vidGenerations.ok) { setVideoGenerations(vidGenerations.data.generations || []); setVideoGenerationsHasMore(vidGenerations.data.hasMore === true) }
        setWorkspaceErrors({
          imageSessions: !imgSessions.ok,
          imageDrafts: !imgDrafts.ok,
          videoDrafts: !vidDrafts.ok,
          videoSessions: !vidSessions.ok,
          videoGenerations: !vidGenerations.ok,
        })
      } finally {
        if (!cancelled) setIsLoadingWorkspace(false)
      }
    }
    loadWorkspace()
    return () => { cancelled = true }
  }, [production, productionId, workspaceReloadKey])

  useEffect(() => {
    const hasMcp = videoGenerations.some((g: any) => g.transport === 'mcp' && g.connection_id)
    if (!hasMcp) return
    let cancelled = false
    fetch('/api/video-generations/connections')
      .then((res) => (res.ok ? (res.json() as Promise<VideoConnectionsResponse>) : null))
      .then((payload) => {
        if (!cancelled && payload) setConnectionNames(connectionNamesById(payload.connections))
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [videoGenerations])

  // Load channel pieces for all ECs of this production (independent of workspace load)
  useEffect(() => {
    if (editorialContents.length === 0) {
      setChannelPieces([])
      return
    }
    let cancelled = false
    setIsLoadingCps(true)
    fetch(`/api/channel-pieces?productionId=${productionId}`)
      .then((r) => r.json())
      .then((d) => { if (!cancelled) setChannelPieces(d.channelPieces || []) })
      .catch(() => { if (!cancelled) setChannelPieces([]) })
      .finally(() => { if (!cancelled) setIsLoadingCps(false) })
    return () => { cancelled = true }
  }, [editorialContents, productionId])

  const handleCreateEc = async () => {
    if (!createEcTitle.trim()) {
      return
    }
    setIsCreatingEc(true)
    try {
      const res = await fetch('/api/editorial-contents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: createEcTitle.trim(),
          projectId,
          productionId,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Erro ao criar')
      setEditorialContents((prev) => [data.editorialContent, ...prev])
      setShowCreateEcDialog(false)
      setCreateEcTitle('')
    } catch (err) {
      toast({
        title: 'Erro ao criar conteúdo',
        description: err instanceof Error ? err.message : 'Tente novamente.',
        variant: 'destructive',
      })
    } finally {
      setIsCreatingEc(false)
    }
  }

  const handleEditSuccess = (updated: Production) => {
    setProduction(updated)
  }

  const handleDelete = async () => {
    setIsDeleting(true)
    try {
      const res = await fetch(`/api/productions/${productionId}`, { method: 'DELETE' })
      if (!res.ok) {
        const data = await res.json()
        toast({ title: 'Erro', description: data.error || 'Não foi possível excluir a Produção.', variant: 'destructive' })
        return
      }
      toast({ title: 'Produção excluída', description: 'A Produção foi removida com sucesso.' })
      router.push(`/projetos/${projectId}`)
    } catch {
      toast({ title: 'Erro', description: 'Erro de conexão. Tente novamente.', variant: 'destructive' })
    } finally {
      setIsDeleting(false)
      setShowDeleteDialog(false)
    }
  }

  const createVideoInCreativeEditor = () => {
    router.push(`/videos?project=${projectId}&production=${productionId}`)
  }

  const handleUnlink = async () => {
    if (!unlinkTarget) return
    setIsUnlinking(true)
    try {
      const endpoint =
        unlinkTarget.type === 'image' ? '/api/image-drafts' : '/api/video-drafts'

      const res = await fetch(endpoint, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: unlinkTarget.id, productionId: null, linkOnly: true }),
      })

      if (!res.ok) {
        const data = await res.json()
        toast({ title: 'Erro', description: data.error || 'Não foi possível desvincular.', variant: 'destructive' })
        return
      }

      if (unlinkTarget.type === 'image') {
        setImageDrafts((prev) => prev.filter((d) => d.id !== unlinkTarget.id))
      } else {
        setVideoDrafts((prev) => prev.filter((d) => d.id !== unlinkTarget.id))
      }

      toast({ title: 'Desvinculado', description: `"${unlinkTarget.name}" foi desvinculado desta Produção.` })
    } catch {
      toast({ title: 'Erro', description: 'Erro de conexão. Tente novamente.', variant: 'destructive' })
    } finally {
      setIsUnlinking(false)
      setUnlinkTarget(null)
    }
  }

      const markGenerationSaved = (generationId: string, libraryFileId: string) =>
        setVideoGenerations((prev) => prev.map((entry) => (entry.id === generationId ? { ...entry, library_file_id: libraryFileId } : entry)))

      const standaloneGenerations = videoGenerations.filter((g) => g.session_id === null || g.session_id === undefined)

      // STRUCTURAL_WAVE_1A1: the canonical Image Sessions of THIS Production (re-checked against its Project and Production) and the
      // legacy drafts that no Session carries; a draft a Session already carries is the same work and is not listed twice.
      const imageContinuity = buildProductionImageContinuity({ sessions: imageSessions, legacyDrafts: imageDrafts, projectId, productionId, linkedLegacyDraftIds })
      // If the Sessions could not be read the linkage is unknown, so the legacy list is withheld (never risk listing work twice).
      const visibleLegacyImageDrafts = workspaceErrors.imageSessions || workspaceErrors.imageDrafts || legacyLinksUnavailable ? [] : imageContinuity.legacyDrafts
      const imageWorkCount = imageContinuity.sessions.length + visibleLegacyImageDrafts.length

      // Video Sessions of THIS Production only (their scope is mandatory; a row from a list endpoint is re-checked, never trusted blindly).
      const scopedVideoSessions = videoSessions.filter((s) => s.projectId === projectId && s.productionId === productionId)
      const videoSessionCount = scopedVideoSessions.length

      const productionAiCards = [
        ...scopedVideoSessions.map((s) => {
          const sessionGenerations = videoGenerations.filter((g) => g.session_id === s.id)
          const latestAttempt = sessionGenerations[0] ?? null
          const attemptsIncomplete = workspaceErrors.videoGenerations || videoGenerationsHasMore
          const status = !latestAttempt && attemptsIncomplete ? '' : sessionHubStatus(latestAttempt)
          const latestTime = latestAttempt ? new Date(latestAttempt.created_at).getTime() : 0
          const sessionTime = new Date(s.updatedAt).getTime()
          const recency = Math.max(sessionTime, latestTime)

          return {
            id: s.id,
            kind: 'session' as const,
            title: s.workingState?.prompt || 'Workspace de geração',
            meta: attemptsIncomplete ? 'Sessão · histórico parcial de tentativas' : `Sessão · ${sessionGenerations.length} tentativa${sessionGenerations.length !== 1 ? 's' : ''}`,
            status,
            recency,
            updatedAt: s.updatedAt,
            href: `/videos/geracoes/${s.id}`,
          }
        }),
        ...standaloneGenerations.map((g) => ({
          id: g.id,
          kind: 'generation' as const,
          title: g.prompt || 'Geração IA',
          meta: `Histórico · ${g.mode === 'image_to_video' ? 'I2V' : 'T2V'}`,
          status: g.status,
          recency: new Date(g.created_at).getTime(),
          updatedAt: g.updated_at,
          href: g.public_url || '#',
          generation: g,
        })),
      ].sort((a, b) => b.recency - a.recency)

      const formatDate = (dateString: string) =>
    new Date(dateString).toLocaleDateString('pt-BR', {
      day: '2-digit',
      month: 'long',
      year: 'numeric',
    })

  if (isLoading) {
    return (
      <DashboardPage className="items-center justify-center">
        <div className="flex flex-1 flex-col items-center justify-center gap-3">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          <p className="text-sm text-muted-foreground">
            {productionWorkspaceLoadingMessage('page')}
          </p>
        </div>
      </DashboardPage>
    )
  }

  if (error || !production || !project) {
    return (
      <DashboardPage className="items-center justify-center">
        <div className="flex flex-1 flex-col items-center justify-center gap-4">
          <p className="text-muted-foreground">{error || 'Produção não encontrada'}</p>
          <Button variant="outline" onClick={() => router.push(`/projetos/${projectId}`)}>
            <ArrowLeft className="mr-2 h-4 w-4" />
            Voltar para o Projeto
          </Button>
        </div>
      </DashboardPage>
    )
  }

  const productionDisplay = resolveProductionDisplay({
    title: production.title,
    intention: production.intention,
    projectName: project.name,
  })
  let resolvedIdentity: ProjectIdentity | null = null
  let identityReadError = false

  try {
    resolvedIdentity = normalizeProjectIdentity(project.identity)
  } catch {
    identityReadError = true
  }

  const inheritedIdentitySummary = resolveInheritedIdentitySummary({
    identity: resolvedIdentity,
    projectName: project.name,
    hasLegacyContext: !!project.context?.trim(),
    readError: identityReadError,
  })
  const projectIdentityHref = `/projetos/${projectId}#project-identity`

  return (
    <>
      <DashboardPage>
        <DashboardPageContent width="5xl" className="space-y-6">

          {/* Breadcrumb */}
          <nav className="flex items-center gap-1 text-sm text-muted-foreground">
            <Button
              variant="ghost"
              size="sm"
              className="h-auto px-0 py-0 hover:text-foreground"
              onClick={() => router.push('/projetos')}
            >
              Projetos
            </Button>
            <span>/</span>
            <Button
              variant="ghost"
              size="sm"
              className="h-auto px-1 py-0 hover:text-foreground"
              onClick={() => router.push(`/projetos/${projectId}`)}
            >
              {project.name}
            </Button>
            <span>/</span>
            <span className="truncate font-medium text-foreground">{productionDisplay.title}</span>
          </nav>

          {/* Production Info Card */}
          <Card className="border-border/50 bg-card/30 backdrop-blur-sm">
            <CardHeader className="flex flex-row items-start justify-between">
              <div className="flex min-w-0 items-start gap-4">
                <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-violet-500 to-cyan-500">
                  <Layers className="h-6 w-6 text-white" />
                </div>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h1 className="text-2xl font-semibold leading-none text-foreground">{productionDisplay.title}</h1>
                    <Badge variant="outline">
                      {PRODUCTION_TYPE_LABELS[production.type] ?? production.type}
                    </Badge>
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
                    <span className="flex items-center gap-1">
                      <Calendar className="h-3.5 w-3.5" />
                      Atualizado em {formatDate(production.updated_at)}
                    </span>
                    <span className="flex items-center gap-1">
                      <FolderOpen className="h-3.5 w-3.5" />
                      {project.name}
                    </span>
                  </div>
                </div>
              </div>
              <div className="flex shrink-0 gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-2"
                  onClick={() => setShowEditForm(true)}
                >
                  <Edit2 className="h-4 w-4" />
                  Editar
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-2 text-destructive hover:text-destructive"
                  onClick={() => setShowDeleteDialog(true)}
                >
                  <Trash2 className="h-4 w-4" />
                  Excluir
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                <InheritedIdentityIndicator
                  summary={inheritedIdentitySummary}
                  action={
                    inheritedIdentitySummary.kind === 'empty' ||
                    inheritedIdentitySummary.kind === 'legacy' ||
                    inheritedIdentitySummary.kind === 'invalid'
                      ? { label: inheritedIdentitySummary.actionLabel, href: projectIdentityHref }
                      : {
                          label: 'Ver identidade',
                          onClick: () =>
                            identitySummaryRef.current?.scrollIntoView({
                              behavior: 'smooth',
                              block: 'start',
                            }),
                        }
                  }
                />
                <div className="rounded-lg border border-border/50 bg-background/50 p-4">
                  <h3 className="mb-2 text-sm font-medium text-muted-foreground">Intenção</h3>
                  <p className="whitespace-pre-wrap text-foreground">{productionDisplay.intention}</p>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Workspace Tabs */}
          <Tabs defaultValue="overview" className="w-full">
            <div className="overflow-x-auto pb-1">
              <TabsList className={PRODUCTION_TABS_GRID_CLASS}>
              <TabsTrigger value="overview" className="gap-2">
                <Layers className="h-4 w-4" />
                Visão Geral
              </TabsTrigger>
              <TabsTrigger value="images" className="gap-2">
                <ImageIcon className="h-4 w-4" />
                Imagens
              </TabsTrigger>
              <TabsTrigger value="videos" className="gap-2">
                <Video className="h-4 w-4" />
                Vídeos
              </TabsTrigger>
              <TabsTrigger value="editorial" className="gap-2">
                <FileText className="h-4 w-4" />
                Conteúdos editoriais {editorialContents.length > 0 && `(${editorialContents.length})`}
              </TabsTrigger>
              </TabsList>
            </div>

            {/* Visão Geral */}
            <TabsContent value="overview" className="mt-4">
              <div className="space-y-4">
                <div ref={identitySummaryRef}>
                  <InheritedIdentitySummaryCard
                    summary={inheritedIdentitySummary}
                    projectHref={projectIdentityHref}
                    action={{ label: inheritedIdentitySummary.actionLabel }}
                  />
                </div>

                <Card className="border-border/50 bg-card/30">
                  <CardContent className="p-4">
                    <h3 className="mb-3 font-medium">Resumo desta Produção</h3>
                    {isLoadingWorkspace ? (
                      <div className="flex flex-col items-center justify-center gap-2 py-4">
                        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                        <p className="text-xs text-muted-foreground">
                          {productionWorkspaceLoadingMessage('overview')}
                        </p>
                      </div>
                    ) : (
                      <div className="grid gap-3 sm:grid-cols-3">
                        <div className="flex items-center gap-3 rounded-lg border border-border/50 bg-background/50 p-3">
                          <ImageIcon className="h-5 w-5 shrink-0 text-muted-foreground" />
                          <div>
                            <p className="text-sm font-medium">Imagens</p>
                            <p className="text-xs text-muted-foreground" data-testid="overview-images">
                              {workspaceErrors.imageSessions || workspaceErrors.imageDrafts || legacyLinksUnavailable
                                ? 'Indisponível agora'
                                : imageDraftsHasMore ? 'Lista parcial de imagens'
                                : describeOverviewImages({
                                    sessions: imageContinuity.sessions.length,
                                    legacyDrafts: visibleLegacyImageDrafts.length,
                                    hasMore: imageSessionsHasMore,
                                  })}
                            </p>
                          </div>
                        </div>
                        <div className="flex items-center gap-3 rounded-lg border border-border/50 bg-background/50 p-3">
                          <Video className="h-5 w-5 shrink-0 text-muted-foreground" />
                          <div>
                            <p className="text-sm font-medium">Vídeos</p>
                            <p className="text-xs text-muted-foreground" data-testid="overview-videos">
                              {workspaceErrors.videoSessions || workspaceErrors.videoDrafts || workspaceErrors.videoGenerations
                                ? 'Contagem parcial indisponível agora'
                                : videoDraftsHasMore || videoGenerationsHasMore ? 'Lista parcial de vídeos'
                                : describeOverviewVideos({
                                    sessions: videoSessionCount,
                                    drafts: videoDrafts.length,
                                    standaloneGenerations: standaloneGenerations.length,
                                    sessionsHasMore: videoSessionsHasMore,
                                  })}
                            </p>
                          </div>
                        </div>
                        <div className="flex items-center gap-3 rounded-lg border border-border/50 bg-background/50 p-3">
                          <FileText className="h-5 w-5 shrink-0 text-muted-foreground" />
                          <div>
                            <p className="text-sm font-medium">Conteúdos editoriais</p>
                            <p className="text-xs text-muted-foreground">
                              {editorialContents.length === 0
                                ? 'Sem conteúdos vinculados'
                                : `${editorialContents.length} conteúdo${editorialContents.length > 1 ? 's' : ''}`}
                            </p>
                          </div>
                        </div>
                      </div>
                    )}
                  </CardContent>
                </Card>

                {/* Quick actions */}
                <Card className="border-border/50 bg-card/30">
                  <CardContent className="p-4">
                    <h3 className="mb-3 font-medium">Criar nesta Produção</h3>
                    <div className="flex flex-wrap gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        className="gap-2"
                        onClick={() =>
                          router.push(`/imagens?project=${projectId}&production=${productionId}`)
                        }
                      >
                        <Plus className="h-4 w-4" />
                        <ImageIcon className="h-4 w-4" />
                        Criar Imagem
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="gap-2"
                        onClick={() => void createVideoInCreativeEditor()}
                        disabled={isCreatingVideo}
                        data-testid="production-create-video"
                      >
                        <Plus className="h-4 w-4" />
                        <Video className="h-4 w-4" />
                        Criar Vídeo
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="gap-2"
                        onClick={() => setShowQuickFlowDialog(true)}
                      >
                        <Zap className="h-4 w-4" />
                        Publicação rápida
                      </Button>
                    </div>
                  </CardContent>
                </Card>

                {project.context && (
                  <Card className="border-border/50 bg-card/30">
                    <CardContent className="p-4">
                      <h3 className="mb-2 text-sm font-medium text-muted-foreground">
                        Contexto do Projeto
                      </h3>
                      <p className="line-clamp-4 whitespace-pre-wrap text-sm text-foreground">
                        {project.context}
                      </p>
                    </CardContent>
                  </Card>
                )}
              </div>
            </TabsContent>

            {/* Imagens */}
            <TabsContent value="images" className="mt-4">
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <p className="text-sm text-muted-foreground" data-testid="images-tab-summary">
                    {workspaceErrors.imageSessions
                      ? 'Não foi possível carregar as sessões de imagem.'
                      : workspaceErrors.imageDrafts || legacyLinksUnavailable ? 'Lista parcial de imagens; rascunhos legados indisponíveis.'
                      : imageDraftsHasMore ? 'Lista parcial de imagens vinculadas.'
                      : imageWorkCount === 0
                        ? 'Nenhuma imagem vinculada.'
                        : `${describeOverviewImages({ sessions: imageContinuity.sessions.length, legacyDrafts: visibleLegacyImageDrafts.length, hasMore: imageSessionsHasMore })}.`}
                  </p>
                  <Button
                    size="sm"
                    variant="outline"
                    className="gap-2"
                    onClick={() =>
                      router.push(`/imagens?project=${projectId}&production=${productionId}`)
                    }
                  >
                    <Plus className="h-4 w-4" />
                    Criar Imagem
                  </Button>
                </div>

                {isLoadingWorkspace ? (
                  <div className="flex flex-col items-center justify-center gap-2 py-8">
                    <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                    <p className="text-sm text-muted-foreground">
                      {productionWorkspaceLoadingMessage('images')}
                    </p>
                  </div>
                ) : (
                  <>
                    {workspaceErrors.imageSessions && (
                      <div data-testid="images-sessions-error">
                        <StateMessage
                          tone="error"
                          title="Não foi possível carregar as sessões de imagem"
                          description="As sessões desta Produção não puderam ser lidas agora; isto não significa que ela não tenha imagens."
                          actionLabel="Tentar novamente"
                          onAction={() => setWorkspaceReloadKey((key) => key + 1)}
                          compact
                        />
                      </div>
                    )}
                    {imageContinuity.sessions.length > 0 && (
                      <div className="space-y-2" data-testid="production-image-sessions">
                        {imageContinuity.sessions.map((session) => (
                          <ImageSessionCard
                            key={session.id}
                            session={{ id: session.id, name: session.title, workingPrompt: null, updatedAt: session.updatedAt, thumbnailUrl: session.thumbnailUrl }}
                            projectName={project?.name}
                            productionTitle={productionDisplay.title}
                            statusLabel={session.status.label}
                            statusTone={session.status.tone}
                            onContinue={() => router.push(session.href)}
                          />
                        ))}
                        {imageSessionsHasMore && (
                          <p className="text-xs text-muted-foreground" data-testid="images-sessions-truncated">
                            Mostrando as sessões mais recentes; há mais sessões nesta Produção do que a lista comporta.
                          </p>
                        )}
                      </div>
                    )}
                    {!workspaceErrors.imageSessions && !workspaceErrors.imageDrafts && !legacyLinksUnavailable && imageWorkCount === 0 && (
                      <Card className="border-dashed" data-testid="production-images-empty">
                        <CardContent className="flex flex-col items-center justify-center py-10">
                          <ImageIcon className="mb-3 h-10 w-10 text-muted-foreground" />
                          <p className="text-sm text-muted-foreground">Nenhuma imagem vinculada a esta Produção.</p>
                        </CardContent>
                      </Card>
                    )}
                    {(workspaceErrors.imageDrafts || legacyLinksUnavailable) && !workspaceErrors.imageSessions && (
                      <p className="text-xs text-muted-foreground" data-testid="images-legacy-error">
                        Não foi possível verificar os rascunhos de imagem legados desta Produção.
                      </p>
                    )}
                    {imageDraftsHasMore && <p className="text-xs text-muted-foreground">Mostrando apenas os rascunhos legados mais recentes.</p>}
                    {visibleLegacyImageDrafts.length > 0 && (
                      <div className="space-y-2" data-testid="production-legacy-image-drafts">
                        <div>
                          <h3 className="text-sm font-medium text-foreground">Rascunhos legados sem sessão</h3>
                          <p className="text-xs text-muted-foreground">Trabalho antigo que ainda não tem uma sessão de geração.</p>
                        </div>
                    {visibleLegacyImageDrafts.map((draft) => (
                      <Card key={draft.id} className="border-border/50 bg-card/30" data-testid={`production-legacy-image-draft-${draft.id}`}>
                        <CardContent className="grid gap-3 p-4 md:grid-cols-[minmax(0,1fr)_auto] md:items-start">
                          <div className="min-w-0 space-y-3">
                            <CardTitle className="line-clamp-1 text-sm">
                              {draft.name || draft.user_input?.split('\n')[0].slice(0, 60) || 'Rascunho sem título'}
                            </CardTitle>
                            <ContextMetadata
                              dense
                              items={[
                                {
                                  label: 'Status',
                                  value:
                                    draft.image_status === 'approved'
                                      ? 'Aprovada'
                                      : draft.image_status === 'generating'
                                        ? 'Gerando'
                                        : 'Rascunho',
                                },
                                {
                                  label: 'Atualizado',
                                  value: new Date(draft.updated_at).toLocaleDateString('pt-BR'),
                                },
                              ]}
                            />
                          </div>
                          <CardActions className="flex flex-wrap gap-2 md:justify-end">
                            <Button
                              variant="ghost"
                              size="sm"
                              className="gap-1 text-xs"
                              onClick={() =>
                                router.push(`/imagens?draft=${draft.id}&project=${projectId}&production=${productionId}`)
                              }
                            >
                              <ExternalLink className="h-3.5 w-3.5" />
                              Abrir
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="gap-1 text-xs text-muted-foreground hover:text-destructive"
                              onClick={() =>
                                setUnlinkTarget({
                                  type: 'image',
                                  id: draft.id,
                                  name: draft.name || draft.user_input?.split('\n')[0].slice(0, 40) || 'Rascunho',
                                })
                              }
                            >
                              <Link2Off className="h-3.5 w-3.5" />
                              Desvincular
                            </Button>
                          </CardActions>
                        </CardContent>
                      </Card>
                    ))}
                      </div>
                    )}
                  </>
                )}
              </div>
            </TabsContent>

            {/* Vídeos */}
            <TabsContent value="videos" className="mt-4">
              <div className="space-y-6">
                {!isLoadingWorkspace && (workspaceErrors.videoSessions || workspaceErrors.videoGenerations || workspaceErrors.videoDrafts) && (
                  <div data-testid="videos-load-error">
                    <StateMessage
                      tone="error"
                      title="Não foi possível carregar parte dos vídeos desta Produção"
                      description="Alguma lista (sessões, gerações ou edições) não pôde ser lida agora; isto não significa que ela esteja vazia."
                      actionLabel="Tentar novamente"
                      onAction={() => setWorkspaceReloadKey((key) => key + 1)}
                      compact
                    />
                  </div>
                )}
                {/* Gerações IA */}
                <div className="space-y-3" data-testid="production-ai-group">
                  <div className="flex items-center justify-between">
                    <div>
                      <h3 className="text-base font-semibold text-foreground flex items-center gap-2">
                        <Zap className="h-4 w-4 text-primary" /> Gerações IA
                      </h3>
                      <p className="text-xs text-muted-foreground">Workspaces de geração e tentativas desta Produção</p>
                    </div>
                  </div>

                  {isLoadingWorkspace ? (
                    <div className="flex flex-col items-center justify-center gap-2 py-8">
                      <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                      <p className="text-sm text-muted-foreground">
                        {productionWorkspaceLoadingMessage('videos')}
                      </p>
                    </div>
                  ) : productionAiCards.length === 0 && !(workspaceErrors.videoSessions || workspaceErrors.videoGenerations) ? (
                    <Card className="border-dashed" data-testid="production-ai-empty">
                      <CardContent className="flex flex-col items-center justify-center py-8 text-center text-muted-foreground">
                        <Zap className="mb-2 h-8 w-8 opacity-40" />
                        <p className="text-sm font-medium">Nenhuma geração IA nesta Produção.</p>
                      </CardContent>
                    </Card>
                  ) : (
                    <div className="space-y-2">
                      {productionAiCards.map((item) => (
                        <Card key={`ai-${item.kind}-${item.id}`} className="border-border/50 bg-card/30" data-testid={`production-card-${item.kind}-${item.id}`}>
                          <CardContent className="grid gap-3 p-4 md:grid-cols-[minmax(0,1fr)_auto] md:items-start">
                            <div className="min-w-0 space-y-3">
                              <div className="min-w-0">
                                <div className="flex items-center gap-2">
                                  {item.kind === 'session' ? (
                                    <Zap className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
                                  ) : (
                                    <Video className="h-4 w-4 shrink-0 text-pink-300" aria-hidden="true" />
                                  )}
                                  <CardTitle className="truncate text-sm" title={item.title}>
                                    {item.title}
                                  </CardTitle>
                                </div>
                                <p className="mt-1 text-xs text-muted-foreground">{item.meta}</p>
                                {item.kind === 'generation' && (
                                  <GenerationProvenance generation={item.generation} connectionNames={connectionNames} />
                                )}
                              </div>
                              <ContextMetadata
                                dense
                                items={[
                                  { label: 'Status', value: <GenerationStatusBadge status={item.status} /> },
                                  { label: 'Atualizado', value: new Date(item.updatedAt).toLocaleDateString('pt-BR') },
                                ]}
                              />
                            </div>
                            <CardActions className="flex flex-wrap gap-2 md:justify-end">
                              {item.kind === 'session' ? (
                                <Button size="sm" onClick={() => router.push(item.href)} className="gap-1" data-testid="production-continue-session">
                                  <Zap className="h-4 w-4" />
                                  Continuar
                                  <ChevronRight className="h-4 w-4" />
                                </Button>
                              ) : (
                                <>
                                  <Button
                                    size="sm"
                                    onClick={() => {
                                      if (item.generation.status === 'succeeded') {
                                        setSelectedVideoGeneration(item.generation)
                                      } else {
                                        toast(describeGenerationNotReady(item.generation))
                                      }
                                    }}
                                    className="gap-1"
                                    data-testid="production-watch-generation"
                                  >
                                    <Video className="h-4 w-4" />
                                    {item.generation.status === 'succeeded' ? 'Assistir' : describeGenerationStatus(item.generation.status).label}
                                  </Button>
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    onClick={() => {
                                      const newSessionId = crypto.randomUUID()
                                      const url = `/videos/geracoes/${newSessionId}?new=1&project=${encodeURIComponent(projectId)}&production=${encodeURIComponent(productionId)}&reuseGenerationId=${encodeURIComponent(item.id)}`
                                      router.push(url)
                                    }}
                                    className="gap-1"
                                    data-testid="production-reuse-generation"
                                  >
                                    Reutilizar configurações
                                  </Button>
                                  <SaveGenerationToLibrary generation={item.generation} size="sm" onSaved={markGenerationSaved} />
                                </>
                              )}
                            </CardActions>
                          </CardContent>
                        </Card>
                      ))}
                    </div>
                  )}
                  {!isLoadingWorkspace && videoSessionsHasMore && (
                    <p className="text-xs text-muted-foreground" data-testid="video-sessions-truncated">
                      Mostrando as sessões mais recentes; há mais sessões de vídeo nesta Produção do que a lista comporta.
                    </p>
                  )}
                  {!isLoadingWorkspace && (videoDraftsHasMore || videoGenerationsHasMore) && (
                    <p className="text-xs text-muted-foreground" data-testid="videos-history-truncated">Listas parciais: mostrando as edições e o histórico de geração mais recentes.</p>
                  )}
                </div>

                {/* Edições */}
                <div className="space-y-3" data-testid="production-editions-group">
                  <div className="flex items-center justify-between">
                    <div>
                      <h3 className="text-base font-semibold text-foreground flex items-center gap-2">
                        <Clapperboard className="h-4 w-4 text-pink-400" /> Edições
                      </h3>
                      <p className="text-xs text-muted-foreground">Rascunhos de composição e edição no Creative Editor</p>
                    </div>
                    <Button
                      size="sm"
                      variant="outline"
                      className="gap-2"
                      onClick={() => void createVideoInCreativeEditor()}
                      disabled={isCreatingVideo}
                    >
                      <Plus className="h-4 w-4" />
                      Criar Vídeo
                    </Button>
                  </div>

                  {isLoadingWorkspace ? (
                    <div className="flex flex-col items-center justify-center gap-2 py-8">
                      <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                      <p className="text-sm text-muted-foreground">
                        {productionWorkspaceLoadingMessage('videos')}
                      </p>
                    </div>
                  ) : videoDrafts.length === 0 && !workspaceErrors.videoDrafts ? (
                    <Card className="border-dashed" data-testid="production-editions-empty">
                      <CardContent className="flex flex-col items-center justify-center py-8 text-center text-muted-foreground">
                        <Clapperboard className="mb-2 h-8 w-8 opacity-40" />
                        <p className="text-sm font-medium">Nenhuma edição de vídeo nesta Produção.</p>
                      </CardContent>
                    </Card>
                  ) : (
                    <div className="space-y-2">
                      {videoDrafts.map((draft) => (
                        <Card key={draft.id} className="border-border/50 bg-card/30" data-testid={`production-card-draft-${draft.id}`}>
                          <CardContent className="grid gap-3 p-4 md:grid-cols-[minmax(0,1fr)_auto] md:items-start">
                            <div className="min-w-0 space-y-3">
                              <CardTitle className="line-clamp-1 text-sm">{draft.name || 'Rascunho sem título'}</CardTitle>
                              <ContextMetadata
                                dense
                                items={[
                                  {
                                    label: 'Cenas',
                                    value: `${draft.scenes?.length ?? 0} cena${(draft.scenes?.length ?? 0) !== 1 ? 's' : ''}`,
                                  },
                                  {
                                    label: 'Atualizado',
                                    value: new Date(draft.updated_at).toLocaleDateString('pt-BR'),
                                  },
                                ]}
                              />
                            </div>
                            <CardActions className="flex flex-wrap gap-2 md:justify-end">
                              <Button
                                variant="ghost"
                                size="sm"
                                className="gap-1 text-xs"
                                onClick={() => router.push(videoCreativeEditorHref(draft.id))}
                                data-testid="production-open-video-draft"
                              >
                                <ExternalLink className="h-3.5 w-3.5" />
                                Abrir
                              </Button>
                              <Button
                                variant="ghost"
                                size="sm"
                                className="gap-1 text-xs text-muted-foreground hover:text-destructive"
                                onClick={() =>
                                  setUnlinkTarget({
                                    type: 'video',
                                    id: draft.id,
                                    name: draft.name || 'Rascunho',
                                  })
                                }
                              >
                                <Link2Off className="h-3.5 w-3.5" />
                                Desvincular
                              </Button>
                            </CardActions>
                          </CardContent>
                        </Card>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </TabsContent>

            {/* Conteúdos Editoriais */}
            <TabsContent value="editorial" className="mt-4">
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <p className="text-sm text-muted-foreground">
                    {editorialContents.length === 0
                      ? 'Nenhum conteúdo editorial vinculado.'
                      : `${editorialContents.length} conteúdo${editorialContents.length > 1 ? 's' : ''} editorial${editorialContents.length > 1 ? 'is' : ''} vinculado${editorialContents.length > 1 ? 's' : ''}.`}
                  </p>
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      className="gap-2"
                      onClick={() => setShowQuickFlowDialog(true)}
                    >
                      <Zap className="h-3.5 w-3.5" />
                      Publicação rápida
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="gap-2"
                      onClick={() => {
                        setCreateEcTitle('')
                        setShowCreateEcDialog(true)
                      }}
                    >
                      <Plus className="h-4 w-4" />
                      Criar Conteúdo
                    </Button>
                  </div>
                </div>

                {isLoadingWorkspace ? (
                  <div className="flex flex-col items-center justify-center gap-2 py-8">
                    <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                    <p className="text-sm text-muted-foreground">
                      {productionWorkspaceLoadingMessage('editorial')}
                    </p>
                  </div>
                ) : editorialContents.length === 0 ? (
                  <Card className="border-dashed">
                    <CardContent className="flex flex-col items-center justify-center py-10">
                      <FileText className="mb-3 h-10 w-10 text-muted-foreground" />
                      <p className="text-sm text-muted-foreground">
                        Nenhum conteúdo editorial vinculado a esta Produção.
                      </p>
                    </CardContent>
                  </Card>
                ) : (
                  <div className="space-y-3">
                    {editorialContents.map((ec) => {
                      const ecCps = channelPieces.filter((cp) => cp.editorial_content_id === ec.id)
                      return (
                        <Card key={ec.id} className="border-border/50 bg-card/30">
                          <CardContent className="p-4">
                            <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_auto] md:items-start">
                              <div className="min-w-0 space-y-3">
                                <div className="flex flex-wrap items-center gap-2">
                                  <CardTitle className="line-clamp-1 text-sm">{ec.title}</CardTitle>
                                  <Badge variant={ec.status === 'ready' ? 'default' : 'secondary'} className="shrink-0">
                                    {ec.status === 'ready' ? 'Pronto' : ec.status === 'archived' ? 'Arquivado' : 'Rascunho'}
                                  </Badge>
                                  {!isLoadingCps && (
                                    <span className="shrink-0 text-xs text-muted-foreground">
                                      {ecCps.length} peça{ecCps.length !== 1 ? 's' : ''}
                                    </span>
                                  )}
                                </div>
                                <ContextMetadata
                                  dense
                                  items={[{ label: 'Atualizado', value: new Date(ec.updated_at).toLocaleDateString('pt-BR') }]}
                                />
                                {isLoadingCps ? (
                                  <div className="mt-2 flex items-center gap-1.5">
                                    <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />
                                    <span className="text-xs text-muted-foreground">Carregando peças...</span>
                                  </div>
                                ) : ecCps.length > 0 ? (
                                  <div className="mt-2 flex flex-wrap gap-1.5">
                                    {ecCps.map((cp) => (
                                      <span
                                        key={cp.id}
                                        className="inline-flex items-center gap-1 rounded-full border border-border/50 bg-background/60 px-2 py-0.5 text-xs text-muted-foreground"
                                      >
                                        <span className="font-medium text-foreground">
                                          {CHANNEL_LABELS[cp.channel] ?? cp.channel}
                                        </span>
                                        <span>·</span>
                                        <span>{FORMAT_LABELS[cp.format] ?? cp.format}</span>
                                        <span>·</span>
                                        <span>{CP_STATUS_LABELS[cp.status] ?? cp.status}</span>
                                      </span>
                                    ))}
                                  </div>
                                ) : null}
                              </div>
                              <CardActions className="md:justify-end">
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="shrink-0 gap-1 text-xs"
                                  onClick={() =>
                                    router.push(`/projetos/${projectId}/conteudos/${ec.id}`)
                                  }
                                >
                                  <ExternalLink className="h-3.5 w-3.5" />
                                  Abrir
                                </Button>
                              </CardActions>
                            </div>
                          </CardContent>
                        </Card>
                      )
                    })}
                  </div>
                )}
              </div>
            </TabsContent>

          </Tabs>
        </DashboardPageContent>
      </DashboardPage>

      <QuickFlowDialog
        open={showQuickFlowDialog}
        onOpenChange={setShowQuickFlowDialog}
        lockedProjectId={projectId}
        lockedProductionId={productionId}
      />

      {/* Edit Production Modal */}
      <ProductionForm
        open={showEditForm}
        onOpenChange={setShowEditForm}
        projectId={projectId}
        production={production}
        onSuccess={handleEditSuccess}
      />

      {/* Delete Confirmation */}
      <AlertDialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir Produção?</AlertDialogTitle>
            <AlertDialogDescription>
              A Produção <strong>&quot;{productionDisplay.title}&quot;</strong> será removida
              permanentemente. Imagens, vídeos e publicações vinculados <strong>não serão excluídos</strong> —
              apenas perderão o vínculo com esta Produção. Esta ação não pode ser desfeita.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeleting}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              disabled={isDeleting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {isDeleting ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Excluindo...
                </>
              ) : (
                'Excluir'
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Create EC Dialog */}
      <Dialog open={showCreateEcDialog} onOpenChange={setShowCreateEcDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Novo Conteúdo Editorial</DialogTitle>
            <DialogDescription>
              Será criado vinculado a esta Produção e ao seu Projeto.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label htmlFor="prod-ec-title">Título *</Label>
              <Input
                id="prod-ec-title"
                value={createEcTitle}
                onChange={(e) => setCreateEcTitle(e.target.value)}
                placeholder="Ex: Post de lançamento"
                onKeyDown={(e) => e.key === 'Enter' && handleCreateEc()}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreateEcDialog(false)}>
              Cancelar
            </Button>
            <Button onClick={handleCreateEc} disabled={isCreatingEc || !createEcTitle.trim()}>
              {isCreatingEc && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Criar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Unlink Confirmation */}
      <AlertDialog open={!!unlinkTarget} onOpenChange={(open) => { if (!open) setUnlinkTarget(null) }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Desvincular item?</AlertDialogTitle>
            <AlertDialogDescription>
              <strong>&quot;{unlinkTarget?.name}&quot;</strong> será desvinculado desta Produção.
              O item <strong>não será excluído</strong> — continuará acessível normalmente.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isUnlinking}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleUnlink}
              disabled={isUnlinking}
            >
              {isUnlinking ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Desvinculando...
                </>
              ) : (
                'Desvincular'
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

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

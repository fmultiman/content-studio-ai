'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Header } from '@/components/layout/header'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
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
} from 'lucide-react'
import { useToast } from '@/hooks/use-toast'
import type { Project, Production, ImageDraft, VideoDraft, Post, EditorialContent } from '@/lib/types'

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
  const [videoDrafts, setVideoDrafts] = useState<VideoDraft[]>([])
  const [posts, setPosts] = useState<Post[]>([])
  const [isLoadingWorkspace, setIsLoadingWorkspace] = useState(false)

  // Editorial contents state
  const [editorialContents, setEditorialContents] = useState<EditorialContent[]>([])
  const [showCreateEcDialog, setShowCreateEcDialog] = useState(false)
  const [createEcTitle, setCreateEcTitle] = useState('')
  const [isCreatingEc, setIsCreatingEc] = useState(false)

  // Unlink state
  const [unlinkTarget, setUnlinkTarget] = useState<{ type: 'image' | 'video' | 'post'; id: string; name: string } | null>(null)
  const [isUnlinking, setIsUnlinking] = useState(false)

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
    const loadWorkspace = async () => {
      setIsLoadingWorkspace(true)
      try {
        const [imgRes, vidRes, postRes, ecRes] = await Promise.all([
          fetch(`/api/image-drafts?productionId=${productionId}`),
          fetch(`/api/video-drafts?productionId=${productionId}`),
          fetch(`/api/posts?productionId=${productionId}`),
          fetch(`/api/editorial-contents?productionId=${productionId}`),
        ])
        const [imgData, vidData, postData, ecData] = await Promise.all([
          imgRes.json(),
          vidRes.json(),
          postRes.json(),
          ecRes.json(),
        ])
        if (imgRes.ok) setImageDrafts(imgData.drafts || [])
        if (vidRes.ok) setVideoDrafts(vidData.drafts || [])
        if (postRes.ok) setPosts(postData.posts || [])
        if (ecRes.ok) setEditorialContents(ecData.editorialContents || [])
      } catch {
        // silently fail — workspace items are non-critical
      } finally {
        setIsLoadingWorkspace(false)
      }
    }
    loadWorkspace()
  }, [production, productionId])

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
    } catch {
      // silently fail — user will see empty list
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

  const handleUnlink = async () => {
    if (!unlinkTarget) return
    setIsUnlinking(true)
    try {
      const endpoint =
        unlinkTarget.type === 'image' ? '/api/image-drafts' :
        unlinkTarget.type === 'video' ? '/api/video-drafts' :
        '/api/posts'

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
      } else if (unlinkTarget.type === 'video') {
        setVideoDrafts((prev) => prev.filter((d) => d.id !== unlinkTarget.id))
      } else {
        setPosts((prev) => prev.filter((p) => p.id !== unlinkTarget.id))
      }

      toast({ title: 'Desvinculado', description: `"${unlinkTarget.name}" foi desvinculado desta Produção.` })
    } catch {
      toast({ title: 'Erro', description: 'Erro de conexão. Tente novamente.', variant: 'destructive' })
    } finally {
      setIsUnlinking(false)
      setUnlinkTarget(null)
    }
  }

  const formatDate = (dateString: string) =>
    new Date(dateString).toLocaleDateString('pt-BR', {
      day: '2-digit',
      month: 'long',
      year: 'numeric',
    })

  if (isLoading) {
    return (
      <>
        <Header title="Carregando..." />
        <div className="flex flex-1 items-center justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      </>
    )
  }

  if (error || !production || !project) {
    return (
      <>
        <Header title="Erro" />
        <div className="flex flex-1 flex-col items-center justify-center gap-4">
          <p className="text-muted-foreground">{error || 'Produção não encontrada'}</p>
          <Button variant="outline" onClick={() => router.push(`/projetos/${projectId}`)}>
            <ArrowLeft className="mr-2 h-4 w-4" />
            Voltar para o Projeto
          </Button>
        </div>
      </>
    )
  }

  return (
    <>
      <Header title={production.title} />
      <div className="flex-1 overflow-auto p-6">
        <div className="mx-auto max-w-5xl space-y-6">

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
            <span className="truncate font-medium text-foreground">{production.title}</span>
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
                    <CardTitle className="text-2xl">{production.title}</CardTitle>
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
              <div className="rounded-lg border border-border/50 bg-background/50 p-4">
                <h3 className="mb-2 text-sm font-medium text-muted-foreground">Intenção</h3>
                <p className="whitespace-pre-wrap text-foreground">{production.intention}</p>
              </div>
            </CardContent>
          </Card>

          {/* Workspace Tabs */}
          <Tabs defaultValue="overview" className="w-full">
            <TabsList className="grid w-full grid-cols-5">
              <TabsTrigger value="overview" className="gap-2">
                <Layers className="h-4 w-4" />
                Visão Geral
              </TabsTrigger>
              <TabsTrigger value="images" className="gap-2">
                <ImageIcon className="h-4 w-4" />
                Imagens {imageDrafts.length > 0 && `(${imageDrafts.length})`}
              </TabsTrigger>
              <TabsTrigger value="videos" className="gap-2">
                <Video className="h-4 w-4" />
                Vídeos {videoDrafts.length > 0 && `(${videoDrafts.length})`}
              </TabsTrigger>
              <TabsTrigger value="editorial" className="gap-2">
                <FileText className="h-4 w-4" />
                Conteúdos {editorialContents.length > 0 && `(${editorialContents.length})`}
              </TabsTrigger>
              <TabsTrigger value="posts" className="gap-2">
                <FileText className="h-4 w-4" />
                Posts {posts.length > 0 && `(${posts.length})`}
              </TabsTrigger>
            </TabsList>

            {/* Visão Geral */}
            <TabsContent value="overview" className="mt-4">
              <div className="space-y-4">
                <Card className="border-border/50 bg-card/30">
                  <CardContent className="p-4">
                    <h3 className="mb-3 font-medium">Resumo desta Produção</h3>
                    {isLoadingWorkspace ? (
                      <div className="flex justify-center py-4">
                        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                      </div>
                    ) : (
                      <div className="grid gap-3 sm:grid-cols-3">
                        <div className="flex items-center gap-3 rounded-lg border border-border/50 bg-background/50 p-3">
                          <ImageIcon className="h-5 w-5 shrink-0 text-muted-foreground" />
                          <div>
                            <p className="text-sm font-medium">Imagens</p>
                            <p className="text-xs text-muted-foreground">
                              {imageDrafts.length === 0
                                ? 'Sem imagens vinculadas'
                                : `${imageDrafts.length} rascunho${imageDrafts.length > 1 ? 's' : ''}`}
                            </p>
                          </div>
                        </div>
                        <div className="flex items-center gap-3 rounded-lg border border-border/50 bg-background/50 p-3">
                          <Video className="h-5 w-5 shrink-0 text-muted-foreground" />
                          <div>
                            <p className="text-sm font-medium">Vídeos</p>
                            <p className="text-xs text-muted-foreground">
                              {videoDrafts.length === 0
                                ? 'Sem vídeos vinculados'
                                : `${videoDrafts.length} rascunho${videoDrafts.length > 1 ? 's' : ''}`}
                            </p>
                          </div>
                        </div>
                        <div className="flex items-center gap-3 rounded-lg border border-border/50 bg-background/50 p-3">
                          <FileText className="h-5 w-5 shrink-0 text-muted-foreground" />
                          <div>
                            <p className="text-sm font-medium">Publicações</p>
                            <p className="text-xs text-muted-foreground">
                              {posts.length === 0
                                ? 'Sem publicações vinculadas'
                                : `${posts.length} post${posts.length > 1 ? 's' : ''}`}
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
                        onClick={() =>
                          router.push(`/videos?project=${projectId}&production=${productionId}`)
                        }
                      >
                        <Plus className="h-4 w-4" />
                        <Video className="h-4 w-4" />
                        Criar Vídeo
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="gap-2"
                        onClick={() =>
                          router.push(`/posts?project=${projectId}&production=${productionId}`)
                        }
                      >
                        <Plus className="h-4 w-4" />
                        <FileText className="h-4 w-4" />
                        Criar Publicação
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
                  <p className="text-sm text-muted-foreground">
                    {imageDrafts.length === 0 ? 'Nenhuma imagem vinculada.' : `${imageDrafts.length} rascunho${imageDrafts.length > 1 ? 's' : ''} vinculado${imageDrafts.length > 1 ? 's' : ''}.`}
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
                  <div className="flex justify-center py-8">
                    <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                  </div>
                ) : imageDrafts.length === 0 ? (
                  <Card className="border-dashed">
                    <CardContent className="flex flex-col items-center justify-center py-10">
                      <ImageIcon className="mb-3 h-10 w-10 text-muted-foreground" />
                      <p className="text-sm text-muted-foreground">Nenhuma imagem vinculada a esta Produção.</p>
                    </CardContent>
                  </Card>
                ) : (
                  <div className="space-y-2">
                    {imageDrafts.map((draft) => (
                      <Card key={draft.id} className="border-border/50 bg-card/30">
                        <CardContent className="flex items-center justify-between p-4">
                          <div className="min-w-0 flex-1">
                            <p className="truncate font-medium">
                              {draft.name || draft.user_input.split('\n')[0].slice(0, 60) || 'Rascunho sem título'}
                            </p>
                            <p className="mt-0.5 text-xs text-muted-foreground">
                              {draft.image_status === 'approved' ? 'Aprovada' :
                               draft.image_status === 'generating' ? 'Gerando' : 'Rascunho'} ·{' '}
                              {new Date(draft.updated_at).toLocaleDateString('pt-BR')}
                            </p>
                          </div>
                          <div className="flex shrink-0 gap-2 ml-4">
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
                                  name: draft.name || draft.user_input.split('\n')[0].slice(0, 40) || 'Rascunho',
                                })
                              }
                            >
                              <Link2Off className="h-3.5 w-3.5" />
                              Desvincular
                            </Button>
                          </div>
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                )}
              </div>
            </TabsContent>

            {/* Vídeos */}
            <TabsContent value="videos" className="mt-4">
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <p className="text-sm text-muted-foreground">
                    {videoDrafts.length === 0 ? 'Nenhum vídeo vinculado.' : `${videoDrafts.length} rascunho${videoDrafts.length > 1 ? 's' : ''} vinculado${videoDrafts.length > 1 ? 's' : ''}.`}
                  </p>
                  <Button
                    size="sm"
                    variant="outline"
                    className="gap-2"
                    onClick={() =>
                      router.push(`/videos?project=${projectId}&production=${productionId}`)
                    }
                  >
                    <Plus className="h-4 w-4" />
                    Criar Vídeo
                  </Button>
                </div>

                {isLoadingWorkspace ? (
                  <div className="flex justify-center py-8">
                    <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                  </div>
                ) : videoDrafts.length === 0 ? (
                  <Card className="border-dashed">
                    <CardContent className="flex flex-col items-center justify-center py-10">
                      <Video className="mb-3 h-10 w-10 text-muted-foreground" />
                      <p className="text-sm text-muted-foreground">Nenhum vídeo vinculado a esta Produção.</p>
                    </CardContent>
                  </Card>
                ) : (
                  <div className="space-y-2">
                    {videoDrafts.map((draft) => (
                      <Card key={draft.id} className="border-border/50 bg-card/30">
                        <CardContent className="flex items-center justify-between p-4">
                          <div className="min-w-0 flex-1">
                            <p className="truncate font-medium">{draft.name || 'Rascunho sem título'}</p>
                            <p className="mt-0.5 text-xs text-muted-foreground">
                              {draft.scenes?.length ?? 0} cena{(draft.scenes?.length ?? 0) !== 1 ? 's' : ''} ·{' '}
                              {new Date(draft.updated_at).toLocaleDateString('pt-BR')}
                            </p>
                          </div>
                          <div className="flex shrink-0 gap-2 ml-4">
                            <Button
                              variant="ghost"
                              size="sm"
                              className="gap-1 text-xs"
                              onClick={() =>
                                router.push(`/videos?draft=${draft.id}&project=${projectId}&production=${productionId}`)
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
                                  type: 'video',
                                  id: draft.id,
                                  name: draft.name || 'Rascunho',
                                })
                              }
                            >
                              <Link2Off className="h-3.5 w-3.5" />
                              Desvincular
                            </Button>
                          </div>
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                )}
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

                {isLoadingWorkspace ? (
                  <div className="flex justify-center py-8">
                    <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
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
                  <div className="space-y-2">
                    {editorialContents.map((ec) => (
                      <Card key={ec.id} className="border-border/50 bg-card/30">
                        <CardContent className="flex items-center justify-between p-4">
                          <div className="min-w-0 flex-1">
                            <p className="truncate font-medium">{ec.title}</p>
                            <p className="mt-0.5 text-xs text-muted-foreground">
                              {ec.status === 'ready' ? 'Pronto' : ec.status === 'archived' ? 'Arquivado' : 'Rascunho'} ·{' '}
                              {new Date(ec.updated_at).toLocaleDateString('pt-BR')}
                            </p>
                          </div>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="ml-4 shrink-0 gap-1 text-xs"
                            onClick={() =>
                              router.push(`/projetos/${projectId}/conteudos/${ec.id}`)
                            }
                          >
                            <ExternalLink className="h-3.5 w-3.5" />
                            Abrir
                          </Button>
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                )}
              </div>
            </TabsContent>

            {/* Publicações (legado) */}
            <TabsContent value="posts" className="mt-4">
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <p className="text-sm text-muted-foreground">
                    {posts.length === 0 ? 'Nenhuma publicação vinculada.' : `${posts.length} publicação${posts.length > 1 ? 'ões' : ''} vinculada${posts.length > 1 ? 's' : ''}.`}
                  </p>
                  <Button
                    size="sm"
                    variant="outline"
                    className="gap-2"
                    onClick={() =>
                      router.push(`/posts?project=${projectId}&production=${productionId}`)
                    }
                  >
                    <Plus className="h-4 w-4" />
                    Criar Publicação
                  </Button>
                </div>

                {isLoadingWorkspace ? (
                  <div className="flex justify-center py-8">
                    <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                  </div>
                ) : posts.length === 0 ? (
                  <Card className="border-dashed">
                    <CardContent className="flex flex-col items-center justify-center py-10">
                      <FileText className="mb-3 h-10 w-10 text-muted-foreground" />
                      <p className="text-sm text-muted-foreground">Nenhuma publicação vinculada a esta Produção.</p>
                    </CardContent>
                  </Card>
                ) : (
                  <div className="space-y-2">
                    {posts.map((post) => (
                      <Card key={post.id} className="border-border/50 bg-card/30">
                        <CardContent className="flex items-center justify-between p-4">
                          <div className="min-w-0 flex-1">
                            <p className="truncate font-medium">{post.name || 'Post sem título'}</p>
                            <p className="mt-0.5 text-xs text-muted-foreground">
                              {post.status === 'saved' ? 'Salvo' : 'Rascunho'} ·{' '}
                              {post.channel.replace('_', ' ')} ·{' '}
                              {new Date(post.updated_at).toLocaleDateString('pt-BR')}
                            </p>
                          </div>
                          <div className="flex shrink-0 gap-2 ml-4">
                            <Button
                              variant="ghost"
                              size="sm"
                              className="gap-1 text-xs"
                              onClick={() =>
                                router.push(`/posts?project=${projectId}&production=${productionId}`)
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
                                  type: 'post',
                                  id: post.id,
                                  name: post.name || 'Post',
                                })
                              }
                            >
                              <Link2Off className="h-3.5 w-3.5" />
                              Desvincular
                            </Button>
                          </div>
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                )}
              </div>
            </TabsContent>
          </Tabs>
        </div>
      </div>

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
              A Produção <strong>&quot;{production.title}&quot;</strong> será removida
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
    </>
  )
}

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
import { ProjectForm } from '@/components/projects/project-form'
import {
  ArrowLeft,
  Loader2,
  FolderOpen,
  ImageIcon,
  Video,
  FileText,
  Calendar,
  Edit2,
  Trash2,
  Palette,
  Copy,
  Check,
} from 'lucide-react'
import { useToast } from '@/hooks/use-toast'
import type { Project, Image as ImageType, Video as VideoType } from '@/lib/types'

export default function ProjectDetailPage() {
  const params = useParams()
  const router = useRouter()
  const projectId = params.id as string

  const { toast } = useToast()
  const [project, setProject] = useState<Project | null>(null)
  const [images, setImages] = useState<ImageType[]>([])
  const [videos, setVideos] = useState<VideoType[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [showEditForm, setShowEditForm] = useState(false)
  const [showDeleteDialog, setShowDeleteDialog] = useState(false)
  const [isDeleting, setIsDeleting] = useState(false)
  const [copiedSection, setCopiedSection] = useState<string | null>(null)

  useEffect(() => {
    const fetchProjectData = async () => {
      const supabase = createClient()

      try {
        // Fetch project
        const { data: projectData, error: projectError } = await supabase
          .from('projects')
          .select('*')
          .eq('id', projectId)
          .single()

        if (projectError) throw projectError
        setProject(projectData)

        // Fetch images for this project
        const { data: imagesData } = await supabase
          .from('images')
          .select('*')
          .eq('project_id', projectId)
          .order('created_at', { ascending: false })

        if (imagesData) setImages(imagesData)

        // Fetch videos for this project
        const { data: videosData } = await supabase
          .from('videos')
          .select('*')
          .eq('project_id', projectId)
          .order('created_at', { ascending: false })

        if (videosData) setVideos(videosData)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Erro ao carregar projeto')
      } finally {
        setIsLoading(false)
      }
    }

    fetchProjectData()
  }, [projectId])

  const handleDelete = async () => {
    if (!project) return

    setIsDeleting(true)
    const supabase = createClient()

    try {
      await supabase.from('projects').delete().eq('id', project.id)
      toast({
        title: 'Projeto excluído',
        description: 'O projeto foi excluído com sucesso.',
      })
      router.push('/projetos')
    } catch (error) {
      console.error('Erro ao deletar projeto:', error)
      toast({
        title: 'Erro',
        description: 'Não foi possível excluir o projeto.',
        variant: 'destructive',
      })
    } finally {
      setIsDeleting(false)
      setShowDeleteDialog(false)
    }
  }

  const handleEditSuccess = async () => {
    setShowEditForm(false)
    // Refresh project data
    const supabase = createClient()
    const { data: projectData } = await supabase
      .from('projects')
      .select('*')
      .eq('id', projectId)
      .single()
    if (projectData) {
      setProject(projectData)
    }
  }

  const handleCopySection = async (section: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text)
      setCopiedSection(section)
      setTimeout(() => setCopiedSection(null), 2000)
    } catch {
      toast({
        title: 'Erro',
        description: 'Não foi possível copiar o texto.',
        variant: 'destructive',
      })
    }
  }

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

  if (error || !project) {
    return (
      <>
        <Header title="Erro" />
        <div className="flex flex-1 flex-col items-center justify-center gap-4">
          <p className="text-muted-foreground">{error || 'Projeto não encontrado'}</p>
          <Button variant="outline" onClick={() => router.push('/projetos')}>
            <ArrowLeft className="mr-2 h-4 w-4" />
            Voltar para Projetos
          </Button>
        </div>
      </>
    )
  }

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('pt-BR', {
      day: '2-digit',
      month: 'long',
      year: 'numeric',
    })
  }

  return (
    <>
      <Header title={project.name} />
      <div className="flex-1 overflow-auto p-6">
        <div className="mx-auto max-w-5xl space-y-6">
          {/* Back Button */}
          <Button
            variant="ghost"
            onClick={() => router.push('/projetos')}
            className="gap-2"
          >
            <ArrowLeft className="h-4 w-4" />
            Voltar para Projetos
          </Button>

          {/* Project Info Card */}
          <Card className="border-border/50 bg-card/30 backdrop-blur-sm">
            <CardHeader className="flex flex-row items-start justify-between">
              <div className="flex items-start gap-4">
                <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br from-violet-500 to-cyan-500">
                  <FolderOpen className="h-6 w-6 text-white" />
                </div>
                <div>
                  <CardTitle className="text-2xl">{project.name}</CardTitle>
                  <div className="mt-1 flex items-center gap-3 text-sm text-muted-foreground">
                    <span className="flex items-center gap-1">
                      <Calendar className="h-3.5 w-3.5" />
                      Criado em {formatDate(project.created_at)}
                    </span>
                    <Badge
                      variant={project.status === 'active' ? 'default' : 'secondary'}
                    >
                      {project.status === 'active' ? 'Ativo' : 'Arquivado'}
                    </Badge>
                  </div>
                </div>
              </div>
              <div className="flex gap-2">
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
            <CardContent className="space-y-6">
              {project.description && (
                <div>
                  <div className="mb-2 flex items-center justify-between gap-3">
                    <h3 className="text-sm font-medium text-muted-foreground">Descrição</h3>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => handleCopySection('description', project.description || '')}
                      className="h-7 w-7 text-muted-foreground hover:text-foreground"
                      aria-label="Copiar descrição"
                    >
                      {copiedSection === 'description' ? (
                        <Check className="h-4 w-4 text-emerald-500" />
                      ) : (
                        <Copy className="h-4 w-4" />
                      )}
                    </Button>
                  </div>
                  <p className="whitespace-pre-wrap text-foreground">{project.description}</p>
                </div>
              )}
              {project.context && (
                <div>
                  <div className="mb-2 flex items-center justify-between gap-3">
                    <h3 className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
                      <FileText className="h-4 w-4" />
                      Contexto para IA
                    </h3>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => handleCopySection('context', project.context || '')}
                      className="h-7 w-7 text-muted-foreground hover:text-foreground"
                      aria-label="Copiar contexto para IA"
                    >
                      {copiedSection === 'context' ? (
                        <Check className="h-4 w-4 text-emerald-500" />
                      ) : (
                        <Copy className="h-4 w-4" />
                      )}
                    </Button>
                  </div>
                  <div className="rounded-lg border border-border/50 bg-background/50 p-4">
                    <p className="whitespace-pre-wrap text-sm text-foreground">{project.context}</p>
                  </div>
                </div>
              )}
              {project.style_profile && (
                <div>
                  <div className="mb-2 flex items-center justify-between gap-3">
                    <h3 className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
                      <Palette className="h-4 w-4" />
                      Perfil de Estilo
                    </h3>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => handleCopySection('style_profile', project.style_profile || '')}
                      className="h-7 w-7 text-muted-foreground hover:text-foreground"
                      aria-label="Copiar perfil de estilo"
                    >
                      {copiedSection === 'style_profile' ? (
                        <Check className="h-4 w-4 text-emerald-500" />
                      ) : (
                        <Copy className="h-4 w-4" />
                      )}
                    </Button>
                  </div>
                  <div className="rounded-lg border border-border/50 bg-background/50 p-4">
                    <p className="whitespace-pre-wrap text-sm text-foreground">{project.style_profile}</p>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Content Tabs */}
          <Tabs defaultValue="images" className="w-full">
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="images" className="gap-2">
                <ImageIcon className="h-4 w-4" />
                Imagens ({images.length})
              </TabsTrigger>
              <TabsTrigger value="videos" className="gap-2">
                <Video className="h-4 w-4" />
                Vídeos ({videos.length})
              </TabsTrigger>
            </TabsList>

            <TabsContent value="images" className="mt-4">
              {images.length === 0 ? (
                <Card className="border-dashed">
                  <CardContent className="flex flex-col items-center justify-center py-12">
                    <ImageIcon className="mb-4 h-12 w-12 text-muted-foreground" />
                    <h3 className="text-lg font-semibold">Nenhuma imagem ainda</h3>
                    <p className="mt-1 text-sm text-muted-foreground">
                      As imagens criadas para este projeto aparecerão aqui.
                    </p>
                    <Button
                      className="mt-4"
                      onClick={() => router.push(`/imagens?project=${projectId}`)}
                    >
                      Criar Imagem
                    </Button>
                  </CardContent>
                </Card>
              ) : (
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  {images.map((image) => (
                    <Card key={image.id} className="overflow-hidden">
                      {image.image_url && (
                        <div className="aspect-square">
                          <img
                            src={image.image_url}
                            alt={image.user_input}
                            className="h-full w-full object-cover"
                          />
                        </div>
                      )}
                      <CardContent className="p-3">
                        <p className="line-clamp-2 text-sm text-muted-foreground">
                          {image.user_input}
                        </p>
                        <Badge variant="outline" className="mt-2">
                          {image.status}
                        </Badge>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              )}
            </TabsContent>

            <TabsContent value="videos" className="mt-4">
              {videos.length === 0 ? (
                <Card className="border-dashed">
                  <CardContent className="flex flex-col items-center justify-center py-12">
                    <Video className="mb-4 h-12 w-12 text-muted-foreground" />
                    <h3 className="text-lg font-semibold">Nenhum vídeo ainda</h3>
                    <p className="mt-1 text-sm text-muted-foreground">
                      Os vídeos criados para este projeto aparecerão aqui.
                    </p>
                    <Button
                      className="mt-4"
                      onClick={() => router.push(`/videos?project=${projectId}`)}
                    >
                      Criar Vídeo
                    </Button>
                  </CardContent>
                </Card>
              ) : (
                <div className="grid gap-4 sm:grid-cols-2">
                  {videos.map((video) => (
                    <Card key={video.id}>
                      <CardContent className="p-4">
                        <h3 className="font-semibold">{video.name}</h3>
                        {video.description && (
                          <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">
                            {video.description}
                          </p>
                        )}
                        <div className="mt-2 flex items-center gap-2">
                          <Badge variant="outline">{video.status}</Badge>
                          {video.duration_seconds && (
                            <span className="text-sm text-muted-foreground">
                              {video.duration_seconds}s
                            </span>
                          )}
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              )}
            </TabsContent>
          </Tabs>
        </div>
      </div>

      {/* Edit Project Modal */}
      <ProjectForm
        open={showEditForm}
        onOpenChange={setShowEditForm}
        project={project}
        onSuccess={handleEditSuccess}
      />

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir projeto?</AlertDialogTitle>
            <AlertDialogDescription>
              Esta ação não pode ser desfeita. Todas as imagens e vídeos
              associados a este projeto perderão a referência.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              disabled={isDeleting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {isDeleting ? 'Excluindo...' : 'Excluir'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}

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
} from 'lucide-react'
import { useToast } from '@/hooks/use-toast'
import type { Project, Production } from '@/lib/types'

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

  useEffect(() => {
    const loadData = async () => {
      try {
        // Load production first via API
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

        // Guard: production must belong to the project in the URL
        if (prod.project_id !== projectId) {
          setError('Produção não encontrada.')
          return
        }

        // Load project after session is guaranteed to be established
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

  const handleEditSuccess = (updated: Production) => {
    setProduction(updated)
  }

  const handleDelete = async () => {
    setIsDeleting(true)
    try {
      const res = await fetch(`/api/productions/${productionId}`, { method: 'DELETE' })
      if (!res.ok) {
        const data = await res.json()
        toast({
          title: 'Erro',
          description: data.error || 'Não foi possível excluir a Produção.',
          variant: 'destructive',
        })
        return
      }
      toast({ title: 'Produção excluída', description: 'A Produção foi removida com sucesso.' })
      router.push(`/projetos/${projectId}`)
    } catch {
      toast({
        title: 'Erro',
        description: 'Erro de conexão. Tente novamente.',
        variant: 'destructive',
      })
    } finally {
      setIsDeleting(false)
      setShowDeleteDialog(false)
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
            <TabsList className="grid w-full grid-cols-4">
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
              <TabsTrigger value="posts" className="gap-2">
                <FileText className="h-4 w-4" />
                Publicações
              </TabsTrigger>
            </TabsList>

            {/* Visão Geral */}
            <TabsContent value="overview" className="mt-4">
              <div className="space-y-4">
                <Card className="border-border/50 bg-card/30">
                  <CardContent className="p-4">
                    <h3 className="mb-3 font-medium">Resumo desta Produção</h3>
                    <div className="grid gap-3 sm:grid-cols-3">
                      <div className="flex items-center gap-3 rounded-lg border border-border/50 bg-background/50 p-3">
                        <ImageIcon className="h-5 w-5 shrink-0 text-muted-foreground" />
                        <div>
                          <p className="text-sm font-medium">Imagens</p>
                          <p className="text-xs text-muted-foreground">Sem imagens vinculadas</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-3 rounded-lg border border-border/50 bg-background/50 p-3">
                        <Video className="h-5 w-5 shrink-0 text-muted-foreground" />
                        <div>
                          <p className="text-sm font-medium">Vídeos</p>
                          <p className="text-xs text-muted-foreground">Sem vídeos vinculados</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-3 rounded-lg border border-border/50 bg-background/50 p-3">
                        <FileText className="h-5 w-5 shrink-0 text-muted-foreground" />
                        <div>
                          <p className="text-sm font-medium">Publicações</p>
                          <p className="text-xs text-muted-foreground">Sem publicações vinculadas</p>
                        </div>
                      </div>
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
              <Card className="border-dashed">
                <CardContent className="flex flex-col items-center justify-center py-12">
                  <ImageIcon className="mb-4 h-12 w-12 text-muted-foreground" />
                  <h3 className="text-lg font-semibold">Nenhuma imagem vinculada</h3>
                  <p className="mt-1 max-w-sm text-center text-sm text-muted-foreground">
                    Nenhuma imagem vinculada a esta Produção.
                  </p>
                  <p className="mt-3 rounded-md border border-border/50 bg-muted/30 px-3 py-1 text-xs text-muted-foreground">
                    Disponível a partir do Incremento 5
                  </p>
                </CardContent>
              </Card>
            </TabsContent>

            {/* Vídeos */}
            <TabsContent value="videos" className="mt-4">
              <Card className="border-dashed">
                <CardContent className="flex flex-col items-center justify-center py-12">
                  <Video className="mb-4 h-12 w-12 text-muted-foreground" />
                  <h3 className="text-lg font-semibold">Nenhum vídeo vinculado</h3>
                  <p className="mt-1 max-w-sm text-center text-sm text-muted-foreground">
                    Nenhum vídeo vinculado a esta Produção.
                  </p>
                  <p className="mt-3 rounded-md border border-border/50 bg-muted/30 px-3 py-1 text-xs text-muted-foreground">
                    Disponível a partir do Incremento 5
                  </p>
                </CardContent>
              </Card>
            </TabsContent>

            {/* Publicações */}
            <TabsContent value="posts" className="mt-4">
              <Card className="border-dashed">
                <CardContent className="flex flex-col items-center justify-center py-12">
                  <FileText className="mb-4 h-12 w-12 text-muted-foreground" />
                  <h3 className="text-lg font-semibold">Nenhuma publicação vinculada</h3>
                  <p className="mt-1 max-w-sm text-center text-sm text-muted-foreground">
                    Nenhuma publicação vinculada a esta Produção.
                  </p>
                  <p className="mt-3 rounded-md border border-border/50 bg-muted/30 px-3 py-1 text-xs text-muted-foreground">
                    Disponível a partir do Incremento 5
                  </p>
                </CardContent>
              </Card>
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
              permanentemente. Esta ação não pode ser desfeita.
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
    </>
  )
}

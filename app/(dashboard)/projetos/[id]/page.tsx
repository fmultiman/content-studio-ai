'use client'

import { useEffect, useRef, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Header } from '@/components/layout/header'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
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
import { ProjectForm } from '@/components/projects/project-form'
import { ProductionForm } from '@/components/productions/production-form'
import { ProjectIdentityDisplay } from '@/components/projects/project-identity-display'
import { ProjectIdentityForm } from '@/components/projects/project-identity-form'
import {
  ArrowLeft,
  Loader2,
  FolderOpen,
  FileText,
  Calendar,
  Edit2,
  Trash2,
  Copy,
  Check,
  Layers,
  Plus,
} from 'lucide-react'
import { useToast } from '@/hooks/use-toast'
import type { Project, Production } from '@/lib/types'
import type { ProjectIdentity } from '@/lib/schemas/project-identity'
import { normalizeProjectIdentity } from '@/lib/project-identity-normalizer'
import { resolveProductionDisplay } from '@/lib/ux-production-hardening'

const PRODUCTION_TYPE_LABELS: Record<string, string> = {
  editorial: 'Editorial',
  branding: 'Branding',
  campaign: 'Campanha',
}

export default function ProjectDetailPage() {
  const params = useParams()
  const router = useRouter()
  const projectId = params.id as string

  const { toast } = useToast()

  // Project + productions state
  const [project, setProject] = useState<Project | null>(null)
  const [productions, setProductions] = useState<Production[]>([])
  const [productionsError, setProductionsError] = useState(false)

  // Page state
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [copiedSection, setCopiedSection] = useState<string | null>(null)

  // Project edit/delete state
  const [showEditForm, setShowEditForm] = useState(false)
  const [showDeleteDialog, setShowDeleteDialog] = useState(false)
  const [isDeleting, setIsDeleting] = useState(false)
  const [showProductionsBlockDialog, setShowProductionsBlockDialog] = useState(false)

  // Identity form state
  const [showIdentityForm, setShowIdentityForm] = useState(false)

  // Production form state
  const [showProductionForm, setShowProductionForm] = useState(false)
  const [editingProduction, setEditingProduction] = useState<Production | null>(null)

  const productionsSectionRef = useRef<HTMLDivElement>(null)

  // Production delete state
  const [showDeleteProductionDialog, setShowDeleteProductionDialog] = useState(false)
  const [deletingProductionId, setDeletingProductionId] = useState<string | null>(null)
  const [isDeletingProduction, setIsDeletingProduction] = useState(false)

  useEffect(() => {
    const fetchProjectData = async () => {
      const supabase = createClient()

      try {
        const { data: projectData, error: projectError } = await supabase
          .from('projects')
          .select('*')
          .eq('id', projectId)
          .single()

        if (projectError) throw projectError
        setProject(projectData)

        const productionsRes = await fetch(`/api/productions?projectId=${projectId}`)

        if (productionsRes.ok) {
          const productionsData = await productionsRes.json()
          setProductions(productionsData.productions || [])
        } else {
          setProductionsError(true)
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Erro ao carregar projeto')
      } finally {
        setIsLoading(false)
      }
    }

    fetchProjectData()
  }, [projectId])

  // ── Project handlers ──────────────────────────────────────────────────────

  const handleDeleteButtonClick = () => {
    if (productions.length > 0) {
      setShowProductionsBlockDialog(true)
    } else {
      setShowDeleteDialog(true)
    }
  }

  const handleDelete = async () => {
    if (!project) return

    setIsDeleting(true)
    const supabase = createClient()

    try {
      const { error: deleteError } = await supabase
        .from('projects')
        .delete()
        .eq('id', project.id)

      if (deleteError) {
        if (deleteError.code === '23503') {
          toast({
            title: 'Projeto possui Produções',
            description: 'Remova as Produções antes de excluir o Projeto.',
            variant: 'destructive',
          })
        } else {
          toast({
            title: 'Erro',
            description: 'Não foi possível excluir o projeto.',
            variant: 'destructive',
          })
        }
        return
      }

      toast({ title: 'Projeto excluído', description: 'O projeto foi excluído com sucesso.' })
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

  const handleIdentitySuccess = (updated: ProjectIdentity | null) => {
    setProject((prev) => (prev ? { ...prev, identity: updated } : prev))
  }

  const handleEditSuccess = async () => {
    setShowEditForm(false)
    const supabase = createClient()
    const { data: projectData } = await supabase
      .from('projects')
      .select('*')
      .eq('id', projectId)
      .single()
    if (projectData) setProject(projectData)
  }

  const handleCopySection = async (section: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text)
      setCopiedSection(section)
      setTimeout(() => setCopiedSection(null), 2000)
    } catch {
      toast({ title: 'Erro', description: 'Não foi possível copiar o texto.', variant: 'destructive' })
    }
  }

  // ── Production handlers ───────────────────────────────────────────────────

  const handleProductionSuccess = (saved: Production) => {
    setProductions((prev) => {
      const idx = prev.findIndex((p) => p.id === saved.id)
      if (idx >= 0) {
        const next = [...prev]
        next[idx] = saved
        return next
      }
      return [saved, ...prev]
    })
  }

  const handleDeleteProduction = async () => {
    if (!deletingProductionId) return
    setIsDeletingProduction(true)

    try {
      const res = await fetch(`/api/productions/${deletingProductionId}`, {
        method: 'DELETE',
      })
      const data = await res.json()

      if (!res.ok) {
        toast({
          title: 'Erro',
          description: data.error || 'Não foi possível excluir a Produção.',
          variant: 'destructive',
        })
        return
      }

      setProductions((prev) => prev.filter((p) => p.id !== deletingProductionId))
      setShowDeleteProductionDialog(false)
      setDeletingProductionId(null)
      toast({ title: 'Produção excluída', description: 'A Produção foi removida com sucesso.' })
    } catch {
      toast({ title: 'Erro', description: 'Erro de conexão. Tente novamente.', variant: 'destructive' })
    } finally {
      setIsDeletingProduction(false)
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────

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

  let resolvedIdentity: ProjectIdentity | null = null
  let identityReadError: string | null = null
  try {
    resolvedIdentity = normalizeProjectIdentity(project.identity)
  } catch {
    identityReadError = 'A identidade salva não pôde ser lida. Os dados foram preservados no banco.'
  }

  const formatDate = (dateString: string) =>
    new Date(dateString).toLocaleDateString('pt-BR', {
      day: '2-digit',
      month: 'long',
      year: 'numeric',
    })

  const deletingProduction = productions.find((p) => p.id === deletingProductionId)

  return (
    <>
      <Header />
      <div className="flex-1 overflow-auto p-6">
        <div className="mx-auto max-w-5xl space-y-6">
          {/* Back Button */}
          <Button variant="ghost" onClick={() => router.push('/projetos')} className="gap-2">
            <ArrowLeft className="h-4 w-4" />
            Voltar para Projetos
          </Button>

          {/* Project Identity Card */}
          <Card className="border-border/50 bg-card/30 backdrop-blur-sm">
            <CardHeader className="flex flex-row items-start justify-between">
              <div className="flex items-start gap-4">
                <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br from-violet-500 to-cyan-500">
                  <FolderOpen className="h-6 w-6 text-white" />
                </div>
                <div>
                  <h1 className="text-2xl font-semibold leading-none text-foreground">{project.name}</h1>
                  <div className="mt-1 flex items-center gap-3 text-sm text-muted-foreground">
                    <span className="flex items-center gap-1">
                      <Calendar className="h-3.5 w-3.5" />
                      Criado em {formatDate(project.created_at)}
                    </span>
                    <Badge variant={project.status === 'active' ? 'default' : 'secondary'}>
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
                  onClick={handleDeleteButtonClick}
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
            </CardContent>
          </Card>

          {/* Project Identity Section */}
          <section id="project-identity" className="scroll-mt-24">
            <ProjectIdentityDisplay
              identity={resolvedIdentity}
              readError={identityReadError}
              onStructure={() => setShowIdentityForm(true)}
              onEdit={() => setShowIdentityForm(true)}
            />
          </section>

          {/* Productions Section */}
          <div ref={productionsSectionRef} className="scroll-mt-24 space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <h2 className="text-lg font-semibold">Produções</h2>
                <Badge variant="secondary">{productions.length}</Badge>
              </div>
              <Button
                size="sm"
                className="gap-2 bg-gradient-to-r from-violet-600 to-cyan-500 text-white"
                onClick={() => {
                  setEditingProduction(null)
                  setShowProductionForm(true)
                }}
              >
                <Plus className="h-4 w-4" />
                Nova Produção
              </Button>
            </div>

            {productionsError ? (
              <Card className="border-dashed">
                <CardContent className="flex flex-col items-center justify-center py-12">
                  <Layers className="mb-4 h-12 w-12 text-muted-foreground" />
                  <p className="text-muted-foreground">
                    Erro ao carregar Produções. Tente recarregar a página.
                  </p>
                </CardContent>
              </Card>
            ) : productions.length === 0 ? (
              <Card className="border-dashed">
                <CardContent className="flex flex-col items-center justify-center py-12">
                  <Layers className="mb-4 h-12 w-12 text-muted-foreground" />
                  <h3 className="text-lg font-semibold">Nenhuma Produção ainda</h3>
                  <p className="mt-1 max-w-sm text-center text-sm text-muted-foreground">
                    Este projeto ainda não possui Produções. Crie uma Production para organizar
                    imagens, vídeos e conteúdos.
                  </p>
                  <Button
                    className="mt-4"
                    onClick={() => {
                      setEditingProduction(null)
                      setShowProductionForm(true)
                    }}
                  >
                    Nova Produção
                  </Button>
                </CardContent>
              </Card>
            ) : (
              <div className="space-y-3">
                {productions.map((prod) => {
                  const productionDisplay = resolveProductionDisplay({
                    title: prod.title,
                    intention: prod.intention,
                    projectName: project.name,
                  })

                  return (
                  <Card
                    key={prod.id}
                    className="cursor-pointer border-border/50 bg-card/30 transition-colors hover:border-border hover:bg-card/50"
                    onClick={() => router.push(`/projetos/${projectId}/producoes/${prod.id}`)}
                  >
                    <CardContent className="p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <h3 className="truncate font-semibold">{productionDisplay.title}</h3>
                            <Badge variant="outline" className="shrink-0">
                              {PRODUCTION_TYPE_LABELS[prod.type] ?? prod.type}
                            </Badge>
                          </div>
                          <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">
                            {productionDisplay.intention}
                          </p>
                          <p className="mt-2 flex items-center gap-1 text-xs text-muted-foreground">
                            <Calendar className="h-3 w-3" />
                            Atualizado em {formatDate(prod.updated_at)}
                          </p>
                        </div>
                        <div className="flex shrink-0 gap-1">
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8"
                            onClick={(e) => {
                              e.stopPropagation()
                              setEditingProduction(prod)
                              setShowProductionForm(true)
                            }}
                            aria-label="Editar Produção"
                          >
                            <Edit2 className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-destructive hover:text-destructive"
                            onClick={(e) => {
                              e.stopPropagation()
                              setDeletingProductionId(prod.id)
                              setShowDeleteProductionDialog(true)
                            }}
                            aria-label="Excluir Produção"
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                  )
                })}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Project Identity Form Modal */}
      <ProjectIdentityForm
        key={showIdentityForm ? 'identity-open' : 'identity-closed'}
        open={showIdentityForm}
        onOpenChange={setShowIdentityForm}
        projectId={projectId}
        identity={resolvedIdentity}
        onSuccess={handleIdentitySuccess}
      />

      {/* Edit Project Modal */}
      <ProjectForm
        open={showEditForm}
        onOpenChange={setShowEditForm}
        project={project}
        onSuccess={handleEditSuccess}
      />

      {/* Production Form Modal (create + edit) */}
      <ProductionForm
        open={showProductionForm}
        onOpenChange={(open) => {
          setShowProductionForm(open)
          if (!open) setEditingProduction(null)
        }}
        projectId={projectId}
        production={editingProduction}
        onSuccess={handleProductionSuccess}
      />

      {/* Delete Project Dialog */}
      <AlertDialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir projeto?</AlertDialogTitle>
            <AlertDialogDescription>
              Esta ação não pode ser desfeita. As imagens, vídeos e publicações associados
              não serão excluídos — apenas perderão o vínculo com este projeto.
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

      {/* Block dialog: project has productions */}
      <Dialog open={showProductionsBlockDialog} onOpenChange={setShowProductionsBlockDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Projeto não pode ser excluído</DialogTitle>
            <DialogDescription>
              Este Projeto possui{' '}
              <strong>
                {productions.length} {productions.length === 1 ? 'Produção' : 'Produções'}
              </strong>{' '}
              e não pode ser excluído.
              <br />
              Remova as Produções antes de excluir o Projeto.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button variant="outline" onClick={() => setShowProductionsBlockDialog(false)}>
              Cancelar
            </Button>
            <Button
              onClick={() => {
                setShowProductionsBlockDialog(false)
                requestAnimationFrame(() => {
                  productionsSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
                })
              }}
              className="bg-gradient-to-r from-violet-600 to-cyan-500 text-white"
            >
              Ver Produções
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Production Confirmation */}
      <AlertDialog
        open={showDeleteProductionDialog}
        onOpenChange={setShowDeleteProductionDialog}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir Produção?</AlertDialogTitle>
            <AlertDialogDescription>
              A Produção{' '}
              <strong>&quot;{deletingProduction?.title}&quot;</strong> será removida
              permanentemente. Esta ação não pode ser desfeita.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel
              onClick={() => {
                setShowDeleteProductionDialog(false)
                setDeletingProductionId(null)
              }}
            >
              Cancelar
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteProduction}
              disabled={isDeletingProduction}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {isDeletingProduction ? 'Excluindo...' : 'Excluir'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}

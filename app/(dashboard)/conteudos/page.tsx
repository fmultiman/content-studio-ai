'use client'

import { Suspense, useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Header } from '@/components/layout/header'
import { PageHeader } from '@/components/layout/page-header'
import { createClient } from '@/lib/supabase/client'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardActions, CardContent, CardTitle } from '@/components/ui/card'
import { FieldError } from '@/components/ui/field'
import { StateMessage } from '@/components/ui/state-message'
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { StatusBadge } from '@/components/ui/status-badge'
import { useToast } from '@/hooks/use-toast'
import type { EditorialContent, EditorialContentStatus, Production, Project } from '@/lib/types'
import { ExternalLink, FolderKanban, Loader2, Plus, Zap } from 'lucide-react'
import { QuickFlowDialog } from '@/components/publication/quick-flow-dialog'

type StatusFilter = 'all' | EditorialContentStatus

const STATUS_LABELS: Record<EditorialContentStatus, string> = {
  draft: 'Rascunho',
  ready: 'Pronto',
  archived: 'Arquivado',
}

function PublicacoesPageContent() {
  const { toast } = useToast()
  const router = useRouter()

  const [projects, setProjects] = useState<Project[]>([])
  const [editorialContents, setEditorialContents] = useState<EditorialContent[]>([])
  const [selectedProject, setSelectedProject] = useState('all')
  const [selectedStatus, setSelectedStatus] = useState<StatusFilter>('all')
  const [selectedProduction, setSelectedProduction] = useState('all')
  const [productions, setProductions] = useState<Production[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [loadError, setLoadError] = useState(false)
  const [retryKey, setRetryKey] = useState(0)

  const [showCreateDialog, setShowCreateDialog] = useState(false)
  const [createTitle, setCreateTitle] = useState('')
  const [createProjectId, setCreateProjectId] = useState('none')
  const [isCreating, setIsCreating] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)

  const [showQuickFlowDialog, setShowQuickFlowDialog] = useState(false)

  useEffect(() => {
    setIsLoading(true)
    setLoadError(false)
    const load = async () => {
      try {
        const supabase = createClient()
        const [{ data: projectsData }, ecRes] = await Promise.all([
          supabase.from('projects').select('*').order('created_at', { ascending: false }),
          fetch('/api/editorial-contents'),
        ])
        const ecData = await ecRes.json()
        if (projectsData) setProjects(projectsData)
        if (ecRes.ok) setEditorialContents(ecData.editorialContents || [])
        else setLoadError(true)
      } catch {
        setLoadError(true)
      } finally {
        setIsLoading(false)
      }
    }
    load()
  }, [retryKey])

  // Load productions when selected project changes
  useEffect(() => {
    if (selectedProject === 'all') {
      setProductions([])
      setSelectedProduction('all')
      return
    }
    let cancelled = false
    fetch(`/api/productions?projectId=${selectedProject}`)
      .then((r) => r.json())
      .then((d) => { if (!cancelled) setProductions(d.productions || []) })
      .catch(() => { if (!cancelled) setProductions([]) })
    return () => { cancelled = true }
  }, [selectedProject])

  const filtered = useMemo(() => {
    return editorialContents.filter((ec) => {
      const matchProject = selectedProject === 'all' || ec.project_id === selectedProject
      const matchStatus = selectedStatus === 'all' || ec.status === selectedStatus
      const matchProduction =
        selectedProduction === 'all' ||
        (selectedProduction === 'none' ? ec.production_id === null : ec.production_id === selectedProduction)
      return matchProject && matchStatus && matchProduction
    })
  }, [editorialContents, selectedProject, selectedStatus, selectedProduction])

  const openCreateDialog = () => {
    setCreateTitle('')
    setCreateProjectId('none')
    setCreateError(null)
    setShowCreateDialog(true)
  }

  const handleProjectChange = (value: string) => {
    setSelectedProject(value)
    setSelectedProduction('all')
  }

  const handleCreate = async () => {
    setCreateError(null)
    if (!createTitle.trim()) {
      setCreateError('Informe o título do conteúdo editorial.')
      return
    }
    if (createProjectId === 'none') {
      setCreateError('Selecione o Project que vai receber este conteúdo.')
      return
    }
    setIsCreating(true)
    try {
      const res = await fetch('/api/editorial-contents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: createTitle.trim(), projectId: createProjectId }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Erro ao criar')
      setEditorialContents((prev) => [data.editorialContent, ...prev])
      setShowCreateDialog(false)
      router.push(`/projetos/${createProjectId}/conteudos/${data.editorialContent.id}`)
    } catch (err) {
      toast({
        title: 'Erro ao criar conteúdo',
        description: err instanceof Error ? err.message : 'Tente novamente.',
        variant: 'destructive',
      })
    } finally {
      setIsCreating(false)
    }
  }

  return (
    <>
      <Header />
      <div className="flex-1 overflow-auto p-6">
        <div className="mx-auto max-w-5xl space-y-6">
          <PageHeader
            context="Workspace"
            title="Conteúdos"
            description="Crie conteúdos editoriais, retome peças em andamento e conecte formatos, canais e Productions."
            actions={(
              <>
                <Button
                  variant="outline"
                  className="gap-2"
                  onClick={() => setShowQuickFlowDialog(true)}
                >
                  <Zap className="h-4 w-4" />
                  Criação rápida
                </Button>
                <Button
                  className="gap-2 text-white"
                  onClick={openCreateDialog}
                >
                  <Plus className="h-4 w-4" />
                  Novo conteúdo
                </Button>
              </>
            )}
          />

          {/* Filters */}
          <div className="flex flex-wrap items-center gap-3">
            <ToggleGroup
              type="single"
              value={selectedStatus}
              onValueChange={(value: StatusFilter) => value && setSelectedStatus(value)}
              className="flex-wrap justify-start rounded-lg border border-border/50"
            >
              <ToggleGroupItem value="all" className="gap-2 text-xs">Todos</ToggleGroupItem>
              <ToggleGroupItem value="draft" className="gap-2 text-xs">Rascunhos</ToggleGroupItem>
              <ToggleGroupItem value="ready" className="gap-2 text-xs">Prontos</ToggleGroupItem>
              <ToggleGroupItem value="archived" className="gap-2 text-xs">Arquivados</ToggleGroupItem>
            </ToggleGroup>

            <div className="flex min-w-[200px] items-center gap-2">
              <FolderKanban className="h-4 w-4 shrink-0 text-muted-foreground" />
              <Select value={selectedProject} onValueChange={handleProjectChange}>
                <SelectTrigger className="bg-background/50">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos os projetos</SelectItem>
                  {projects.map((project) => (
                    <SelectItem key={project.id} value={project.id}>{project.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {selectedProject !== 'all' && (
              <div className="flex min-w-[200px] items-center gap-2">
                <Select value={selectedProduction} onValueChange={setSelectedProduction}>
                  <SelectTrigger className="bg-background/50">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Todas as produções</SelectItem>
                    <SelectItem value="none">Sem produção</SelectItem>
                    {productions.map((prod) => (
                      <SelectItem key={prod.id} value={prod.id}>{prod.title}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>

          <div className="space-y-1">
            <h2 className="text-lg font-semibold text-foreground">Conteúdos editoriais</h2>
            <p className="text-sm text-muted-foreground">
              Retome peças ligadas ao Project e à Production corretos.
            </p>
          </div>
          {isLoading ? (
            <StateMessage
              tone="loading"
              title="Carregando conteúdos editoriais..."
              description="Estamos preparando drafts, status e vínculos com Project e Production."
              className="py-10"
            />
          ) : loadError ? (
            <StateMessage
              tone="error"
              title="Não foi possível carregar os conteúdos"
              description="Tente novamente para recuperar a lista editorial."
              actionLabel="Tentar novamente"
              onAction={() => setRetryKey((k) => k + 1)}
            />
          ) : filtered.length === 0 ? (
            <StateMessage
              tone="empty"
              title={editorialContents.length === 0 ? 'Nenhum conteúdo editorial ainda' : 'Nenhum resultado encontrado'}
              description={
                editorialContents.length === 0
                  ? 'Crie o primeiro conteúdo editorial para começar o fluxo de produção e publicação.'
                  : 'Ajuste os filtros para voltar a ver conteúdos já existentes.'
              }
              actionLabel={editorialContents.length === 0 ? 'Novo conteúdo' : 'Limpar filtros'}
              onAction={
                editorialContents.length === 0
                  ? openCreateDialog
                  : () => {
                      setSelectedStatus('all')
                      setSelectedProject('all')
                      setSelectedProduction('all')
                    }
              }
            />
          ) : (
            <div className="space-y-3">
              {filtered.map((ec) => (
                <Card
                  key={ec.id}
                  className="border-border/50 bg-card/30 transition-colors hover:border-border hover:bg-card/50"
                >
                  <CardContent className="p-4">
                    <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                      <div className="min-w-0 flex-1 space-y-3">
                        <div className="space-y-2">
                          <CardTitle className="line-clamp-1 text-base">{ec.title}</CardTitle>
                          {ec.body && (
                            <p className="line-clamp-2 text-sm text-muted-foreground">
                              {ec.body}
                            </p>
                          )}
                        </div>
                        <ContextMetadata
                          dense
                          items={[
                            { label: 'Project', value: projects.find((p) => p.id === ec.project_id)?.name || 'Projeto' },
                            { label: 'Production', value: ec.production_id ? productions.find((p) => p.id === ec.production_id)?.title || 'Produção' : 'Sem Production associada' },
                            {
                              label: 'Status',
                              value: <StatusBadge label={STATUS_LABELS[ec.status]} tone={ec.status === 'ready' ? 'positive' : 'neutral'} />,
                            },
                            { label: 'Atualizado', value: new Date(ec.updated_at).toLocaleDateString('pt-BR') },
                          ]}
                        />
                      </div>
                      <CardActions className="sm:ml-4 sm:justify-end">
                        <Button
                          variant="outline"
                          size="sm"
                          className="gap-2"
                          onClick={() => router.push(`/projetos/${ec.project_id}/conteudos/${ec.id}`)}
                        >
                          <ExternalLink className="h-4 w-4" />
                          Abrir
                        </Button>
                      </CardActions>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}

        </div>
      </div>

      <QuickFlowDialog
        open={showQuickFlowDialog}
        onOpenChange={setShowQuickFlowDialog}
        projects={projects}
      />

      {/* Create EC Dialog — criação mínima: título + projeto; demais campos no workspace */}
      <Dialog open={showCreateDialog} onOpenChange={setShowCreateDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Novo Conteúdo Editorial</DialogTitle>
            <DialogDescription>
              Defina título e projeto. Corpo, contexto e produção podem ser configurados no workspace.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label htmlFor="ec-create-title">Título *</Label>
              <Input
                id="ec-create-title"
                value={createTitle}
                onChange={(e) => setCreateTitle(e.target.value)}
                placeholder="Ex: Post de lançamento do produto X"
                onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
                aria-invalid={!!createError && !createTitle.trim()}
              />
            </div>
            <div className="space-y-2">
              <Label>Projeto *</Label>
              <Select value={createProjectId} onValueChange={setCreateProjectId}>
                <SelectTrigger>
                  <SelectValue placeholder="Selecione um projeto" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Selecione um projeto</SelectItem>
                  {projects.map((p) => (
                    <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <FieldError>{createError}</FieldError>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreateDialog(false)}>
              Cancelar
            </Button>
            <Button onClick={handleCreate} disabled={isCreating}>
              {isCreating && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Criar e abrir
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

export default function PublicacoesPage() {
  return (
    <Suspense>
      <PublicacoesPageContent />
    </Suspense>
  )
}

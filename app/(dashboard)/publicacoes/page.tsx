'use client'

import { Suspense, useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Header } from '@/components/layout/header'
import { createClient } from '@/lib/supabase/client'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
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
import { useToast } from '@/hooks/use-toast'
import type { EditorialContent, EditorialContentStatus, Production, Project } from '@/lib/types'
import { ExternalLink, FileText, FolderKanban, Loader2, Plus, RefreshCw } from 'lucide-react'

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
    setShowCreateDialog(true)
  }

  const handleProjectChange = (value: string) => {
    setSelectedProject(value)
    setSelectedProduction('all')
  }

  const handleCreate = async () => {
    if (!createTitle.trim()) {
      toast({ title: 'Título obrigatório', variant: 'destructive' })
      return
    }
    if (createProjectId === 'none') {
      toast({ title: 'Selecione um projeto', variant: 'destructive' })
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
      <Header title="Publicações" />
      <div className="flex-1 overflow-auto p-6">
        <div className="mx-auto max-w-5xl space-y-6">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-muted-foreground">
              Gerencie Conteúdos Editoriais por canal e formato.
            </p>
            <Button
              className="gap-2 bg-gradient-to-r from-violet-600 to-cyan-500 text-white"
              onClick={openCreateDialog}
            >
              <Plus className="h-4 w-4" />
              Novo Conteúdo
            </Button>
          </div>

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

          {/* EC List */}
          {isLoading ? (
            <div className="flex justify-center py-16">
              <Loader2 className="h-7 w-7 animate-spin text-muted-foreground" />
            </div>
          ) : loadError ? (
            <Card className="border-dashed">
              <CardContent className="flex flex-col items-center justify-center py-12">
                <FileText className="mb-3 h-10 w-10 text-muted-foreground" />
                <p className="text-muted-foreground">Erro ao carregar conteúdos.</p>
                <Button
                  variant="outline"
                  size="sm"
                  className="mt-4 gap-2"
                  onClick={() => setRetryKey((k) => k + 1)}
                >
                  <RefreshCw className="h-4 w-4" />
                  Tentar novamente
                </Button>
              </CardContent>
            </Card>
          ) : filtered.length === 0 ? (
            <Card className="border-dashed">
              <CardContent className="flex flex-col items-center justify-center py-12">
                <FileText className="mb-3 h-10 w-10 text-muted-foreground" />
                <h3 className="text-lg font-semibold">Nenhum conteúdo editorial</h3>
                <p className="mt-1 text-sm text-muted-foreground">
                  {editorialContents.length === 0
                    ? 'Crie o primeiro Conteúdo Editorial para começar.'
                    : 'Nenhum resultado para os filtros selecionados.'}
                </p>
                {editorialContents.length === 0 && (
                  <Button className="mt-4" onClick={openCreateDialog}>
                    <Plus className="mr-2 h-4 w-4" />
                    Criar Conteúdo
                  </Button>
                )}
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-3">
              {filtered.map((ec) => (
                <Card
                  key={ec.id}
                  className="cursor-pointer border-border/50 bg-card/30 transition-colors hover:border-border hover:bg-card/50"
                  onClick={() => router.push(`/projetos/${ec.project_id}/conteudos/${ec.id}`)}
                >
                  <CardContent className="p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="truncate font-medium">{ec.title}</span>
                          <Badge variant={ec.status === 'ready' ? 'default' : 'secondary'}>
                            {STATUS_LABELS[ec.status]}
                          </Badge>
                        </div>
                        {ec.body && (
                          <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">
                            {ec.body}
                          </p>
                        )}
                        <p className="mt-2 text-xs text-muted-foreground">
                          {projects.find((p) => p.id === ec.project_id)?.name || 'Projeto'} ·{' '}
                          {new Date(ec.updated_at).toLocaleDateString('pt-BR')}
                        </p>
                      </div>
                      <ExternalLink className="h-4 w-4 shrink-0 text-muted-foreground" />
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}

          {/* Legacy Posts section */}
          <div className="border-t border-border/50 pt-6">
            <p className="text-sm text-muted-foreground">
              Procurando pelos Posts legados (Instagram, YouTube)?{' '}
              <a href="/posts" className="text-violet-400 hover:underline">
                Acessar Publicações legadas →
              </a>
            </p>
          </div>
        </div>
      </div>

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

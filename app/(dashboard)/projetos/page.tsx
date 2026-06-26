'use client'

import { useEffect, useState, Suspense, useMemo } from 'react'
import { useSearchParams } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Header } from '@/components/layout/header'
import { ProjectList } from '@/components/projects/project-list'
import { ProjectForm } from '@/components/projects/project-form'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
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
import { Plus, Loader2, Search, FolderOpen, ImageIcon, Video, Trash2 } from 'lucide-react'
import { useToast } from '@/hooks/use-toast'
import type { Project } from '@/lib/types'

function ProjectsContent() {
  const searchParams = useSearchParams()
  const { toast } = useToast()
  const [projects, setProjects] = useState<Project[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  
  // Search and filter state
  const [searchQuery, setSearchQuery] = useState('')
  const [filterType, setFilterType] = useState<string>('all')
  
  // Multi-select state
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [showDeleteDialog, setShowDeleteDialog] = useState(false)
  const [isDeleting, setIsDeleting] = useState(false)

  useEffect(() => {
    if (searchParams.get('new') === 'true') {
      setShowForm(true)
    }
  }, [searchParams])

  const fetchProjects = async () => {
    const supabase = createClient()
    const { data, error } = await supabase
      .from('projects')
      .select('*')
      .order('created_at', { ascending: false })

    if (!error && data) {
      setProjects(data)
    }
    setIsLoading(false)
  }

  useEffect(() => {
    fetchProjects()
  }, [showForm])

  // Filtered projects based on search and filter
  const filteredProjects = useMemo(() => {
    let result = projects

    // Search filter
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase()
      result = result.filter(
        (p) =>
          p.name.toLowerCase().includes(query) ||
          p.description?.toLowerCase().includes(query) ||
          p.context?.toLowerCase().includes(query)
      )
    }

    // Type filter (could filter by status or other criteria)
    if (filterType === 'active') {
      result = result.filter((p) => p.status === 'active')
    } else if (filterType === 'archived') {
      result = result.filter((p) => p.status === 'archived')
    }

    return result
  }, [projects, searchQuery, filterType])

  // Selection handlers
  const handleSelectProject = (id: string, selected: boolean) => {
    setSelectedIds((prev) => {
      const newSet = new Set(prev)
      if (selected) {
        newSet.add(id)
      } else {
        newSet.delete(id)
      }
      return newSet
    })
  }

  const handleSelectAll = () => {
    if (selectedIds.size === filteredProjects.length) {
      setSelectedIds(new Set())
    } else {
      setSelectedIds(new Set(filteredProjects.map((p) => p.id)))
    }
  }

  const handleDeleteSelected = async () => {
    if (selectedIds.size === 0) return

    setIsDeleting(true)
    const supabase = createClient()

    try {
      const idsArray = Array.from(selectedIds)
      await supabase.from('projects').delete().in('id', idsArray)
      
      toast({
        title: 'Projetos excluídos',
        description: `${idsArray.length} projeto(s) excluído(s) com sucesso.`,
      })
      
      setSelectedIds(new Set())
      fetchProjects()
    } catch (error) {
      console.error('Erro ao deletar projetos:', error)
      toast({
        title: 'Erro',
        description: 'Não foi possível excluir os projetos selecionados.',
        variant: 'destructive',
      })
    } finally {
      setIsDeleting(false)
      setShowDeleteDialog(false)
    }
  }

  return (
    <>
      <Header title="Projetos" />
      <div className="flex-1 overflow-auto p-6">
        <div className="mx-auto max-w-7xl space-y-6">
          {/* Header Actions */}
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-muted-foreground">
                Organize suas criações em projetos para melhor contexto.
              </p>
            </div>
            <Button
              onClick={() => setShowForm(true)}
              className="bg-gradient-to-r from-violet-600 to-cyan-500 text-white"
            >
              <Plus className="mr-2 h-4 w-4" />
              Novo Projeto
            </Button>
          </div>

          {/* Search and Filters */}
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="relative flex-1 sm:max-w-md">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Buscar por nome, descrição, tags..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-10"
              />
            </div>
            <div className="flex items-center gap-3">
              <ToggleGroup
                type="single"
                value={filterType}
                onValueChange={(value) => value && setFilterType(value)}
                className="border border-border/50 rounded-lg"
              >
                <ToggleGroupItem value="all" className="gap-2 text-xs">
                  <FolderOpen className="h-3.5 w-3.5" />
                  Todos
                </ToggleGroupItem>
                <ToggleGroupItem value="active" className="gap-2 text-xs">
                  <ImageIcon className="h-3.5 w-3.5" />
                  Ativos
                </ToggleGroupItem>
                <ToggleGroupItem value="archived" className="gap-2 text-xs">
                  <Video className="h-3.5 w-3.5" />
                  Arquivados
                </ToggleGroupItem>
              </ToggleGroup>
            </div>
          </div>

          {/* Multi-select Actions */}
          {selectedIds.size > 0 && (
            <div className="flex items-center gap-4 rounded-lg border border-violet-500/30 bg-violet-500/10 p-3">
              <span className="text-sm text-foreground">
                {selectedIds.size} projeto(s) selecionado(s)
              </span>
              <div className="flex-1" />
              <Button
                variant="ghost"
                size="sm"
                onClick={handleSelectAll}
              >
                {selectedIds.size === filteredProjects.length ? 'Desmarcar todos' : 'Selecionar todos'}
              </Button>
              <Button
                variant="destructive"
                size="sm"
                className="gap-2"
                onClick={() => setShowDeleteDialog(true)}
              >
                <Trash2 className="h-4 w-4" />
                Excluir selecionados
              </Button>
            </div>
          )}

          {/* Project List */}
          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <ProjectList 
              projects={filteredProjects} 
              onRefresh={fetchProjects}
              selectable
              selectedIds={selectedIds}
              onSelectProject={handleSelectProject}
            />
          )}
        </div>
      </div>

      <ProjectForm open={showForm} onOpenChange={setShowForm} onSuccess={fetchProjects} />

      {/* Delete Selected Confirmation Dialog */}
      <AlertDialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir {selectedIds.size} projeto(s)?</AlertDialogTitle>
            <AlertDialogDescription>
              Esta ação não pode ser desfeita. Todas as imagens e vídeos
              associados a estes projetos perderão a referência.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteSelected}
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

export default function ProjectsPage() {
  return (
    <Suspense fallback={
      <div className="flex h-full items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    }>
      <ProjectsContent />
    </Suspense>
  )
}

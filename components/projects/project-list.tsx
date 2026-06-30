'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import type { Project } from '@/lib/types'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { ContextMetadata } from '@/components/ui/context-metadata'
import {
  Card,
  CardActions,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { StatusBadge } from '@/components/ui/status-badge'
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
import { ProjectForm } from './project-form'
import { FolderOpen, MoreVertical, Trash2, Pencil } from 'lucide-react'
import { formatDistanceToNow } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import { useToast } from '@/hooks/use-toast'

interface ProjectListProps {
  projects: Project[]
  onRefresh?: () => void
  selectable?: boolean
  selectedIds?: Set<string>
  onSelectProject?: (id: string, selected: boolean) => void
}

export function ProjectList({
  projects,
  onRefresh,
  selectable = false,
  selectedIds = new Set(),
  onSelectProject,
}: ProjectListProps) {
  const router = useRouter()
  const { toast } = useToast()
  const [deleteId, setDeleteId] = useState<string | null>(null)
  const [isDeleting, setIsDeleting] = useState(false)
  const [editingProject, setEditingProject] = useState<Project | null>(null)

  const handleDelete = async () => {
    if (!deleteId) return

    setIsDeleting(true)
    const supabase = createClient()

    try {
      await supabase.from('projects').delete().eq('id', deleteId)
      toast({
        title: 'Projeto excluído',
        description: 'O projeto foi excluído com sucesso.',
      })
      onRefresh?.()
      router.refresh()
    } catch (error) {
      console.error('Erro ao deletar projeto:', error)
      toast({
        title: 'Erro',
        description: 'Não foi possível excluir o projeto.',
        variant: 'destructive',
      })
    } finally {
      setIsDeleting(false)
      setDeleteId(null)
    }
  }

  const handleEditSuccess = () => {
    setEditingProject(null)
    onRefresh?.()
  }

  if (projects.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border/50 bg-card/30 p-12 text-center">
        <FolderOpen className="mb-4 h-12 w-12 text-muted-foreground" />
        <h3 className="text-lg font-semibold text-foreground">
          Nenhum projeto ainda
        </h3>
        <p className="mt-1 text-sm text-muted-foreground">
          Crie seu primeiro projeto para começar a organizar suas criações.
        </p>
      </div>
    )
  }

  return (
    <>
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {projects.map((project) => (
          <Card
            key={project.id}
            className={`group border-border/50 bg-card/30 backdrop-blur-sm transition-all duration-200 hover:border-violet-500/50 hover:shadow-lg ${
              selectedIds.has(project.id)
                ? 'border-[var(--card-selected-border)] bg-[var(--card-selected-background)]'
                : ''
            }`}
          >
            <CardHeader className="flex flex-row items-start justify-between gap-3 pb-0">
              <div className="flex min-w-0 items-start gap-3">
                {selectable && (
                  <Checkbox
                    checked={selectedIds.has(project.id)}
                    onCheckedChange={(checked) => {
                      onSelectProject?.(project.id, !!checked)
                    }}
                    className="mt-1"
                  />
                )}
                <div className="min-w-0 flex-1">
                  <CardTitle className="line-clamp-2 text-base" title={project.name}>
                    {project.name}
                  </CardTitle>
                  <CardDescription className="mt-1 line-clamp-2 text-xs">
                    {project.description || 'Sem descrição'}
                  </CardDescription>
                </div>
              </div>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 shrink-0 opacity-100 transition-opacity sm:opacity-0 sm:group-hover:opacity-100"
                    aria-label={`Opções do Project ${project.name}`}
                  >
                    <MoreVertical className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem
                    onClick={() => {
                      setEditingProject(project)
                    }}
                  >
                    <Pencil className="mr-2 h-4 w-4" />
                    Editar
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    onClick={() => {
                      setDeleteId(project.id)
                    }}
                    className="text-destructive"
                  >
                    <Trash2 className="mr-2 h-4 w-4" />
                    Excluir
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </CardHeader>
            <CardContent className="space-y-4 pt-0">
              <ContextMetadata
                dense
                items={[
                  {
                    label: 'Status',
                    value: (
                      <StatusBadge
                        label={project.status === 'active' ? 'Ativo' : 'Arquivado'}
                        tone={project.status === 'active' ? 'positive' : 'neutral'}
                      />
                    ),
                  },
                  {
                    label: 'Atualizado',
                    value: formatDistanceToNow(new Date(project.updated_at), {
                      addSuffix: true,
                      locale: ptBR,
                    }),
                  },
                ]}
              />
              <CardActions>
                <Button
                  size="sm"
                  onClick={() => router.push(`/projetos/${project.id}`)}
                >
                  Abrir
                </Button>
              </CardActions>
            </CardContent>
          </Card>
        ))}
      </div>

      <ProjectForm
        open={!!editingProject}
        onOpenChange={(open) => !open && setEditingProject(null)}
        project={editingProject}
        onSuccess={handleEditSuccess}
      />

      <AlertDialog open={!!deleteId} onOpenChange={() => setDeleteId(null)}>
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

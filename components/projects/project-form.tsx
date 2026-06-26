'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Loader2 } from 'lucide-react'
import { useToast } from '@/hooks/use-toast'
import type { EvaluationMode, Project } from '@/lib/types'

interface ProjectFormProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  project?: Project | null
  onSuccess?: () => void
}

export function ProjectForm({ open, onOpenChange, project, onSuccess }: ProjectFormProps) {
  const router = useRouter()
  const { toast } = useToast()
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [formData, setFormData] = useState({
    name: '',
    description: '',
    context: '',
    evaluation_mode: 'default' as EvaluationMode,
  })

  const isEditing = !!project

  // Populate form when editing
  useEffect(() => {
    if (project) {
      setFormData({
        name: project.name || '',
        description: project.description || '',
        context: project.context || '',
        evaluation_mode: project.evaluation_mode || 'default',
      })
    } else {
      setFormData({
        name: '',
        description: '',
        context: '',
        evaluation_mode: 'default',
      })
    }
  }, [project, open])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setIsLoading(true)
    setError(null)

    const supabase = createClient()

    try {
      const { data: { user } } = await supabase.auth.getUser()
      
      if (!user) {
        throw new Error('Usuário não autenticado')
      }

      if (isEditing && project) {
        // Update existing project
        const { error: updateError } = await supabase
          .from('projects')
          .update({
            name: formData.name,
            description: formData.description || null,
            context: formData.context || null,
            evaluation_mode: formData.evaluation_mode,
          })
          .eq('id', project.id)

        if (updateError) throw updateError

        toast({
          title: 'Projeto atualizado',
          description: 'As alterações foram salvas com sucesso.',
        })
      } else {
        // Create new project
        const { data: createdProject, error: insertError } = await supabase
          .from('projects')
          .insert({
            user_id: user.id,
            name: formData.name,
            description: formData.description || null,
            context: formData.context || null,
            evaluation_mode: formData.evaluation_mode,
          })
          .select('id')
          .single()

        if (insertError) throw insertError

        if (createdProject?.id) {
          const folderResponse = await fetch('/api/library-folders', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              projectId: createdProject.id,
              ensureProjectRoot: true,
            }),
          })

          if (!folderResponse.ok) {
            console.error('[Project Form] Project folder creation failed:', await folderResponse.json())
          }
        }

        toast({
          title: 'Projeto criado',
          description: 'Seu novo projeto foi criado com sucesso.',
        })
      }

      setFormData({ name: '', description: '', context: '', evaluation_mode: 'default' })
      onOpenChange(false)
      onSuccess?.()
      router.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao salvar projeto')
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[90vh] flex-col sm:max-w-lg">
        <DialogHeader className="flex-shrink-0">
          <DialogTitle>{isEditing ? 'Editar Projeto' : 'Novo Projeto'}</DialogTitle>
          <DialogDescription>
            {isEditing 
              ? 'Atualize as informações do seu projeto.'
              : 'Crie um projeto para organizar suas criações e manter contexto consistente.'
            }
          </DialogDescription>
        </DialogHeader>

        <form id="project-form" onSubmit={handleSubmit} className="flex flex-1 flex-col gap-6 overflow-y-auto pr-2">
          <div className="space-y-2">
            <Label htmlFor="name">Nome do Projeto *</Label>
            <Input
              id="name"
              placeholder="Ex: Campanha de Marketing Q1"
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              required
              className="bg-background/50"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="description">Descrição</Label>
            <Textarea
              id="description"
              placeholder="Descreva brevemente o objetivo do projeto..."
              value={formData.description}
              onChange={(e) => setFormData({ ...formData, description: e.target.value })}
              rows={3}
              className="bg-background/50"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="context">Contexto para IA</Label>
            <Textarea
              id="context"
              placeholder="Forneça contexto adicional que a IA deve considerar ao gerar conteúdo para este projeto (estilo, tom, referências, etc.)..."
              value={formData.context}
              onChange={(e) => setFormData({ ...formData, context: e.target.value })}
              rows={4}
              className="bg-background/50"
            />
            <p className="text-xs text-muted-foreground">
              Este contexto será usado para melhorar a geração de prompts.
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="evaluation_mode">Modo de Avaliacao</Label>
            <Select
              value={formData.evaluation_mode}
              onValueChange={(value: EvaluationMode) =>
                setFormData({ ...formData, evaluation_mode: value })
              }
            >
              <SelectTrigger id="evaluation_mode" className="bg-background/50">
                <SelectValue placeholder="Selecione o modo de avaliacao" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="default">Padrao</SelectItem>
                <SelectItem value="conceptual">Conceitual</SelectItem>
                <SelectItem value="aesthetic">Estetico</SelectItem>
                <SelectItem value="commercial">Comercial</SelectItem>
                <SelectItem value="experimental">Experimental</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              Define como a IA deve julgar imagens deste projeto durante a revisao.
            </p>
          </div>

          {error && (
            <p className="text-sm text-destructive">{error}</p>
          )}
        </form>

        <div className="flex flex-shrink-0 justify-end gap-3 border-t border-border/50 pt-4">
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
          >
            Cancelar
          </Button>
          <Button
            type="submit"
            form="project-form"
            disabled={isLoading || !formData.name}
            className="bg-gradient-to-r from-violet-600 to-cyan-500 text-white"
          >
            {isLoading ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                {isEditing ? 'Salvando...' : 'Criando...'}
              </>
            ) : (
              isEditing ? 'Salvar Alterações' : 'Criar Projeto'
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

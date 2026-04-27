'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Loader2, HelpCircle } from 'lucide-react'
import { TagInput } from '@/components/ui/tag-input'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import { useToast } from '@/hooks/use-toast'
import type { Project } from '@/lib/types'

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
    style_profile: '',
  })

  const isEditing = !!project

  // Populate form when editing
  useEffect(() => {
    if (project) {
      setFormData({
        name: project.name || '',
        description: project.description || '',
        context: project.context || '',
        style_profile: project.style_profile || '',
      })
    } else {
      setFormData({
        name: '',
        description: '',
        context: '',
        style_profile: '',
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
            style_profile: formData.style_profile || null,
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
            style_profile: formData.style_profile || null,
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

      setFormData({ name: '', description: '', context: '', style_profile: '' })
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
            <div className="flex items-center gap-2">
              <Label htmlFor="style_profile">Perfil de Estilo</Label>
              <Popover>
                <PopoverTrigger asChild>
                  <button
                    type="button"
                    className="rounded-full p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                  >
                    <HelpCircle className="h-4 w-4" />
                  </button>
                </PopoverTrigger>
                <PopoverContent className="w-80" side="top">
                  <div className="space-y-3">
                    <p className="text-sm font-medium">Como preencher o Perfil de Estilo</p>
                    <p className="text-sm text-muted-foreground">
                      Descreva como as imagens devem parecer.
                    </p>
                    <div className="space-y-1">
                      <p className="text-xs font-medium text-muted-foreground">Exemplos:</p>
                      <ul className="list-inside list-disc text-xs text-muted-foreground">
                        <li>iluminação dramática</li>
                        <li>contraste forte</li>
                        <li>estilo cinematográfico</li>
                        <li>evitar visual clean</li>
                      </ul>
                    </div>
                    <p className="text-xs text-cyan-400">
                      Dica: Pense em luz, cor, composição e sensação.
                    </p>
                  </div>
                </PopoverContent>
              </Popover>
            </div>
            <TagInput
              value={formData.style_profile}
              onChange={(value) => setFormData({ ...formData, style_profile: value })}
              placeholder="Digite termos de estilo e pressione Enter..."
              suggestions={[
                'iluminação dramática',
                'realista',
                'cinematográfico',
                'alto contraste',
                'minimalista',
                'cyberpunk',
                'espiritual',
                'tecnológico',
                'escuro',
                'cores vibrantes',
                'foco central',
                'simetria',
              ]}
            />
            <p className="text-xs text-muted-foreground">
              O perfil de estilo será aplicado automaticamente às gerações deste projeto.
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

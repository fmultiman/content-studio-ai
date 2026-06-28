'use client'

import { useState, useEffect } from 'react'
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
import { FieldError } from '@/components/ui/field'
import { Loader2 } from 'lucide-react'
import { useToast } from '@/hooks/use-toast'
import type { Production, ProductionType } from '@/lib/types'

interface ProductionFormProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  projectId: string
  production?: Production | null
  onSuccess?: (production: Production) => void
}

const PRODUCTION_TYPES: { value: ProductionType; label: string; description: string }[] = [
  {
    value: 'editorial',
    label: 'Editorial',
    description: 'Posts, artigos, newsletters e conteúdo editorial',
  },
  {
    value: 'branding',
    label: 'Branding',
    description: 'Identidade visual, assets de marca e materiais visuais',
  },
  {
    value: 'campaign',
    label: 'Campanha',
    description: 'Campanhas de marketing, lançamentos e promocionais',
  },
]

export function ProductionForm({
  open,
  onOpenChange,
  projectId,
  production,
  onSuccess,
}: ProductionFormProps) {
  const { toast } = useToast()
  const isEditing = !!production

  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [titleManuallyEdited, setTitleManuallyEdited] = useState(false)
  const [formData, setFormData] = useState({
    title: '',
    intention: '',
    type: 'editorial' as ProductionType,
  })
  const trimmedTitle = formData.title.trim()
  const trimmedIntention = formData.intention.trim()
  const intentionError = !trimmedIntention ? 'Descreva a intenção da Production.' : null
  const titleError = !trimmedTitle ? 'Informe o título da Production.' : null

  useEffect(() => {
    if (open) {
      if (production) {
        setFormData({
          title: production.title,
          intention: production.intention,
          type: production.type,
        })
        setTitleManuallyEdited(true)
      } else {
        setFormData({ title: '', intention: '', type: 'editorial' })
        setTitleManuallyEdited(false)
      }
      setError(null)
    }
  }, [open, production])

  const handleIntentionBlur = () => {
    if (!titleManuallyEdited && formData.intention.trim()) {
      const suggested = formData.intention.trim().slice(0, 60).trimEnd()
      setFormData((prev) => ({ ...prev, title: suggested }))
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setIsLoading(true)
    setError(null)

    const title = trimmedTitle
    const intention = trimmedIntention

    try {
      const res = await fetch(
        isEditing ? `/api/productions/${production!.id}` : '/api/productions',
        {
          method: isEditing ? 'PATCH' : 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(
            isEditing
              ? { title, intention, type: formData.type }
              : { projectId, title, intention, type: formData.type }
          ),
        }
      )

      const data = await res.json()

      if (!res.ok) {
        setError(data.error || 'Erro ao salvar Produção')
        return
      }

      toast({
        title: isEditing ? 'Produção atualizada' : 'Produção criada',
        description: isEditing
          ? 'As alterações foram salvas.'
          : 'Nova Produção criada com sucesso.',
      })

      onSuccess?.(data.production)
      onOpenChange(false)
    } catch {
      setError('Erro de conexão. Tente novamente.')
    } finally {
      setIsLoading(false)
    }
  }

  const selectedTypeInfo = PRODUCTION_TYPES.find((t) => t.value === formData.type)
  const canSubmit = !titleError && !intentionError && !isLoading

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{isEditing ? 'Editar Produção' : 'Nova Produção'}</DialogTitle>
          <DialogDescription>
            {isEditing
              ? 'Atualize as informações desta Produção.'
              : 'Defina a intenção e organize seu trabalho criativo.'}
          </DialogDescription>
        </DialogHeader>

        <form id="production-form" onSubmit={handleSubmit} className="space-y-5">
          <div className="space-y-2">
            <Label htmlFor="intention">Intenção *</Label>
            <Textarea
              id="intention"
              placeholder="O que você deseja produzir e por quê?"
              value={formData.intention}
              onChange={(e) =>
                setFormData((prev) => ({ ...prev, intention: e.target.value }))
              }
              onBlur={handleIntentionBlur}
              rows={3}
              className="bg-background/50"
              aria-invalid={!!intentionError}
              aria-describedby={intentionError ? 'production-intention-error' : undefined}
              required
            />
            <FieldError id="production-intention-error">{intentionError}</FieldError>
          </div>

          <div className="space-y-2">
            <Label htmlFor="title">Título *</Label>
            <Input
              id="title"
              placeholder="Nome curto desta Produção"
              value={formData.title}
              onChange={(e) => {
                setTitleManuallyEdited(true)
                setFormData((prev) => ({ ...prev, title: e.target.value }))
              }}
              className="bg-background/50"
              aria-invalid={!!titleError}
              aria-describedby={titleError ? 'production-title-error' : undefined}
              required
            />
            <FieldError id="production-title-error">{titleError}</FieldError>
            {!isEditing && !titleManuallyEdited && (
              <p className="text-xs text-muted-foreground">
                Sugerido automaticamente a partir da intenção.
              </p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="type">Tipo</Label>
            <Select
              value={formData.type}
              onValueChange={(value) =>
                setFormData((prev) => ({ ...prev, type: value as ProductionType }))
              }
            >
              <SelectTrigger id="type" className="bg-background/50">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PRODUCTION_TYPES.map((t) => (
                  <SelectItem key={t.value} value={t.value}>
                    {t.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {selectedTypeInfo && (
              <p className="text-xs text-muted-foreground">{selectedTypeInfo.description}</p>
            )}
          </div>

          <FieldError>{error}</FieldError>
        </form>

        <div className="flex justify-end gap-3 border-t border-border/50 pt-4">
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isLoading}
          >
            Cancelar
          </Button>
          <Button
            type="submit"
            form="production-form"
            disabled={!canSubmit}
            className="bg-gradient-to-r from-violet-600 to-cyan-500 text-white"
          >
            {isLoading ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                {isEditing ? 'Salvando...' : 'Criando...'}
              </>
            ) : isEditing ? (
              'Salvar Alterações'
            ) : (
              'Criar Produção'
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

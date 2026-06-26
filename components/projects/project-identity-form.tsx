'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Loader2 } from 'lucide-react'
import { useToast } from '@/hooks/use-toast'
import type { ProjectIdentity } from '@/lib/schemas/project-identity'
import {
  identityToFormState,
  formStateToIdentityInput,
  type IdentityFormState,
} from '@/lib/project-identity-form-helpers'
import { normalizeProjectIdentity } from '@/lib/project-identity-normalizer'

interface ProjectIdentityFormProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  projectId: string
  identity: ProjectIdentity | null
  onSuccess: (updated: ProjectIdentity | null) => void
}

export function ProjectIdentityForm({
  open,
  onOpenChange,
  projectId,
  identity,
  onSuccess,
}: ProjectIdentityFormProps) {
  const { toast } = useToast()
  const [formState, setFormState] = useState<IdentityFormState>(() => identityToFormState(identity))
  const [isSaving, setIsSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  const setField = (field: keyof IdentityFormState) => (
    e: React.ChangeEvent<HTMLTextAreaElement>,
  ) => {
    setFormState((prev) => ({ ...prev, [field]: e.target.value }))
  }

  const handleCancel = () => {
    setSaveError(null)
    onOpenChange(false)
  }

  const handleSave = async () => {
    setIsSaving(true)
    setSaveError(null)

    // 1. Convert form state to raw input
    const raw = formStateToIdentityInput(formState)

    // 2. Validate / normalize — if throws, surface the error and do not persist
    let normalized: ProjectIdentity | null
    try {
      normalized = normalizeProjectIdentity(raw)
    } catch (err) {
      setSaveError(
        err instanceof Error
          ? err.message
          : 'A identidade não pôde ser validada. Verifique os campos e tente novamente.',
      )
      setIsSaving(false)
      return
    }

    // 3. Persist to Supabase
    const supabase = createClient()
    const { error: dbError } = await supabase
      .from('projects')
      .update({ identity: normalized })
      .eq('id', projectId)

    if (dbError) {
      setSaveError(
        `Erro ao salvar: ${dbError.message || 'Não foi possível persistir a identidade. Tente novamente.'}`,
      )
      setIsSaving(false)
      return
    }

    // 4. Success: notify, close, inform parent
    toast({
      title: normalized ? 'Identidade salva' : 'Identidade removida',
      description: normalized
        ? 'A identidade do projeto foi atualizada.'
        : 'A identidade estruturada foi removida.',
    })

    setIsSaving(false)
    onOpenChange(false)
    onSuccess(normalized)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[90vh] flex-col sm:max-w-2xl">
        <DialogHeader className="flex-shrink-0">
          <DialogTitle>Identidade do Projeto</DialogTitle>
          <DialogDescription>
            Defina propósito, público, estética e regras que guiam este Projeto.
          </DialogDescription>
        </DialogHeader>

        {/* Scrollable form body */}
        <div className="flex-1 overflow-y-auto space-y-6 pr-2">
          {/* Fundamento */}
          <FormSection title="Fundamento">
            <div className="space-y-2">
              <Label htmlFor="identity-purpose">Propósito</Label>
              <Textarea
                id="identity-purpose"
                rows={4}
                placeholder="Por que este Project existe e o que o torna distinto?"
                value={formState.purpose}
                onChange={setField('purpose')}
                className="bg-background/50"
              />
            </div>
          </FormSection>

          {/* Relacionamento */}
          <FormSection title="Relacionamento">
            <div className="space-y-2">
              <Label htmlFor="identity-audience">Público</Label>
              <Textarea
                id="identity-audience"
                rows={3}
                placeholder="Para quem o Project existe e com quem deseja se comunicar?"
                value={formState.audience}
                onChange={setField('audience')}
                className="bg-background/50"
              />
            </div>
          </FormSection>

          {/* Expressão */}
          <FormSection title="Expressão">
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="identity-visual">Identidade visual</Label>
                <Textarea
                  id="identity-visual"
                  rows={3}
                  placeholder="Como o Project deve parecer? Atmosfera, estética, composição e linguagem visual."
                  value={formState.visual_identity}
                  onChange={setField('visual_identity')}
                  className="bg-background/50"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="identity-voice">Voz e linguagem</Label>
                <Textarea
                  id="identity-voice"
                  rows={3}
                  placeholder="Como o Project deve soar? Tom, vocabulário, registro e ritmo."
                  value={formState.voice}
                  onChange={setField('voice')}
                  className="bg-background/50"
                />
              </div>
            </div>
          </FormSection>

          {/* Governança */}
          <FormSection title="Governança">
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="identity-principles">Princípios</Label>
                <Textarea
                  id="identity-principles"
                  rows={3}
                  placeholder="Uma orientação por linha. Ex: Autenticidade acima de tudo"
                  value={formState.principles}
                  onChange={setField('principles')}
                  className="bg-background/50"
                />
                <p className="text-xs text-muted-foreground">
                  Orientações positivas que devem guiar decisões. Uma por linha.
                </p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="identity-restrictions">Restrições</Label>
                <Textarea
                  id="identity-restrictions"
                  rows={3}
                  placeholder="Uma restrição por linha. Ex: Sem logos de terceiros"
                  value={formState.restrictions}
                  onChange={setField('restrictions')}
                  className="bg-background/50"
                />
                <p className="text-xs text-muted-foreground">
                  O que o Project deve evitar. Uma por linha.
                </p>
              </div>
            </div>
          </FormSection>

          {/* Prática */}
          <FormSection title="Prática">
            <div className="space-y-2">
              <Label htmlFor="identity-prefs">Preferências de geração</Label>
              <Textarea
                id="identity-prefs"
                rows={3}
                placeholder="Uma preferência por linha. Ex: Luz natural"
                value={formState.generation_preferences}
                onChange={setField('generation_preferences')}
                className="bg-background/50"
              />
              <p className="text-xs text-muted-foreground">
                Preferências recorrentes de composição, iluminação e geração. Uma por linha.
              </p>
            </div>
          </FormSection>
        </div>

        {/* Error display */}
        {saveError !== null && (
          <p className="text-sm text-destructive flex-shrink-0 pt-1">{saveError}</p>
        )}

        {/* Fixed footer */}
        <div className="flex flex-shrink-0 justify-end gap-3 border-t border-border/50 pt-4">
          <Button type="button" variant="outline" onClick={handleCancel} disabled={isSaving}>
            Cancelar
          </Button>
          <Button
            type="button"
            onClick={handleSave}
            disabled={isSaving}
            className="bg-gradient-to-r from-violet-600 to-cyan-500 text-white"
          >
            {isSaving ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Salvando...
              </>
            ) : (
              'Salvar'
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

// ─── Internal helper ──────────────────────────────────────────────────────────

function FormSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="border-t border-border/30 pt-4">
      <h3 className="mb-3 text-sm font-semibold text-muted-foreground">{title}</h3>
      {children}
    </div>
  )
}

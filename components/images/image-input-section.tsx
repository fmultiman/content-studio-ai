'use client'

import type { ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Sparkles, Loader2, Wand2, Save, Plus } from 'lucide-react'
import type { Project } from '@/lib/types'
import type { PromptAssistanceModel } from '@/lib/prompt-assistance/models'
import type { WorkflowMode } from './image-workflow-controls'

interface ImageInputSectionProps {
  projects: Project[]
  userInput: string
  setUserInput: (value: string) => void
  selectedProject: string | null
  setSelectedProject: (value: string | null) => void
  /** Effective workflow: Manual hides the assistance controls; Automatic replaces Create/Improve by `automaticPanel`. */
  mode: WorkflowMode
  modeControl: ReactNode
  automaticPanel: ReactNode
  /** An automatic run owns the inputs until it finishes. */
  workflowBusy: boolean
  onCreateWithAI: () => void
  onImproveWithAI: () => void
  canImprove: boolean
  assistantModel: PromptAssistanceModel
  assistantModels: readonly PromptAssistanceModel[]
  onAssistantModelChange: (model: PromptAssistanceModel) => void
  isGeneratingPrompt: boolean
  onSaveDraft: () => void
  isSavingDraft: boolean
  canonical?: boolean
  onNewImage?: () => void
  generatedPrompt?: string
}

export function ImageInputSection({
  projects,
  userInput,
  setUserInput,
  selectedProject,
  setSelectedProject,
  mode,
  modeControl,
  automaticPanel,
  workflowBusy,
  onCreateWithAI,
  onImproveWithAI,
  canImprove,
  assistantModel,
  assistantModels,
  onAssistantModelChange,
  isGeneratingPrompt,
  onSaveDraft,
  isSavingDraft,
  canonical = false,
  onNewImage,
  generatedPrompt = '',
}: ImageInputSectionProps) {
  const canSaveDraft = userInput.trim() || generatedPrompt.trim()
  return (
    <div className="rounded-xl border border-border/50 bg-card/30 p-6 backdrop-blur-sm">
      <div className="mb-6 flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-gradient-to-br from-violet-600 to-cyan-500">
            <Wand2 className="h-5 w-5 text-white" />
          </div>
          <div>
            <h2 className="text-lg font-semibold text-foreground">Nova Imagem</h2>
            <p className="text-sm text-muted-foreground">
              Escolha o modo: escreva o prompt, peça ajuda à IA ou deixe o fluxo automático gerar prompt e imagem
            </p>
          </div>
        </div>
        {onNewImage && (
          <Button variant="outline" size="sm" onClick={onNewImage} disabled={workflowBusy} className="gap-2">
            <Plus className="h-4 w-4" />
            Nova Imagem
          </Button>
        )}
      </div>

      <div className="space-y-6">
        {/* Project Selection */}
        {projects.length > 0 && (
          <div className="space-y-2">
            <Label>Projeto (opcional)</Label>
            <Select
              value={selectedProject || ''}
              onValueChange={(value) => setSelectedProject(value || null)}
              disabled={workflowBusy}
            >
              <SelectTrigger className="bg-background/50">
                <SelectValue placeholder="Selecione um projeto..." />
              </SelectTrigger>
              <SelectContent>
                {projects.map((project) => (
                  <SelectItem key={project.id} value={project.id}>
                    {project.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              O contexto do projeto será usado para melhorar o prompt
            </p>
          </div>
        )}

        {/* User Input */}
        <div className="space-y-2">
          <Label htmlFor="user-input">Sua descrição</Label>
          <Textarea
            id="user-input"
            placeholder="Ex: Um gato astronauta flutuando em uma estação espacial futurista, estilo cyberpunk..."
            value={userInput}
            onChange={(e) => setUserInput(e.target.value)}
            readOnly={workflowBusy}
            rows={4}
            className="resize-none bg-background/50"
          />
        </div>

        {modeControl}

        {/* Options Row */}
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-wrap gap-2">
            {!canonical && <Button
              variant="outline"
              onClick={onSaveDraft}
              disabled={!canSaveDraft || isSavingDraft || workflowBusy}
              className="gap-2"
            >
              {isSavingDraft ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              Salvar Rascunho
            </Button>}
          </div>

          {mode !== 'manual' && (
            <div className="flex flex-wrap gap-2">
              <div className="flex items-center gap-2">
                <Label className="text-sm text-muted-foreground">Assistência:</Label>
                <Select
                  value={`${assistantModel.provider}:${assistantModel.id}`}
                  onValueChange={(value) => {
                    const selected = assistantModels.find((entry) => `${entry.provider}:${entry.id}` === value)
                    if (selected) onAssistantModelChange(selected)
                  }}
                  disabled={workflowBusy}
                >
                  <SelectTrigger className="w-[205px]" aria-label="Modelo de assistência">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {assistantModels.map((model) => (
                      <SelectItem key={`${model.provider}:${model.id}`} value={`${model.provider}:${model.id}`}>
                        {model.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {mode === 'assisted' && (
                <>
                  <Button
                    onClick={onCreateWithAI}
                    disabled={!userInput.trim() || isGeneratingPrompt || assistantModels.length === 0}
                    className="bg-gradient-to-r from-violet-600 to-cyan-500 text-white hover:from-violet-700 hover:to-cyan-600"
                  >
                    {isGeneratingPrompt ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        Gerando...
                      </>
                    ) : (
                      <>
                        <Sparkles className="mr-2 h-4 w-4" />
                        Criar com IA
                      </>
                    )}
                  </Button>
                  <Button
                    variant="outline"
                    onClick={onImproveWithAI}
                    disabled={!canImprove || isGeneratingPrompt || assistantModels.length === 0}
                    className="gap-2"
                  >
                    <Sparkles className="h-4 w-4" />
                    Melhorar com IA
                  </Button>
                </>
              )}
            </div>
          )}
        </div>

        {mode === 'automatic' && automaticPanel}
      </div>
    </div>
  )
}

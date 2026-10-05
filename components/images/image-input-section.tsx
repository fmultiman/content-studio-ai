'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Sparkles, Loader2, Wand2, Save, Plus } from 'lucide-react'
import type { Project } from '@/lib/types'

interface ImageInputSectionProps {
  projects: Project[]
  userInput: string
  setUserInput: (value: string) => void
  selectedProject: string | null
  setSelectedProject: (value: string | null) => void
  autoMode: boolean
  setAutoMode: (value: boolean) => void
  onGeneratePrompt: () => void
  isGeneratingPrompt: boolean
  onSaveDraft: () => void
  isSavingDraft: boolean
  canonical?: boolean
  onNewImage?: () => void
  generatedPrompt?: string
  automationEnabled?: boolean
}

export function ImageInputSection({
  projects,
  userInput,
  setUserInput,
  selectedProject,
  setSelectedProject,
  autoMode,
  setAutoMode,
  onGeneratePrompt,
  isGeneratingPrompt,
  onSaveDraft,
  isSavingDraft,
  canonical = false,
  onNewImage,
  generatedPrompt = '',
  automationEnabled = false,
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
              Descreva a imagem, gere um prompt otimizado e crie o resultado visual
            </p>
          </div>
        </div>
        {onNewImage && (
          <Button variant="outline" size="sm" onClick={onNewImage} className="gap-2">
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
            rows={4}
            className="resize-none bg-background/50"
          />
        </div>

        {/* Options Row */}
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          {/* Auto Mode Toggle */}
          <div className="flex items-center gap-3">
            <Switch
              id="auto-mode"
              checked={autoMode}
              onCheckedChange={setAutoMode}
              disabled={!automationEnabled}
            />
            <Label htmlFor="auto-mode" className="cursor-pointer">
              <span className="font-medium">Modo Automático</span>
              <span className="ml-2 text-sm text-muted-foreground">
                {automationEnabled 
                  ? '(Gerar prompt + imagem automaticamente)' 
                  : '(Ative em Configurações > Automação)'}
              </span>
            </Label>
          </div>

          {/* Buttons */}
          <div className="flex flex-wrap gap-2">
            {!canonical && <Button
              variant="outline"
              onClick={onSaveDraft}
              disabled={!canSaveDraft || isSavingDraft}
              className="gap-2"
            >
              {isSavingDraft ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              Salvar Rascunho
            </Button>}
            <Button
              onClick={onGeneratePrompt}
              disabled={!userInput.trim() || isGeneratingPrompt}
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
                  {automationEnabled ? 'Gerar Prompt + Imagem' : 'Gerar Prompt (IA)'}
                </>
              )}
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}

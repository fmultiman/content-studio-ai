'use client'

import { Loader2, Sparkles } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { WorkflowModeControl, type WorkflowMode } from '@/components/images/image-workflow-controls'
import { PROMPT_ASSISTANCE_MODELS, type PromptAssistanceModel } from '@/lib/prompt-assistance/models'

export type VideoAutomaticStage = 'idle' | 'prompt' | 'saving' | 'video' | 'prompt_failed' | 'video_failed' | 'cancelled' | 'submitted'

export function VideoPromptWorkflow({
  mode, onModeChange, description, onDescriptionChange, assistant, onAssistantChange,
  configured, providerStatusLoaded, reason, suggestion, onApply, onDiscard, confirmingApply,
  onConfirmApply, onCancelApply, canImprove, onAssist, assisting, busy,
  automaticReason, automaticStage, automaticMessage, confirmingAutomatic, onStartAutomatic,
  onConfirmAutomatic, onCancelAutomaticConfirm, onCancelAutomatic,
}: {
  mode: WorkflowMode; onModeChange: (value: WorkflowMode) => void
  description: string; onDescriptionChange: (value: string) => void
  assistant: PromptAssistanceModel | null; onAssistantChange: (value: PromptAssistanceModel) => void
  configured: ReadonlySet<string>; providerStatusLoaded: boolean; reason: string | null
  suggestion: string; onApply: () => void; onDiscard: () => void
  confirmingApply: boolean; onConfirmApply: () => void; onCancelApply: () => void
  canImprove: boolean; onAssist: (operation: 'create' | 'improve') => void
  assisting: boolean; busy: boolean; automaticReason: string | null
  automaticStage: VideoAutomaticStage; automaticMessage: string | null
  confirmingAutomatic: boolean; onStartAutomatic: () => void; onConfirmAutomatic: () => void
  onCancelAutomaticConfirm: () => void; onCancelAutomatic: () => void
}) {
  return (
    <section className="min-w-0 space-y-3 rounded-lg border border-border/50 bg-card/30 p-4" aria-label="Fluxo de prompt do vídeo" data-testid="video-prompt-workflow">
      <WorkflowModeControl mode={mode} onChange={onModeChange} mediaType="video" disabled={busy || assisting} automaticUnavailableReason={automaticReason} />
      {mode !== 'manual' && (
        <>
          <div className="space-y-2">
            <Label htmlFor="video-description">Sua descrição</Label>
            <Textarea id="video-description" value={description} maxLength={12000} disabled={busy || assisting} onChange={(event) => onDescriptionChange(event.target.value)} placeholder="Descreva a cena, a ação e o movimento desejados." className="min-h-[90px]" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="video-assistant-model">Modelo de assistência</Label>
            <Select value={assistant ? `${assistant.provider}:${assistant.id}` : undefined} disabled={busy || assisting} onValueChange={(value) => {
              const model = PROMPT_ASSISTANCE_MODELS.find((entry) => `${entry.provider}:${entry.id}` === value)
              if (model) onAssistantChange(model)
            }}>
              <SelectTrigger id="video-assistant-model" aria-label="Modelo de assistência" className="w-full min-w-0"><SelectValue placeholder="Selecione o modelo de assistência" /></SelectTrigger>
              <SelectContent>{PROMPT_ASSISTANCE_MODELS.map((entry) => <SelectItem key={`${entry.provider}:${entry.id}`} value={`${entry.provider}:${entry.id}`} disabled={!providerStatusLoaded || !configured.has(entry.provider)}>{entry.label}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <p className="text-xs text-muted-foreground" data-testid="video-assistance-cost-notice">A assistência usa sua chave do provedor selecionado (BYOK) e pode gerar cobrança. A geração de vídeo usa separadamente a conexão Kling escolhida. Em Uso, custos estimados podem ser parciais ou indisponíveis.</p>
          {reason && <p className="text-xs text-muted-foreground" role="status" data-testid="video-assistance-disabled-reason">{reason}</p>}
          {mode === 'assisted' && (
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="outline" disabled={busy || assisting || !!reason || !description.trim()} onClick={() => onAssist('create')} data-testid="video-assistance-create"><Sparkles className="mr-2 h-4 w-4" />Criar com IA</Button>
              <Button type="button" variant="outline" disabled={busy || assisting || !!reason || !canImprove} onClick={() => onAssist('improve')} data-testid="video-assistance-improve">Melhorar com IA</Button>
              {assisting && <p className="flex items-center gap-2 text-sm" role="status"><Loader2 className="h-4 w-4 animate-spin" />Gerando sugestão…</p>}
            </div>
          )}
          {mode === 'automatic' && (
            <div className="space-y-2 rounded-md border border-border/60 p-3" data-testid="video-automatic-panel">
              <p className="text-xs text-muted-foreground">Um início explícito autoriza 1 chamada de assistência + 1 envio de vídeo. Sem retries ocultos. Mantenha a página aberta até o envio terminar.</p>
              {confirmingAutomatic ? (
                <div className="flex flex-wrap items-center gap-2" data-testid="video-automatic-confirm">
                  <p className="text-sm">O prompt atual será substituído pelo novo prompt. A geração pode gerar cobrança.</p>
                  <Button type="button" onClick={onConfirmAutomatic} disabled={busy} data-testid="video-automatic-confirm-accept">Substituir e gerar</Button>
                  <Button type="button" variant="ghost" onClick={onCancelAutomaticConfirm}>Manter o prompt atual</Button>
                </div>
              ) : <Button type="button" disabled={busy || !!automaticReason || !!reason || !description.trim()} onClick={onStartAutomatic} data-testid="video-automatic-start">{busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Sparkles className="mr-2 h-4 w-4" />}Gerar automaticamente</Button>}
              {(automaticStage === 'prompt' || automaticStage === 'saving') && <Button type="button" variant="outline" onClick={onCancelAutomatic} data-testid="video-automatic-cancel">Cancelar antes do vídeo</Button>}
              {automaticStage === 'video' && <p className="text-xs text-muted-foreground">Enviando vídeo. Depois do envio ao provedor, a geração não pode ser cancelada aqui.</p>}
              {automaticMessage && <p className="text-sm" role={automaticStage.endsWith('failed') ? 'alert' : 'status'} data-testid="video-automatic-status">{automaticMessage}</p>}
            </div>
          )}
        </>
      )}
      {suggestion && (
        <div className="min-w-0 space-y-2 rounded-md border border-cyan-500/30 p-3" data-testid="video-prompt-suggestion">
          <p className="text-sm font-medium">Sugestão de prompt — ainda não aplicada</p>
          <p className="whitespace-pre-wrap [overflow-wrap:anywhere] text-sm">{suggestion}</p>
          {confirmingApply && <p className="text-xs" role="status">Aplicar substituirá o prompt editável atual. A tentativa anterior e o Review serão preservados.</p>}
          <div className="flex flex-wrap gap-2">
            <Button type="button" disabled={busy} onClick={confirmingApply ? onConfirmApply : onApply} data-testid="video-assistance-apply">{confirmingApply ? 'Substituir prompt' : 'Aplicar sugestão'}</Button>
            <Button type="button" variant="ghost" disabled={busy} onClick={confirmingApply ? onCancelApply : onDiscard} data-testid="video-assistance-discard">{confirmingApply ? 'Manter o prompt atual' : 'Descartar'}</Button>
          </div>
        </div>
      )}
    </section>
  )
}

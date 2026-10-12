'use client'

import { Button } from '@/components/ui/button'
import { Check, Loader2, Sparkles, X } from 'lucide-react'

export type WorkflowMode = 'manual' | 'assisted' | 'automatic'

// FUTURE-057 Slice A — the three Image workspace flows. This file only presents state; the single orchestration
// lives in the workspace page (one explicit start, one text call, one image submission).

const MODES: ReadonlyArray<{ value: WorkflowMode; label: string; hint: string }> = [
  { value: 'manual', label: 'Manual', hint: 'Você escreve o prompt e cria a imagem.' },
  { value: 'assisted', label: 'Assistido', hint: 'A IA sugere; você aplica e cria a imagem.' },
  { value: 'automatic', label: 'Automático', hint: 'Um clique: a IA cria o prompt e a imagem é gerada.' },
]

export function WorkflowModeControl({
  mode,
  onChange,
  automaticUnavailableReason,
  disabled = false,
  mediaType = 'image',
}: {
  mode: WorkflowMode
  onChange: (mode: WorkflowMode) => void
  /** Non-null = the Automatic option cannot be used, and why. */
  automaticUnavailableReason: string | null
  disabled?: boolean
  mediaType?: 'image' | 'video'
}) {
  const modes = mediaType === 'image' ? MODES : MODES.map((entry) => ({ ...entry, hint: entry.hint.replace(/a imagem/g, 'o vídeo').replace('é gerada', 'é gerado') }))
  return (
    <div className="space-y-1" data-testid="workflow-mode-control">
      <div role="radiogroup" aria-label="Modo de criação" className="inline-flex rounded-lg border border-border/60 bg-background/40 p-1">
        {modes.map((entry) => {
          const unavailable = entry.value === 'automatic' && automaticUnavailableReason !== null
          const selected = mode === entry.value
          return (
            <button
              key={entry.value}
              type="button"
              role="radio"
              aria-checked={selected}
              disabled={disabled || unavailable}
              title={unavailable ? automaticUnavailableReason ?? undefined : entry.hint}
              data-testid={`workflow-mode-${entry.value}`}
              onClick={() => onChange(entry.value)}
              className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
                selected ? 'bg-violet-600 text-white' : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              {entry.label}
            </button>
          )
        })}
      </div>
      <p className="text-xs text-muted-foreground" data-testid="workflow-mode-hint">
        {modes.find((entry) => entry.value === mode)?.hint}
        {automaticUnavailableReason ? ` Automático indisponível: ${automaticUnavailableReason}` : ''}
      </p>
    </div>
  )
}

export type AutomaticStage = 'idle' | 'prompt' | 'image' | 'prompt_failed' | 'image_failed' | 'cancelled'
export interface AutomaticRunView {
  stage: AutomaticStage
  message?: string | null
}

export function isAutomaticRunBusy(run: AutomaticRunView) {
  return run.stage === 'prompt' || run.stage === 'image'
}

export function AutomaticRunPanel({
  run,
  canStart,
  startDisabledReason,
  summary,
  confirmOverwrite,
  onStart,
  onConfirmOverwrite,
  onDismissOverwrite,
  onCancel,
  onRetryImage,
}: {
  run: AutomaticRunView
  canStart: boolean
  startDisabledReason: string | null
  /** e.g. "Prompt: OpenAI · GPT-4o mini → Imagem: GPT Image 2" */
  summary: string
  confirmOverwrite: boolean
  onStart: () => void
  onConfirmOverwrite: () => void
  onDismissOverwrite: () => void
  onCancel: () => void
  onRetryImage: () => void
}) {
  const busy = isAutomaticRunBusy(run)
  return (
    <div className="space-y-3 rounded-lg border border-violet-500/30 bg-violet-500/5 p-4" data-testid="automatic-run-panel">
      {!busy && !confirmOverwrite && (
        <div className="flex flex-wrap items-center gap-3">
          <Button
            onClick={onStart}
            disabled={!canStart}
            className="bg-gradient-to-r from-violet-600 to-cyan-500 text-white hover:from-violet-700 hover:to-cyan-600"
            data-testid="automatic-run-start"
          >
            <Sparkles className="mr-2 h-4 w-4" />
            Gerar automaticamente
          </Button>
          <p className="text-sm text-muted-foreground" data-testid="automatic-run-summary">{summary}</p>
        </div>
      )}

      {!busy && confirmOverwrite && (
        <div className="flex flex-wrap items-center gap-3 rounded-md border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-200" data-testid="automatic-run-confirm">
          <span>O prompt atual será substituído pelo prompt gerado.</span>
          <Button variant="ghost" size="sm" onClick={onDismissOverwrite} data-testid="automatic-run-confirm-cancel">Manter o prompt atual</Button>
          <Button size="sm" onClick={onConfirmOverwrite} data-testid="automatic-run-confirm-accept">Substituir e gerar</Button>
        </div>
      )}

      {!busy && !canStart && startDisabledReason && !confirmOverwrite && (
        <p className="text-xs text-muted-foreground" data-testid="automatic-run-disabled-reason">{startDisabledReason}</p>
      )}

      {busy && (
        <div className="space-y-2" data-testid="automatic-run-progress" aria-live="polite">
          <ol className="space-y-1 text-sm">
            <li className="flex items-center gap-2" data-testid="automatic-stage-prompt" data-state={run.stage === 'prompt' ? 'active' : 'done'}>
              {run.stage === 'prompt' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4 text-emerald-500" />}
              1. {run.stage === 'prompt' ? 'Gerando o prompt…' : 'Prompt pronto'}
            </li>
            <li className="flex items-center gap-2" data-testid="automatic-stage-image" data-state={run.stage === 'image' ? 'active' : 'pending'}>
              {run.stage === 'image' ? <Loader2 className="h-4 w-4 animate-spin" /> : <span className="inline-block h-4 w-4 rounded-full border border-border" />}
              2. {run.stage === 'image' ? 'Gerando a imagem…' : 'Imagem (aguardando o prompt)'}
            </li>
          </ol>
          {run.stage === 'prompt' ? (
            <Button variant="outline" size="sm" onClick={onCancel} data-testid="automatic-run-cancel">
              <X className="mr-1 h-4 w-4" /> Cancelar
            </Button>
          ) : (
            <p className="text-xs text-muted-foreground" data-testid="automatic-run-image-note">
              A imagem já foi enviada ao provedor e não pode ser cancelada.
            </p>
          )}
          <p className="text-xs text-muted-foreground">
            Esta execução roda neste navegador: mantenha a página aberta até terminar. Não é um processo em segundo plano.
          </p>
        </div>
      )}

      {run.stage === 'prompt_failed' && (
        <div className="space-y-2 rounded-md border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-200" data-testid="automatic-run-prompt-failed">
          <p>Não foi possível gerar o prompt. Nenhuma imagem foi pedida e seu texto foi mantido.</p>
          {run.message && <p className="text-xs opacity-80">{run.message}</p>}
          <Button variant="outline" size="sm" onClick={onStart} disabled={!canStart} data-testid="automatic-run-retry-all">Tentar novamente</Button>
        </div>
      )}

      {run.stage === 'image_failed' && (
        <div className="space-y-2 rounded-md border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-200" data-testid="automatic-run-image-failed">
          <p>O prompt foi gerado e mantido no editor, mas a imagem falhou.</p>
          {run.message && <p className="text-xs opacity-80">{run.message}</p>}
          <p className="text-xs opacity-80">Antes de tentar de novo, confira o histórico: se o provedor chegou a processar, a tentativa anterior pode ter sido cobrada.</p>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" onClick={onRetryImage} data-testid="automatic-run-retry-image">Tentar só a imagem</Button>
            <Button variant="ghost" size="sm" onClick={onStart} disabled={!canStart} data-testid="automatic-run-retry-all">Gerar tudo de novo</Button>
          </div>
        </div>
      )}

      {run.stage === 'cancelled' && (
        <p className="text-sm text-muted-foreground" data-testid="automatic-run-cancelled">
          {run.message || 'Execução cancelada. Nenhuma imagem foi pedida.'}
        </p>
      )}
    </div>
  )
}

'use client'

import type { SaveState } from '@/lib/generation-session/autosave'
import { cn } from '@/lib/utils'

type SessionSaveStatusProps = {
  state: SaveState
  className?: string
  onRetry?: () => void
  onReloadServer?: () => void
  onKeepLocal?: () => void
  onDiscardLocal?: () => void
}

const COPY: Record<SaveState, string> = {
  clean: 'Salvo',
  dirty: 'Alterações pendentes',
  pending: 'Alterações pendentes',
  saving: 'Salvando…',
  error: 'Erro ao salvar',
  conflict: 'Conflito de alterações',
}

export function SessionSaveStatus({
  state,
  className,
  onRetry,
  onReloadServer,
  onKeepLocal,
  onDiscardLocal,
}: SessionSaveStatusProps) {
  const testId = state === 'clean'
    ? 'save-status-saved'
    : state === 'saving'
      ? 'save-status-saving'
      : state === 'error'
        ? 'save-status-error'
        : state === 'conflict'
          ? 'save-status-conflict'
          : undefined
  return (
    <div className={cn('flex flex-wrap items-center gap-2 text-xs text-muted-foreground', className)} data-testid="session-save-status">
      <span aria-live="polite" data-state={state} data-testid={testId}>{COPY[state]}</span>
      {state === 'error' && onRetry && (
        <button type="button" className="underline underline-offset-2" onClick={onRetry}>
          Tentar novamente
        </button>
      )}
      {state === 'conflict' && onReloadServer && (
        <button type="button" className="underline underline-offset-2" onClick={onReloadServer}>
          Recarregar versão salva
        </button>
      )}
      {state === 'conflict' && onKeepLocal && (
        <button type="button" className="underline underline-offset-2" onClick={onKeepLocal}>
          Manter minhas alterações
        </button>
      )}
      {state === 'conflict' && onDiscardLocal && (
        <button type="button" className="underline underline-offset-2" onClick={onDiscardLocal}>
          Descartar alterações
        </button>
      )}
    </div>
  )
}

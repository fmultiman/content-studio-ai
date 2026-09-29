'use client'

// KLING_MCP_OAUTH_CONNECTION_SPIKE_V1
//
// Minimal, truthful UI for the user's Kling ACCOUNT (MCP / OAuth) connection.
// It is deliberately NOT the future generic "AI Connections" screen: it shows
// the one real non-API connection next to the existing Kling API-key card.
//
// The browser never sees a token. It only receives safe metadata (status,
// scopes, a 4-character account hint, capability names) and, for a check, a
// live credit read that is shown once and never stored.

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { StatusBadge } from '@/components/ui/status-badge'
import { Loader2, Link2, RefreshCw, ShieldCheck } from 'lucide-react'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import type { PublicProviderConnection } from '@/lib/provider-connections/types'

interface KlingMcpConnectionCardProps {
  /** null = no connection row = "not configured". `undefined` while loading. */
  connection: PublicProviderConnection | null | undefined
  /** False when this environment cannot store connection secrets. */
  connectionsAvailable: boolean
  liveCredits: number | null
  onConnect: () => Promise<void>
  onCheck: () => Promise<void>
  onDisconnect: () => Promise<void>
}

const STATUS_LABEL: Record<string, { label: string; tone: 'success' | 'warning' | 'danger' | 'unavailable' | 'neutral' }> = {
  connected: { label: 'Conectada ✓', tone: 'success' },
  authorization_required: { label: 'Reautorização necessária', tone: 'warning' },
  error: { label: 'Erro na conexão', tone: 'danger' },
}

export function KlingMcpConnectionCard({
  connection,
  connectionsAvailable,
  liveCredits,
  onConnect,
  onCheck,
  onDisconnect,
}: KlingMcpConnectionCardProps) {
  const [isConnecting, setIsConnecting] = useState(false)
  const [isChecking, setIsChecking] = useState(false)
  const [isDisconnecting, setIsDisconnecting] = useState(false)

  const badge =
    connection === undefined
      ? { label: 'Carregando...', tone: 'neutral' as const }
      : connection === null
        ? { label: 'Não conectada', tone: 'unavailable' as const }
        : STATUS_LABEL[connection.status]

  const needsAuthorization = connection?.status === 'authorization_required'
  const modelCount = connection?.capabilities.models?.text_to_video?.length

  const run = async (setBusy: (value: boolean) => void, action: () => Promise<void>) => {
    setBusy(true)
    try {
      await action()
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-3 rounded-lg border border-border/50 p-4" data-provider="kling" data-connection-method="mcp_oauth">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h4 className="font-medium">Conta Kling</h4>
          <p className="text-xs text-muted-foreground">
            Usa os créditos da sua conta Kling. Conexão somente leitura por enquanto: ainda não gera vídeos.
          </p>
        </div>
        <StatusBadge label={badge.label} tone={badge.tone} />
      </div>

      {connection ? (
        <dl className="grid gap-1 text-xs text-muted-foreground">
          {connection.accountHint ? (
            <div className="flex gap-2">
              <dt>Conta:</dt>
              <dd>final {connection.accountHint}</dd>
            </div>
          ) : null}
          {connection.capabilities.membership?.label ? (
            <div className="flex gap-2">
              <dt>Plano:</dt>
              <dd>{connection.capabilities.membership.label}</dd>
            </div>
          ) : null}
          {modelCount ? (
            <div className="flex gap-2">
              <dt>Modelos de vídeo disponíveis:</dt>
              <dd>{modelCount}</dd>
            </div>
          ) : null}
          <div className="flex gap-2">
            <dt>Permissões:</dt>
            <dd>{connection.scopes.length ? connection.scopes.join(', ') : '—'}</dd>
          </div>
          {connection.lastCheckedAt ? (
            <div className="flex gap-2">
              <dt>Última verificação:</dt>
              <dd>{new Date(connection.lastCheckedAt).toLocaleString('pt-BR')}</dd>
            </div>
          ) : null}
          {liveCredits !== null ? (
            <div className="flex gap-2">
              <dt>Créditos na conta Kling (leitura ao vivo):</dt>
              <dd>{liveCredits.toLocaleString('pt-BR')}</dd>
            </div>
          ) : null}
        </dl>
      ) : null}

      {!connectionsAvailable && connection === null ? (
        <p className="text-xs text-amber-500">
          As conexões de conta ainda não estão habilitadas neste ambiente.
        </p>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        {connection === null || needsAuthorization ? (
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={isConnecting || !connectionsAvailable}
            onClick={() => void run(setIsConnecting, onConnect)}
          >
            {isConnecting ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> : <Link2 className="mr-2 h-3.5 w-3.5" />}
            {needsAuthorization ? 'Reconectar' : 'Conectar conta'}
          </Button>
        ) : null}

        {connection && !needsAuthorization ? (
          <Button type="button" size="sm" variant="outline" disabled={isChecking} onClick={() => void run(setIsChecking, onCheck)}>
            {isChecking ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="mr-2 h-3.5 w-3.5" />}
            Verificar conexão
          </Button>
        ) : null}

        {connection ? (
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button type="button" size="sm" variant="ghost" disabled={isDisconnecting}>
                {isDisconnecting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : 'Desconectar'}
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Desconectar a conta Kling?</AlertDialogTitle>
                <AlertDialogDescription>
                  Revogamos a autorização na Kling e apagamos as credenciais guardadas. Sua chave de API da Kling e
                  seus vídeos já gerados não são afetados.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancelar</AlertDialogCancel>
                <AlertDialogAction onClick={() => void run(setIsDisconnecting, onDisconnect)}>Desconectar</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        ) : null}
      </div>

      {connection === null ? (
        <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
          <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          Você será levado à Kling para autorizar. Pedimos apenas permissões de leitura (consultar conta e créditos).
        </p>
      ) : null}
    </div>
  )
}

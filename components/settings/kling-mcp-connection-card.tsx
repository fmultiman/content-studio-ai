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
  /** The connection state could not be loaded: unknown is never presented as "not connected". */
  loadFailed?: boolean
  onRetryLoad?: () => void
  /** False when this environment cannot store connection secrets. */
  connectionsAvailable: boolean
  liveCredits: number | null
  onConnect: (intent: 'generation' | 'read_only') => Promise<void>
  onCheck: () => Promise<void>
  onDisconnect: () => Promise<void>
}

const STATUS_LABEL: Record<string, { label: string; tone: 'success' | 'warning' | 'danger' | 'unavailable' | 'neutral' }> = {
  connected: { label: 'Conectada', tone: 'success' },
  authorization_required: { label: 'Reautorização necessária', tone: 'warning' },
  error: { label: 'Erro na conexão', tone: 'danger' },
}

export function KlingMcpConnectionCard({
  connection,
  loadFailed = false,
  onRetryLoad,
  connectionsAvailable,
  liveCredits,
  onConnect,
  onCheck,
  onDisconnect,
}: KlingMcpConnectionCardProps) {
  const [isConnecting, setIsConnecting] = useState(false)
  const [isConnectingReadOnly, setIsConnectingReadOnly] = useState(false)
  const [isAuthorizing, setIsAuthorizing] = useState(false)
  const [isChecking, setIsChecking] = useState(false)
  const [isDisconnecting, setIsDisconnecting] = useState(false)

  const stateUnknown = loadFailed && !connection
  const readOnly = connection?.status === 'connected' && !connection.generationAuthorized
  const generationAuthorized = connection?.status === 'connected' && connection.generationAuthorized

  let badge = stateUnknown
    ? { label: 'Estado indisponível', tone: 'warning' as const }
    : connection === undefined
      ? { label: 'Carregando...', tone: 'neutral' as const }
      : connection === null
        ? { label: 'Não conectada', tone: 'unavailable' as const }
        : STATUS_LABEL[connection.status]

  if (connection?.status === 'connected') {
    badge = generationAuthorized 
      ? { label: 'Conectada - Pronta para gerar', tone: 'success' as const }
      : { label: 'Conectada - Somente leitura', tone: 'success' as const }
  }

  // Reconnecting is offered when authorization is lost, and also for an error state
  // (e.g. the provider rejected our registration) where re-checking alone cannot help.
  const canReconnect = connection?.status === 'authorization_required' || connection?.status === 'error'
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
      <div className="flex items-start justify-between gap-3">
        <div>
          <h4 className="font-medium">Conta Kling via MCP</h4>
          <p className="text-xs text-muted-foreground mt-1">
            {connection === null ? (
              'Conecte sua conta para usar os modelos Kling diretamente com seus créditos.'
            ) : generationAuthorized ? (
              'Geração de vídeos autorizada com sucesso.'
            ) : connection?.status === 'connected' ? (
              'Conexão somente leitura: ainda não gera vídeos até você autorizar a geração.'
            ) : (
              'Usa os créditos da sua conta Kling.'
            )}
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
          <div className="flex flex-col gap-1 mt-1">
            <dt>Permissões concedidas:</dt>
            <dd className="pl-2">
              <ul className="list-disc list-inside">
                <li>Consultar conta, modelos e créditos</li>
                {generationAuthorized && <li>Criar gerações</li>}
              </ul>
            </dd>
          </div>
          {connection.lastCheckedAt ? (
            <div className="flex gap-2 mt-1">
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

      {stateUnknown ? (
        <div className="flex flex-wrap items-center gap-2 text-xs text-amber-500">
          <span>Não foi possível carregar o estado da conexão.</span>
          {onRetryLoad ? (
            <Button type="button" size="sm" variant="outline" onClick={onRetryLoad}>
              Tentar novamente
            </Button>
          ) : null}
        </div>
      ) : null}

      {!connectionsAvailable && connection === null && !stateUnknown ? (
        <p className="text-xs text-amber-500">
          As conexões de conta ainda não estão habilitadas neste ambiente.
        </p>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        {connection === null && !stateUnknown ? (
          <>
            <Button
              type="button"
              size="sm"
              disabled={isConnecting || isConnectingReadOnly || !connectionsAvailable}
              onClick={() => void run(setIsConnecting, () => onConnect('generation'))}
            >
              {isConnecting ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> : <Link2 className="mr-2 h-3.5 w-3.5" />}
              Conectar conta Kling
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={isConnecting || isConnectingReadOnly || !connectionsAvailable}
              onClick={() => void run(setIsConnectingReadOnly, () => onConnect('read_only'))}
            >
              {isConnectingReadOnly ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> : null}
              Conectar somente para leitura
            </Button>
          </>
        ) : null}
        
        {canReconnect ? (
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={isConnecting || !connectionsAvailable}
            onClick={() => void run(setIsConnecting, () => onConnect(connection?.generationAuthorized ? 'generation' : 'read_only'))}
          >
            {isConnecting ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> : <Link2 className="mr-2 h-3.5 w-3.5" />}
            Reconectar
          </Button>
        ) : null}

        {readOnly && (
          <Button
            type="button"
            size="sm"
            disabled={isAuthorizing || !connectionsAvailable}
            onClick={() => void run(setIsAuthorizing, () => onConnect('generation'))}
          >
            {isAuthorizing ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> : <ShieldCheck className="mr-2 h-3.5 w-3.5" />}
            Autorizar geração
          </Button>
        )}

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
                  Tentamos revogar a autorização na Kling e apagamos as credenciais guardadas aqui. Sua chave de API da
                  Kling e seus vídeos já gerados não são afetados. Se houver vídeos ainda em geração com esta conta,
                  a desconexão só é liberada quando terminarem.
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

      {connection === null && !stateUnknown ? (
        <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
          <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          Você será levado à Kling para autorizar. &quot;Conectar conta Kling&quot; pedirá permissão extra para criar gerações.
        </p>
      ) : null}
    </div>
  )
}

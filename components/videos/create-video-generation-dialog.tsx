'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, Image as ImageIcon, FileText, Zap, RefreshCw, ShieldCheck } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useToast } from '@/hooks/use-toast'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'
import {
  audioAllowedAt,
  findOperation,
  VIDEO_OPERATIONS,
  type VideoAspectRatio,
  type VideoAudio,
  type VideoConnectionBlockedReason,
  type VideoConnectionsResponse,
  type VideoGenerationConnectionDescriptor,
  type VideoOperation,
  type VideoResolution,
} from '@/lib/video-generation/capabilities'
import { I2vSourcePicker } from '@/components/videos/i2v-source-picker'
import { i2vSourceFields, reconcileI2vSource, type I2vSourceSelection } from '@/lib/video-generation/i2v-source'
import { VideoGenerationForm } from '@/components/videos/video-generation-form'
import { parseConnectionRef } from '@/lib/video-generation/connection-ref'
import { connectionDisplayName, spendingSourceCopy, transportBadge } from '@/lib/video-generation/connection-presentation'
import {
  EMPTY_SELECTION,
  reconcileSelection,
  selectedConnection,
  selectedModel,
  toSubmitControls,
  visibleControls,
  type VideoFormSelection,
} from '@/lib/video-generation/form-selection'

// VIDEO_GENERATION_CONNECTION_CAPABILITY_ROUTING_V1
//
// The generation form is DRIVEN BY the selected connection:
//   connection -> operations -> model -> controls (+ explicit defaults)
// Everything it shows comes from the server's normalized capability
// descriptors (GET /api/video-generations/connections). It never renders a
// raw provider schema, never reads provider connections directly and never
// sends a value for a control the selected model does not offer.

interface CreateVideoGenerationDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  projectId: string
  productionId: string
  onSuccess?: () => void
}

type LoadState = 'loading' | 'ready' | 'failed'

const OPERATION_LABEL: Record<VideoOperation, string> = {
  text_to_video: 'Texto → Vídeo',
  image_to_video: 'Imagem → Vídeo',
}

const RESOLUTION_LABEL: Record<VideoResolution, string> = {
  '720p': 'Padrão (720p)',
  '1080p': 'Alta (1080p)',
  '4k': 'Ultra (4K)',
}

const ASPECT_LABEL: Record<VideoAspectRatio, string> = {
  '16:9': 'Horizontal (16:9)',
  '9:16': 'Vertical (9:16)',
  '1:1': 'Quadrado (1:1)',
}

const AUDIO_LABEL: Record<VideoAudio, string> = {
  off: 'Sem áudio',
  on: 'Gerar áudio (IA)',
}

interface BlockedCopy {
  title: string
  description: string
  action?: 'settings' | 'authorize' | 'refresh'
}

const BLOCKED_COPY: Record<VideoConnectionBlockedReason, BlockedCopy> = {
  not_configured: {
    title: 'Kling API não configurada',
    description: 'Adicione sua chave de API da Kling em Configurações para gerar vídeos por esta conexão.',
    action: 'settings',
  },
  authorization_required: {
    title: 'Reautorização necessária',
    description: 'A autorização da sua conta Kling expirou ou foi revogada. Reconecte em Configurações.',
    action: 'settings',
  },
  connection_error: {
    title: 'Erro na conexão',
    description: 'A conexão com a sua conta Kling está com erro. Verifique-a em Configurações.',
    action: 'settings',
  },
  generation_authorization_required: {
    title: 'Conectada — somente leitura',
    description:
      'Você ainda não autorizou o Content Studio a gerar vídeos com a sua conta Kling. Você pode explorar os modelos, mas a geração fica desativada até a autorização.',
    action: 'authorize',
  },
  capabilities_missing: {
    title: 'Capacidades ainda não carregadas',
    description: 'Atualize a conexão para ver os modelos e opções disponíveis nesta conta.',
    action: 'refresh',
  },
  capabilities_expired: {
    title: 'Capacidades desatualizadas',
    description: 'A última verificação desta conta é antiga. Atualize a conexão antes de gerar.',
    action: 'refresh',
  },
  no_supported_models: {
    title: 'Nenhum modelo compatível',
    description: 'A verificação mais recente não encontrou modelos de vídeo compatíveis com o Content Studio nesta conta.',
    action: 'refresh',
  },
}

async function fetchConnections(): Promise<VideoGenerationConnectionDescriptor[]> {
  const res = await fetch('/api/video-generations/connections')
  if (!res.ok) throw new Error(`status ${res.status}`)
  return ((await res.json()) as VideoConnectionsResponse).connections
}

function hoursSince(iso: string | null): number | null {
  if (!iso) return null
  const ms = Date.now() - new Date(iso).getTime()
  return Number.isFinite(ms) ? Math.max(0, Math.floor(ms / 3_600_000)) : null
}

export function CreateVideoGenerationDialog({
  open,
  onOpenChange,
  projectId,
  productionId,
  onSuccess,
}: CreateVideoGenerationDialogProps) {
  const router = useRouter()
  const { toast } = useToast()

  const [connections, setConnections] = useState<VideoGenerationConnectionDescriptor[]>([])
  const [loadState, setLoadState] = useState<LoadState>('loading')
  const [selection, setSelection] = useState<VideoFormSelection>(EMPTY_SELECTION)

  const [prompt, setPrompt] = useState('')
  // Exactly one source class (generated image OR Arquivos file); never both. The choice is
  // remembered WITH the Project it was made for, so changing the Project on the page behind
  // this dialog can never carry a file/image of another Project into the form.
  // The selection also carries its in-memory display summary (name, thumbnail, origin); only `source` is ever submitted.
  const [chosenSource, setChosenSource] = useState<{ projectId: string; selection: I2vSourceSelection } | null>(null)
  const i2vSelection = chosenSource && chosenSource.projectId === projectId ? chosenSource.selection : null
  const source = i2vSelection?.source ?? null
  const setSourceSelection = useCallback(
    (next: I2vSourceSelection | null) => setChosenSource(next ? { projectId, selection: next } : null),
    [projectId],
  )

  const [isSubmitting, setIsSubmitting] = useState(false)
  // VIDEO_GENERATION_MODAL_SAFETY_AND_TRANSPORT_UX_V1 — a submission is paid, so it can only start ONCE
  // per opening of the form. `submitLockRef` is a SYNCHRONOUS guard (React state settles only after the
  // handler returns, so two activations in the same tick — double click, click + Enter — would both
  // pass a state check). It stays locked after the server ACCEPTS the generation (`accepted`) and after
  // an unconfirmed outcome; it is released only when the request failed BEFORE provider acceptance.
  const submitLockRef = useRef(false)
  const acceptedRef = useRef(false)
  const [accepted, setAccepted] = useState(false)
  // Set when the provider MAY have accepted (and billed) a generation we could not confirm
  // (network drop, gateway timeout, unreadable response, unrecorded task): the form stays
  // locked — until the page is reloaded after checking — so it cannot be resubmitted by mistake.
  const [unconfirmedSubmission, setUnconfirmedSubmission] = useState<string | null>(null)
  const currentClientRequestId = useRef<string>(crypto.randomUUID())
  const [isBusy, setIsBusy] = useState<'refresh' | 'authorize' | null>(null)

  const applyConnections = useCallback((list: VideoGenerationConnectionDescriptor[]) => {
    setConnections(list)
    setSelection((prev) => reconcileSelection(list, prev))
    setLoadState('ready')
  }, [])

  // Manual (re)load: retry button, refresh, post-error reload.
  const loadConnections = useCallback(async () => {
    setLoadState('loading')
    try {
      applyConnections(await fetchConnections())
    } catch {
      // A load failure is NOT "no connections" and NOT "no models".
      setLoadState('failed')
    }
  }, [applyConnections])

  useEffect(() => {
    if (!open) return
    let cancelled = false
    fetchConnections()
      .then((list) => {
        if (!cancelled) applyConnections(list)
      })
      .catch(() => {
        if (!cancelled) setLoadState('failed')
      })
    return () => {
      cancelled = true
    }
  }, [open, applyConnections])

  // Reopening the form after an accepted generation starts a NEW, empty form: the previous prompt is
  // never left armed behind an enabled button. (An unconfirmed submission keeps its lock until reload.)
  useEffect(() => {
    if (!open || !acceptedRef.current) return
    acceptedRef.current = false
    submitLockRef.current = false
    currentClientRequestId.current = crypto.randomUUID()
    setAccepted(false)
    setPrompt('')
    setChosenSource(null)
  }, [open])

  const connection = useMemo(() => selectedConnection(connections, selection), [connections, selection])
  const model = useMemo(() => selectedModel(connections, selection), [connections, selection])
  const controls = visibleControls(model)
  const operationChoices = useMemo(
    () => VIDEO_OPERATIONS.filter((operation) => connection && findOperation(connection.operations, operation)),
    [connection],
  )
  const modelChoices = useMemo(
    () => (connection && selection.operation ? (findOperation(connection.operations, selection.operation)?.models ?? []) : []),
    [connection, selection.operation],
  )

  // Every change goes through the SAME reconciliation: a value survives only
  // if the new context still allows it, otherwise it resets to an explicit default.
  const change = (patch: Partial<VideoFormSelection>) => {
    const next = reconcileSelection(connections, { ...selection, ...patch })
    setSelection(next)
    // Any path that leaves image_to_video (tab, or a connection switch that drops the
    // operation) also drops the source: a stale selection never rides along.
    setChosenSource((prev) => (prev && reconcileI2vSource(next.operation, prev.selection.source) ? prev : null))
  }

  const blocked = connection && !connection.canGenerate ? connection.blockedReason : undefined
  const blockedCopy = blocked ? BLOCKED_COPY[blocked] : null

  const capabilityAgeHours = connection?.capabilitiesFreshness === 'stale' ? hoursSince(connection.capabilitiesCheckedAt) : null

  const refreshCapabilities = async () => {
    const parsed = parseConnectionRef(selection.connectionRef)
    if (parsed?.kind !== 'provider_connection') return
    setIsBusy('refresh')
    try {
      const res = await fetch(`/api/provider-connections/${parsed.connectionId}/check`, { method: 'POST' })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast({
          title: 'Não foi possível atualizar a conexão',
          description: data?.code === 'PROVIDER_AUTHORIZATION_REQUIRED'
            ? 'A autorização da conta Kling não é mais válida. Reconecte em Configurações.'
            : 'Tente novamente em instantes.',
          variant: 'destructive',
        })
      } else {
        toast({ title: 'Conexão atualizada', description: 'Modelos e opções desta conta foram recarregados.' })
      }
    } catch {
      toast({ title: 'Erro de rede', description: 'Não foi possível atualizar a conexão agora.', variant: 'destructive' })
    } finally {
      setIsBusy(null)
      await loadConnections()
    }
  }

  // Explicit user action only — never triggered by merely selecting the connection.
  const authorizeGeneration = async () => {
    setIsBusy('authorize')
    try {
      const res = await fetch('/api/provider-connections/kling/mcp/connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ intent: 'generation' }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || typeof data?.authorizationUrl !== 'string') {
        toast({
          title: 'Não foi possível iniciar a autorização',
          description: data?.code === 'CONNECTION_ENCRYPTION_NOT_CONFIGURED'
            ? 'Conexões de conta ainda não estão disponíveis neste ambiente.'
            : 'Tente novamente em instantes.',
          variant: 'destructive',
        })
        setIsBusy(null)
        return
      }
      window.location.assign(data.authorizationUrl)
    } catch {
      toast({ title: 'Erro de rede', description: 'Não foi possível iniciar a autorização agora.', variant: 'destructive' })
      setIsBusy(null)
    }
  }

  const handleOpenChange = (newOpen: boolean) => {
    onOpenChange(newOpen)
  }

  const canSubmit =
    loadState === 'ready' &&
    !!connection?.canGenerate &&
    !!selection.operation &&
    !!selection.modelId &&
    !isSubmitting &&
    !accepted &&
    unconfirmedSubmission === null

  const handleSubmit = async () => {
    // Synchronous re-entry guard: the FIRST activation wins, every other path (double click, Enter,
    // programmatic) is a no-op while a submission is in flight or was already accepted.
    if (submitLockRef.current) return
    if (!prompt.trim()) {
      toast({ title: 'Prompt obrigatório', variant: 'destructive' })
      return
    }

    if (selection.operation === 'image_to_video' && !source) {
      toast({ title: 'Selecione uma imagem', variant: 'destructive' })
      return
    }

    submitLockRef.current = true
    setIsSubmitting(true)
    let keepLocked = false

    // From the moment the request is sent, a missing/garbled answer does NOT mean "not submitted".
    const lockUnconfirmed = (message: string) => {
      keepLocked = true
      setUnconfirmedSubmission(message)
      if (onSuccess) onSuccess()
    }

    try {
      let res: Response
      try {
        res = await fetch('/api/video-generations', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            projectId,
            productionId,
            clientRequestId: currentClientRequestId.current,
            prompt,
            // Exactly one of sourceImageId / sourceLibraryFileId for image_to_video, none otherwise.
            ...i2vSourceFields(selection.operation, source),
            // Visible controls only: nothing hidden or stale is ever submitted.
            ...toSubmitControls(selection),
          }),
        })
      } catch {
        lockUnconfirmed('A conexão foi interrompida antes de recebermos a resposta.')
        return
      }

      let data: any
      try {
        data = await res.json()
      } catch {
        lockUnconfirmed('Recebemos uma resposta ilegível do servidor.')
        return
      }

      if (!res.ok) {
        if (data.code === 'PROVIDER_NOT_CONFIGURED') {
          toast({
            title: 'Kling não configurado',
            description: 'Adicione sua chave de API do Kling em Configurações antes de gerar vídeos.',
            variant: 'destructive',
          })
          router.push('/configuracoes?tab=api')
          return
        }
        if (data.code === 'GENERATION_AUTHORIZATION_REQUIRED' || data.code === 'AUTHORIZATION_REQUIRED') {
          await loadConnections()
        }
        // Definitive answers carry a `code`. An unknown outcome (flagged by the server) or a
        // server/gateway error WITHOUT a code may already have been billed: never leave a
        // live "Gerar" button that invites a second charge.
        if (data.outcomeUnknown === true || (res.status >= 500 && !data.code)) {
          lockUnconfirmed(data.error || 'Não foi possível confirmar o envio à Kling.')
          return
        }
        throw new Error(data.error || 'Erro ao criar geração de vídeo')
      }

      // ACCEPTED: this form instance can never submit again. It closes; if the host keeps it visible
      // (animation, parent state), it shows a stable success state instead of an armed button.
      keepLocked = true
      acceptedRef.current = true
      currentClientRequestId.current = crypto.randomUUID()
      setAccepted(true)
      toast({ title: 'Geração iniciada!', description: 'O vídeo está sendo gerado pela IA (Kling)' })
      onOpenChange(false)
      if (onSuccess) onSuccess()

    } catch (err: any) {
      toast({ title: 'Erro', description: err.message, variant: 'destructive' })
    } finally {
      setIsSubmitting(false)
      // Failed BEFORE provider acceptance (definitive answer): the user may correct and retry normally.
      if (!keepLocked) submitLockRef.current = false
    }
  }

  const consumptionNoun = connection?.funding === 'kling_web_credits' ? 'créditos' : 'unidades'
  const heavier =
    (model && selection.duration !== null && selection.duration > 5) ||
    (selection.resolution !== null && selection.resolution !== '720p')

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Gerar vídeo com IA</DialogTitle>
          <DialogDescription>
            Gere um vídeo do zero usando Inteligência Artificial (Kling). O resultado fará parte desta Produção.
          </DialogDescription>
        </DialogHeader>

        {loadState === 'loading' && connections.length === 0 && (
          <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground" data-testid="video-connections-loading">
            <Loader2 className="h-4 w-4 animate-spin" /> Carregando conexões…
          </div>
        )}

        {loadState === 'failed' && (
          <div className="space-y-3 rounded-md border border-destructive/40 bg-destructive/5 p-4" role="alert" data-testid="video-connections-failed">
            <p className="text-sm font-medium">Não foi possível carregar suas conexões.</p>
            <p className="text-xs text-muted-foreground">
              Isso é uma falha temporária de carregamento — não significa que a Kling está desconectada.
            </p>
            <Button size="sm" variant="outline" onClick={() => void loadConnections()}>
              Tentar novamente
            </Button>
          </div>
        )}

        {unconfirmedSubmission && (
          <div className="space-y-2 rounded-md border border-destructive/50 bg-destructive/5 p-4" role="alert" data-testid="video-submission-unconfirmed">
            <p className="text-sm font-medium">Envio não confirmado — não tente de novo</p>
            <p className="text-xs text-muted-foreground">{unconfirmedSubmission}</p>
            <p className="text-xs text-muted-foreground">
              Confira a sua conta Kling e a lista de vídeos antes de gerar outro. Este formulário foi bloqueado para evitar uma cobrança duplicada; recarregue a página para liberá-lo depois de conferir.
            </p>
          </div>
        )}

        {accepted && (
          <div className="space-y-2 rounded-md border border-emerald-500/40 bg-emerald-500/5 p-4" role="status" data-testid="video-submission-accepted">
            <p className="text-sm font-medium">Geração enviada</p>
            <p className="text-xs text-muted-foreground">
              O vídeo está sendo gerado e aparecerá na lista de vídeos quando ficar pronto. Para gerar outro, feche e abra o formulário novamente.
            </p>
          </div>
        )}

        {!accepted && loadState === 'ready' && connections.length > 0 && connection && (
          <div className="min-w-0 space-y-5">
            {blockedCopy && (
              <div className="space-y-2 rounded-md border border-amber-400/40 bg-amber-400/5 p-3" role="status" data-testid="video-connection-blocked" data-reason={blocked}>
                <p className="flex items-center gap-2 text-sm font-medium">
                  <ShieldCheck className="h-4 w-4" /> {blockedCopy.title}
                </p>
                <p className="text-xs text-muted-foreground">{blockedCopy.description}</p>
                {blockedCopy.action === 'settings' && (
                  <Button size="sm" variant="outline" onClick={() => router.push('/configuracoes?tab=api')}>
                    Abrir Configurações
                  </Button>
                )}
                {blockedCopy.action === 'authorize' && (
                  <Button size="sm" onClick={() => void authorizeGeneration()} disabled={isBusy !== null} data-testid="authorize-generation">
                    {isBusy === 'authorize' ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> : null}
                    Autorizar geração
                  </Button>
                )}
                {blockedCopy.action === 'refresh' && (
                  <Button size="sm" variant="outline" onClick={() => void refreshCapabilities()} disabled={isBusy !== null} data-testid="refresh-capabilities">
                    {isBusy === 'refresh' ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="mr-2 h-3.5 w-3.5" />}
                    Atualizar conexão
                  </Button>
                )}
              </div>
            )}

            {capabilityAgeHours !== null && (
              <p className="text-xs text-muted-foreground" data-testid="video-capabilities-stale">
                Modelos e opções verificados há {capabilityAgeHours} h.{' '}
                <button type="button" className="underline" onClick={() => void refreshCapabilities()} disabled={isBusy !== null}>
                  Atualizar
                </button>
              </p>
            )}

            {operationChoices.length > 0 && selection.operation && model && (
              <VideoGenerationForm
                projectId={projectId}
                productionId={productionId}
                connections={connections}
                selection={selection}
                onSelectionChange={change}
                prompt={prompt}
                onPromptChange={setPrompt}
                sourceSelection={i2vSelection}
                onSourceSelectionChange={setSourceSelection}
              />
            )}
          </div>
        )}

        <div className="mt-4 flex justify-end gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>{accepted ? 'Fechar' : 'Cancelar'}</Button>
          {!accepted && (
            <Button onClick={handleSubmit} disabled={!canSubmit} className="gap-2" data-testid="generate-video">
              {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Zap className="h-4 w-4" />}
              Gerar vídeo
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}


'use client'

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useParams, useRouter, useSearchParams } from 'next/navigation'
import { ArrowLeft, RefreshCw, Loader2, XCircle, FileWarning, Zap, Video, AlertTriangle } from 'lucide-react'
import { DashboardPage, DashboardPageBar, DashboardPageContent } from '@/components/layout/dashboard-page'
import { Button } from '@/components/ui/button'
import { useToast } from '@/hooks/use-toast'
import { VideoGenerationForm } from '@/components/videos/video-generation-form'
import {
  type VideoGenerationConnectionDescriptor,
  type VideoConnectionsResponse,
} from '@/lib/video-generation/capabilities'
import { i2vSourceFields, type I2vSourceSelection } from '@/lib/video-generation/i2v-source'
import {
  EMPTY_SELECTION,
  reconcileSelection,
  selectedConnection,
  selectedModel,
  toSubmitControls,
  type VideoFormSelection,
} from '@/lib/video-generation/form-selection'
import {
  describeGenerationNotReady,
  isInFlightGeneration,
  selectRecoverySyncs,
  STATUS_REFRESH_MS,
} from '@/lib/video-generation/status-refresh'
import { GenerationProvenance } from '@/components/videos/generation-provenance'
import { SaveGenerationToLibrary } from '@/components/videos/save-generation-to-library'
import { VideoGenerationPreviewDialog } from '@/components/videos/video-generation-preview-dialog'
import { StatusBadge } from '@/components/ui/status-badge'
import { Card, CardContent } from '@/components/ui/card'
import { connectionNamesById } from '@/lib/video-generation/connection-presentation'
import { attemptToWorkingState, type VideoGenerationWorkingStateV1 } from '@/lib/video-generation/working-state'
import type { SessionResponse } from '@/lib/video-generation/session'
import { useGenerationSessionAutosave } from '@/hooks/use-generation-session-autosave'
import { SessionSaveStatus } from '@/components/generation-session/session-save-status'
import { useGenerationSessionNavigation } from '@/components/generation-session/session-navigation-guard'
import type { GenerationSessionAutosaveAdapter } from '@/lib/generation-session/autosave'

type ConnectionState = 'loading' | 'ready' | 'failed'
type AutosaveTransportError = {
  kind: 'network' | 'server' | 'auth' | 'validation' | 'conflict'
  code?: string
  server?: SessionResponse | { workingState?: VideoGenerationWorkingStateV1; updatedAt?: string }
}

function WorkspacePageContent() {
  const params = useParams<{ sessionId: string }>()
  const sessionId = params.sessionId
  const router = useRouter()
  const routerRef = useRef(router)
  useEffect(() => {
    routerRef.current = router
  }, [router])
  const searchParams = useSearchParams()
  const { toast } = useToast()

  const isNewParam = searchParams.get('new') === '1'
  const contextProjectId = searchParams.get('project')
  const contextProductionId = searchParams.get('production')
  const reuseGenerationId = searchParams.get('reuseGenerationId')

  // DATA FETCHING
  const [connections, setConnections] = useState<VideoGenerationConnectionDescriptor[]>([])
  const [connectionsState, setConnectionsState] = useState<ConnectionState>('loading')
  const [sessionData, setSessionData] = useState<SessionResponse | null>(null)
  const [isHydrating, setIsHydrating] = useState(true)
  const [fatalError, setFatalError] = useState<string | null>(null)
  const [reconciledNotice, setReconciledNotice] = useState<string | null>(null)

  // LOCAL STATE
  const [prompt, setPrompt] = useState('')
  const [selection, setSelection] = useState<VideoFormSelection>(EMPTY_SELECTION)
  const [sourceSelection, setSourceSelection] = useState<I2vSourceSelection | null>(null)

  const currentWorkingState = useMemo<VideoGenerationWorkingStateV1>(() => ({
    schemaVersion: 1,
    prompt,
    source: sourceSelection?.source ?? null,
    selection,
  }), [prompt, selection, sourceSelection])

  const sessionContextRef = useRef<{
    sessionData: SessionResponse | null
    projectId: string | null
    productionId: string | null
    onCreated: ((session: SessionResponse) => void) | null
  }>({ sessionData: null, projectId: null, productionId: null, onCreated: null })
  sessionContextRef.current.sessionData = sessionData
  sessionContextRef.current.projectId = contextProjectId
  sessionContextRef.current.productionId = contextProductionId
  sessionContextRef.current.onCreated = (session) => {
    sessionContextRef.current.sessionData = session
    setSessionData(session)
    routerRef.current.replace(`/videos/geracoes/${session.id}`, { scroll: false })
  }

  const videoAutosaveAdapterRef = useRef<GenerationSessionAutosaveAdapter<VideoGenerationWorkingStateV1, string> | null>(null)
  if (!videoAutosaveAdapterRef.current) {
    videoAutosaveAdapterRef.current = {
      serialize: (value) => JSON.parse(JSON.stringify(value)) as VideoGenerationWorkingStateV1,
      fingerprint: (value) => JSON.stringify(value),
      save: async ({ snapshot, expectedToken }) => {
        const context = sessionContextRef.current
        const hasSession = Boolean(context.sessionData?.updatedAt)
        const response = await fetch(`/api/video-generation-sessions/${encodeURIComponent(sessionId)}`, {
          method: hasSession ? 'PATCH' : 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(hasSession
            ? { expectedUpdatedAt: expectedToken, workingState: snapshot }
            : {
                projectId: context.sessionData?.projectId ?? context.projectId,
                productionId: context.sessionData?.productionId ?? context.productionId,
                workingState: snapshot,
              }),
        })
        const data = await response.json().catch(() => ({}))
        if (!response.ok || !data.session?.updatedAt) {
          const kind = response.status === 409
            ? 'conflict'
            : response.status === 401 || response.status === 403
              ? 'auth'
              : response.status >= 500
                ? 'server'
                : 'validation'
          throw { kind, code: data.code || `HTTP_${response.status}`, server: data.session }
        }
        if (!hasSession && data.created === false && JSON.stringify(data.session.workingState) !== JSON.stringify(snapshot)) {
          throw { kind: 'conflict', code: 'SESSION_CREATE_RACE', server: data.session }
        }
        if (!hasSession) context.onCreated?.(data.session as SessionResponse)
        return {
          ok: true,
          snapshot: (data.session.workingState || snapshot) as VideoGenerationWorkingStateV1,
          token: data.session.updatedAt as string,
        }
      },
      classify: (error, snapshot, token) => {
        const typed = error as AutosaveTransportError
        const server = typed?.server
        return {
          ok: false,
          kind: typed?.kind || 'network',
          snapshot,
          token,
          retryable: typed?.kind !== 'validation' && typed?.kind !== 'auth' && typed?.kind !== 'conflict',
          code: typed?.code,
          server: server?.workingState && server?.updatedAt
            ? { snapshot: server.workingState as VideoGenerationWorkingStateV1, token: server.updatedAt as string }
            : undefined,
        }
      },
      fetchCurrent: async () => {
        const response = await fetch(`/api/video-generation-sessions/${encodeURIComponent(sessionId)}`)
        const data = await response.json().catch(() => ({}))
        if (!response.ok || !data.session?.updatedAt || !data.session.workingState) {
          throw { kind: response.status >= 500 ? 'server' : 'network', code: data.code || `HTTP_${response.status}` }
        }
        return {
          snapshot: data.session.workingState as VideoGenerationWorkingStateV1,
          token: data.session.updatedAt as string,
        }
      },
    }
  }

  const autosave = useGenerationSessionAutosave({
    sessionKey: `video:${sessionId}`,
    initial: { snapshot: currentWorkingState, token: null },
    adapter: videoAutosaveAdapterRef.current,
    canPersist: (snapshot, token) => Boolean(token) || snapshot.prompt.trim().length > 0 || snapshot.source !== null,
    debounceMs: 800,
  })
  const saveState = autosave.state
  const navigation = useGenerationSessionNavigation()

  useEffect(() => navigation.register({
    sessionKey: `video:${sessionId}`,
    getState: () => autosave.state,
    flush: async () => (await autosave.controller.flush()).ok,
  }), [autosave.controller, autosave.state, navigation, sessionId])

  const navigateSafely = useCallback((target: string) => {
    void navigation.runBeforeNavigate(target, () => routerRef.current.push(target))
  }, [navigation])

  const [forceRetry, setForceRetry] = useState(0)

  // Generate / Submit
  const [isGenerating, setIsGenerating] = useState(false)
  const [unconfirmedSubmission, setUnconfirmedSubmission] = useState<string | null>(null)
  const currentClientRequestId = useRef<string>(crypto.randomUUID())
  const [attempts, setAttempts] = useState<any[]>([])
  const [attemptsLoading, setAttemptsLoading] = useState(true)
  const [connectionNames, setConnectionNames] = useState<ReadonlyMap<string, string>>(new Map())
  const [selectedVideoGeneration, setSelectedVideoGeneration] = useState<any | null>(null)

  const loadAttempts = useCallback(async () => {
    try {
      const res = await fetch(`/api/video-generations?sessionId=${encodeURIComponent(sessionId)}`)
      if (res.ok) {
        const data = await res.json()
        setAttempts(data.generations || [])
      }
    } catch {
      // transient network error
    } finally {
      setAttemptsLoading(false)
    }
  }, [sessionId])

  const loadConnections = useCallback(async () => {
    setConnectionsState('loading')
    try {
      const res = await fetch('/api/video-generations/connections')
      if (!res.ok) throw new Error(`status ${res.status}`)
      const data = (await res.json()) as VideoConnectionsResponse
      setConnections(data.connections)
      setConnectionNames(connectionNamesById(data.connections))
      setConnectionsState('ready')
      return data.connections
    } catch {
      setConnectionsState('failed')
      return []
    }
  }, [])

  // HYDRATE
  useEffect(() => {
    let cancelled = false
    const init = async () => {
      setIsHydrating(true)
      setFatalError(null)
      const loadedConnections = await loadConnections()
      if (cancelled) return

      try {
        const res = await fetch(`/api/video-generation-sessions/${encodeURIComponent(sessionId)}`)
        if (cancelled) return

        if (res.ok) {
          const data = await res.json()
          const session = data.session as SessionResponse
          setSessionData(session)

          if (session.workingState) {
            setPrompt(session.workingState.prompt)
            if (session.workingState.source) {
              setSourceSelection({
                source: session.workingState.source,
                summary: {
                  category: session.workingState.source.type === 'library' ? 'library' : 'ai',
                  label: 'Imagem selecionada',
                  thumbnailUrl: null,
                  productionName: null,
                  folder: null,
                },
              })
            } else {
              setSourceSelection(null)
            }

            const reconciled = reconcileSelection(loadedConnections, session.workingState.selection)
            setSelection(reconciled)

            const selectionChanged = JSON.stringify(reconciled) !== JSON.stringify(session.workingState.selection)
            if (selectionChanged) {
              setReconciledNotice('Algumas configurações salvas não estão mais disponíveis nesta conexão e foram ajustadas.')
            }

            // Hydrate establishes the server baseline. Reconciliation is kept
            // as local working state and is persisted only by the controller.
            autosave.controller.resetAcknowledged({
              schemaVersion: 1,
              prompt: session.workingState.prompt,
              source: session.workingState.source ?? null,
              selection: reconciled,
            } satisfies VideoGenerationWorkingStateV1, session.updatedAt)
          } else {
            const initialSelection = reconcileSelection(loadedConnections, EMPTY_SELECTION)
            setSelection(initialSelection)
            autosave.controller.resetAcknowledged({
              schemaVersion: 1,
              prompt: '',
              source: null,
              selection: initialSelection,
            } satisfies VideoGenerationWorkingStateV1, session.updatedAt)
          }

          if (isNewParam) {
            routerRef.current.replace(`/videos/geracoes/${sessionId}`, { scroll: false })
          }

          void loadAttempts()
        } else if (res.status === 404) {
          if (isNewParam && contextProjectId && contextProductionId) {
            // Authorized new session entry
            if (reuseGenerationId) {
              const reuseRes = await fetch(`/api/video-generations/${encodeURIComponent(reuseGenerationId)}?projectId=${encodeURIComponent(contextProjectId)}&productionId=${encodeURIComponent(contextProductionId)}`)
              if (reuseRes.ok) {
                const reuseData = await reuseRes.json()
                const attempt = reuseData.generation
                // We rely on the server to have enforced the context match
                const seeded = attemptToWorkingState(attempt)
                setPrompt(seeded.prompt)
                if (seeded.source) {
                  setSourceSelection({
                    source: seeded.source,
                    summary: {
                      category: seeded.source.type === 'library' ? 'library' : 'ai',
                      label: 'Imagem reutilizada',
                      thumbnailUrl: null,
                      productionName: null,
                      folder: null,
                    },
                  })
                } else {
                  setSourceSelection(null)
                }

                const reconciled = reconcileSelection(loadedConnections, seeded.selection)
                setSelection(reconciled)

                const selectionChanged = JSON.stringify(reconciled) !== JSON.stringify(seeded.selection)
                if (selectionChanged) {
                  setReconciledNotice('Algumas configurações salvas não estão mais disponíveis nesta conexão e foram ajustadas.')
                }

                setAttemptsLoading(false)
                autosave.controller.resetAcknowledged({
                  schemaVersion: 1,
                  prompt: '',
                  source: null,
                  selection: reconcileSelection(loadedConnections, EMPTY_SELECTION),
                }, null)
                autosave.controller.setLocal(seeded)
                setIsHydrating(false)
                return
              }
            }

            const initialSelection = reconcileSelection(loadedConnections, EMPTY_SELECTION)
            setSelection(initialSelection)
            setAttemptsLoading(false)
            // Stays uncreated until first meaningful edit or generate
            autosave.controller.resetAcknowledged({
              schemaVersion: 1,
              prompt: '',
              source: null,
              selection: initialSelection,
            }, null)
          } else {
            setFatalError('Sessão não encontrada.')
          }
        } else {
          setFatalError('Não foi possível carregar a sessão.')
        }
      } catch {
        if (!cancelled) setFatalError('Erro de conexão ao carregar a sessão.')
      } finally {
        if (!cancelled) setIsHydrating(false)
      }
    }

    void init()
    return () => {
      cancelled = true
    }
  }, [sessionId, isNewParam, contextProjectId, contextProductionId, reuseGenerationId, loadConnections, loadAttempts, forceRetry])

  // Polling in-flight generations
  const hasInFlightGeneration = attempts.some(isInFlightGeneration)
  const refreshInFlightRef = useRef(false)
  const recoverySyncedAtRef = useRef<Map<string, number>>(new Map())

  useEffect(() => {
    if (!hasInFlightGeneration) return
    const recoverySync = async (item: any) => {
      try {
        const response = await fetch(`/api/video-generations/${item.id}/sync`, { method: 'POST' })
        if (!response.ok) return
        const payload = await response.json()
        if (payload?.generation) {
          setAttempts((previous: any[]) =>
            previous.map((entry) => (entry.id === item.id ? { ...entry, ...payload.generation } : entry)),
          )
        }
      } catch {
        // next refresh retries
      }
    }

    const tick = async () => {
      if (refreshInFlightRef.current || document.visibilityState === 'hidden') return
      refreshInFlightRef.current = true
      try {
        const response = await fetch(`/api/video-generations?sessionId=${encodeURIComponent(sessionId)}`)
        if (!response.ok) return
        const payload = await response.json()
        const fresh: any[] = Array.isArray(payload?.generations) ? payload.generations : []
        setAttempts(fresh)
        await Promise.all(selectRecoverySyncs(fresh, Date.now(), recoverySyncedAtRef.current).map(recoverySync))
      } catch {
        // transient error
      } finally {
        refreshInFlightRef.current = false
      }
    }

    const timer = setInterval(() => void tick(), STATUS_REFRESH_MS)
    return () => clearInterval(timer)
  }, [hasInFlightGeneration, sessionId])

  // The shared controller owns debounce, single-flight, CAS, conflict, and
  // stale-response behavior. The page only projects form state into it.
  useEffect(() => {
    if (isHydrating || fatalError || connectionsState !== 'ready') return
    autosave.controller.setLocal(currentWorkingState)
  }, [autosave.controller, connectionsState, currentWorkingState, fatalError, isHydrating])

  useEffect(() => {
    const handleLifecycle = () => {
      if (document.visibilityState === 'hidden') autosave.controller.flushLifecycle()
    }
    document.addEventListener('visibilitychange', handleLifecycle)
    window.addEventListener('pagehide', handleLifecycle)
    return () => {
      document.removeEventListener('visibilitychange', handleLifecycle)
      window.removeEventListener('pagehide', handleLifecycle)
    }
  }, [autosave.controller])

  const applyVideoWorkingState = (workingState: VideoGenerationWorkingStateV1) => {
    setPrompt(workingState.prompt)
    setSourceSelection(
      workingState.source
        ? {
            source: workingState.source,
            summary: {
              category: workingState.source.type === 'library' ? 'library' : 'ai',
              label: 'Imagem selecionada',
              thumbnailUrl: null,
              productionName: null,
              folder: null,
            },
          }
        : null,
    )
    setSelection(reconcileSelection(connections, workingState.selection))
  }

  const flushSave = useCallback(async (snapshot: VideoGenerationWorkingStateV1 = currentWorkingState) => {
    return (await autosave.controller.flushSnapshot(snapshot)).ok
  }, [autosave.controller, currentWorkingState])

  const performConflictResolution = async (mode: 'reload_server' | 'keep_local' | 'discard_local') => {
    if (mode === 'keep_local') {
      await autosave.controller.resolveConflict('keep_local')
      return
    }
    try {
      const response = await fetch(`/api/video-generation-sessions/${encodeURIComponent(sessionId)}`)
      const data = await response.json().catch(() => ({}))
      if (!response.ok || !data.session?.workingState) return
      const serverState = data.session.workingState as VideoGenerationWorkingStateV1
      if (mode !== 'discard_local') applyVideoWorkingState(serverState)
      autosave.controller.resetAcknowledged(serverState, data.session.updatedAt as string)
      setSessionData(data.session as SessionResponse)
    } catch {
      // Keep the conflict visible and local state intact.
    }
  }

  const markGenerationSaved = (generationId: string, libraryFileId: string) =>
    setAttempts((previous) => previous.map((entry) => (entry.id === generationId ? { ...entry, library_file_id: libraryFileId } : entry)))

  const activeConnection = selectedConnection(connections, selection)
  const activeModel = selectedModel(connections, selection)

  const canSubmit =
    !isGenerating &&
    saveState !== 'conflict' &&
    unconfirmedSubmission === null &&
    prompt.trim().length > 0 &&
    connectionsState === 'ready' &&
    !!activeConnection?.canGenerate &&
    !!selection.operation &&
    !!selection.modelId &&
    (selection.operation !== 'image_to_video' || !!sourceSelection?.source)

  const handleSubmit = async () => {
    if (saveState === 'conflict') {
      toast({
        title: 'Conflito de autoria pendente',
        description: 'Resolva o conflito antes de iniciar uma geração.',
        variant: 'destructive',
      })
      return
    }

    if (unconfirmedSubmission) {
      toast({
        title: 'Envio anterior não confirmado',
        description: 'Recarregue a página para conferir se a tentativa foi faturada antes de tentar gerar novamente.',
        variant: 'destructive',
      })
      return
    }

    if (!prompt.trim()) {
      toast({ title: 'Prompt obrigatório', variant: 'destructive' })
      return
    }

    if (selection.operation === 'image_to_video' && !sourceSelection?.source) {
      toast({ title: 'Selecione uma imagem', variant: 'destructive' })
      return
    }

    setIsGenerating(true)

    // Capture the exact request before awaiting persistence. Later edits cannot
    // change the Attempt payload while this submission is being prepared.
    const submittedState = currentWorkingState
    const saved = await flushSave(submittedState)
    if (!saved) {
      setIsGenerating(false)
      toast({
        title: 'Não foi possível salvar o estado antes da geração',
        description: 'Verifique a conexão ou resolva o conflito pendente.',
        variant: 'destructive',
      })
      return
    }

    const effectiveProjectId = sessionData?.projectId ?? contextProjectId
    const effectiveProductionId = sessionData?.productionId ?? contextProductionId

    try {
      let res: Response
      try {
        res = await fetch('/api/video-generations', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            projectId: effectiveProjectId,
            productionId: effectiveProductionId,
            sessionId,
            clientRequestId: currentClientRequestId.current,
            prompt: submittedState.prompt,
            ...i2vSourceFields(submittedState.selection.operation, submittedState.source),
            ...toSubmitControls(submittedState.selection),
          }),
        })
      } catch {
        setUnconfirmedSubmission('A conexão foi interrompida antes de recebermos a resposta. Não tente novamente sem conferir os vídeos gerados.')
        void loadAttempts()
        setIsGenerating(false)
        return
      }

      let data: any
      try {
        data = await res.json()
      } catch {
        setUnconfirmedSubmission('Recebemos uma resposta ilegível do servidor. Não tente novamente sem conferir a lista de tentativas.')
        void loadAttempts()
        setIsGenerating(false)
        return
      }

      if (!res.ok) {
        if (data.outcomeUnknown === true || (res.status >= 500 && !data.code)) {
          setUnconfirmedSubmission(data.error || 'Não foi possível confirmar o envio à Kling.')
          void loadAttempts()
          setIsGenerating(false)
          return
        }
        throw new Error(data.error || 'Erro ao criar geração de vídeo')
      }

      toast({ title: 'Geração iniciada!', description: 'O vídeo está sendo gerado pela IA (Kling)' })
      currentClientRequestId.current = crypto.randomUUID()
      void loadAttempts()
    } catch (err: any) {
      toast({ title: 'Erro', description: err.message, variant: 'destructive' })
    } finally {
      setIsGenerating(false)
    }
  }

  const backTarget = sessionData?.projectId && sessionData?.productionId
    ? `/projetos/${sessionData.projectId}/producoes/${sessionData.productionId}`
    : contextProjectId && contextProductionId
      ? `/projetos/${contextProjectId}/producoes/${contextProductionId}`
      : '/videos'

  return (
    <DashboardPage>
      <DashboardPageBar>
        <div className="flex w-full items-center justify-between gap-3">
          <Button
            variant="ghost"
            size="sm"
            className="gap-2 text-muted-foreground hover:text-foreground"
            onClick={() => navigateSafely(backTarget)}
          >
            <ArrowLeft className="h-4 w-4" />
            Voltar para a Produção
          </Button>

          <SessionSaveStatus
            state={saveState}
            className="pr-4"
            onRetry={() => void autosave.controller.retry()}
            onReloadServer={() => void performConflictResolution('reload_server')}
            onKeepLocal={() => void performConflictResolution('keep_local')}
            onDiscardLocal={() => void performConflictResolution('discard_local')}
          />
        </div>
      </DashboardPageBar>

      <DashboardPageContent className="space-y-6">
        <div className="flex flex-col gap-1">
          <h1 className="text-xl font-bold tracking-tight">Workspace de Geração de Vídeo</h1>
          <p className="text-sm text-muted-foreground">
            Ajuste seu prompt e parâmetros. O rascunho é salvo automaticamente e pode ser retomado a qualquer momento.
          </p>
        </div>

        {reconciledNotice && (
          <div className="flex items-center gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-xs text-amber-700 dark:text-amber-300" role="status" data-testid="reconciliation-notice">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            <span>{reconciledNotice}</span>
          </div>
        )}

        {saveState === 'conflict' && (
          <div className="rounded-md border border-amber-500/50 bg-amber-500/10 p-5 space-y-3" role="alert" data-testid="conflict-banner">
            <h3 className="font-semibold text-amber-600 dark:text-amber-400 flex items-center gap-2">
              <FileWarning className="w-5 h-5" /> Conflito de Autoria
            </h3>
            <p className="text-sm text-foreground">
              Esta sessão foi alterada em outra janela ou por outro usuário. O salvamento automático foi pausado para evitar sobrescrita silenciosa.
            </p>
            <div className="flex flex-wrap gap-3 pt-2">
              <Button variant="outline" size="sm" onClick={() => void performConflictResolution('reload_server')} data-testid="conflict-reload-server">
                Recarregar versão salva
              </Button>
              <Button size="sm" onClick={() => void performConflictResolution('keep_local')} data-testid="conflict-keep-local">
                Manter minhas alterações
              </Button>
            </div>
          </div>
        )}

        {fatalError ? (
          <div className="flex flex-col items-center justify-center p-12 text-center border rounded-md bg-destructive/10" data-testid="workspace-fatal-error">
            <XCircle className="w-8 h-8 mb-4 text-destructive" />
            <p className="font-semibold">{fatalError}</p>
            <Button className="mt-4" variant="outline" onClick={() => navigateSafely('/videos')}>
              Voltar aos vídeos
            </Button>
          </div>
        ) : isHydrating || connectionsState === 'loading' ? (
          <div className="flex flex-col items-center justify-center p-12 text-center text-muted-foreground" data-testid="workspace-loading">
            <Loader2 className="w-8 h-8 animate-spin mb-4" />
            <p>Carregando workspace...</p>
          </div>
        ) : connectionsState === 'failed' ? (
          <div className="flex flex-col items-center justify-center p-12 text-center border rounded-md" data-testid="workspace-connections-failed">
            <p className="font-semibold">Erro ao carregar conexões</p>
            <Button className="mt-4" onClick={() => setForceRetry((f) => f + 1)}>
              Tentar novamente
            </Button>
          </div>
        ) : (
          <div className="grid lg:grid-cols-2 gap-8 items-start">
            <div className="space-y-4">
              {unconfirmedSubmission && (
                <div className="space-y-2 rounded-md border border-destructive/50 bg-destructive/5 p-4" role="alert" data-testid="unconfirmed-submission-banner">
                  <p className="text-sm font-medium flex items-center gap-2">
                    <XCircle className="w-4 h-4 text-destructive" /> Envio não confirmado
                  </p>
                  <p className="text-xs text-muted-foreground">{unconfirmedSubmission}</p>
                </div>
              )}

              <VideoGenerationForm
                projectId={sessionData?.projectId || contextProjectId || ''}
                productionId={sessionData?.productionId || contextProductionId || ''}
                connections={connections}
                selection={selection}
                onSelectionChange={(patch) => setSelection((prev) => reconcileSelection(connections, { ...prev, ...patch }))}
                prompt={prompt}
                onPromptChange={setPrompt}
                sourceSelection={sourceSelection}
                onSourceSelectionChange={setSourceSelection}
                disabled={isGenerating || saveState === 'conflict'}
              />

              <div className="flex justify-end pt-4">
                <Button
                  onClick={() => void handleSubmit()}
                  disabled={!canSubmit}
                  className="gap-2"
                  data-testid="generate-video"
                >
                  {isGenerating || saveState === 'saving' ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Zap className="h-4 w-4" />
                  )}
                  Gerar vídeo
                </Button>
              </div>
            </div>

            <div className="border rounded-lg bg-card min-h-[500px]" data-testid="attempts-timeline-panel">
              <div className="p-4 border-b flex items-center justify-between">
                <div>
                  <h2 className="font-semibold text-sm">Histórico de Tentativas</h2>
                  <p className="text-xs text-muted-foreground">Vídeos gerados nesta sessão</p>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => void loadAttempts()}
                  disabled={attemptsLoading}
                  aria-label="Atualizar tentativas"
                >
                  <RefreshCw className={`w-4 h-4 ${attemptsLoading ? 'animate-spin' : ''}`} />
                </Button>
              </div>

              <div className="p-4 space-y-4 max-h-[800px] overflow-y-auto" data-testid="attempts-timeline-list">
                {attemptsLoading && attempts.length === 0 ? (
                  <div className="flex justify-center p-8 text-muted-foreground">
                    <Loader2 className="w-6 h-6 animate-spin" />
                  </div>
                ) : attempts.length === 0 ? (
                  <div className="flex flex-col items-center justify-center p-12 text-center text-muted-foreground" data-testid="attempts-empty">
                    <Video className="w-8 h-8 mb-3 opacity-50" />
                    <p className="text-sm font-medium">Nenhum vídeo gerado nesta sessão ainda.</p>
                    <p className="text-xs text-muted-foreground mt-1">
                      Configure o prompt e clique em &quot;Gerar vídeo&quot;.
                    </p>
                  </div>
                ) : (
                  attempts.map((generation) => (
                    <Card key={generation.id} className="bg-background overflow-hidden border-border/50" data-testid={`attempt-card-${generation.id}`}>
                      <CardContent className="p-4 space-y-3">
                        <div className="flex justify-between items-start gap-4">
                          <p className="text-sm font-medium line-clamp-2" title={generation.prompt}>
                            {generation.prompt}
                          </p>
                          <StatusBadge label={generation.status} tone="neutral" />
                        </div>

                        <GenerationProvenance generation={generation} connectionNames={connectionNames} />

                        <div className="flex flex-wrap gap-2 pt-2">
                          <Button
                            size="sm"
                            onClick={() => {
                              if (generation.status === 'succeeded') {
                                setSelectedVideoGeneration(generation)
                              } else {
                                toast(describeGenerationNotReady(generation))
                              }
                            }}
                            className="gap-1"
                            data-testid={`attempt-watch-${generation.id}`}
                          >
                            <Video className="h-4 w-4" />
                            {generation.status === 'succeeded' ? 'Assistir' : generation.status}
                          </Button>

                          <SaveGenerationToLibrary generation={generation} size="sm" onSaved={markGenerationSaved} />
                        </div>
                      </CardContent>
                    </Card>
                  ))
                )}
              </div>
            </div>
          </div>
        )}

        <VideoGenerationPreviewDialog
          item={selectedVideoGeneration}
          onOpenChange={(open) => {
            if (!open) setSelectedVideoGeneration(null)
          }}
          onNavigate={(href) => navigateSafely(href)}
        />
      </DashboardPageContent>
    </DashboardPage>
  )
}

export default function WorkspacePage() {
  return (
    <Suspense
      fallback={
        <div className="flex h-full items-center justify-center py-24">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      }
    >
      <WorkspacePageContent />
    </Suspense>
  )
}

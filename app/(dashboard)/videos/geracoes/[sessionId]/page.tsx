'use client'

import { Suspense, useCallback, useEffect, useRef, useState } from 'react'
import { useParams, useRouter, useSearchParams } from 'next/navigation'
import { ArrowLeft, RefreshCw, Loader2, Save, XCircle, FileWarning, Zap, Video, AlertTriangle } from 'lucide-react'
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
import type { VideoGenerationWorkingStateV1 } from '@/lib/video-generation/working-state'
import type { SessionResponse } from '@/lib/video-generation/session'

const AUTOSAVE_DEBOUNCE_MS = 800

type ConnectionState = 'loading' | 'ready' | 'failed'
type SaveState = 'saved' | 'saving' | 'error' | 'conflict'

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

  // AUTOSAVE & SYNC
  const [saveState, setSaveState] = useState<SaveState>('saved')
  const [conflictServerData, setConflictServerData] = useState<SessionResponse | null>(null)

  const expectedUpdatedAtRef = useRef<string | null>(null)
  const lastSavedStateRef = useRef<string | null>(null)
  const isSavingRef = useRef(false)
  const pendingStateRef = useRef<VideoGenerationWorkingStateV1 | null>(null)
  const saveWaitersRef = useRef<Array<(success: boolean) => void>>([])
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
          expectedUpdatedAtRef.current = session.updatedAt

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

            // Hydrate writes nothing to DB: match the reconciled state so opening remains clean
            lastSavedStateRef.current = JSON.stringify({
              schemaVersion: 1,
              prompt: session.workingState.prompt,
              source: session.workingState.source ?? null,
              selection: reconciled,
            } satisfies VideoGenerationWorkingStateV1)
          } else {
            const initialSelection = reconcileSelection(loadedConnections, EMPTY_SELECTION)
            setSelection(initialSelection)
            lastSavedStateRef.current = JSON.stringify({
              schemaVersion: 1,
              prompt: '',
              source: null,
              selection: initialSelection,
            } satisfies VideoGenerationWorkingStateV1)
          }

          if (isNewParam) {
            routerRef.current.replace(`/videos/geracoes/${sessionId}`, { scroll: false })
          }

          void loadAttempts()
        } else if (res.status === 404) {
          if (isNewParam && contextProjectId && contextProductionId) {
            // Authorized new session entry
            const initialSelection = reconcileSelection(loadedConnections, EMPTY_SELECTION)
            setSelection(initialSelection)
            setAttemptsLoading(false)
            // Stays uncreated until first meaningful edit or generate
            lastSavedStateRef.current = null
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
  }, [sessionId, isNewParam, contextProjectId, contextProductionId, loadConnections, loadAttempts, forceRetry])

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

  // SINGLE-FLIGHT COALESCING SAVE ENGINE
  const executeSaveLoop = useCallback(async (initialTarget: VideoGenerationWorkingStateV1) => {
    if (isSavingRef.current) {
      pendingStateRef.current = initialTarget
      return
    }

    isSavingRef.current = true
    setSaveState('saving')
    let currentTarget: VideoGenerationWorkingStateV1 | null = initialTarget

    while (currentTarget) {
      const stateToSave = currentTarget
      const toSaveStr = JSON.stringify(stateToSave)
      let ok = false

      try {
        let res: Response
        if (!expectedUpdatedAtRef.current) {
          // PUT create
          res = await fetch(`/api/video-generation-sessions/${encodeURIComponent(sessionId)}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              projectId: sessionData?.projectId ?? contextProjectId,
              productionId: sessionData?.productionId ?? contextProductionId,
              workingState: stateToSave,
            }),
          })
        } else {
          // PATCH update
          res = await fetch(`/api/video-generation-sessions/${encodeURIComponent(sessionId)}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              expectedUpdatedAt: expectedUpdatedAtRef.current,
              workingState: stateToSave,
            }),
          })
        }

        const data = await res.json().catch(() => ({}))

        if (!res.ok) {
          if (res.status === 409 && data.session) {
            setConflictServerData(data.session)
            setSaveState('conflict')
            pendingStateRef.current = null
            const waiters = saveWaitersRef.current
            saveWaitersRef.current = []
            waiters.forEach((cb) => cb(false))
            break
          }
          throw new Error(data.error || 'Autosave falhou')
        }

        expectedUpdatedAtRef.current = data.session.updatedAt
        lastSavedStateRef.current = toSaveStr
          if (!sessionData) {
            setSessionData(data.session)
            routerRef.current.replace(`/videos/geracoes/${sessionId}`, { scroll: false })
          }

        ok = true
      } catch {
        setSaveState('error')
        const waiters = saveWaitersRef.current
        saveWaitersRef.current = []
        waiters.forEach((cb) => cb(false))
        break
      }

      // Check for coalesced newer state
      if (pendingStateRef.current && JSON.stringify(pendingStateRef.current) !== lastSavedStateRef.current) {
        currentTarget = pendingStateRef.current
        pendingStateRef.current = null
      } else {
        currentTarget = null
        if (ok) {
          setSaveState('saved')
          const waiters = saveWaitersRef.current
          saveWaitersRef.current = []
          waiters.forEach((cb) => cb(true))
        }
      }
    }

    isSavingRef.current = false
  }, [sessionId, sessionData, contextProjectId, contextProductionId])

  // Explicit flush function to guarantee current state is persisted before generation or exit
  const flushSave = useCallback(async (): Promise<boolean> => {
    if (saveState === 'conflict') return false

    const currentState: VideoGenerationWorkingStateV1 = {
      schemaVersion: 1,
      prompt,
      source: sourceSelection?.source ?? null,
      selection,
    }

    if (JSON.stringify(currentState) === lastSavedStateRef.current && saveState === 'saved') {
      return true
    }

    return new Promise<boolean>((resolve) => {
      saveWaitersRef.current.push(resolve)
      void executeSaveLoop(currentState)
    })
  }, [prompt, selection, sourceSelection, saveState, executeSaveLoop])

  // Debounced Autosave Effect
  useEffect(() => {
    if (isHydrating || fatalError || connectionsState !== 'ready') return

    const currentState: VideoGenerationWorkingStateV1 = {
      schemaVersion: 1,
      prompt,
      source: sourceSelection?.source ?? null,
      selection,
    }

    const stateStr = JSON.stringify(currentState)
    if (stateStr === lastSavedStateRef.current) {
      return
    }

    const isMeaningful = prompt.trim().length > 0 || sourceSelection !== null
    if (!expectedUpdatedAtRef.current && !isMeaningful) {
      return
    }

    if (saveState === 'conflict') {
      return
    }

    const timer = setTimeout(() => {
      void executeSaveLoop(currentState)
    }, AUTOSAVE_DEBOUNCE_MS)

    return () => clearTimeout(timer)
  }, [prompt, selection, sourceSelection, isHydrating, fatalError, connectionsState, saveState, executeSaveLoop])

  // Best-effort flush on page hide or tab switch
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        void flushSave()
      }
    }
    window.addEventListener('visibilitychange', handleVisibilityChange)
    window.addEventListener('pagehide', handleVisibilityChange)
    return () => {
      window.removeEventListener('visibilitychange', handleVisibilityChange)
      window.removeEventListener('pagehide', handleVisibilityChange)
    }
  }, [flushSave])

  const performConflictResolution = async (mode: 'reload_server' | 'keep_local') => {
    if (!conflictServerData) return
    if (mode === 'reload_server') {
      expectedUpdatedAtRef.current = conflictServerData.updatedAt
      if (conflictServerData.workingState) {
        setPrompt(conflictServerData.workingState.prompt)
        setSourceSelection(
          conflictServerData.workingState.source
            ? {
                source: conflictServerData.workingState.source,
                summary: {
                  category: conflictServerData.workingState.source.type === 'library' ? 'library' : 'ai',
                  label: 'Imagem selecionada',
                  thumbnailUrl: null,
                  productionName: null,
                  folder: null,
                },
              }
            : null,
        )
        const reconciled = reconcileSelection(connections, conflictServerData.workingState.selection)
        setSelection(reconciled)
        lastSavedStateRef.current = JSON.stringify({
          schemaVersion: 1,
          prompt: conflictServerData.workingState.prompt,
          source: conflictServerData.workingState.source ?? null,
          selection: reconciled,
        } satisfies VideoGenerationWorkingStateV1)
      }
      setConflictServerData(null)
      setSaveState('saved')
    } else {
      // Keep local version: adopt the newer concurrency token and immediately save local state
      expectedUpdatedAtRef.current = conflictServerData.updatedAt
      setConflictServerData(null)
      const localState: VideoGenerationWorkingStateV1 = {
        schemaVersion: 1,
        prompt,
        source: sourceSelection?.source ?? null,
        selection,
      }
      void executeSaveLoop(localState)
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

    // Save working state before generation to guarantee lineage & resumability
    const saved = await flushSave()
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
            prompt,
            ...i2vSourceFields(selection.operation, sourceSelection?.source ?? null),
            ...toSubmitControls(selection),
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
            onClick={() => router.push(backTarget)}
          >
            <ArrowLeft className="h-4 w-4" />
            Voltar para a Produção
          </Button>

          <div className="flex items-center gap-2 pr-4 text-xs font-medium" data-testid="workspace-save-status">
            {saveState === 'saved' && (
              <span className="flex items-center gap-1.5 text-emerald-600 dark:text-emerald-400" data-testid="save-status-saved">
                <Save className="h-3.5 w-3.5" /> Salvo
              </span>
            )}
            {saveState === 'saving' && (
              <span className="flex items-center gap-1.5 text-muted-foreground" data-testid="save-status-saving">
                <Loader2 className="h-3.5 w-3.5 animate-spin" /> Salvando...
              </span>
            )}
            {saveState === 'error' && (
              <span className="flex items-center gap-1.5 text-destructive" data-testid="save-status-error">
                <FileWarning className="h-3.5 w-3.5" /> Erro ao salvar
              </span>
            )}
            {saveState === 'conflict' && (
              <span className="flex items-center gap-1.5 text-amber-600 dark:text-amber-400 font-semibold" data-testid="save-status-conflict">
                <AlertTriangle className="h-3.5 w-3.5" /> Conflito
              </span>
            )}
          </div>
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

        {saveState === 'conflict' && conflictServerData && (
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
            <Button className="mt-4" variant="outline" onClick={() => router.push('/videos')}>
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
          onNavigate={(href) => router.push(href)}
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

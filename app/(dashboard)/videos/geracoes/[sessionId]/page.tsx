'use client'

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useParams, useRouter, useSearchParams } from 'next/navigation'
import { ArrowLeft, RefreshCw, Loader2, XCircle, FileWarning, Zap, Video, AlertTriangle } from 'lucide-react'
import { DashboardPage, DashboardPageBar, DashboardPageContent } from '@/components/layout/dashboard-page'
import { Button } from '@/components/ui/button'
import { useToast } from '@/hooks/use-toast'
import { VideoGenerationForm } from '@/components/videos/video-generation-form'
import { VideoPromptWorkflow, type VideoAutomaticStage } from '@/components/videos/video-prompt-workflow'
import { type WorkflowMode } from '@/components/images/image-workflow-controls'
import { DEFAULT_PROMPT_ASSISTANCE_MODEL, findPromptAssistanceModel, type PromptAssistanceModel } from '@/lib/prompt-assistance/models'
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
import { VideoReviewControl } from '@/components/reviews/video-review-control'
import { isGenerationReviewable } from '@/lib/reviews/video-review-presentation'
import { VideoGenerationPreviewDialog } from '@/components/videos/video-generation-preview-dialog'
import { StatusBadge } from '@/components/ui/status-badge'
import { Card, CardContent } from '@/components/ui/card'
import { connectionNamesById } from '@/lib/video-generation/connection-presentation'
import { attemptToWorkingState, type VideoGenerationWorkingStateV1 } from '@/lib/video-generation/working-state'
import type { SessionResponse } from '@/lib/video-generation/session'
import { useGenerationSessionAutosave } from '@/hooks/use-generation-session-autosave'
import { usePromptTranslation } from '@/hooks/use-prompt-translation'
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
  // Optional read-only Portuguese view of the generation prompt: bound to the exact prompt, explicit action only.
  const [promptPt, setPromptPt] = useState('')
  const promptTranslation = usePromptTranslation({ prompt, translation: promptPt, setTranslation: setPromptPt })
  const [selection, setSelection] = useState<VideoFormSelection>(EMPTY_SELECTION)
  const [sourceSelection, setSourceSelection] = useState<I2vSourceSelection | null>(null)

  const [description, setDescription] = useState('')
  const [assistantSelection, setAssistantSelection] = useState({ provider: DEFAULT_PROMPT_ASSISTANCE_MODEL.provider, model: DEFAULT_PROMPT_ASSISTANCE_MODEL.id })
  const assistant = findPromptAssistanceModel(assistantSelection.provider, assistantSelection.model)
  const [workflowMode, setWorkflowMode] = useState<WorkflowMode>('manual')
  // Old sessions keep their exact JSON shape until the user edits the new controls.
  const [persistAssistance, setPersistAssistance] = useState(false)
  const [providerStatusLoaded, setProviderStatusLoaded] = useState(false)
  const [configuredProviders, setConfiguredProviders] = useState<ReadonlySet<string>>(new Set())
  const [paidExecutionAllowed, setPaidExecutionAllowed] = useState(false)
  const [automationEnabled, setAutomationEnabled] = useState(false)
  const [suggestion, setSuggestion] = useState('')
  const [assisting, setAssisting] = useState(false)
  const [assistanceError, setAssistanceError] = useState<string | null>(null)
  const [confirmingApply, setConfirmingApply] = useState(false)
  const [confirmingAutomatic, setConfirmingAutomatic] = useState(false)
  const [automaticStage, setAutomaticStage] = useState<VideoAutomaticStage>('idle')
  const [automaticMessage, setAutomaticMessage] = useState<string | null>(null)
  const assistanceEpoch = useRef(0)
  const assistanceAbort = useRef<AbortController | null>(null)
  const automaticRun = useRef<{ cancelled: boolean; stage: 'prompt' | 'saving' | 'video' } | null>(null)
  const submitLock = useRef(false)
  const invalidateAssistance = () => {
    assistanceEpoch.current += 1
    assistanceAbort.current?.abort()
    assistanceAbort.current = null
    setAssisting(false)
    setSuggestion('')
    setAssistanceError(null)
    setConfirmingApply(false)
    setConfirmingAutomatic(false)
  }
  const restoreAssistance = (state: VideoGenerationWorkingStateV1) => {
    invalidateAssistance()
    const saved = state.assistance
    setPersistAssistance(!!saved)
    setDescription(saved?.description ?? '')
    setAssistantSelection(saved ? { provider: saved.provider, model: saved.model } : { provider: DEFAULT_PROMPT_ASSISTANCE_MODEL.provider, model: DEFAULT_PROMPT_ASSISTANCE_MODEL.id })
    setWorkflowMode(saved?.mode ?? 'manual')
  }

  const currentWorkingState = useMemo<VideoGenerationWorkingStateV1>(() => ({
    schemaVersion: 1,
    prompt,
    source: sourceSelection?.source ?? null,
    selection,
    ...(persistAssistance ? { assistance: { description, ...assistantSelection, mode: workflowMode } } : {}),
  }), [prompt, selection, sourceSelection, persistAssistance, description, assistantSelection, workflowMode])

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
    canPersist: (snapshot, token) => Boolean(token) || snapshot.prompt.trim().length > 0 || snapshot.source !== null || !!snapshot.assistance?.description.trim(),
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
    cancelAutomatic()
    invalidateAssistance()
    void navigation.runBeforeNavigate(target, () => routerRef.current.push(target))
  }, [navigation])

  const [forceRetry, setForceRetry] = useState(0)

  // Generate / Submit
  const [isGenerating, setIsGenerating] = useState(false)
  const [unconfirmedSubmission, setUnconfirmedSubmission] = useState<string | null>(null)
  const currentClientRequestId = useRef<string>(crypto.randomUUID())
  const pendingStorageKey = `video-pending-submit:${sessionId}`
  const rememberPending = (key: string | null) => {
    try {
      if (key) sessionStorage.setItem(pendingStorageKey, key)
      else sessionStorage.removeItem(pendingStorageKey)
    } catch { /* Storage is optional; the in-memory lock still prevents a second submit. */ }
  }
  useEffect(() => {
    try {
      const pending = sessionStorage.getItem(`video-pending-submit:${sessionId}`)
      if (pending && /^[0-9a-f-]{36}$/i.test(pending)) {
        currentClientRequestId.current = pending
        setUnconfirmedSubmission('Há um envio anterior ainda não confirmado. Confira as tentativas antes de iniciar outro vídeo.')
      } else {
        currentClientRequestId.current = crypto.randomUUID()
        setUnconfirmedSubmission(null)
      }
    } catch { /* Preserve the in-memory state when browser storage is unavailable. */ }
  }, [sessionId])
  const [attempts, setAttempts] = useState<any[]>([])
  const [attemptsLoading, setAttemptsLoading] = useState(true)
  const [connectionNames, setConnectionNames] = useState<ReadonlyMap<string, string>>(new Map())
  const [selectedVideoGeneration, setSelectedVideoGeneration] = useState<any | null>(null)

  const loadAttempts = useCallback(async () => {
    try {
      const res = await fetch(`/api/video-generations?sessionId=${encodeURIComponent(sessionId)}`)
      if (res.ok) {
        const data = await res.json()
        const fresh = data.generations || []
        setAttempts(fresh)
        // A server-recorded, known outcome reconciles the browser's pending marker without submitting anything.
        const known = fresh.find((item: any) => item.client_request_id === currentClientRequestId.current)
        const verifiedTask = !!(known?.task_id || known?.storage_path || known?.public_url)
        const definitiveRejection = known?.status === 'failed' && known.error_details?.outcome_unknown === false
        if (known && (verifiedTask || definitiveRejection) && known.error_details?.outcome_unknown !== true
          && known.error_details?.code !== 'SUBMISSION_INTERRUPTED') {
          try { sessionStorage.removeItem(`video-pending-submit:${sessionId}`) } catch { /* optional browser storage */ }
          setUnconfirmedSubmission(null)
          currentClientRequestId.current = crypto.randomUUID()
        }
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

  useEffect(() => {
    let cancelled = false
    setProviderStatusLoaded(false)
    setAutomationEnabled(false)
    void (async () => {
      try {
        const response = await fetch('/api/settings/providers')
        const data = await response.json()
        if (cancelled || !response.ok || !data.providers) return
        setConfiguredProviders(new Set(['openai', 'gemini'].filter((provider) => data.providers[provider]?.status === 'configured')))
        setPaidExecutionAllowed(data.executionPolicy?.paidExecution === 'allowed')
        setAutomationEnabled(data.automationEnabled === true)
        setProviderStatusLoaded(true)
      } catch { /* Fail closed. Manual generation does not depend on text-assistance readiness. */ }
    })()
    return () => { cancelled = true }
  }, [sessionId])

  // HYDRATE
  const hydratedSession = useRef<string | null>(null)
  useEffect(() => {
    const hydrationKey = `${sessionId}:${forceRetry}`
    // onCreated only normalizes the URL of the already hydrated session. A fresh GET/reset here could
    // abandon a pending save barrier or restore a stale prompt while an authorized run is in progress.
    if (hydratedSession.current === hydrationKey && sessionContextRef.current.sessionData?.id === sessionId) return
    let cancelled = false
    const init = async () => {
      setIsHydrating(true)
      if (!automaticRun.current) invalidateAssistance()
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
            if (!automaticRun.current) restoreAssistance(session.workingState)
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
              ...(session.workingState.assistance ? { assistance: session.workingState.assistance } : {}),
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
        if (!cancelled) {
          hydratedSession.current = hydrationKey
          setIsHydrating(false)
        }
      }
    }

    void init()
    return () => {
      cancelled = true
    }
  }, [sessionId, isNewParam, contextProjectId, contextProductionId, reuseGenerationId, loadConnections, loadAttempts, forceRetry])

  useEffect(() => {
    setAutomaticStage('idle')
    setAutomaticMessage(null)
    return () => {
      assistanceEpoch.current += 1
      assistanceAbort.current?.abort()
      assistanceAbort.current = null
      const run = automaticRun.current
      if (run && run.stage !== 'video') run.cancelled = true
      automaticRun.current = null
    }
  }, [sessionId])

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
    restoreAssistance(workingState)
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

  const automaticBusy = automaticStage === 'prompt' || automaticStage === 'saving' || automaticStage === 'video'
  const busy = isGenerating || automaticBusy
  const canSubmit =
    !busy && !assisting &&
    saveState !== 'conflict' &&
    unconfirmedSubmission === null &&
    prompt.trim().length > 0 &&
    connectionsState === 'ready' &&
    !!activeConnection?.canGenerate &&
    !!selection.operation &&
    !!selection.modelId &&
    (selection.operation !== 'image_to_video' || !!sourceSelection?.source)

  const submitVideo = async (submittedState: VideoGenerationWorkingStateV1, beforeSend?: () => boolean): Promise<boolean> => {
    if (submitLock.current || unconfirmedSubmission || saveState === 'conflict' || !submittedState.prompt.trim()
      || !selectedConnection(connections, submittedState.selection)?.canGenerate
      || !submittedState.selection.operation || !submittedState.selection.modelId
      || (submittedState.selection.operation === 'image_to_video' && !submittedState.source)) return false
    // Synchronous lock precedes the first await; the snapshot and key cannot change mid-submit.
    submitLock.current = true
    setIsGenerating(true)
    const requestId = currentClientRequestId.current
    const effectiveProjectId = sessionData?.projectId ?? contextProjectId
    const effectiveProductionId = sessionData?.productionId ?? contextProductionId
    const unknown = (message: string) => {
      setUnconfirmedSubmission(message)
      void loadAttempts()
      return false
    }
    try {
      if (!await flushSave(submittedState)) {
        toast({ title: 'Não foi possível salvar o estado antes da geração', description: 'Verifique a conexão ou resolva o conflito pendente.', variant: 'destructive' })
        return false
      }
      if (beforeSend && !beforeSend()) return false
      rememberPending(requestId)
      let res: Response
      try {
        res = await fetch('/api/video-generations', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ projectId: effectiveProjectId, productionId: effectiveProductionId, sessionId,
            clientRequestId: requestId, prompt: submittedState.prompt,
            ...i2vSourceFields(submittedState.selection.operation, submittedState.source),
            ...toSubmitControls(submittedState.selection),
          }),
        })
      } catch {
        return unknown('A conexão foi interrompida antes de recebermos a resposta. Confira as tentativas; nenhum novo vídeo será enviado automaticamente.')
      }
      let data: any
      try { data = await res.json() } catch {
        return unknown('Recebemos uma resposta ilegível. Confira as tentativas antes de iniciar outro vídeo.')
      }
      if (data.outcomeUnknown === true || (!res.ok && ((res.status >= 500 && !data.code) || data.code === 'IDEMPOTENCY_KEY_REUSED'))) {
        return unknown(data.error || 'Não foi possível confirmar o envio à Kling.')
      }
      if (!res.ok) {
        rememberPending(null)
        currentClientRequestId.current = crypto.randomUUID()
        throw new Error(data.error || 'Erro ao criar geração de vídeo')
      }
      if (!data.generation?.id || !data.generation?.status) return unknown('O servidor não confirmou uma tentativa válida. Confira o histórico antes de iniciar outro vídeo.')
      rememberPending(null)
      currentClientRequestId.current = crypto.randomUUID()
      if (data.generation.status === 'failed' || data.generation.status === 'cancelled') {
        void loadAttempts()
        throw new Error(data.generation.error_message || 'A tentativa anterior não foi concluída. Um novo envio exige uma nova ação sua.')
      }
      toast({ title: 'Geração iniciada!', description: 'Acompanhe o vídeo no histórico de tentativas.' })
      void loadAttempts()
      return true
    } catch (err: unknown) {
      toast({ title: 'Erro', description: err instanceof Error ? err.message : 'Não foi possível iniciar o vídeo.', variant: 'destructive' })
      return false
    } finally {
      submitLock.current = false
      setIsGenerating(false)
    }
  }

  const assistanceReason = !providerStatusLoaded ? 'Não foi possível confirmar os provedores. Confira Configurações ou recarregue a página.'
    : !paidExecutionAllowed ? 'A assistência paga está bloqueada neste ambiente.'
    : !assistant ? 'Selecione um modelo de assistência compatível.'
    : !configuredProviders.has(assistant.provider) ? 'Configure sua chave BYOK para o provedor de assistência selecionado.'
    : !selection.operation ? 'Selecione Texto para Vídeo ou Imagem para Vídeo.'
    : saveState === 'conflict' ? 'Resolva o conflito de autoria antes de usar assistência.' : null
  const automaticReason = !automationEnabled ? 'Ative “Permitir modo Automático” em Configurações.'
    : unconfirmedSubmission ? 'Confira o envio anterior no histórico antes de iniciar outro vídeo.'
    : !activeConnection?.canGenerate || !selection.operation || !selection.modelId ? 'Selecione uma conexão Kling disponível e um modelo compatível.'
    : selection.operation === 'image_to_video' && !sourceSelection?.source ? 'Selecione uma imagem de origem.'
    : assistanceReason

  const generationSummary = activeModel && selection.operation ? `${activeModel.label} · ${selection.operation === 'image_to_video' ? 'Imagem para Vídeo' : 'Texto para Vídeo'}` : null
  // Automatic that cannot run (preference off, no usable connection...) is shown as Assisted, so a competing generate
  // button never disappears behind a disabled Automatic. The saved selection is untouched.
  const effectiveMode: WorkflowMode = workflowMode === 'automatic' && automaticReason ? 'assisted' : workflowMode

  const requestAssistance = async (operation: 'create' | 'improve', workflow: 'assisted' | 'automatic', snapshot: VideoGenerationWorkingStateV1, signal: AbortSignal) => {
    if (!assistant || assistanceReason) throw new Error(assistanceReason || 'Modelo de assistência indisponível.')
    const response = await fetch('/api/prompt-assistance', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, signal,
      body: JSON.stringify({ projectId: sessionData?.projectId ?? contextProjectId, productionId: sessionData?.productionId ?? contextProductionId,
        mediaType: 'video', videoMode: snapshot.selection.operation, operation, workflow,
        originalText: description.trim() || snapshot.prompt.trim(),
        ...(operation === 'improve' ? { currentText: snapshot.prompt.trim() } : {}),
        provider: assistant.provider, model: assistant.id,
      }),
    })
    const payload = await response.json()
    if (!response.ok) throw new Error(payload.message || payload.error || 'Não foi possível obter uma sugestão de prompt.')
    const text = typeof payload.suggestedPrompt === 'string' ? payload.suggestedPrompt.trim() : ''
    if (!text || text.length > 12000 || payload.provider !== assistant.provider || payload.model !== assistant.id || payload.operation !== operation) {
      throw new Error('O provedor retornou uma sugestão inválida. O prompt atual foi preservado.')
    }
    return text
  }
  const assist = async (operation: 'create' | 'improve') => {
    if (submitLock.current || automaticRun.current || assistanceAbort.current || assistanceReason
      || (operation === 'create' ? !description.trim() : !prompt.trim())) return
    const controller = new AbortController()
    assistanceAbort.current = controller
    const epoch = ++assistanceEpoch.current
    setAssisting(true)
    setSuggestion('')
    setConfirmingApply(false)
    setAssistanceError(null)
    try {
      const text = await requestAssistance(operation, 'assisted', currentWorkingState, controller.signal)
      if (epoch === assistanceEpoch.current && !controller.signal.aborted) setSuggestion(text)
    } catch (error) {
      if (epoch === assistanceEpoch.current && !controller.signal.aborted) setAssistanceError(error instanceof Error ? error.message : 'Falha na assistência de prompt.')
    } finally {
      if (epoch === assistanceEpoch.current) setAssisting(false)
      if (assistanceAbort.current === controller) assistanceAbort.current = null
    }
  }
  const applySuggestion = () => {
    if (submitLock.current || automaticRun.current || !suggestion) return
    setPrompt(suggestion)
    invalidateAssistance()
  }
  const runAutomatic = async () => {
    if (submitLock.current || automaticRun.current || assistanceAbort.current || automaticReason || !description.trim()) return
    const run = { cancelled: false, stage: 'prompt' as 'prompt' | 'saving' | 'video' }
    automaticRun.current = run
    const controller = new AbortController()
    assistanceAbort.current = controller
    const epoch = ++assistanceEpoch.current
    const snapshot = currentWorkingState
    setConfirmingAutomatic(false)
    setSuggestion('')
    setAssistanceError(null)
    setAutomaticStage('prompt')
    setAutomaticMessage('Criando o prompt. O vídeo ainda não foi enviado.')
    try {
      const text = await requestAssistance('create', 'automatic', snapshot, controller.signal)
      if (run.cancelled || controller.signal.aborted || epoch !== assistanceEpoch.current) return
      run.stage = 'saving'
      setAutomaticStage('saving')
      setAutomaticMessage('Salvando o prompt. O vídeo ainda não foi enviado.')
      setPrompt(text)
      const accepted = await submitVideo({ ...snapshot, prompt: text }, () => {
        if (run.cancelled || epoch !== assistanceEpoch.current) return false
        run.stage = 'video'
        setAutomaticStage('video')
        setAutomaticMessage('Enviando um vídeo para a Kling.')
        return true
      })
      if (run.cancelled || epoch !== assistanceEpoch.current) return
      setAutomaticStage(accepted ? 'submitted' : 'video_failed')
      setAutomaticMessage(accepted ? 'Vídeo enviado. Acompanhe o resultado no histórico; o Review continua sendo uma ação sua.' : 'O envio não foi confirmado ou foi rejeitado. Confira o histórico e o aviso de envio antes de uma nova ação. O prompt foi preservado.')
    } catch (error) {
      if (!run.cancelled && epoch === assistanceEpoch.current) {
        setAutomaticStage('prompt_failed')
        setAutomaticMessage(error instanceof Error ? error.message : 'Falha ao criar o prompt. Nenhum vídeo foi enviado.')
      }
    } finally {
      if (assistanceAbort.current === controller) assistanceAbort.current = null
      if (automaticRun.current === run) automaticRun.current = null
    }
  }
  function cancelAutomatic() {
    const run = automaticRun.current
    if (!run || run.stage === 'video') return
    run.cancelled = true
    assistanceEpoch.current += 1
    assistanceAbort.current?.abort()
    assistanceAbort.current = null
    automaticRun.current = null
    setAutomaticStage('cancelled')
    setAutomaticMessage('Cancelado antes do envio de vídeo. A chamada de assistência já iniciada pode ter custo.')
  }
  const editPrompt = (value: string) => {
    if (submitLock.current || automaticRun.current) return
    invalidateAssistance()
    setPrompt(value)
  }
  const useRefinedPrompt = (value: string) => {
    if (submitLock.current || automaticRun.current || saveState === 'conflict' || unconfirmedSubmission) return
    editPrompt(value)
    toast({ title: 'Prompt refinado aplicado', description: 'Edite o prompt e clique em Gerar vídeo quando estiver pronto. O Review e as tentativas anteriores foram preservados.' })
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
          <div className="grid min-w-0 lg:grid-cols-2 gap-8 items-start">
            <div className="min-w-0 space-y-4">
              {unconfirmedSubmission && (
                <div className="space-y-2 rounded-md border border-destructive/50 bg-destructive/5 p-4" role="alert" data-testid="unconfirmed-submission-banner">
                  <p className="text-sm font-medium flex items-center gap-2">
                    <XCircle className="w-4 h-4 text-destructive" /> Envio não confirmado
                  </p>
                  <p className="text-xs text-muted-foreground">{unconfirmedSubmission}</p>
                </div>
              )}

              <VideoPromptWorkflow
                mode={effectiveMode} onModeChange={(value) => { if (submitLock.current || automaticRun.current) return; invalidateAssistance(); setPersistAssistance(true); setWorkflowMode(value) }}
                description={description} onDescriptionChange={(value) => { if (submitLock.current || automaticRun.current) return; invalidateAssistance(); setPersistAssistance(true); setDescription(value) }}
                assistant={assistant} onAssistantChange={(value: PromptAssistanceModel) => { invalidateAssistance(); setPersistAssistance(true); setAssistantSelection({ provider: value.provider, model: value.id }) }}
                configured={configuredProviders} providerStatusLoaded={providerStatusLoaded} reason={assistanceReason}
                suggestion={suggestion} onApply={() => { if (prompt.trim() && prompt !== suggestion) setConfirmingApply(true); else applySuggestion() }}
                onDiscard={invalidateAssistance} confirmingApply={confirmingApply} onConfirmApply={applySuggestion} onCancelApply={() => setConfirmingApply(false)}
                canImprove={!!prompt.trim()} onAssist={(operation) => void assist(operation)} assisting={assisting} busy={busy || saveState === 'conflict' || !!unconfirmedSubmission}
                automaticReason={automaticReason} automaticStage={automaticStage} automaticMessage={automaticMessage}
                confirmingAutomatic={confirmingAutomatic} onStartAutomatic={() => { if (prompt.trim()) setConfirmingAutomatic(true); else void runAutomatic() }}
                onConfirmAutomatic={() => void runAutomatic()} onCancelAutomaticConfirm={() => setConfirmingAutomatic(false)} onCancelAutomatic={cancelAutomatic}
                generationSummary={generationSummary} promptEmpty={!prompt.trim()}
                onUseDescription={() => editPrompt(description.trim())}
              />
              {assistanceError && <p role="alert" className="text-sm text-destructive" data-testid="video-assistance-error">{assistanceError}</p>}

              <VideoGenerationForm
                projectId={sessionData?.projectId || contextProjectId || ''}
                productionId={sessionData?.productionId || contextProductionId || ''}
                connections={connections}
                selection={selection}
                onSelectionChange={(patch) => { if (submitLock.current || automaticRun.current) return; invalidateAssistance(); setSelection((prev) => reconcileSelection(connections, { ...prev, ...patch })) }}
                prompt={prompt}
                onPromptChange={editPrompt}
                sourceSelection={sourceSelection}
                onSourceSelectionChange={(value) => { if (submitLock.current || automaticRun.current) return; invalidateAssistance(); setSourceSelection(value) }}
                disabled={busy || saveState === 'conflict' || !!unconfirmedSubmission}
                promptReadOnly={effectiveMode === 'automatic'}
                promptLanguage={{
                  translation: promptTranslation.translation,
                  translating: promptTranslation.translating,
                  error: promptTranslation.error,
                  canTranslate: providerStatusLoaded && paidExecutionAllowed && configuredProviders.has('openai'),
                  unavailableReason: !providerStatusLoaded ? 'Não foi possível confirmar os provedores.' : !paidExecutionAllowed ? 'A tradução paga está bloqueada neste ambiente.' : undefined,
                  onTranslate: () => { void promptTranslation.translate() },
                }}
              />

              {effectiveMode !== 'automatic' && (
              <div className="flex justify-end pt-4">
                <Button
                  onClick={() => { if (!automaticRun.current && !assistanceAbort.current) void submitVideo(currentWorkingState) }}
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
              )}
            </div>

            <div className="min-w-0 border rounded-lg bg-card min-h-[500px]" data-testid="attempts-timeline-panel">
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

                          {/* VIDEO_REVIEW_UI_AND_HISTORY_V1: advisory Review of a completed result; sends only the generation id. */}
                          {isGenerationReviewable(generation) && (
                            <VideoReviewControl onUseRefinedPrompt={useRefinedPrompt} refinedPromptDisabled={busy || assisting || saveState === 'conflict' || !!unconfirmedSubmission} source={{ kind: 'video_generation', id: generation.id }} size="sm" subjectLabel={generation.prompt} />
                          )}
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

'use client'

import { useState, useEffect, Suspense, useMemo, useRef } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import {
  DashboardPage,
  DashboardPageBar,
  DashboardPageContent,
} from '@/components/layout/dashboard-page'
import { PageHeader } from '@/components/layout/page-header'
import { ImageInputSection } from '@/components/images/image-input-section'
import { PromptSection, type ImageModel } from '@/components/images/prompt-section'
import { ImageResult } from '@/components/images/image-result'
import { WorkspaceIdentityContext } from '@/components/projects/inherited-project-identity'
import { PromptGenerationError, regeneratePrompt, type PromptGenerationResult } from '@/lib/ai-simulator'
import { normalizeProjectIdentity, ProjectIdentityParseError } from '@/lib/project-identity-normalizer'
import { resolveInheritedIdentitySummary } from '@/lib/inherited-project-identity'
import type { ProjectIdentity } from '@/lib/schemas/project-identity'
import {
  Card,
  CardActions,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { ViewModeToggle, useViewModePreference } from '@/components/ui/view-mode-toggle'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { ContextMetadata } from '@/components/ui/context-metadata'
import { StateMessage } from '@/components/ui/state-message'
import { StatusBadge } from '@/components/ui/status-badge'
import { FileText, ChevronRight, Loader2, ArrowLeft, Search, ImageIcon } from 'lucide-react'
import { GenerationHistory } from '@/components/images/generation-history'
import type { Project, Production, Image as ImageType, ImageDraft, ImageEvaluation, GenerationAttempt } from '@/lib/types'
import { useToast } from '@/hooks/use-toast'
import { draftLoadingMessage } from '@/lib/ux-production-hardening'
import { useGenerationSessionAutosave } from '@/hooks/use-generation-session-autosave'
import { SessionSaveStatus } from '@/components/generation-session/session-save-status'
import { useGenerationSessionNavigation } from '@/components/generation-session/session-navigation-guard'
import type { GenerationSessionAutosaveAdapter } from '@/lib/generation-session/autosave'
import type { ImageGenerationWorkingStateV1 } from '@/lib/image-generation/session'
import {
  buildImageDraftHubCards,
  filterDraftHubCards,
  getDraftHubEmptyState,
  getDraftHubProductionLabel,
  getProductionsForProject,
} from '@/lib/draft-hub'

type GeneratedImageResult = {
  imageUrl: string
  publicUrl?: string | null
  thumbnailUrl?: string | null
  storageProvider?: string | null
  storagePath?: string | null
  thumbnailPath?: string | null
  fileSize?: number | null
  mimeType?: string | null
  image?: ImageType | null
  attemptId?: string | null
}

type ImageAutosaveState = {
  workingPrompt: string
  workingState: ImageGenerationWorkingStateV1
}

type ImageAutosaveTransportError = {
  kind: 'network' | 'server' | 'auth' | 'validation' | 'conflict'
  code?: string
  server?: { workingPrompt?: string; workingState?: ImageGenerationWorkingStateV1; revision?: number }
}

function persistableImageUrl(url: string | null | undefined) {
  if (!url || url.startsWith('data:')) return null
  if (url.includes('X-Amz-') || url.includes('AWSAccessKeyId=') || url.includes('Signature=')) return null
  return url
}

export function ImagesPageContent({ canonicalSessionId }: { canonicalSessionId?: string } = {}) {
  const { toast } = useToast()
  const router = useRouter()
  const searchParams = useSearchParams()
  const canonicalWorkspace = Boolean(canonicalSessionId)
  
  const [projects, setProjects] = useState<Project[]>([])
  const [productions, setProductions] = useState<Production[]>([])
  const [selectedProject, setSelectedProject] = useState<string | null>(null)
  const [productionId, setProductionId] = useState<string | null>(null)
  const [productionTitle, setProductionTitle] = useState<string | null>(null)
  const [productionProjectId, setProductionProjectId] = useState<string | null>(null)
  const [drafts, setDrafts] = useState<ImageDraft[]>([])
  const [sessions, setSessions] = useState<any[]>([])
  const [currentDraftId, setCurrentDraftId] = useState<string | null>(null)
  const imageSourceReferencesRef = useRef<ImageGenerationWorkingStateV1['sourceReferences']>([])
  const imageGenerationConfigRef = useRef<ImageGenerationWorkingStateV1['generationConfig']>({
    size: '1024x1024', quality: 'medium', aspectRatio: '1:1', style: null, providerOptions: {},
  })
  
  // Input state
  const [userInput, setUserInput] = useState('')
  const [autoMode, setAutoMode] = useState(false)
  
  // Prompt state
  const [generatedPrompt, setGeneratedPrompt] = useState('')
  const [generatedPromptPt, setGeneratedPromptPt] = useState('')
  const [promptDetails, setPromptDetails] = useState<{
    style: string
    lighting: string | null
    composition: string | null
  } | null>(null)
  
  // Image state
  const [currentImage, setCurrentImage] = useState<ImageType | null>(null)
  const [imageUrl, setImageUrl] = useState<string | null>(null)
  const [imageStatus, setImageStatus] = useState<'draft' | 'generating' | 'approved' | 'rejected'>('draft')
  
  // Loading states
  const [isGeneratingPrompt, setIsGeneratingPrompt] = useState(false)
  const [isCreatingImage, setIsCreatingImage] = useState(false)
  const [isRegenerating, setIsRegenerating] = useState(false)
  const [isApproving, setIsApproving] = useState(false)
  const [isSavingDraft, setIsSavingDraft] = useState(false)
  const [isLoadingDrafts, setIsLoadingDrafts] = useState(true)
  const [isDataReady, setIsDataReady] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [retryKey, setRetryKey] = useState(0)
  const [isTranslatingPrompt, setIsTranslatingPrompt] = useState(false)
  const [promptTranslationError, setPromptTranslationError] = useState<string | null>(null)
  const [hubProjectFilter, setHubProjectFilter] = useState('all')
  const [hubProductionFilter, setHubProductionFilter] = useState('all')
  const [hubStatusFilter, setHubStatusFilter] = useState('all')
  const [hubSearch, setHubSearch] = useState('')
  const [hubCreateProjectId, setHubCreateProjectId] = useState('')
  const [hubCreateProductionId, setHubCreateProductionId] = useState('')
  const [hubViewMode, setHubViewMode] = useViewModePreference('image-draft-hub-view', 'list')
  
  // Provider configuration status — booleans only. The full secret never
  // reaches the browser; see /api/settings/providers (AI_PROVIDER_CREDENTIALS_BYOK_V1).
  const [openaiConfigured, setOpenaiConfigured] = useState(false)
  const [nanobananaConfigured, setNanobananaConfigured] = useState(false)
  const [isGeneratingNanoBanana, setIsGeneratingNanoBanana] = useState(false)
  const imageClientRequestIdRef = useRef<string>(crypto.randomUUID())
  const [automationEnabled, setAutomationEnabled] = useState(false)
  const [defaultImageModel, setDefaultImageModel] = useState<ImageModel>('gpt-image-2')
  const [selectedModel, setSelectedModel] = useState<ImageModel>('gpt-image-2')
  const [currentAttempt, setCurrentAttempt] = useState(1)

  const currentImageAutosaveState = useMemo<ImageAutosaveState>(() => ({
    workingPrompt: userInput,
    workingState: {
      schemaVersion: 1,
      generatedPrompt: generatedPrompt || null,
      generatedPromptPt: generatedPromptPt || null,
      promptDetails,
      autoMode,
      selectedModel,
      imageStatus,
      currentAttempt,
      currentImageId: currentImage?.id || null,
      sourceReferences: imageSourceReferencesRef.current,
      generationConfig: imageGenerationConfigRef.current,
      legacyImageUrl: persistableImageUrl(imageUrl),
    },
  }), [userInput, generatedPrompt, generatedPromptPt, promptDetails, autoMode, selectedModel, imageStatus, currentAttempt, currentImage?.id, imageUrl])

  const imageSessionContextRef = useRef({ canonicalSessionId, onCreated: null as ((session: any) => void) | null })
  imageSessionContextRef.current.canonicalSessionId = canonicalSessionId

  const imageAutosaveAdapterRef = useRef<GenerationSessionAutosaveAdapter<ImageAutosaveState, number> | null>(null)
  if (!imageAutosaveAdapterRef.current) {
    imageAutosaveAdapterRef.current = {
      serialize: (value) => JSON.parse(JSON.stringify(value)) as ImageAutosaveState,
      fingerprint: (value) => JSON.stringify({
        workingPrompt: value.workingPrompt,
        generatedPrompt: value.workingState.generatedPrompt,
        generatedPromptPt: value.workingState.generatedPromptPt,
        promptDetails: value.workingState.promptDetails,
        autoMode: value.workingState.autoMode,
        selectedModel: value.workingState.selectedModel,
        sourceReferences: value.workingState.sourceReferences,
        generationConfig: value.workingState.generationConfig,
      }),
      save: async ({ snapshot, expectedToken }) => {
        const sessionId = imageSessionContextRef.current.canonicalSessionId
        if (!sessionId || expectedToken === null) throw { kind: 'validation', code: 'SESSION_REQUIRED' }
        const response = await fetch(`/api/image-generation-sessions/${sessionId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ expectedRevision: expectedToken, ...snapshot }),
        })
        const data = await response.json().catch(() => ({}))
        if (!response.ok || typeof data.session?.revision !== 'number') {
          const kind = response.status === 409
            ? 'conflict'
            : response.status === 401 || response.status === 403
              ? 'auth'
              : response.status >= 500
                ? 'server'
                : 'validation'
          throw { kind, code: data.code || `HTTP_${response.status}`, server: data.session }
        }
        return {
          ok: true,
          snapshot: {
            workingPrompt: data.session.workingPrompt,
            workingState: data.session.workingState,
          } as ImageAutosaveState,
          token: data.session.revision as number,
        }
      },
      classify: (error, snapshot, token) => {
        const typed = error as ImageAutosaveTransportError
        return {
          ok: false,
          kind: typed?.kind || 'network',
          snapshot,
          token,
          retryable: typed?.kind !== 'validation' && typed?.kind !== 'auth' && typed?.kind !== 'conflict',
          code: typed?.code,
          server: typed?.server?.workingState && typeof typed.server.revision === 'number'
            ? { snapshot: { workingPrompt: typed.server.workingPrompt || '', workingState: typed.server.workingState }, token: typed.server.revision }
            : undefined,
        }
      },
      fetchCurrent: async () => {
        const sessionId = imageSessionContextRef.current.canonicalSessionId
        if (!sessionId) throw { kind: 'validation', code: 'SESSION_REQUIRED' }
        const response = await fetch(`/api/image-generation-sessions/${sessionId}`)
        const data = await response.json().catch(() => ({}))
        if (!response.ok || typeof data.session?.revision !== 'number' || !data.session.workingState) {
          throw { kind: response.status >= 500 ? 'server' : 'network', code: data.code || `HTTP_${response.status}` }
        }
        return {
          snapshot: { workingPrompt: data.session.workingPrompt, workingState: data.session.workingState } as ImageAutosaveState,
          token: data.session.revision as number,
        }
      },
    }
  }

  const imageAutosave = useGenerationSessionAutosave({
    sessionKey: `image:${canonicalSessionId || 'hub'}`,
    initial: { snapshot: currentImageAutosaveState, token: null },
    adapter: imageAutosaveAdapterRef.current,
    canPersist: (_snapshot, token) => Boolean(canonicalSessionId && token !== null),
    debounceMs: 800,
  })
  const navigation = useGenerationSessionNavigation()

  useEffect(() => {
    if (!canonicalSessionId) return
    return navigation.register({
      sessionKey: `image:${canonicalSessionId}`,
      getState: () => imageAutosave.state,
      flush: async () => (await imageAutosave.controller.flush()).ok,
    })
  }, [canonicalSessionId, imageAutosave.controller, imageAutosave.state, navigation])

  const navigateSafely = (target: string) => {
    void navigation.runBeforeNavigate(target, () => router.push(target))
  }

  useEffect(() => {
    if (!canonicalWorkspace || !isDataReady) return
    imageAutosave.controller.setLocal(currentImageAutosaveState)
  }, [canonicalWorkspace, isDataReady, currentImageAutosaveState, imageAutosave.controller])

  useEffect(() => {
    if (!canonicalWorkspace) return
    const flushLifecycle = () => {
      if (document.visibilityState === 'hidden') void imageAutosave.controller.flushLifecycle()
    }
    document.addEventListener('visibilitychange', flushLifecycle)
    window.addEventListener('pagehide', flushLifecycle)
    return () => {
      document.removeEventListener('visibilitychange', flushLifecycle)
      window.removeEventListener('pagehide', flushLifecycle)
    }
  }, [canonicalWorkspace, imageAutosave.controller])

  // Evaluator state
  const [evaluatorEnabled, setEvaluatorEnabled] = useState(false)
  const [maxRefinements, setMaxRefinements] = useState(2)
  const [isEvaluating, setIsEvaluating] = useState(false)
  const [currentEvaluation, setCurrentEvaluation] = useState<ImageEvaluation | null>(null)
  const [generationAttempts, setGenerationAttempts] = useState<GenerationAttempt[]>([])

  // Refs para scroll automático
  const promptSectionRef = useRef<HTMLDivElement>(null)
  const resultSectionRef = useRef<HTMLDivElement>(null)

  const getDisplayUrlForImage = async (image: ImageType | null) => {
    if (!image) return null
    if (!image.storage_path) return image.image_url

    try {
      const response = await fetch(`/api/images/${image.id}/signed-url`)
      const payload = await response.json()
      return response.ok ? payload.imageUrl || image.image_url : image.image_url
    } catch {
      return image.image_url
    }
  }

  const isTemporarySignedUrl = (url: string | null | undefined) => {
    if (!url) return false

    return (
      url.includes('X-Amz-') ||
      url.includes('AWSAccessKeyId=') ||
      url.includes('Signature=')
    )
  }

  const getPersistableImageUrl = (url: string | null | undefined) => {
    if (!url || url.startsWith('data:') || isTemporarySignedUrl(url)) return null
    return url
  }

  const getDisplayUrlForStoredUrl = async (url: string | null | undefined) => {
    if (!url || url.startsWith('data:')) return null

    try {
      const response = await fetch('/api/storage/sign-image-path', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageUrl: url }),
      })
      const payload = await response.json()

      return response.ok ? payload.imageUrl || null : null
    } catch {
      return null
    }
  }

  const saveImageDraft = async () => {
    if (!userInput.trim() && !generatedPrompt.trim()) return null

    const draftName = userInput.split('\n')[0].trim().slice(0, 50) || 'Rascunho sem titulo'
    const safeImageUrl = getPersistableImageUrl(imageUrl)
    const safeGenerationAttempts = generationAttempts.map((attempt) => {
      const imageId = attempt.imageId || null

      return {
        ...attempt,
        imageId,
        imageUrl: imageId ? null : getPersistableImageUrl(attempt.imageUrl),
      }
    })
    const body: Record<string, unknown> = {
      id: currentDraftId,
      name: draftName,
      projectId: selectedProject,
      productionId,
      userInput,
      generatedPrompt: generatedPrompt || null,
      generatedPromptPt: generatedPromptPt || null,
      promptDetails,
      currentEvaluation,
      generationAttempts: safeGenerationAttempts,
      currentAttempt,
      imageStatus,
      autoMode,
      currentImageId: currentImage?.id || null,
      selectedModel,
    }

    if (safeImageUrl) {
      body.imageUrl = safeImageUrl
    }

    const response = await fetch('/api/image-drafts', {
      method: currentDraftId ? 'PATCH' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    const responseText = await response.text()
    let data: { draft?: ImageDraft; error?: string } = {}

    try {
      data = responseText ? JSON.parse(responseText) : {}
    } catch {
      data = { error: responseText || 'Resposta invalida do servidor' }
    }

    if (!response.ok) {
      throw new Error(data.error || 'Erro ao salvar rascunho')
    }

    return data.draft as ImageDraft
  }

  const applyCanonicalSessionState = async (session: any, attempts: any[]) => {
    const state = session.workingState || {}
    const imageIds = Array.from(new Set([
      session.currentImageId,
      ...attempts.map((attempt) => attempt.resultImageId),
    ].filter((id): id is string => typeof id === 'string' && id.length > 0)))
    const imageById = new Map<string, ImageType>()
    if (imageIds.length) {
      const supabase = createClient()
      const { data } = await supabase.from('images').select('*').in('id', imageIds)
      for (const image of data || []) imageById.set(image.id, image as ImageType)
    }
    const current = session.currentImageId ? imageById.get(session.currentImageId) || null : null
    setCurrentDraftId(null)
    setSelectedProject(session.projectId || null)
    setProductionId(session.productionId || null)
    setUserInput(session.workingPrompt || '')
    setGeneratedPrompt(state.generatedPrompt || '')
    setGeneratedPromptPt(state.generatedPromptPt || '')
    setPromptDetails(state.promptDetails || null)
    setAutoMode(Boolean(state.autoMode))
    if (state.selectedModel) setSelectedModel(normalizeImageModel(state.selectedModel))
    setCurrentAttempt(state.currentAttempt || 1)
    setImageStatus(state.imageStatus || 'draft')
    imageSourceReferencesRef.current = state.sourceReferences || []
    imageGenerationConfigRef.current = state.generationConfig || imageGenerationConfigRef.current
    setCurrentImage(current)
    setImageUrl(await getDisplayUrlForImage(current) || state.legacyImageUrl || null)
    setCurrentEvaluation(session.legacyCurrentEvaluation || null)
    const history = await Promise.all(attempts.map(async (attempt) => {
      const output = attempt.resultImageId ? imageById.get(attempt.resultImageId) || null : null
      return {
        id: attempt.id,
        attempt: attempt.sequence,
        prompt: attempt.submittedPrompt || '',
        imageUrl: await getDisplayUrlForImage(output),
        imageId: attempt.resultImageId || null,
        model: attempt.model || 'unknown',
        evaluation: attempt.legacyEvaluation || null,
        timestamp: attempt.submittedAt || attempt.createdAt,
      } as GenerationAttempt
    }))
    setGenerationAttempts(history)
    imageAutosave.controller.resetAcknowledged({
      workingPrompt: session.workingPrompt || '',
      workingState: state as ImageGenerationWorkingStateV1,
    }, session.revision)
    if (session.productionId) {
      fetch(`/api/productions/${session.productionId}`).then((r) => r.ok ? r.json() : null).then((payload) => {
        if (payload?.production) {
          setProductionTitle(payload.production.title || null)
          setProductionProjectId(payload.production.project_id || null)
        }
      }).catch(() => null)
    }
  }

  const reloadCanonicalSession = async () => {
    if (!canonicalSessionId) return
    const [sessionResponse, attemptsResponse] = await Promise.all([
      fetch(`/api/image-generation-sessions/${canonicalSessionId}`),
      fetch(`/api/image-generation-attempts?sessionId=${canonicalSessionId}`),
    ])
    const sessionPayload = await sessionResponse.json()
    const attemptsPayload = await attemptsResponse.json()
    if (sessionResponse.ok && attemptsResponse.ok && sessionPayload.session) {
      await applyCanonicalSessionState(sessionPayload.session, attemptsPayload.attempts || [])
    }
  }

  const refreshCanonicalExecution = async () => {
    if (!canonicalSessionId) return
    const response = await fetch(`/api/image-generation-attempts?sessionId=${canonicalSessionId}`)
    const payload = await response.json().catch(() => ({}))
    if (!response.ok || !Array.isArray(payload.attempts)) return
    const attempts = payload.attempts
    const imageIds = Array.from(new Set(
      attempts.map((attempt: any) => attempt.resultImageId).filter((id: unknown): id is string => typeof id === 'string' && id.length > 0),
    ))
    const imageById = new Map<string, ImageType>()
    if (imageIds.length) {
      const supabase = createClient()
      const { data } = await supabase.from('images').select('*').in('id', imageIds)
      for (const image of data || []) imageById.set(image.id, image as ImageType)
    }
    const history = await Promise.all(attempts.map(async (attempt: any) => {
      const output = attempt.resultImageId ? imageById.get(attempt.resultImageId) || null : null
      return {
        id: attempt.id,
        attempt: attempt.sequence,
        prompt: attempt.submittedPrompt || '',
        imageUrl: await getDisplayUrlForImage(output),
        imageId: attempt.resultImageId || null,
        model: attempt.model || 'unknown',
        evaluation: attempt.legacyEvaluation || null,
        timestamp: attempt.submittedAt || attempt.createdAt,
      } as GenerationAttempt
    }))
    setGenerationAttempts(history)
  }

  const applyDraftState = async (draft: ImageDraft) => {
    const draftAttempts = draft.generation_attempts || []
    const imageIds = Array.from(
      new Set(
        [
          draft.current_image_id,
          ...draftAttempts.map((attempt) => attempt.imageId),
        ].filter((id): id is string => typeof id === 'string' && id.length > 0),
      ),
    )
    let imageById = new Map<string, ImageType>()

    if (imageIds.length > 0) {
      const supabase = createClient()
      const { data: images } = await supabase
        .from('images')
        .select('*')
        .in('id', imageIds)

      imageById = new Map((images || []).map((image) => [image.id, image as ImageType]))
    }

    const currentDraftImage = draft.current_image_id ? imageById.get(draft.current_image_id) || null : null
    const currentDisplayUrl = await getDisplayUrlForImage(currentDraftImage)
    const signedAttempts = await Promise.all(
      draftAttempts.map(async (attempt) => {
        const attemptImage = attempt.imageId ? imageById.get(attempt.imageId) || null : null
        const historicalDisplayUrl = await getDisplayUrlForStoredUrl(attempt.imageUrl)
        const displayUrl = historicalDisplayUrl || await getDisplayUrlForImage(attemptImage)
        return {
          ...attempt,
          imageUrl: displayUrl || attempt.imageUrl || null,
        }
      }),
    )

    setPromptDetails(draft.prompt_details || null)
    setCurrentEvaluation(draft.current_evaluation || null)
    setGenerationAttempts(signedAttempts)
    setCurrentAttempt(draft.current_attempt || 1)
    setCurrentImage(currentDraftImage)
    setImageUrl(currentDisplayUrl || draft.image_url || null)
    setImageStatus(draft.image_status || 'draft')

    setCurrentDraftId(draft.id)
    setUserInput(draft.user_input)
    setSelectedProject(draft.project_id)
    if (draft.production_id && !productionId) {
      setProductionId(draft.production_id)
      // Fetch title and project for back button when loading a production-linked draft outside URL context
      fetch(`/api/productions/${draft.production_id}`)
        .then((r) => r.ok ? r.json() : null)
        .then((d) => {
          if (d?.production) {
            setProductionTitle(d.production.title || null)
            setProductionProjectId(d.production.project_id || null)
          }
        })
        .catch(() => null)
    }
    setGeneratedPrompt(draft.generated_prompt || '')
    setGeneratedPromptPt(draft.generated_prompt_pt || '')
    setAutoMode(draft.auto_mode)
    if (draft.selected_model) {
      setSelectedModel(normalizeImageModel(draft.selected_model))
    }
  }

  // Auto save do rascunho de imagem
  useEffect(() => {
    if (!isDataReady || canonicalWorkspace) return

    const autoSaveDraft = async () => {
      if (!productionId) return
      try {
        const draft = await saveImageDraft()

        if (draft) {
          setCurrentDraftId(draft.id)
          setDrafts((prev) => {
            const withoutCurrent = prev.filter((item) => item.id !== draft.id)
            return [draft, ...withoutCurrent].slice(0, 5)
          })
        }
      } catch (error) {
        console.error('[v0] Image auto-save error:', error)
      }
    }

    const timeoutId = window.setTimeout(autoSaveDraft, 800)

    const handleBeforeUnload = () => {
      autoSaveDraft()
    }

    window.addEventListener('beforeunload', handleBeforeUnload)

    return () => {
      window.clearTimeout(timeoutId)
      window.removeEventListener('beforeunload', handleBeforeUnload)
    }
  }, [
    userInput,
    generatedPrompt,
    generatedPromptPt,
    promptDetails,
    currentEvaluation,
    generationAttempts,
    currentAttempt,
    imageStatus,
    selectedProject,
    productionId,
    autoMode,
    imageUrl,
    selectedModel,
    currentDraftId,
    isDataReady,
    canonicalWorkspace,
  ])

  // Fetch projects and drafts on mount
  useEffect(() => {
    let cancelled = false
    setLoadError(null)

    const fetchData = async () => {
      // Apply URL params before any await so the banner and project selector
      // are visible even when subsequent async fetches fail.
      const projectId = canonicalWorkspace ? null : searchParams.get('project')
      const prodId = canonicalWorkspace ? null : searchParams.get('production')
      if (projectId) setSelectedProject(projectId)
      if (prodId) setProductionId(prodId)

      try {
        const supabase = createClient()

        const { data: projectsData } = await supabase
          .from('projects')
          .select('*')
          .order('created_at', { ascending: false })

        if (!cancelled && projectsData) setProjects(projectsData)

        const { data: productionsData } = await supabase
          .from('productions')
          .select('*')
          .order('updated_at', { ascending: false })

        if (!cancelled && productionsData) setProductions(productionsData)

        const { data: { user } } = await supabase.auth.getUser()
        if (!cancelled && user) {
          const { data: settingsData } = await supabase
            .from('user_settings')
            .select('automation_enabled, default_image_model, image_evaluator_enabled, max_refinement_iterations')
            .eq('user_id', user.id)
            .single()

          setAutomationEnabled(settingsData?.automation_enabled ?? false)
          const model = normalizeImageModel(settingsData?.default_image_model)
          setDefaultImageModel(model)
          setSelectedModel(model)
          setEvaluatorEnabled(settingsData?.image_evaluator_enabled ?? false)
          setMaxRefinements(settingsData?.max_refinement_iterations ?? 2)

          try {
            const providersResponse = await fetch('/api/settings/providers')
            if (providersResponse.ok) {
              const providersPayload = await providersResponse.json()
              if (!cancelled) {
                setOpenaiConfigured(providersPayload?.providers?.openai?.status === 'configured')
                setNanobananaConfigured(providersPayload?.providers?.nano_banana?.status === 'configured')
              }
            }
          } catch (providerStatusError) {
            console.error('[v0] Provider status load error:', providerStatusError)
          }
        }

        const draftsResponse = await fetch('/api/image-drafts?limit=50')
        const draftsPayload = await draftsResponse.json()

        if (!cancelled) {
          if (draftsResponse.ok) {
            setDrafts(draftsPayload.drafts || [])
          } else {
            console.error('[v0] Image drafts load error:', draftsPayload)
          }
        }
        const sessionsResponse = await fetch('/api/image-generation-sessions')
        const sessionsPayload = await sessionsResponse.json()
        if (!cancelled && sessionsResponse.ok) setSessions(sessionsPayload.sessions || [])

        if (canonicalSessionId && !cancelled) {
          const sessionResponse = await fetch(`/api/image-generation-sessions/${canonicalSessionId}`)
          const sessionPayload = await sessionResponse.json()
          if (!sessionResponse.ok || !sessionPayload.session) throw new Error(sessionPayload.error || 'Geração não encontrada')
          const attemptsResponse = await fetch(`/api/image-generation-attempts?sessionId=${canonicalSessionId}`)
          const attemptsPayload = await attemptsResponse.json()
          if (!attemptsResponse.ok) throw new Error(attemptsPayload.error || 'Histórico indisponível')
          await applyCanonicalSessionState(sessionPayload.session, attemptsPayload.attempts || [])
        }

        const draftId = searchParams.get('draft')
        if (draftId && !canonicalWorkspace && !cancelled) {
          const sessionLookup = await fetch(`/api/image-generation-sessions?legacyImageDraftId=${draftId}`)
          const sessionLookupPayload = await sessionLookup.json()
          if (sessionLookup.ok && sessionLookupPayload.sessions?.[0]) {
            router.replace(`/imagens/geracoes/${sessionLookupPayload.sessions[0].id}`)
          }
          const draftResponse = await fetch(`/api/image-drafts?id=${draftId}`)
          const draftPayload = await draftResponse.json()

          if (draftResponse.ok && draftPayload.draft && !cancelled) {
            await applyDraftState(draftPayload.draft as ImageDraft)
          } else if (!draftResponse.ok) {
            console.error('[v0] Image draft load error:', draftPayload)
          }
        }

        if (prodId && !cancelled) {
          const prodRes = await fetch(`/api/productions/${prodId}`)
          if (prodRes.ok && !cancelled) {
            const prodData = await prodRes.json()
            if (!cancelled) {
              setProductionTitle(prodData.production?.title || null)
              setProductionProjectId(prodData.production?.project_id || null)
            }
          }
        }

        if (!cancelled) setIsDataReady(true)
      } catch (err) {
        console.error('[v0] Image data load error:', err)
        if (!cancelled) {
          setLoadError('Não foi possível carregar os dados. Verifique sua conexão e tente novamente.')
        }
      } finally {
        if (!cancelled) setIsLoadingDrafts(false)
      }
    }

    fetchData()
    return () => { cancelled = true }
  }, [searchParams, retryKey, canonicalSessionId, canonicalWorkspace])

  // Save draft handler
  const handleSaveDraft = async () => {
    if (!userInput.trim() && !generatedPrompt.trim()) {
      toast({
        title: 'Conteudo obrigatorio',
        description: 'Por favor, insira uma descricao ou gere um prompt para salvar o rascunho.',
        variant: 'destructive',
      })
      return
    }

    if (!productionId) {
      toast({
        title: 'Production obrigatória',
        description: 'Acesse esta página a partir de uma Production para salvar o rascunho.',
        variant: 'destructive',
      })
      return
    }

    setIsSavingDraft(true)

    try {
      const draft = await saveImageDraft()

      if (draft) {
        setCurrentDraftId(draft.id)
        setDrafts((prev) => {
          const withoutCurrent = prev.filter((item) => item.id !== draft.id)
          return [draft, ...withoutCurrent].slice(0, 5)
        })
      }

      toast({
        title: currentDraftId ? 'Rascunho atualizado!' : 'Rascunho salvo!',
        description: currentDraftId
          ? 'As alterações foram salvas.'
          : 'Voce pode continuar editando mais tarde.',
      })
    } catch (error) {
      console.error('[v0] Image draft save error:', error)
      toast({
        title: 'Erro',
        description: 'Nao foi possivel salvar o rascunho.',
        variant: 'destructive',
      })
    } finally {
      setIsSavingDraft(false)
    }
  }

  const loadDraft = async (draft: ImageDraft) => {
    if (currentDraftId !== draft.id) {
      try {
        const savedDraft = await saveImageDraft()
        if (savedDraft) {
          setDrafts((prev) => {
            const withoutCurrent = prev.filter((item) => item.id !== savedDraft.id)
            return [savedDraft, ...withoutCurrent].slice(0, 5)
          })
        }
      } catch (error) {
        console.error('[v0] Image draft save before load error:', error)
      }
    }

    await applyDraftState(draft)

    toast({
      title: 'Rascunho carregado',
      description: 'O rascunho foi carregado para edição.',
    })
  }

  const resetImageForm = () => {
    setUserInput('')
    setGeneratedPrompt('')
    setGeneratedPromptPt('')
    setPromptDetails(null)
    setImageUrl(null)
    setCurrentImage(null)
    setCurrentDraftId(null)
    setAutoMode(false)
    setImageStatus('draft')
    // Reset evaluator state
    setCurrentEvaluation(null)
    setGenerationAttempts([])
    setCurrentAttempt(1)
    // Production context and project are preserved intentionally:
    // creating a new image within a Production keeps the workspace context.
  }

  const handleNewImage = async () => {
    if (canonicalWorkspace) {
      const response = await fetch('/api/image-generation-sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId: selectedProject,
          productionId,
          workingPrompt: '',
          workingState: {
            schemaVersion: 1, generatedPrompt: null, generatedPromptPt: null,
            promptDetails: null, autoMode: false, selectedModel,
            imageStatus: 'draft', currentAttempt: 1, currentImageId: null,
            sourceReferences: [],
            generationConfig: { size: '1024x1024', quality: 'medium', aspectRatio: '1:1', style: null, providerOptions: {} },
            legacyImageUrl: null,
          },
        }),
      })
      const payload = await response.json()
      if (response.ok && payload.session?.id) navigateSafely(`/imagens/geracoes/${payload.session.id}`)
      return
    }
    try {
      await saveImageDraft()
    } catch (error) {
      console.error('[v0] Image draft save before new image error:', error)
    }

    resetImageForm()
  }

  const updateGeneratedPrompt = (prompt: string) => {
    setGeneratedPrompt(prompt)
    setGeneratedPromptPt('')
    setPromptTranslationError(null)
  }

  const handleTranslatePrompt = async () => {
    if (!generatedPrompt.trim() || isTranslatingPrompt) return

    if (!openaiConfigured) {
      setPromptTranslationError('Tradução indisponível sem provedor configurado.')
      return
    }

    setIsTranslatingPrompt(true)
    setPromptTranslationError(null)

    try {
      const response = await fetch('/api/prompts/translate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: generatedPrompt }),
      })
      const data = await response.json()

      if (!response.ok) {
        if (data.code === 'PROMPT_PROVIDER_NOT_CONFIGURED') {
          setPromptTranslationError('Tradução indisponível sem provedor configurado.')
          return
        }

        throw new Error(data.error || 'Erro ao traduzir prompt')
      }

      setGeneratedPromptPt(data.translatedPrompt)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Nao foi possivel traduzir o prompt.'
      setPromptTranslationError(message)
      toast({
        title: 'Erro na traducao',
        description: message,
        variant: 'destructive',
      })
    } finally {
      setIsTranslatingPrompt(false)
    }
  }

  const normalizeImageModel = (model: string | null | undefined): ImageModel => {
    if (
      model === 'gpt-image-2' ||
      model === 'gpt-image-1.5' ||
      model === 'gpt-image-1' ||
      model === 'gpt-image-1-mini' ||
      model === 'nanobanana-v1' ||
      model === 'nanobanana-v2'
    ) {
      return model
    }

    return 'gpt-image-2'
  }

  const isOpenAIImageModel = (model: ImageModel) =>
    model === 'gpt-image-2' ||
    model === 'gpt-image-1.5' ||
    model === 'gpt-image-1' ||
    model === 'gpt-image-1-mini'

  // Evaluate image with AI
  const handleEvaluateImage = async () => {
    if (!imageUrl || !generatedPrompt) return

    setIsEvaluating(true)

    try {
      const selectedProjectData = projects.find(p => p.id === selectedProject)

      let projectIdentity: ProjectIdentity | null = null
      if (selectedProjectData) {
        try {
          projectIdentity = normalizeProjectIdentity(selectedProjectData.identity)
        } catch (err) {
          const detail = err instanceof ProjectIdentityParseError
            ? 'Os dados estruturados não correspondem ao schema V1.'
            : 'Erro inesperado ao ler a identidade.'
          toast({
            title: 'Identidade do Project inválida',
            description: `${detail} Acesse o Project e corrija a configuração de identidade antes de avaliar.`,
            variant: 'destructive',
          })
          setIsEvaluating(false)
          return
        }
      }

      const response = await fetch('/api/evaluate-image', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userInput,
          generatedPrompt,
          imageUrl,
          projectId: selectedProject,
          context: selectedProjectData?.context || null,
          evaluation_mode: selectedProjectData?.evaluation_mode || 'default',
          identity: projectIdentity,
          attempt: currentAttempt,
        }),
      })

      const evaluation = await response.json()

      if (!response.ok) {
        throw new Error(evaluation.error || 'Erro na avaliação')
      }

      setCurrentEvaluation(evaluation)

      // Attach evaluation to the generated image already present in history.
      setGenerationAttempts((prev) => {
        const existingIndex = currentImage?.id
          ? prev.findIndex((attempt) => attempt.imageId === currentImage.id)
          : -1
        const attemptNumber = existingIndex >= 0 ? prev[existingIndex].attempt : prev.length + 1
        const attemptRecord: GenerationAttempt = {
          id: currentImage?.id ? `attempt-${currentImage.id}` : `attempt-${Date.now()}`,
          attempt: attemptNumber,
          prompt: generatedPrompt,
          imageUrl,
          imageId: currentImage?.id || null,
          model: selectedModel,
          evaluation,
          timestamp: new Date().toISOString(),
        }

        if (existingIndex >= 0) {
          const next = [...prev]
          next[existingIndex] = {
            ...next[existingIndex],
            ...attemptRecord,
          }
          return next
        }

        return [...prev, attemptRecord]
      })

      toast({
        title: evaluation.approved ? 'Imagem aprovada!' : 'Sugestões de melhoria',
        description: evaluation.feedback,
      })

      // Scroll to result
      setTimeout(() => {
        resultSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
      }, 100)

    } catch (error) {
      console.error('[v0] Evaluation error:', error)
      toast({
        title: 'Erro na avaliação',
        description: error instanceof Error ? error.message : 'Erro desconhecido',
        variant: 'destructive',
      })
    } finally {
      setIsEvaluating(false)
    }
  }

  // Use refined prompt from evaluation
  const handleUseRefinedPrompt = (refinedPrompt: string) => {
    updateGeneratedPrompt(refinedPrompt)
    setCurrentEvaluation(null)
    setCurrentAttempt(prev => prev + 1)
    
    toast({
      title: 'Prompt atualizado',
      description: 'O prompt refinado foi aplicado. Clique em "Criar Imagem" para gerar.',
    })

    // Scroll to prompt section
    setTimeout(() => {
      promptSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }, 100)
  }

  // Unified image creation handler
  const handleCreateImageWithModel = async (model: ImageModel) => {
    if (isOpenAIImageModel(model)) {
      await handleCreateImage(undefined, model)
    } else {
      // NanoBanana V1 or V2
      await handleGenerateNanoBanana(model)
    }
  }

  const generateOpenAIImage = async (prompt: string, model: ImageModel, clientRequestId?: string) => {
    const response = await fetch('/api/openai/generate-image', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        prompt,
        model,
        size: '1024x1024',
        quality: 'medium',
        ...(canonicalSessionId && clientRequestId ? { sessionId: canonicalSessionId, clientRequestId } : {}),
      }),
    })

    const data = await response.json()

    if (!response.ok) {
      throw new Error(data.error || 'Erro na API da OpenAI')
    }

    if (!data.imageUrl) {
      throw new Error('A OpenAI nao retornou uma imagem')
    }

    return {
      imageUrl: data.imageUrl as string,
      publicUrl: data.publicUrl || null,
      thumbnailUrl: data.thumbnailUrl || null,
      storageProvider: data.storageProvider || null,
      storagePath: data.storagePath || null,
      thumbnailPath: data.thumbnailPath || null,
      fileSize: data.fileSize || null,
      mimeType: data.mimeType || null,
      image: data.image || null,
      attemptId: data.attemptId || null,
    } satisfies GeneratedImageResult
  }

  const imageSubmissionSnapshot = (prompt: string, model: ImageModel): ImageAutosaveState => ({
    workingPrompt: userInput,
    workingState: {
      ...currentImageAutosaveState.workingState,
      generatedPrompt: prompt,
      selectedModel: model,
    },
  })

  const flushImageSubmission = async (prompt: string, model: ImageModel) => {
    if (!canonicalSessionId) return true
    const result = await imageAutosave.controller.flushSnapshot(imageSubmissionSnapshot(prompt, model))
    if (!result.ok) {
      throw new Error(result.kind === 'conflict'
        ? 'Resolva o conflito de salvamento antes de gerar a imagem.'
        : 'Não foi possível salvar o estado antes da geração.')
    }
    return true
  }

  const saveGeneratedImageRecord = async (
    generatedImage: GeneratedImageResult,
    prompt: string,
    model: ImageModel,
    status: 'draft' | 'generating' | 'approved' | 'rejected' = 'draft',
    existingImageId?: string | null,
  ) => {
    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) throw new Error('Usuário não autenticado')

    const payload = {
      project_id: selectedProject,
      user_input: userInput,
      generated_prompt: prompt,
      image_url: generatedImage.publicUrl || generatedImage.imageUrl,
      thumbnail_url: generatedImage.thumbnailUrl || null,
      storage_provider: generatedImage.storageProvider || null,
      storage_path: generatedImage.storagePath || null,
      thumbnail_path: generatedImage.thumbnailPath || null,
      file_size: generatedImage.fileSize || null,
      mime_type: generatedImage.mimeType || null,
      status,
      model,
    }

    if (existingImageId) {
      const { data, error } = await supabase
        .from('images')
        .update(payload)
        .eq('id', existingImageId)
        .eq('user_id', user.id)
        .select()
        .single()

      if (error) throw error
      return data as ImageType
    }

    const { data, error } = await supabase
      .from('images')
      .insert({
        user_id: user.id,
        ...payload,
      })
      .select()
      .single()

    if (error) throw error
    return data as ImageType
  }

  const recordGenerationAttempt = (
    image: ImageType,
    displayUrl: string | null,
    prompt: string,
    model: ImageModel,
    evaluation: ImageEvaluation | null = null,
  ) => {
    setGenerationAttempts((prev) => {
      const existingIndex = prev.findIndex((attempt) => attempt.imageId === image.id)
      const attemptNumber = existingIndex >= 0 ? prev[existingIndex].attempt : prev.length + 1
      const attemptRecord: GenerationAttempt = {
        id: `attempt-${image.id}`,
        attempt: attemptNumber,
        prompt,
        imageUrl: displayUrl,
        imageId: image.id,
        model,
        evaluation,
        timestamp: new Date().toISOString(),
      }

      if (existingIndex >= 0) {
        const next = [...prev]
        next[existingIndex] = {
          ...next[existingIndex],
          ...attemptRecord,
          evaluation: evaluation || next[existingIndex].evaluation || null,
        }
        return next
      }

      return [...prev, attemptRecord]
    })
  }

  // Generate image with NanoBanana (via server route for security)
  const handleGenerateNanoBanana = async (
    model: ImageModel = selectedModel,
    promptOverride?: string,
  ) => {
    // Usar generatedPrompt se disponível, senão userInput como fallback
    const promptToUse = promptOverride?.trim() || generatedPrompt.trim() || userInput.trim()
    
    if (!promptToUse) {
      toast({
        title: 'Prompt obrigatório',
        description: 'Digite uma descrição ou gere um prompt antes de criar a imagem.',
        variant: 'destructive',
      })
      return
    }

    if (!nanobananaConfigured) {
      toast({
        title: 'API Key não configurada',
        description: 'Configure sua API Key do NanoBanana em Configurações > API.',
        variant: 'destructive',
      })
      return
    }

    setIsGeneratingNanoBanana(true)
    setImageStatus('generating')

    try {
      // Determinar versão do modelo
      const modelVersion = model === 'nanobanana-v2' ? 'v2' : 'v1'
      
      // 1. Enviar requisição para gerar (retorna taskId)
      if (canonicalSessionId) {
        await flushImageSubmission(promptToUse, model)
        setGeneratedPrompt(promptToUse)
        setSelectedModel(model)
      }
      // The legacy route contract was `canonicalSessionId ? crypto.randomUUID() : undefined`;
      // the stable ref below keeps retries tied to one logical submission.
      const clientRequestId = canonicalSessionId ? imageClientRequestIdRef.current : undefined
      const response = await fetch('/api/nanobanana/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: promptToUse,
          aspectRatio: '1:1',
          projectId: selectedProject,
          model: modelVersion,
          ...(canonicalSessionId && clientRequestId ? { sessionId: canonicalSessionId, clientRequestId } : {}),
        }),
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || 'Erro na API NanoBanana')
      }

      const taskId = data.taskId
      if (!taskId) {
        throw new Error('TaskId não retornado')
      }

      toast({
        title: 'Gerando imagem...',
        description: 'Aguarde enquanto a imagem é processada.',
      })

      // 2. Polling para verificar status
      const maxAttempts = 60 // 5 minutos (60 x 5s)
      let attempts = 0

      const pollStatus = async (): Promise<void> => {
        attempts++
        
        const statusRes = await fetch(`/api/nanobanana/status/${taskId}`)
        const statusData = await statusRes.json()

        if (statusData.status === 'completed' && statusData.imageUrl) {
          if (canonicalSessionId && statusData.image) {
            setCurrentImage(statusData.image as ImageType)
            setImageUrl(statusData.imageUrl)
            setImageStatus('draft')
            await refreshCanonicalExecution()
            imageClientRequestIdRef.current = crypto.randomUUID()
            setIsGeneratingNanoBanana(false)
            toast({ title: 'Imagem gerada!', description: 'Sua imagem foi criada com sucesso.' })
            return
          }
          const storageResponse = await fetch('/api/storage/upload-image', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              imageUrl: statusData.imageUrl,
              folder: 'images',
            }),
          })
          const storageData = storageResponse.ok ? await storageResponse.json() : null
          const storedDisplayUrl = storageData?.imageUrl || statusData.imageUrl
          const storedPublicUrl = storageData?.publicUrl || storageData?.imageUrl || statusData.imageUrl
          const savedImage = await saveGeneratedImageRecord(
            {
              imageUrl: storedDisplayUrl,
              publicUrl: storedPublicUrl,
              thumbnailUrl: storageData?.thumbnailUrl || null,
              storageProvider: storageData?.storageProvider || null,
              storagePath: storageData?.storagePath || null,
              thumbnailPath: storageData?.thumbnailPath || null,
              fileSize: storageData?.fileSize || null,
              mimeType: storageData?.mimeType || null,
            },
            promptToUse,
            model,
          )

          setCurrentImage(savedImage)
          setImageUrl(storedDisplayUrl)
          setImageStatus('draft')
          recordGenerationAttempt(savedImage, storedDisplayUrl, promptToUse, model)
          setIsGeneratingNanoBanana(false)
          toast({
            title: 'Imagem gerada!',
            description: 'Sua imagem foi criada com sucesso.',
          })
          // Scroll automático para o resultado
          setTimeout(() => {
            resultSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
          }, 100)
          return
        }

        if (statusData.status === 'failed') {
          throw new Error(statusData.errorMessage || 'Erro na geração')
        }

        if (attempts >= maxAttempts) {
          throw new Error('Tempo limite excedido')
        }

        // Continuar polling
        await new Promise(resolve => setTimeout(resolve, 5000))
        return pollStatus()
      }

      await pollStatus()

    } catch (error) {
      console.error('[v0] NanoBanana generation error:', error)
      setImageStatus('draft')
      setIsGeneratingNanoBanana(false)
      toast({
        title: 'Erro na geração',
        description: error instanceof Error ? error.message : 'Erro na API NanoBanana',
        variant: 'destructive',
      })
    }
  }

  // Generate prompt handler
  const handleGeneratePrompt = async () => {
    if (!userInput.trim()) return

    setIsGeneratingPrompt(true)

    try {
      // Get project context and identity if a project is selected
      let projectContext: string | null = null
      let evaluationMode: 'default' | 'conceptual' | 'aesthetic' | 'commercial' | 'experimental' = 'default'
      let projectIdentity: ProjectIdentity | null = null

      if (selectedProject) {
        const project = projects.find(p => p.id === selectedProject)
        if (project) {
          projectContext = project.context
          evaluationMode = project.evaluation_mode || 'default'

          // Normalize identity — invalid identity blocks generation to avoid silent data loss
          try {
            projectIdentity = normalizeProjectIdentity(project.identity)
          } catch (err) {
            const detail = err instanceof ProjectIdentityParseError
              ? 'Os dados estruturados não correspondem ao schema V1.'
              : 'Erro inesperado ao ler a identidade.'
            toast({
              title: 'Identidade do Project inválida',
              description: `${detail} Acesse o Project e corrija a configuração de identidade antes de gerar prompts.`,
              variant: 'destructive',
            })
            return
          }
        }
      }

      const promptResponse = await fetch('/api/prompts/generate-image-prompt', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userInput,
          projectContext,
          evaluationMode,
          identity: projectIdentity,
        }),
      })
      const promptPayload = await promptResponse.json()

      if (!promptResponse.ok) {
        throw new PromptGenerationError(
          promptPayload?.code || 'PROMPT_PROVIDER_FAILED',
          promptPayload?.message || 'Não foi possível gerar o prompt agora. Verifique a configuração do provedor ou tente novamente.',
          promptResponse.status,
        )
      }

      const result: PromptGenerationResult = promptPayload

      updateGeneratedPrompt(result.prompt)
      setPromptDetails({
        style: result.style,
        lighting: result.lighting,
        composition: result.composition,
      })

      // Save prompt to database
      const supabase = createClient()
      const { data: { user } } = await supabase.auth.getUser()
      
      if (user) {
        await supabase.from('prompts').insert({
          user_id: user.id,
          original_input: userInput,
          generated_prompt: result.prompt,
          type: 'image',
        })
      }

      toast({
        title: 'Prompt gerado!',
        description: 'O prompt foi criado com sucesso. Você pode editá-lo antes de criar a imagem.',
      })

      // Scroll automático para a seção do prompt
      setTimeout(() => {
        promptSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
      }, 100)

      // If auto mode AND automation enabled, automatically create image with default model
      if (autoMode && automationEnabled) {
        await handleCreateImageWithModel(defaultImageModel)
      } else if (autoMode) {
        await handleCreateImage(result.prompt, selectedModel)
      }
    } catch (error) {
      const promptError = error instanceof PromptGenerationError ? error : null
      toast({
        title: promptError?.code === 'PROMPT_PROVIDER_NOT_CONFIGURED'
          ? 'Provedor de IA necessario'
          : 'Erro ao gerar prompt',
        description: promptError?.message || 'Nao foi possivel gerar o prompt agora. Verifique a configuracao do provedor ou tente novamente.',
        variant: 'destructive',
      })
    } finally {
      setIsGeneratingPrompt(false)
    }
  }

  // Create image handler
  const handleCreateImage = async (
    promptOverride?: string,
    model: ImageModel = selectedModel,
  ) => {
    const prompt = promptOverride || generatedPrompt
    if (!prompt.trim()) return

    setIsCreatingImage(true)
    setImageStatus('generating')

    try {
      const supabase = createClient()
      const { data: { user } } = await supabase.auth.getUser()
      
      if (!user) throw new Error('Usuário não autenticado')

      if (canonicalSessionId) {
        await flushImageSubmission(prompt, model)
        setGeneratedPrompt(prompt)
        setSelectedModel(model)
        const generatedImage = await generateOpenAIImage(prompt, model, imageClientRequestIdRef.current)
        if (!generatedImage.image) throw new Error('Canonical attempt did not return an image.')
        setCurrentImage(generatedImage.image)
        setImageUrl(generatedImage.imageUrl)
        setImageStatus('draft')
        await refreshCanonicalExecution()
        imageClientRequestIdRef.current = crypto.randomUUID()
        toast({ title: 'Imagem criada!', description: 'A imagem foi gerada com sucesso.' })
        return
      }

      // Create image record in database
      const { data: imageData, error: insertError } = await supabase
        .from('images')
        .insert({
          user_id: user.id,
          project_id: selectedProject,
          user_input: userInput,
          generated_prompt: prompt,
          status: 'generating',
          model,
        })
        .select()
        .single()

      if (insertError) throw insertError

      // Generate image with OpenAI through the server route, keeping the API key private.
      const generatedImage = await generateOpenAIImage(prompt, model)
      const updatedImage = await saveGeneratedImageRecord(
        generatedImage,
        prompt,
        model,
        'draft',
        imageData.id,
      )

      const displayImageUrl = generatedImage.imageUrl
      setCurrentImage(updatedImage)
      setImageUrl(displayImageUrl)
      setImageStatus('draft')
      recordGenerationAttempt(updatedImage, displayImageUrl, prompt, model)

      toast({
        title: 'Imagem criada!',
        description: 'A imagem foi gerada com sucesso.',
      })
    } catch (error) {
      setImageStatus('draft')
      toast({
        title: 'Erro',
        description: error instanceof Error ? error.message : 'Nao foi possivel criar a imagem. Tente novamente.',
        variant: 'destructive',
      })
    } finally {
      setIsCreatingImage(false)
    }
  }

  // Regenerate handler
  const handleRegenerate = async () => {
    setIsRegenerating(true)
    setImageStatus('generating')

    try {
      // Regenerate prompt with variations
      const result = await regeneratePrompt(generatedPrompt)
      updateGeneratedPrompt(result.prompt)
      setPromptDetails({
        style: result.style,
        lighting: result.lighting,
        composition: result.composition,
      })

      // Generate new image
      if (!isOpenAIImageModel(selectedModel)) {
        await handleGenerateNanoBanana(selectedModel, result.prompt)
        return
      }

      if (canonicalSessionId) {
        await flushImageSubmission(result.prompt, selectedModel)
        setGeneratedPrompt(result.prompt)
        setSelectedModel(selectedModel)
        const generatedImage = await generateOpenAIImage(result.prompt, selectedModel, imageClientRequestIdRef.current)
        if (!generatedImage.image) throw new Error('Canonical attempt did not return an image.')
        setCurrentImage(generatedImage.image)
        setImageUrl(generatedImage.imageUrl)
        setImageStatus('draft')
        await refreshCanonicalExecution()
        imageClientRequestIdRef.current = crypto.randomUUID()
        toast({ title: 'Imagem regenerada!', description: 'Uma nova variação foi criada.' })
        return
      }

      const generatedImage = await generateOpenAIImage(result.prompt, selectedModel)

      const savedImage = await saveGeneratedImageRecord(
        generatedImage,
        result.prompt,
        selectedModel,
      )

      setCurrentImage(savedImage)
      setImageUrl(generatedImage.imageUrl)
      setImageStatus('draft')
      recordGenerationAttempt(savedImage, generatedImage.imageUrl, result.prompt, selectedModel)

      toast({
        title: 'Imagem regenerada!',
        description: 'Uma nova variação foi criada.',
      })
    } catch (error) {
      setImageStatus('draft')
      toast({
        title: 'Erro',
        description: error instanceof Error ? error.message : 'Nao foi possivel regenerar a imagem. Tente novamente.',
        variant: 'destructive',
      })
    } finally {
      setIsRegenerating(false)
    }
  }

  // Approve handler
  const handleApprove = async () => {
    if (!imageUrl) return

    setIsApproving(true)

    try {
      const supabase = createClient()
      const { data: { user } } = await supabase.auth.getUser()
      
      if (!user) throw new Error('UsuÃ¡rio nÃ£o autenticado')

      if (currentImage) {
        const { data: approvedImage } = await supabase
          .from('images')
          .update({ status: 'approved' })
          .eq('id', currentImage.id)
          .select()
          .single()

        if (approvedImage) setCurrentImage(approvedImage)
      } else {
        const { data: approvedImage } = await supabase
          .from('images')
          .insert({
            user_id: user.id,
            project_id: selectedProject,
            user_input: userInput,
            generated_prompt: generatedPrompt || null,
            image_url: imageUrl,
            status: 'approved',
            model: selectedModel,
          })
          .select()
          .single()

        if (approvedImage) setCurrentImage(approvedImage)
      }

      setImageStatus('approved')

      toast({
        title: 'Imagem aprovada!',
        description: 'A imagem foi marcada como aprovada e salva na galeria.',
      })
    } catch (error) {
      toast({
        title: 'Erro',
        description: 'Não foi possível aprovar a imagem. Tente novamente.',
        variant: 'destructive',
      })
    } finally {
      setIsApproving(false)
    }
  }

  const requestedDraftId = searchParams.get('draft')
  const selectedProjectData = selectedProject
    ? projects.find((project) => project.id === selectedProject) ?? null
    : null
  let imageIdentity: ProjectIdentity | null = null
  let imageIdentityReadError = false

  try {
    imageIdentity = normalizeProjectIdentity(selectedProjectData?.identity ?? null)
  } catch {
    imageIdentityReadError = true
  }

  const imageIdentitySummary = resolveInheritedIdentitySummary({
    identity: imageIdentity,
    projectName: selectedProjectData?.name,
    hasLegacyContext: !!selectedProjectData?.context?.trim(),
    readError: imageIdentityReadError,
    isLoading: !isDataReady,
  })
  const projectIdentityHref = selectedProjectData
    ? `/projetos/${selectedProjectData.id}#project-identity`
    : undefined
  const productionHref =
    productionId && (productionProjectId || selectedProject)
      ? `/projetos/${productionProjectId || selectedProject}/producoes/${productionId}`
      : undefined
  const hubCards = buildImageDraftHubCards({ drafts, projects, productions })
  const hubFilteredProductions = hubProjectFilter === 'all'
    ? productions
    : productions.filter((production) => production.project_id === hubProjectFilter)
  const filteredHubCards = filterDraftHubCards(hubCards, {
    projectId: hubProjectFilter,
    productionId: hubProductionFilter,
    status: hubStatusFilter,
    search: hubSearch,
  })
  const hasHubFilters = hubProjectFilter !== 'all' || hubProductionFilter !== 'all' || hubStatusFilter !== 'all' || !!hubSearch.trim()
  const hubEmptyState = getDraftHubEmptyState({
    kind: 'image',
    projectCount: projects.length,
    productionCount: productions.length,
    totalDraftCount: hubCards.length,
    filteredDraftCount: filteredHubCards.length,
    hasFilters: hasHubFilters,
    hasError: !!loadError,
  })
  const hubCreateProductions = getProductionsForProject(productions, hubCreateProjectId)
  const openImageWorkspace = async () => {
    if (!hubCreateProjectId || !hubCreateProductionId) return
    const response = await fetch('/api/image-generation-sessions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        projectId: hubCreateProjectId,
        productionId: hubCreateProductionId,
        workingPrompt: '',
        workingState: {
          schemaVersion: 1, generatedPrompt: null, generatedPromptPt: null,
          promptDetails: null, autoMode: false, selectedModel,
          imageStatus: 'draft', currentAttempt: 1, currentImageId: null,
          sourceReferences: [],
          generationConfig: { size: '1024x1024', quality: 'medium', aspectRatio: '1:1', style: null, providerOptions: {} },
          legacyImageUrl: null,
        },
      }),
    })
    const payload = await response.json()
    if (!response.ok || !payload.session?.id) {
      toast({ title: 'Erro', description: payload.error || 'Não foi possível abrir a geração.', variant: 'destructive' })
      return
    }
    router.push(`/imagens/geracoes/${payload.session.id}`)
  }
  const clearHubFilters = () => {
    setHubProjectFilter('all')
    setHubProductionFilter('all')
    setHubStatusFilter('all')
    setHubSearch('')
  }
  const renderImageHub = () => (
    <div className="space-y-6">
      <section className="rounded-xl border border-border/50 bg-card/30 p-6 backdrop-blur-sm">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <ImageIcon className="h-5 w-5 text-cyan-300" />
              <p className="text-sm font-medium text-foreground">Criação contextual</p>
            </div>
            <p className="max-w-2xl text-sm text-muted-foreground">
              Entre no workspace com Project e Production definidos antes de gerar novas imagens.
            </p>
          </div>
          <div className="w-full rounded-lg border border-border/50 bg-background/40 p-4 lg:max-w-md">
            <h2 className="text-base font-semibold text-foreground">Criar nova imagem</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              Escolha o Project e a Production para abrir o workspace contextual.
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              A identidade do Project sera aplicada a geracao e a avaliacao.
            </p>
            <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-1">
              <div className="space-y-2">
                <Label htmlFor="image-hub-project">Project</Label>
                <Select
                  value={hubCreateProjectId}
                  onValueChange={(value) => {
                    setHubCreateProjectId(value)
                    setHubCreateProductionId('')
                  }}
                >
                  <SelectTrigger id="image-hub-project" className="bg-background/50">
                    <SelectValue placeholder="Selecione um Project" />
                  </SelectTrigger>
                  <SelectContent>
                    {projects.map((project) => (
                      <SelectItem key={project.id} value={project.id}>
                        {project.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="image-hub-production">Production</Label>
                <Select
                  value={hubCreateProductionId}
                  onValueChange={setHubCreateProductionId}
                  disabled={!hubCreateProjectId || hubCreateProductions.length === 0}
                >
                  <SelectTrigger id="image-hub-production" className="bg-background/50">
                    <SelectValue placeholder="Selecione uma Production" />
                  </SelectTrigger>
                  <SelectContent>
                    {hubCreateProductions.map((production) => (
                      <SelectItem key={production.id} value={production.id}>
                                {getDraftHubProductionLabel(production, projects)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            {hubCreateProjectId && hubCreateProductions.length === 0 && (
              <p className="mt-3 text-xs text-amber-200">
                Este Project ainda nao possui Production. Crie uma Production antes de iniciar uma imagem.
              </p>
            )}
            <Button
              className="mt-4 w-full text-[rgb(58_58_72)] disabled:text-[rgb(102_102_118)]"
              onClick={openImageWorkspace}
              disabled={!hubCreateProjectId || !hubCreateProductionId}
            >
              Criar na Production
            </Button>
          </div>
        </div>
      </section>

      <section className="space-y-4" aria-labelledby="image-generation-sessions">
        <div>
          <h2 id="image-generation-sessions" className="text-lg font-semibold text-foreground">Gerações recentes</h2>
          <p className="text-sm text-muted-foreground">Continue uma geração salva pelo novo workspace.</p>
        </div>
        {sessions.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border/50 bg-card/30 p-6 text-sm text-muted-foreground">Nenhuma geração iniciada ainda.</div>
        ) : (
          <div className="space-y-2">
            {sessions.slice(0, 20).map((session) => {
              const project = projects.find((item) => item.id === session.projectId)
              const production = productions.find((item) => item.id === session.productionId)
              return <Card key={session.id} className="border-border/50 bg-card/30">
                <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{session.workingPrompt || session.name || 'Geração sem descrição'}</p>
                    <p className="text-xs text-muted-foreground">{project?.name || 'Sem Project'} · {production?.title || 'Sem Production'} · {new Date(session.updatedAt).toLocaleDateString('pt-BR')}</p>
                  </div>
                  <Button size="sm" onClick={() => router.push(`/imagens/geracoes/${session.id}`)} className="gap-1">Continuar <ChevronRight className="h-4 w-4" /></Button>
                </CardContent>
              </Card>
            })}
          </div>
        )}
      </section>

      <section className="space-y-4" aria-labelledby="image-draft-filters">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2 id="image-draft-filters" className="text-lg font-semibold text-foreground">
              Rascunhos recentes
            </h2>
            <p className="text-sm text-muted-foreground">
              Retome trabalhos no Project e na Production corretos.
            </p>
          </div>
          <ViewModeToggle value={hubViewMode} onValueChange={setHubViewMode} />
        </div>

        <div className="grid gap-3 rounded-xl border border-border/50 bg-card/30 p-4 sm:grid-cols-2 lg:grid-cols-4">
          <div className="space-y-2">
            <Label htmlFor="image-filter-search">Buscar</Label>
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                id="image-filter-search"
                value={hubSearch}
                onChange={(event) => setHubSearch(event.target.value)}
                placeholder="Titulo, Project ou Production"
                className="bg-background/50 pl-9"
              />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="image-filter-project">Project</Label>
            <Select
              value={hubProjectFilter}
              onValueChange={(value) => {
                setHubProjectFilter(value)
                setHubProductionFilter('all')
              }}
            >
              <SelectTrigger id="image-filter-project" className="bg-background/50">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos os Projects</SelectItem>
                {projects.map((project) => (
                  <SelectItem key={project.id} value={project.id}>
                    {project.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="image-filter-production">Production</Label>
            <Select value={hubProductionFilter} onValueChange={setHubProductionFilter}>
              <SelectTrigger id="image-filter-production" className="bg-background/50">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todas as Productions</SelectItem>
                {hubFilteredProductions.map((production) => (
                  <SelectItem key={production.id} value={production.id}>
                            {getDraftHubProductionLabel(production, projects)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="image-filter-status">Status</Label>
            <Select value={hubStatusFilter} onValueChange={setHubStatusFilter}>
              <SelectTrigger id="image-filter-status" className="bg-background/50">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos os status</SelectItem>
                <SelectItem value="Rascunho">Rascunho</SelectItem>
                <SelectItem value="Gerando">Gerando</SelectItem>
                <SelectItem value="Aprovada">Aprovada</SelectItem>
                <SelectItem value="Rejeitada">Rejeitada</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        {hubEmptyState ? (
          <div className="rounded-xl border border-dashed border-border/50 bg-card/30 p-10 text-center">
            <h3 className="text-lg font-semibold text-foreground">{hubEmptyState.title}</h3>
            <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">
              {hubEmptyState.description}
            </p>
            {hubEmptyState.kind === 'no-filter-results' ? (
              <Button className="mt-4" variant="outline" onClick={clearHubFilters}>
                Limpar filtros
              </Button>
            ) : hubEmptyState.href && hubEmptyState.actionLabel ? (
              <Button className="mt-4" onClick={() => router.push(hubEmptyState.href!)}>
                {hubEmptyState.actionLabel}
              </Button>
            ) : null}
          </div>
        ) : hubViewMode === 'list' ? (
          <div role="list" className="space-y-2">
              {filteredHubCards.map((draft) => (
                <Card
                  key={draft.id}
                  role="listitem"
                  className="border-border/50 bg-card/30 transition-colors hover:border-border hover:bg-card/50"
                >
                  <CardContent className="grid gap-3 p-4 md:grid-cols-[minmax(0,1fr)_auto] md:items-start">
                    <div className="min-w-0 space-y-3">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <ImageIcon className="h-4 w-4 shrink-0 text-cyan-300" aria-hidden="true" />
                          <CardTitle className="truncate text-sm" title={draft.title}>
                            {draft.title}
                          </CardTitle>
                        </div>
                        <p className="mt-1 text-xs text-muted-foreground">{draft.meta}</p>
                      </div>
                      <ContextMetadata
                        dense
                        items={[
                          { label: 'Project', value: draft.projectName, title: draft.projectName },
                          { label: 'Production', value: draft.productionName || 'Sem Production associada', title: draft.productionName || 'Sem Production associada' },
                          { label: 'Status', value: <StatusBadge label={draft.status} tone={draft.status === 'Aprovada' ? 'positive' : draft.status === 'Gerando' ? 'warning' : draft.status === 'Rejeitada' ? 'danger' : 'neutral'} /> },
                          { label: 'Atualizado', value: new Date(draft.updatedAt).toLocaleDateString('pt-BR') },
                        ]}
                      />
                    </div>
                    <CardActions className="flex flex-wrap gap-2 md:justify-end">
                      <Button size="sm" onClick={() => router.push(draft.href)} className="gap-1">
                        Abrir
                        <ChevronRight className="h-4 w-4" />
                      </Button>
                      {draft.productionHref && (
                        <Button size="sm" variant="outline" onClick={() => router.push(draft.productionHref!)}>
                          Ver Production
                        </Button>
                      )}
                    </CardActions>
                  </CardContent>
                </Card>
              ))}
          </div>
        ) : (
          <div className="grid gap-4 md:grid-cols-2">
            {filteredHubCards.map((draft) => (
              <Card key={draft.id} className="border-border/50 bg-card/30 backdrop-blur-sm">
                <CardContent className="space-y-4 p-4">
                  <div className="flex items-start gap-3">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-cyan-500/15">
                      <ImageIcon className="h-5 w-5 text-cyan-300" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <CardTitle className="line-clamp-2 text-base" title={draft.title}>
                        {draft.title}
                      </CardTitle>
                      <p className="mt-1 text-xs text-muted-foreground">{draft.meta}</p>
                    </div>
                  </div>
                  <ContextMetadata
                    dense
                    items={[
                      { label: 'Project', value: draft.projectName, title: draft.projectName },
                      { label: 'Production', value: draft.productionName || 'Sem Production associada', title: draft.productionName || 'Sem Production associada' },
                      { label: 'Status', value: <StatusBadge label={draft.status} tone={draft.status === 'Aprovada' ? 'positive' : draft.status === 'Gerando' ? 'warning' : draft.status === 'Rejeitada' ? 'danger' : 'neutral'} /> },
                      { label: 'Atualizado', value: new Date(draft.updatedAt).toLocaleString('pt-BR') },
                    ]}
                  />
                  <CardActions className="flex flex-wrap gap-2">
                    <Button onClick={() => router.push(draft.href)} className="gap-2">
                      Abrir
                      <ChevronRight className="h-4 w-4" />
                    </Button>
                    {draft.productionHref && (
                      <Button variant="outline" onClick={() => router.push(draft.productionHref!)}>
                        Ver Production
                      </Button>
                    )}
                  </CardActions>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </section>
    </div>
  )

  return (
    <DashboardPage>
      {canonicalWorkspace && (
        <DashboardPageBar>
          <div className="flex items-center gap-3">
          <Button
            variant="ghost"
            size="sm"
            className="gap-2 text-muted-foreground hover:text-foreground"
            onClick={() => {
              const projId = productionProjectId || selectedProject
              if (projId && productionId) {
                navigateSafely(`/projetos/${projId}/producoes/${productionId}`)
              } else {
                navigateSafely('/imagens')
              }
            }}
          >
            <ArrowLeft className="h-4 w-4" />
            Voltar para a Produção
          </Button>
          {productionTitle && (
            <span className="text-sm text-muted-foreground">
              · {productionTitle}
            </span>
          )}
          </div>
          <SessionSaveStatus
            state={imageAutosave.state}
            onRetry={() => void imageAutosave.controller.retry()}
            onReloadServer={() => void imageAutosave.controller.resolveConflict('reload_server')}
            onKeepLocal={() => void imageAutosave.controller.resolveConflict('keep_local')}
            onDiscardLocal={() => void imageAutosave.controller.resolveConflict('discard_local')}
          />
        </DashboardPageBar>
      )}
      <DashboardPageContent width="4xl" className="space-y-6">
          {!canonicalWorkspace && (
            <PageHeader
              context="Criação"
              title="Imagens"
              description="Crie uma nova imagem dentro de uma Production ou retome um rascunho existente."
            />
          )}

          {loadError && (
            <StateMessage
              tone="error"
              title="Não foi possível carregar os dados de imagem"
              description={loadError}
              actionLabel="Tentar novamente"
              onAction={() => setRetryKey((k) => k + 1)}
              compact
            />
          )}
          {/* Drafts Section */}
          {!canonicalWorkspace && productionId && !isLoadingDrafts && drafts.length > 0 && (
            <Card className="border-border/50 bg-card/30 backdrop-blur-sm">
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <FileText className="h-5 w-5 text-muted-foreground" />
                    <CardTitle className="text-base">Rascunhos</CardTitle>
                    <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                      {drafts.length}
                    </span>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => router.push('/imagens/rascunhos')}
                    className="gap-1 text-sm"
                  >
                    Ver todos
                    <ChevronRight className="h-4 w-4" />
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="pt-0">
                <div className="flex gap-2 overflow-x-auto pb-2">
                  {drafts.slice(0, 3).map((draft) => (
                    <button
                      key={draft.id}
                      type="button"
                      onClick={() => loadDraft(draft)}
                      className="flex min-w-[180px] flex-col rounded-lg border border-[var(--control-border)] bg-[var(--control-background)] p-3 text-left shadow-elevation-low transition-[background-color,border-color,box-shadow] hover:border-[var(--control-border-hover)] hover:bg-[var(--control-background-hover)] focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-[color:var(--control-focus)]"
                    >
                      <span className="font-medium text-foreground line-clamp-1">
                        {draft.name || draft.user_input.split('\n')[0].slice(0, 30)}
                      </span>
                      <span className="mt-1 text-xs text-muted-foreground line-clamp-1">
                        {draft.generated_prompt ? 'Prompt gerado' : 'Sem prompt'}
                      </span>
                    </button>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {loadError ? null : !isDataReady ? (
            <div className="flex flex-col items-center justify-center rounded-xl border border-border/50 bg-card/30 p-12 text-center">
              <Loader2 className="mb-3 h-8 w-8 animate-spin text-muted-foreground" />
              <h3 className="text-lg font-semibold text-foreground">
                {draftLoadingMessage('image', !!requestedDraftId)}
              </h3>
            </div>
          ) : !canonicalWorkspace ? (
            renderImageHub()
          ) : (
            <>
              {selectedProjectData && (
                <WorkspaceIdentityContext
                  surface="image"
                  summary={imageIdentitySummary}
                  productionTitle={productionTitle}
                  projectHref={projectIdentityHref}
                  productionHref={productionHref}
                />
              )}
              {!openaiConfigured && (
                <StateMessage
                  tone="info"
                  title="Provider de prompt não configurado"
                  description="A geração e a tradução de prompt por IA, a avaliação e a geração de imagem com modelos OpenAI exigem uma chave válida da OpenAI em Configurações."
                  actionLabel="Abrir Configurações"
                  onAction={() => router.push('/configuracoes?tab=api')}
                  compact
                />
              )}
              {!nanobananaConfigured && (
                <StateMessage
                  tone="info"
                  title="NanoBanana indisponível neste workspace"
                  description="Você ainda pode criar imagens com os modelos já disponíveis. Configure a chave NanoBanana apenas se quiser esse provider."
                  actionLabel="Ver API"
                  onAction={() => router.push('/configuracoes?tab=api')}
                  compact
                />
              )}

              {/* Current Draft Indicator */}
              {currentDraftId && (
                <div className="flex items-center justify-between rounded-lg border border-violet-500/30 bg-violet-500/10 px-4 py-2">
                  <span className="text-sm text-violet-300">
                    Editando rascunho
                  </span>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={handleNewImage}
                    className="text-violet-300 hover:text-violet-200"
                  >
                    Limpar e criar novo
                  </Button>
                </div>
              )}

              {/* Input Section */}
              <ImageInputSection
                projects={projects}
                userInput={userInput}
                setUserInput={setUserInput}
                selectedProject={selectedProject}
                setSelectedProject={setSelectedProject}
                autoMode={autoMode}
                setAutoMode={setAutoMode}
                onGeneratePrompt={handleGeneratePrompt}
                isGeneratingPrompt={isGeneratingPrompt}
                onSaveDraft={handleSaveDraft}
                isSavingDraft={isSavingDraft}
                canonical={canonicalWorkspace}
                onNewImage={handleNewImage}
                generatedPrompt={generatedPrompt}
                automationEnabled={automationEnabled}
              />

              {/* Prompt Section */}
              <div ref={promptSectionRef}>
                <PromptSection
                  generatedPrompt={generatedPrompt}
                  setGeneratedPrompt={updateGeneratedPrompt}
                  generatedPromptPt={generatedPromptPt}
                  onTranslatePrompt={handleTranslatePrompt}
                  isTranslatingPrompt={isTranslatingPrompt}
                  canTranslatePrompt={openaiConfigured}
                  translationError={promptTranslationError}
                  promptDetails={promptDetails}
                  onCreateImage={handleCreateImageWithModel}
                  isCreatingImage={isCreatingImage || isGeneratingNanoBanana}
                  hasNanoBananaKey={nanobananaConfigured}
                  automationEnabled={automationEnabled}
                  selectedModel={selectedModel}
                  onModelChange={setSelectedModel}
                />
              </div>

              {/* Image Result */}
              <div ref={resultSectionRef}>
                {imageUrl && (
                  <ImageResult
                    imageUrl={imageUrl}
                    status={imageStatus}
                    onRegenerate={handleRegenerate}
                    onApprove={handleApprove}
                    isRegenerating={isRegenerating}
                    isApproving={isApproving}
                    imageName={userInput.slice(0, 50)}
                    imageId={currentImage?.id ?? null}
                    evaluatorEnabled={evaluatorEnabled}
                    evaluation={currentEvaluation}
                    onEvaluate={handleEvaluateImage}
                    isEvaluating={isEvaluating}
                    onUseRefinedPrompt={handleUseRefinedPrompt}
                  />
                )}
              </div>

              {/* Generation History */}
              {generationAttempts.length > 0 && (
                <GenerationHistory
                  attempts={generationAttempts}
                  onUsePrompt={handleUseRefinedPrompt}
                />
              )}
            </>
          )}
      </DashboardPageContent>
    </DashboardPage>
  )
}

export function ImagesPageShell({ canonicalSessionId }: { canonicalSessionId?: string } = {}) {
  return (
    <Suspense fallback={
      <div className="flex h-full items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    }>
      <ImagesPageContent canonicalSessionId={canonicalSessionId} />
    </Suspense>
  )
}

export default function ImagesPage() {
  return <ImagesPageShell />
}

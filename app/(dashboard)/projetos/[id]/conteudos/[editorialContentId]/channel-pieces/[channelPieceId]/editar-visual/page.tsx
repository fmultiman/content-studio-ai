'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { AlertCircle, ArrowLeft, ArrowRight, Check, ChevronDown, Loader2, Minus, Play, Plus, RotateCcw, Trash2, Undo2 } from 'lucide-react'
import { DashboardPage, DashboardPageContent } from '@/components/layout/dashboard-page'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog'
import { ContextMetadata } from '@/components/ui/context-metadata'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { DocumentaryCard, documentaryCardPropsFromResolvedInput } from '@/components/creative/documentary-card'
import { PrimitiveTransformControls, HeroTuningControls, TitleTuningControls } from '@/components/creative/authoring/primitive-controls'
import { ElementLayers } from '@/components/creative/authoring/element-layers'
import { AssetSlotCard, StyleSourcePanel, TemplateAnatomy } from '@/components/creative/authoring/inspector-panels'
import { ProjectLibraryAssetPicker } from '@/components/library/project-library-asset-picker'
import { previewOverrideAssets, resolveSlotResource, type SlotLibraryFile } from '@/lib/creative/authoring/asset-slots'
import { CreativeWorkbench, StackedWorkbench, useFloatingWorkbench } from '@/components/creative/editor/creative-workbench'
import { INSPECTOR_SECTIONS, channelFormatLabel, elementsForVariant, type InspectorSection } from '@/lib/creative/authoring/editor-workspace'
import {
  DEFAULT_TEMPLATE_ID, getTemplateLayout, isAppearanceSupported, layoutAssetSlots, listTemplateDefinitions, resolveAuthoringTemplate,
  type AuthoringAssetSlotId, type TemplateAppearance,
} from '@/lib/creative/templates/template-definitions'
import { isDefaultElementOrder, resolveElementStack } from '@/lib/creative/templates/element-stack'
import { adaptProjectIdentityToVisualTokens } from '@/lib/creative/integration/project-identity-adapter'
import {
  authoringReducer, createContextualAuthoringState, deriveManifestFromState, derivePrimitiveSelectionRequest,
  derivePrimitiveTransformsRequest, deriveTuningOverrides, deriveElementOrderRequest, deriveAssetOverridesRequest, resolvePreviewInput, DEFAULT_TUNING,
  type AuthoringAction, type AuthoringProductContext, type AuthoringState, DEFAULT_PRIMITIVE_TRANSFORMS,
  STATIC_AUTHORING_STATE_SCHEMA_VERSION, sortedSlides, defaultCarouselSlides, authoringStateToPersistedSlide,
  persistedSlideToAuthoringState, type PersistedAuthoredSlide, createTemplateSlide, nextSlideId, nextSlideOrder,
  variantUsesContentImage, LIST_ITEMS_MAX, LIST_ITEMS_MIN, type AuthoringListContent, type AuthoringListIcon,
} from '@/lib/creative/authoring'
import { contextualContentForChannelPiece } from '@/lib/creative/context/static-authoring'
import type { ProjectIdentity } from '@/lib/schemas/project-identity'
import type { StaticAuthoringTarget } from '@/lib/creative/context/static-authoring'
import type { Project, Production, EditorialContent, ChannelPiece } from '@/lib/types'
import type { PrimitiveListItem } from '@/lib/creative/primitives/discovery'
import { calculatePreviewFitScale } from '@/lib/creative/authoring/viewport'
import {
  activeExecutionIds, applyExecutionUpdate, attachExecution, failEnqueue, hydrateRenderJobs, isActiveRenderPhase, isRenderStale,
  patchJobByExecution, renderPhaseLabel, startRenderJob, type StaticRenderJob, type StaticRenderJobs,
} from '@/lib/creative/authoring/static-render-jobs'
import type { LibraryFile, RenderExecutionSummary } from '@/lib/types'

/** Image types a slot replacement may use (what the renderer paints as a CSS background). */
const SLOT_IMAGE_MIME_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'] as const

type ContextResponse = { project: Project; production: Production | null; editorialContent: EditorialContent; channelPiece: ChannelPiece; target: StaticAuthoringTarget; projectIdentity: ProjectIdentity; primitiveProjectRef: string | null; primitives: PrimitiveListItem[] }
const RENDER_POLL_INTERVAL_MS = 2000
type StaticAuthoringStateResponse = { state: { schemaVersion: string; channelPieceId: string; templateId?: string | null; slides: PersistedAuthoredSlide[] } | null }
type AuthoringSlide = { id: string; order: number; state: AuthoringState }

const ZOOM_LEVELS = [0.25, 0.33, 0.4, 0.5, 0.75, 1, 1.25, 1.5]
/** Instagram's carousel ceiling — "Adicionar slide" stops there. */
const MAX_CAROUSEL_SLIDES = 20
const LIST_ICON_LABELS: Readonly<Record<AuthoringListIcon, string>> = { microphone: 'Microfone', pencil: 'Lápis', book: 'Livro' }
const AUTOSAVE_PREF_KEY = 'creative-editor:autosave-enabled'

function readAutosavePreference(): boolean {
  if (typeof window === 'undefined') return false
  try { return window.localStorage.getItem(AUTOSAVE_PREF_KEY) === 'true' } catch { return false }
}
function writeAutosavePreference(value: boolean) {
  if (typeof window === 'undefined') return
  try { window.localStorage.setItem(AUTOSAVE_PREF_KEY, value ? 'true' : 'false') } catch { /* best-effort only */ }
}

function buildProductContext(context: ContextResponse): AuthoringProductContext {
  const identitySnapshot = adaptProjectIdentityToVisualTokens(context.project.id, context.projectIdentity)
  return {
    projectId: context.project.id,
    projectName: context.project.name,
    productionId: context.production?.id ?? null,
    productionTitle: context.production?.title ?? null,
    editorialContentId: context.editorialContent.id,
    editorialContentTitle: context.editorialContent.title,
    channelPieceId: context.channelPiece.id,
    channel: context.channelPiece.channel,
    format: context.channelPiece.format,
    projectIdentity: context.projectIdentity,
    identitySnapshot,
    ...(context.primitiveProjectRef ? { primitiveProjectRef: context.primitiveProjectRef } : {}),
  }
}

function canvasKind(context: ContextResponse): 'portrait' | 'reel' {
  return context.target.canvas.height === 1920 ? 'reel' : 'portrait'
}

/** Non-carousel single-slide default — the exact pre-Creative-Editor behavior, unchanged. */
function singleSlideDefault(context: ContextResponse, productContext: AuthoringProductContext): AuthoringSlide {
  const content = contextualContentForChannelPiece(context.editorialContent, context.channelPiece)
  const primitiveSelection = context.primitiveProjectRef ? { paper: 'paper-card-light-01', tape: 'tape-kraft-short-01' } : {}
  const state = createContextualAuthoringState(productContext, canvasKind(context), content, primitiveSelection)
  return { id: 'slide-1', order: 0, state }
}

function persistedSnapshot(slides: AuthoringSlide[], templateId: string): string {
  return JSON.stringify({ templateId, slides: slides.map(({ id, order, state }) => authoringStateToPersistedSlide(state, id, order, templateId)) })
}


export default function StaticAuthoringProductPage() {
  const params = useParams<{ id: string; editorialContentId: string; channelPieceId: string }>()
  const router = useRouter()
  const [context, setContext] = useState<ContextResponse | null>(null)
  const [slides, setSlides] = useState<AuthoringSlide[] | null>(null)
  // Creative Editor Template Foundation V1: the carousel's Template (root of
  // the authored state, not per slide). Legacy rows default to the first one.
  const [templateId, setTemplateId] = useState<string>(DEFAULT_TEMPLATE_ID)
  const [templateFallback, setTemplateFallback] = useState(false)
  const [currentSlideIndex, setCurrentSlideIndex] = useState(0)
  // Camadas accordion: the single expanded element. Editor UI state only — never persisted.
  const [openElementId, setOpenElementId] = useState<string | null>(null)
  // Project image LibraryFiles (signed display URLs) for slot thumbnails, previews and "Trocar".
  const [projectImages, setProjectImages] = useState<ReadonlyMap<string, SlotLibraryFile>>(new Map())
  const [assetPickerSlot, setAssetPickerSlot] = useState<AuthoringAssetSlotId | null>(null)
  const [activeTab, setActiveTab] = useState<InspectorSection>('template')
  const [error, setError] = useState<string | null>(null)
  // Static Render Worker V1: async "Gerar PNG" jobs, keyed by the slide that
  // started them (see lib/creative/authoring/static-render-jobs.ts).
  const [renderJobs, setRenderJobs] = useState<StaticRenderJobs>({})
  const [previewJobSlideId, setPreviewJobSlideId] = useState<string | null>(null)
  const requestedOutputUrlsRef = useRef(new Set<string>())
  const hydratedRenderJobsRef = useRef<string | null>(null)
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const [lastSavedSnapshot, setLastSavedSnapshot] = useState<string | null>(null)
  // Lazy initializer, not an effect: this page's real content only paints
  // after the async context/state load below (gated by the loading return),
  // so reading localStorage here carries no hydration-mismatch risk.
  const [autosaveEnabled, setAutosaveEnabledState] = useState(() => readAutosavePreference())
  const [zoom, setZoom] = useState<'fit' | number>('fit')
  const [previewSize, setPreviewSize] = useState({ width: 0, height: 0 })
  const [restoreDialogOpen, setRestoreDialogOpen] = useState(false)
  // "Adicionar slide" dialog: the Layout/Appearance the new slide starts from.
  const [addSlideOpen, setAddSlideOpen] = useState(false)
  const [addLayoutId, setAddLayoutId] = useState<string>('info')
  const [addAppearance, setAddAppearance] = useState<TemplateAppearance>('light')
  const floating = useFloatingWorkbench()
  const skipNextAutosaveRef = useRef(true)
  // Callback-ref state, not useRef: in the floating workbench the Canvas mounts inside a Dockview
  // portal AFTER this component's effects run, so a ref read in an effect could miss it (Fit stuck at fallback).
  const [previewContainer, setPreviewContainer] = useState<HTMLDivElement | null>(null)

  const isCarousel = context?.channelPiece.format === 'carousel'
  // Derived, not stored: comparing the live slides against the last-saved
  // snapshot is cheap and avoids a setState-in-effect render cascade.
  const dirty = isCarousel && slides ? persistedSnapshot(slides, templateId) !== lastSavedSnapshot : false

  function setAutosaveEnabled(value: boolean) {
    setAutosaveEnabledState(value)
    writeAutosavePreference(value)
  }

  useEffect(() => {
    const el = previewContainer
    if (!el || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect
      if (rect) setPreviewSize({ width: rect.width, height: rect.height })
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [previewContainer])

  useEffect(() => {
    let cancelled = false
    async function load() {
      const query = new URLSearchParams({ projectId: params.id, editorialContentId: params.editorialContentId, channelPieceId: params.channelPieceId })
      const response = await fetch(`/api/creative/static-authoring-context?${query.toString()}`)
      const payload = await response.json() as ContextResponse & { error?: string }
      if (!response.ok) throw new Error(payload.error || 'Contexto indisponível.')
      if (cancelled) return
      setContext(payload)
      const productContext = buildProductContext(payload)

      if (payload.channelPiece.format !== 'carousel') {
        skipNextAutosaveRef.current = true
        setLastSavedSnapshot(null)
        const single = [singleSlideDefault(payload, productContext)]
        setSlides(single)
        return
      }

      const stateResponse = await fetch(`/api/creative/static-authoring-state?channelPieceId=${payload.channelPiece.id}`)
      const statePayload = await stateResponse.json() as StaticAuthoringStateResponse & { error?: string }
      if (cancelled) return
      const persisted = stateResponse.ok ? statePayload.state?.slides ?? null : null
      const orderedSlides = persisted && persisted.length > 0 ? sortedSlides(persisted) : defaultCarouselSlides(payload.primitiveProjectRef)
      const canvas = canvasKind(payload)
      const { template, fallback } = resolveAuthoringTemplate(stateResponse.ok ? statePayload.state?.templateId : undefined)
      setTemplateId(template.id)
      setTemplateFallback(fallback)

      skipNextAutosaveRef.current = true
      const hydrated = orderedSlides.map((slide) => ({ id: slide.id, order: slide.order, state: persistedSlideToAuthoringState(slide, productContext, canvas, template.id) }))
      setSlides(hydrated)
      setCurrentSlideIndex(0)
      // Reload/read-back baseline: "saved" only reflects what the API actually
      // has today. A freshly-defaulted (never-saved) carousel has no baseline
      // — the first explicit Save (or first autosave) establishes one.
      setLastSavedSnapshot(persisted && persisted.length > 0 ? persistedSnapshot(hydrated, template.id) : null)
    }
    load().catch((cause: unknown) => setError(cause instanceof Error ? cause.message : 'Erro ao carregar contexto.'))
    return () => { cancelled = true }
  }, [params.channelPieceId, params.editorialContentId, params.id])

  // Project images for Assets (thumbnails, "Trocar") and for painting overrides in the preview.
  const projectIdForImages = context?.project.id ?? null
  useEffect(() => {
    if (!projectIdForImages) return
    let cancelled = false
    void (async () => {
      try {
        const response = await fetch(`/api/library-files?projectId=${encodeURIComponent(projectIdForImages)}&kind=image`)
        if (!response.ok) return
        const payload = await response.json() as { files?: LibraryFile[] }
        if (!cancelled) setProjectImages(new Map((payload.files ?? []).map((file) => [file.id, file])))
      } catch {
        // best-effort: slots still show names/origins from authored state
      }
    })()
    return () => { cancelled = true }
  }, [projectIdForImages])

  /** Authored state of one slide as the render/stale comparison sees it (not UI state). */
  function slideSignature(slideState: AuthoringState): string {
    return JSON.stringify(authoringStateToPersistedSlide(slideState, 'slide', 0, templateId))
  }

  async function saveNow() {
    if (!isCarousel || !slides || !context) return
    setSaveStatus('saving')
    const snapshot = persistedSnapshot(slides, templateId)
    try {
      const body = {
        schemaVersion: STATIC_AUTHORING_STATE_SCHEMA_VERSION,
        channelPieceId: context.channelPiece.id,
        templateId,
        slides: slides.map(({ id, order, state }) => authoringStateToPersistedSlide(state, id, order, templateId)),
      }
      const response = await fetch('/api/creative/static-authoring-state', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
      if (!response.ok) throw new Error('persist failed')
      setLastSavedSnapshot(snapshot)
      setSaveStatus('saved')
    } catch {
      setSaveStatus('error')
    }
  }

  // Optional autosave — OFF by default (see docs/productization/creative-rendering/
  // CREATIVE_EDITOR_STATIC_SHELL_FOUNDATION_V1.md for the previous always-on behavior
  // this replaces). Reuses the same 600ms debounce and the same PUT as explicit Save.
  useEffect(() => {
    if (!isCarousel || !slides) return
    // The skip exists only to never autosave the load/hydration itself. Consume it on
    // the first run after load regardless of autosave/dirty: it used to wait for the
    // first dirty run with autosave ON, silently swallowing the author's first real
    // edit (Authoring Usability Completion V1 production smoke finding).
    if (skipNextAutosaveRef.current) { skipNextAutosaveRef.current = false; return }
    if (!autosaveEnabled || !dirty) return
    const timeout = setTimeout(() => { void saveNow() }, 600)
    return () => clearTimeout(timeout)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slides, isCarousel, autosaveEnabled, dirty])

  const currentSlide = slides?.[currentSlideIndex] ?? null
  const state = currentSlide?.state ?? null

  function switchSlide(index: number) {
    // Render jobs are per-slide: switching never clears or rebinds them.
    setCurrentSlideIndex(index)
  }

  const dispatch = (action: AuthoringAction) => setSlides((current) => current
    ? current.map((slide, index) => index === currentSlideIndex ? { ...slide, state: authoringReducer(slide.state, action) } : slide)
    : current)

  function setTuningField(group: 'hero' | 'title' | 'source', field: string, value: number) {
    if (!state) return
    dispatch({ type: 'SET_TUNING', tuning: { ...state.tuning, [group]: { ...state.tuning[group], [field]: value } } })
  }
  function resetTuningField(group: 'hero' | 'title' | 'source') {
    if (!state) return
    dispatch({ type: 'SET_TUNING', tuning: { ...state.tuning, [group]: { ...DEFAULT_TUNING[group] } } })
  }

  function revert() {
    if (!lastSavedSnapshot || !context) return
    const persisted = JSON.parse(lastSavedSnapshot) as { templateId: string; slides: PersistedAuthoredSlide[] }
    const productContext = buildProductContext(context)
    const canvas = canvasKind(context)
    setTemplateId(persisted.templateId)
    setSlides(sortedSlides(persisted.slides).map((slide) => ({ id: slide.id, order: slide.order, state: persistedSlideToAuthoringState(slide, productContext, canvas, persisted.templateId) })))
  }

  function restoreSlideDefault() {
    if (!context || !currentSlide) return
    // Template default for THIS slide's layout (never matched by position): content,
    // assets, transforms, appearance AND the layout's default element stack.
    const defaults = createTemplateSlide({ templateId, layoutId: currentSlide.state.variant, id: currentSlide.id, order: currentSlide.order, primitiveProjectRef: context.primitiveProjectRef })
    if (!defaults) return
    const nextState = persistedSlideToAuthoringState(defaults, buildProductContext(context), canvasKind(context), templateId)
    setSlides((current) => current ? current.map((slide, index) => index === currentSlideIndex ? { ...slide, state: nextState } : slide) : current)
    setRestoreDialogOpen(false)
  }

  function openAddSlide() {
    const template = resolveAuthoringTemplate(templateId).template
    const layoutId = currentSlide?.state.variant && getTemplateLayout(template, currentSlide.state.variant) ? currentSlide.state.variant : template.layouts[0].id
    setAddLayoutId(layoutId)
    setAddAppearance(getTemplateLayout(template, layoutId)?.defaultAppearance ?? 'light')
    setAddSlideOpen(true)
  }

  /** Appends a Template-initialized slide (never a clone) and selects it. Unsaved until Salvar/autosave. */
  function addSlide() {
    if (!context || !slides || slides.length >= MAX_CAROUSEL_SLIDES) return
    const created = createTemplateSlide({
      templateId,
      layoutId: addLayoutId,
      appearance: addAppearance,
      id: nextSlideId(slides.map((slide) => slide.id)),
      order: nextSlideOrder(slides),
      primitiveProjectRef: context.primitiveProjectRef,
    })
    if (!created) return
    const createdState = persistedSlideToAuthoringState(created, buildProductContext(context), canvasKind(context), templateId)
    setSlides([...slides, { id: created.id, order: created.order, state: createdState }])
    setCurrentSlideIndex(slides.length)
    setOpenElementId(null)
    setAddSlideOpen(false)
  }

  const previewInput = useMemo(() => state ? resolvePreviewInput(state) : null, [state])
  const cardProps = useMemo(() => {
    if (!previewInput || !state) return null
    const sequence = slides && slides.length > 1 ? { index: currentSlideIndex + 1, total: slides.length } : { index: 1, total: 1 }
    // Slot overrides painted with the same shapes the claim-time resolver gives the worker.
    const overrideAssets = previewOverrideAssets(state.assetOverrides, projectImages)
    const heroAsset = variantUsesContentImage(state.variant) && overrideAssets.hero ? overrideAssets.hero : undefined
    const previewWithSequence = {
      ...previewInput,
      resolvedAssets: heroAsset ? { ...previewInput.resolvedAssets, hero: heroAsset } : previewInput.resolvedAssets,
      manifest: { ...previewInput.manifest, sequence },
    }
    const materials = Object.keys(overrideAssets.materials).length > 0 ? overrideAssets.materials : undefined
    // Same templateId + element stack the render request freezes; DocumentaryCard normalizes both identically in preview and worker.
    return { ...documentaryCardPropsFromResolvedInput(previewWithSequence, 'still', undefined, state.tuning, materials, undefined, { templateId, elementOrder: state.elementOrder }), primitiveTransforms: derivePrimitiveTransformsRequest(state) }
  }, [previewInput, state, slides, currentSlideIndex, templateId, projectImages])

  async function render() {
    if (!state?.productContext || !slides || !currentSlide) return
    const slideRef = { id: currentSlide.id, index: currentSlideIndex + 1, total: slides.length }
    const previous = renderJobs[slideRef.id]
    if (previous && isActiveRenderPhase(previous.phase)) return
    // Freeze the CURRENT authored state (unsaved edits included) at click
    // time. Rendering never saves authoring and never rereads it later.
    const selection = derivePrimitiveSelectionRequest(state)
    const transforms = derivePrimitiveTransformsRequest(state)
    const overrides = deriveTuningOverrides(state)
    const sequence = slides.length > 1 ? { index: slideRef.index, total: slideRef.total } : undefined
    const manifest = deriveManifestFromState(state, sequence)
    const assetOverrides = deriveAssetOverridesRequest(state)
    const body = {
      manifest,
      context: { projectId: state.productContext.projectId, editorialContentId: state.productContext.editorialContentId, channelPieceId: state.productContext.channelPieceId },
      ...(selection ? { primitiveSelection: selection } : {}),
      ...(transforms ? { primitiveTransforms: transforms } : {}),
      ...(overrides ? { overrides } : {}),
      templateId,
      elementOrder: deriveElementOrderRequest(state, templateId),
      ...(assetOverrides ? { assetOverrides } : {}),
      idempotencyKey: crypto.randomUUID(),
      slide: slideRef,
      ...(previous?.phase === 'failed' && previous.executionId ? { retryOfExecutionId: previous.executionId } : {}),
    }
    setRenderJobs((jobs) => startRenderJob(jobs, slideRef, Date.now(), slideSignature(state)))
    try {
      const response = await fetch('/api/creative/static-authoring/render', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
      const payload = await response.json().catch(() => null) as { executionId?: string; status?: RenderExecutionSummary['status']; error?: string } | null
      if (!response.ok || !payload?.executionId || !payload.status) throw new Error(payload?.error || 'Nao foi possivel enfileirar o render.')
      setRenderJobs((jobs) => attachExecution(jobs, slideRef.id, payload.executionId as string, payload.status as RenderExecutionSummary['status']))
    } catch (cause: unknown) {
      setRenderJobs((jobs) => failEnqueue(jobs, slideRef.id, cause instanceof Error ? cause.message : 'Nao foi possivel enfileirar o render.', Date.now()))
    }
  }

  // Poll every active execution by ID (one chain, one request per execution
  // per tick, never overlapping); stops once nothing is queued/rendering.
  const activeRenderKey = activeExecutionIds(renderJobs).join(',')
  useEffect(() => {
    if (!activeRenderKey) return
    let cancelled = false
    let timeoutId: number | undefined
    const ids = activeRenderKey.split(',')
    const poll = async () => {
      await Promise.all(ids.map(async (executionId) => {
        try {
          const response = await fetch(`/api/render-executions/${executionId}`)
          if (!response.ok || cancelled) return
          const payload = await response.json() as { execution?: RenderExecutionSummary }
          if (payload.execution && !cancelled) setRenderJobs((jobs) => applyExecutionUpdate(jobs, payload.execution as RenderExecutionSummary, Date.now()))
        } catch {
          // transient network error: the next tick retries
        }
      }))
      if (!cancelled) timeoutId = window.setTimeout(poll, RENDER_POLL_INTERVAL_MS)
    }
    timeoutId = window.setTimeout(poll, RENDER_POLL_INTERVAL_MS)
    return () => { cancelled = true; if (timeoutId) window.clearTimeout(timeoutId) }
  }, [activeRenderKey])

  // Ready jobs: fetch a short-lived presigned display URL once per execution.
  useEffect(() => {
    for (const job of Object.values(renderJobs)) {
      if (job.phase !== 'ready' || !job.executionId || job.imageUrl || requestedOutputUrlsRef.current.has(job.executionId)) continue
      const executionId = job.executionId
      requestedOutputUrlsRef.current.add(executionId)
      void (async () => {
        try {
          const response = await fetch(`/api/render-executions/${executionId}/output-url`)
          const payload = await response.json().catch(() => null) as { url?: string } | null
          if (response.ok && payload?.url) setRenderJobs((jobs) => patchJobByExecution(jobs, executionId, { imageUrl: payload.url as string }))
        } catch {
          requestedOutputUrlsRef.current.delete(executionId)
        }
      })()
    }
  }, [renderJobs])

  const slidesRef = useRef<AuthoringSlide[] | null>(null)
  useEffect(() => { slidesRef.current = slides }, [slides])

  // Refresh/reopen: rebind recent executions to the slides that created them.
  const channelPieceIdForRenders = context?.channelPiece.id ?? null
  const slideIdsKey = slides?.map((slide) => slide.id).join(',') ?? ''
  useEffect(() => {
    if (!channelPieceIdForRenders || !slideIdsKey || hydratedRenderJobsRef.current === channelPieceIdForRenders) return
    hydratedRenderJobsRef.current = channelPieceIdForRenders
    let cancelled = false
    void (async () => {
      try {
        const response = await fetch(`/api/render-executions?channelPieceId=${channelPieceIdForRenders}`)
        if (!response.ok) return
        const payload = await response.json() as { executions?: RenderExecutionSummary[] }
        // Baseline for "Alterações ainda não renderizadas": the authored state at load. Any later edit is provably absent from these older renders.
        const signaturesAtLoad = Object.fromEntries((slidesRef.current ?? []).map((slide) => [slide.id, slideSignature(slide.state)]))
        if (!cancelled && payload.executions?.length) setRenderJobs((jobs) => hydrateRenderJobs(jobs, payload.executions ?? [], new Set(slideIdsKey.split(',')), signaturesAtLoad))
      } catch {
        // hydration is best-effort; rendering still works
      }
    })()
    return () => { cancelled = true }
    // Runs once per piece on purpose; slideSignature only reads the load-time state it is meant to capture.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channelPieceIdForRenders, slideIdsKey])

  async function saveRenderOutput(job: StaticRenderJob) {
    if (!context || !job.executionId || job.phase !== 'ready' || job.save === 'saving' || job.save === 'saved') return
    // Explicit only: AUTHORING SAVE != PNG RENDER != SAVE OUTPUT TO LIBRARY.
    const executionId = job.executionId
    setRenderJobs((jobs) => patchJobByExecution(jobs, executionId, { save: 'saving', saveError: null }))
    try {
      const response = await fetch(`/api/render-executions/${executionId}/output`)
      if (!response.ok) throw new Error('Nao foi possivel ler o PNG gerado.')
      const blob = await response.blob()
      const file = new File([blob], `slide-${job.slideIndex}-de-${job.slideTotal}-${executionId.slice(0, 8)}.png`, { type: 'image/png' })
      const { saveRenderFileToChannelPiece } = await import('@/lib/creative/authoring')
      const result = await saveRenderFileToChannelPiece({ file, channelPieceId: context.channelPiece.id, renderExecutionId: executionId })
      if (!result.ok) throw new Error(result.error)
      setRenderJobs((jobs) => patchJobByExecution(jobs, executionId, { save: 'saved' }))
    } catch (cause: unknown) {
      setRenderJobs((jobs) => patchJobByExecution(jobs, executionId, { save: 'error', saveError: cause instanceof Error ? cause.message : 'Falha ao salvar.' }))
    }
  }

  const canvasW = context?.target.canvas.width ?? 1080
  const canvasH = context?.target.canvas.height ?? 1350
  const measuredFitScale = calculatePreviewFitScale(previewSize.width, previewSize.height, canvasW, canvasH)
  const fitScale = measuredFitScale > 0 ? measuredFitScale : 0.33
  const effectiveScale = zoom === 'fit' ? fitScale : zoom
  function stepZoom(direction: 1 | -1) {
    const current = zoom === 'fit' ? fitScale : zoom
    let closestIndex = 0
    for (let i = 1; i < ZOOM_LEVELS.length; i++) if (Math.abs(ZOOM_LEVELS[i] - current) < Math.abs(ZOOM_LEVELS[closestIndex] - current)) closestIndex = i
    const nextIndex = Math.min(ZOOM_LEVELS.length - 1, Math.max(0, closestIndex + direction))
    setZoom(ZOOM_LEVELS[nextIndex])
  }

  if (error && !context) return <DashboardPage><DashboardPageContent width="4xl"><Card><CardContent className="p-6"><p className="text-sm text-muted-foreground">{error}</p><Button className="mt-4" variant="outline" onClick={() => router.back()}>Voltar</Button></CardContent></Card></DashboardPageContent></DashboardPage>
  if (!context || !state || !slides) return <DashboardPage><DashboardPageContent width="4xl"><div className="flex justify-center py-24"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div></DashboardPageContent></DashboardPage>

  const template = resolveAuthoringTemplate(templateId).template
  const layout = getTemplateLayout(template, state.variant)
  const elements = elementsForVariant(state.variant, template.id)
  // The CURRENT slide's own render job only — other slides' jobs keep running
  // and stay bound to their slides (see static-render-jobs.ts).
  const currentRenderJob = currentSlide ? renderJobs[currentSlide.id] : undefined
  const currentRenderActive = Boolean(currentRenderJob && isActiveRenderPhase(currentRenderJob.phase))
  const currentRenderStale = isRenderStale(currentRenderJob, slideSignature(state))
  const previewJob = previewJobSlideId ? renderJobs[previewJobSlideId] : undefined
  const slideTotal = slides.length
  const slideLabel = `${currentSlideIndex + 1}/${slideTotal}`
  // An expanded element the active layout does not have (layout switch) is simply closed.
  const openElement = openElementId && elements.some((element) => element.key === openElementId) ? openElementId : null
  const elementLabels = Object.fromEntries(elements.map((element) => [element.key, element.label]))
  const stack = resolveElementStack(template.id, state.variant, state.elementOrder)
  const stackIsDefault = layout ? isDefaultElementOrder(layout, stack.order) : true
  const slotsInUse = layout ? layoutAssetSlots(template, layout) : []
  const pickerSlot = assetPickerSlot ? slotsInUse.find(({ slot }) => slot.id === assetPickerSlot)?.slot ?? null : null

  /** The open element's own controls — exactly what its Template control contract supports. */
  function renderElementPanel(id: string) {
    const control = elements.find((element) => element.key === id)?.control
    if (!control || !state) return null
    if (control.type === 'tuning' && control.group === 'hero') return <HeroTuningControls tuning={state.tuning.hero} onChange={(field, value) => setTuningField('hero', field, value)} onReset={() => resetTuningField('hero')} />
    if (control.type === 'tuning') { const group = control.group; return <TitleTuningControls tuning={state.tuning[group]} onChange={(field, value) => setTuningField(group, field, value)} onReset={() => resetTuningField(group)} /> }
    const key = control.key
    return <PrimitiveTransformControls slot={key} transforms={state.primitiveTransforms[key] ?? DEFAULT_PRIMITIVE_TRANSFORMS} onChange={(field, value) => dispatch({ type: 'SET_PRIMITIVE_TRANSFORM', slot: key, field, value })} onReset={() => dispatch({ type: 'RESET_PRIMITIVE_TRANSFORMS', slot: key })} />
  }

  const listContent = state.variant === 'list' ? state.contentOverride as AuthoringListContent : null
  const listContentFields = listContent ? (
    <>
      <div><Label htmlFor="visual-list-intro">Introdução</Label><Textarea id="visual-list-intro" value={listContent.intro ?? ''} onChange={(event) => dispatch({ type: 'SET_LIST_FIELD', field: 'intro', value: event.target.value })} rows={3} /></div>
      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">Itens ({listContent.items.length}/{LIST_ITEMS_MAX})</legend>
        {listContent.items.map((item, index) => (
          <div key={index} className="space-y-1.5 rounded-md border border-border/60 p-2" data-testid="list-item-editor">
            <div className="flex items-center gap-1.5">
              <Select value={item.icon} onValueChange={(value) => dispatch({ type: 'SET_LIST_ITEM', index, item: { icon: value as AuthoringListIcon } })}>
                <SelectTrigger className="h-7 flex-1 text-xs" aria-label={`Ícone do item ${index + 1}`}><SelectValue /></SelectTrigger>
                <SelectContent>{(Object.keys(LIST_ICON_LABELS) as AuthoringListIcon[]).map((icon) => <SelectItem key={icon} value={icon}>{LIST_ICON_LABELS[icon]}</SelectItem>)}</SelectContent>
              </Select>
              <Button size="icon-sm" variant="ghost" disabled={listContent.items.length <= LIST_ITEMS_MIN} onClick={() => dispatch({ type: 'REMOVE_LIST_ITEM', index })} aria-label={`Remover item ${index + 1}`} title="Remover item"><Trash2 className="h-3.5 w-3.5" /></Button>
            </div>
            <Textarea aria-label={`Texto do item ${index + 1}`} value={item.text} onChange={(event) => dispatch({ type: 'SET_LIST_ITEM', index, item: { text: event.target.value } })} rows={3} />
          </div>
        ))}
        <Button size="sm" variant="outline" className="w-full gap-1 text-xs" disabled={listContent.items.length >= LIST_ITEMS_MAX} onClick={() => dispatch({ type: 'ADD_LIST_ITEM' })}><Plus className="h-3 w-3" />Adicionar item</Button>
        <p className="text-[11px] text-muted-foreground">Use **texto** para destacar em negrito.</p>
      </fieldset>
      <div><Label htmlFor="visual-list-caption">Legenda da imagem</Label><Textarea id="visual-list-caption" value={listContent.image_caption ?? ''} onChange={(event) => dispatch({ type: 'SET_LIST_FIELD', field: 'image_caption', value: event.target.value })} rows={2} /></div>
    </>
  ) : null

  const inspector = (
    <Tabs value={activeTab} onValueChange={(value) => setActiveTab(value as InspectorSection)}>
      <TabsList className="flex w-full">
        {INSPECTOR_SECTIONS.map((section) => (
          <TabsTrigger key={section.value} value={section.value} className="min-w-0 flex-auto px-1 text-[11px]" title={section.label}>
            <span className="inspector-tab-full">{section.label}</span>
            <span className="inspector-tab-compact" aria-hidden="true">{section.compactLabel}</span>
          </TabsTrigger>
        ))}
      </TabsList>
      <TabsContent value="template" className="space-y-3 pt-3">
        <div className="space-y-1.5">
          <Label htmlFor="template-selector" className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Template</Label>
          <Select value={template.id} onValueChange={(value) => setTemplateId(value)}>
            <SelectTrigger id="template-selector" className="w-full"><SelectValue /></SelectTrigger>
            <SelectContent>{listTemplateDefinitions().map((definition) => <SelectItem key={definition.id} value={definition.id}>{definition.name}</SelectItem>)}</SelectContent>
          </Select>
          {templateFallback ? <p className="text-xs text-destructive" role="alert">Template salvo não reconhecido; usando {template.name}.</p> : null}
        </div>
        <div className="flex flex-wrap items-center gap-2"><span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Estrutura</span>{template.layouts.map((option) => <Button key={option.id} size="sm" variant={state.variant === option.id ? 'default' : 'outline'} onClick={() => { if (state.variant !== option.id) dispatch({ type: 'SET_VARIANT', variant: option.id as AuthoringState['variant'] }) }}>{option.label}</Button>)}</div>
        <div className="flex flex-wrap items-center gap-2"><span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Aparência</span>{(layout?.supportedAppearances ?? []).map((appearance) => <Button key={appearance} size="sm" variant={state.appearance === appearance ? 'default' : 'outline'} onClick={() => { if (isAppearanceSupported(template, state.variant, appearance)) dispatch({ type: 'SET_APPEARANCE', appearance }) }}>{appearance === 'light' ? 'Light' : 'Dark'}</Button>)}</div>
        <p className="text-xs text-muted-foreground">{template.description}</p>
        {layout ? <TemplateAnatomy template={template} layout={layout} /> : null}
      </TabsContent>
      <TabsContent value="content" className="space-y-3 pt-3">
        <div><Label htmlFor="visual-title">Título</Label><Textarea id="visual-title" value={(state.contentOverride as { title?: string }).title ?? ''} onChange={(event) => dispatch(state.variant === 'cover' ? { type: 'SET_COVER_FIELD', field: 'title', value: event.target.value } : state.variant === 'list' ? { type: 'SET_LIST_FIELD', field: 'title', value: event.target.value } : { type: 'SET_INFO_FIELD', field: 'title', value: event.target.value })} rows={2} /></div>
        {state.variant === 'list' ? listContentFields : state.variant === 'cover' ? <div><Label htmlFor="visual-subtitle">Texto</Label><Textarea id="visual-subtitle" value={(state.contentOverride as { subtitle?: string }).subtitle ?? ''} onChange={(event) => dispatch({ type: 'SET_COVER_FIELD', field: 'subtitle', value: event.target.value })} rows={4} /></div> : <><div><Label htmlFor="visual-intro">Introdução</Label><Textarea id="visual-intro" value={(state.contentOverride as { intro?: string }).intro ?? ''} onChange={(event) => dispatch({ type: 'SET_INFO_FIELD', field: 'intro', value: event.target.value })} rows={2} /></div><div><Label htmlFor="visual-body">Corpo (um parágrafo por linha)</Label><Textarea id="visual-body" value={(state.contentOverride as { body_blocks?: string[] }).body_blocks?.join('\n') ?? ''} onChange={(event) => dispatch({ type: 'SET_INFO_BODY', value: event.target.value })} rows={3} /></div></>}
      </TabsContent>
      <TabsContent value="assets" className="space-y-2 pt-3">
        {/* Assets = which resource fills each semantic slot. Placement/stacking live in Elementos. */}
        <p className="text-[11px] text-muted-foreground">Recurso que preenche cada papel visual deste layout. Posição e camadas ficam em Elementos.</p>
        {slotsInUse.map(({ slot, elements: users }) => (
          <AssetSlotCard
            key={slot.id}
            slot={slot}
            resource={resolveSlotResource(slot, state, projectImages, context.primitives)}
            usedBy={users.map((element) => element.label)}
            onReplace={() => setAssetPickerSlot(slot.id)}
            onUseDefault={() => dispatch({ type: 'USE_TEMPLATE_DEFAULT_ASSET', slot: slot.id })}
          />
        ))}
      </TabsContent>
      <TabsContent value="style" className="pt-3">
        <StyleSourcePanel tokens={state.productContext?.identitySnapshot} />
      </TabsContent>
      <TabsContent value="element" className="pt-3">
        <ElementLayers
          order={stack.order}
          labels={elementLabels}
          openId={openElement}
          isDefault={stackIsDefault}
          onToggle={(id) => setOpenElementId((current) => (current === id ? null : id))}
          onReorder={(order) => dispatch({ type: 'SET_ELEMENT_ORDER', order })}
          onRestoreDefault={() => dispatch({ type: 'RESET_ELEMENT_ORDER' })}
          renderPanel={renderElementPanel}
        />
      </TabsContent>
    </Tabs>
  )

  // Floor the scaled box so Fit never overflows its viewport by a sub-pixel and summons scrollbars.
  const scaledWidth = Math.floor(canvasW * effectiveScale)
  const scaledHeight = Math.floor(canvasH * effectiveScale)
  const canvas = (
    <div className={floating ? 'flex h-full min-h-0 flex-col' : 'flex flex-col'}>
      <div ref={setPreviewContainer} className={floating ? 'flex min-h-0 flex-1 overflow-auto p-3' : 'flex h-[min(62vh,560px)] overflow-auto p-2'} data-testid="canvas-viewport">
        <div className="m-auto shrink-0 overflow-hidden" style={{ width: scaledWidth, height: scaledHeight }}>
          <div style={{ width: canvasW, height: canvasH, transform: `scale(${effectiveScale})`, transformOrigin: 'top left' }}>{cardProps ? <DocumentaryCard {...cardProps} /> : null}</div>
        </div>
      </div>
      <div className="flex shrink-0 flex-wrap items-center justify-center gap-x-5 gap-y-1.5 border-t border-border/40 px-3 py-1.5" data-testid="editor-lower-toolbar">
        {isCarousel && <div className="flex items-center gap-1" role="group" aria-label="Slides">
          <Button size="icon-sm" variant="outline" onClick={() => switchSlide(Math.max(0, currentSlideIndex - 1))} disabled={currentSlideIndex === 0} aria-label="Slide anterior"><ArrowLeft className="h-3.5 w-3.5" /></Button>
          {slides.map((slide, index) => <Button key={slide.id} size="sm" className="px-2.5 text-xs" variant={index === currentSlideIndex ? 'default' : 'outline'} aria-pressed={index === currentSlideIndex} onClick={() => switchSlide(index)}>{index + 1}/{slideTotal}</Button>)}
          <Button size="icon-sm" variant="outline" onClick={() => switchSlide(Math.min(slideTotal - 1, currentSlideIndex + 1))} disabled={currentSlideIndex === slideTotal - 1} aria-label="Próximo slide"><ArrowRight className="h-3.5 w-3.5" /></Button>
          <Button size="icon-sm" variant="outline" className="ml-1" onClick={openAddSlide} disabled={slideTotal >= MAX_CAROUSEL_SLIDES} aria-label="Adicionar slide" title={slideTotal >= MAX_CAROUSEL_SLIDES ? `Limite de ${MAX_CAROUSEL_SLIDES} slides` : 'Adicionar slide'} data-testid="add-slide"><Plus className="h-3.5 w-3.5" /></Button>
        </div>}
        <div className="flex items-center gap-1" role="group" aria-label="Zoom">
          <Button size="icon-sm" variant="outline" onClick={() => stepZoom(-1)} aria-label="Diminuir zoom"><Minus className="h-3.5 w-3.5" /></Button>
          <select aria-label="Zoom da prévia" className="h-8 rounded-md border border-input bg-background px-2 text-xs" value={zoom === 'fit' ? 'fit' : String(zoom)} onChange={(event) => setZoom(event.target.value === 'fit' ? 'fit' : Number(event.target.value))}><option value="fit">Fit · {Math.round(fitScale * 100)}%</option>{ZOOM_LEVELS.map((level) => <option key={level} value={level}>{Math.round(level * 100)}%</option>)}</select>
          <Button size="icon-sm" variant="outline" onClick={() => stepZoom(1)} aria-label="Aumentar zoom"><Plus className="h-3.5 w-3.5" /></Button>
        </div>
        {isCarousel && <div className="flex items-center gap-1" role="group" aria-label="Estado do slide">
          <Button size="sm" variant="ghost" className="gap-1 px-2 text-xs" disabled={!dirty || !lastSavedSnapshot} onClick={revert} title="Descartar alterações não salvas e restaurar o último estado salvo."><Undo2 className="h-3 w-3" />Voltar ao salvo</Button>
          <Button size="sm" variant="ghost" className="gap-1 px-2 text-xs" onClick={() => setRestoreDialogOpen(true)} title="Aplicar ao slide atual os valores padrão do Template (ainda é preciso Salvar)."><RotateCcw className="h-3 w-3" />Restaurar padrão do Template</Button>
          <label className="ml-1 flex cursor-pointer items-center gap-1.5 text-xs text-muted-foreground"><input type="checkbox" checked={autosaveEnabled} onChange={(event) => setAutosaveEnabled(event.target.checked)} />Auto-save</label>
        </div>}
      </div>
    </div>
  )

  const saveStatusLabel = saveStatus === 'saving' ? 'Salvando…' : saveStatus === 'error' ? 'Falha ao salvar' : dirty ? 'Alterações não salvas' : lastSavedSnapshot ? 'Salvo' : 'Ainda não salvo'
  const contextItems = [
    { label: 'Project', value: context.project.name },
    { label: 'Production', value: context.production?.title || 'Sem Production' },
    { label: 'EditorialContent', value: context.editorialContent.title, fullWidth: true },
    { label: 'ChannelPiece', value: context.channelPiece.title || `${context.channelPiece.channel}:${context.channelPiece.format}`, fullWidth: true },
    { label: 'Identity', value: context.projectIdentity.expression?.visual_identity || 'Project Identity V1', fullWidth: true },
  ]

  const header = (
    <header className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1.5 pb-2" data-testid="editor-header">
      <div className="flex min-w-0 flex-1 items-center gap-2">
        <Button variant="ghost" size="icon-sm" className="-ml-2 shrink-0" onClick={() => router.back()} aria-label="Voltar ao conteúdo" title="Voltar ao conteúdo"><ArrowLeft className="h-4 w-4" /></Button>
        <h1 className="shrink-0 text-base font-semibold">Creative Editor</h1>
        <p className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
          <span className="truncate">Static · {channelFormatLabel(context.channelPiece.channel, context.channelPiece.format)}</span>
          {isCarousel && <><span aria-hidden="true">·</span><span className="shrink-0 font-medium text-foreground" data-testid="header-slide-indicator" aria-label={`Slide ${currentSlideIndex + 1} de ${slideTotal}`}>{slideLabel}</span></>}
        </p>
        <DropdownMenu>
          <DropdownMenuTrigger asChild><Button variant="ghost" size="sm" className="h-7 shrink-0 gap-1 px-2 text-xs text-muted-foreground">Contexto<ChevronDown className="h-3 w-3" /></Button></DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-80 max-w-[calc(100vw-2rem)] p-3"><ContextMetadata items={contextItems} dense /></DropdownMenuContent>
        </DropdownMenu>
      </div>
      <div className="flex min-w-0 flex-wrap items-center justify-end gap-2">
        {currentRenderJob && currentRenderActive && <span className="flex items-center gap-1 text-xs text-muted-foreground" data-testid="render-status" data-phase={currentRenderJob.phase}><Loader2 className="h-3.5 w-3.5 animate-spin" />{renderPhaseLabel(currentRenderJob.phase)}</span>}
        {currentRenderJob?.phase === 'failed' && <span className="flex max-w-[18rem] items-center gap-1 text-xs text-destructive" title={currentRenderJob.errorMessage ?? undefined} role="alert" data-testid="render-status" data-phase="failed"><AlertCircle className="h-3.5 w-3.5 shrink-0" /><span className="truncate">{renderPhaseLabel('failed')}{currentRenderJob.errorMessage ? ` · ${currentRenderJob.errorMessage}` : ''}</span></span>}
        {currentRenderJob?.phase === 'ready' && <span className="flex items-center gap-2 text-xs text-muted-foreground" data-testid="render-status" data-phase="ready">
          <button type="button" className="h-7 w-[22px] shrink-0 overflow-hidden rounded border border-border/60 bg-muted" onClick={() => setPreviewJobSlideId(currentRenderJob.slideId)} aria-label={`Ver PNG do slide ${currentRenderJob.slideIndex}/${currentRenderJob.slideTotal}`} title="Ver PNG">
            {/* eslint-disable-next-line @next/next/no-img-element -- short-lived presigned scratch URL, not an optimizable asset */}
            {currentRenderJob.imageUrl ? <img src={currentRenderJob.imageUrl} alt="" className="h-full w-full object-cover" /> : null}
          </button>
          <Check className="h-3.5 w-3.5 text-[var(--indicator-success,theme(colors.green.600))]" />{renderPhaseLabel('ready')}{currentRenderJob.finishedAt ? ` · ${Math.max(1, Math.round((currentRenderJob.finishedAt - currentRenderJob.startedAt) / 1000))}s` : ''}
          {currentRenderJob.save === 'saved'
            ? <span className="flex items-center gap-1 text-foreground" data-testid="render-attached" title="Este PNG já está anexado à peça (Galeria / Imagens geradas).">✓ Salvo nesta peça</span>
            : <Button size="sm" variant="outline" className="h-7 px-2 text-[11px]" disabled={currentRenderJob.save === 'saving'} onClick={() => void saveRenderOutput(currentRenderJob)} title={currentRenderJob.saveError ?? 'Anexar este PNG à peça (fica disponível na Galeria / Imagens geradas).'}>{currentRenderJob.save === 'saving' ? 'Salvando…' : currentRenderJob.save === 'error' ? 'Tentar salvar de novo' : 'Salvar nesta peça'}</Button>}
        </span>}
        {currentRenderStale && <span className="text-xs text-amber-600 dark:text-amber-400" data-testid="render-stale" title="O PNG atual não inclui as alterações feitas depois dele. Gere um novo PNG para incluí-las.">Alterações ainda não renderizadas</span>}
        {isCarousel && <span className="text-xs text-muted-foreground" data-testid="save-status">{saveStatusLabel}</span>}
        {isCarousel && <Button size="sm" variant="outline" className="gap-1.5" disabled={!dirty && saveStatus !== 'error'} onClick={() => void saveNow()} title="Salvar o estado de autoria (não gera PNG nem anexa mídia).">{saveStatus === 'saving' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}Salvar</Button>}
        <Button size="sm" onClick={() => void render()} disabled={currentRenderActive} className="gap-1.5" title="Gerar um PNG do estado atual deste slide (não salva a autoria).">{currentRenderActive ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}{currentRenderActive && currentRenderJob ? renderPhaseLabel(currentRenderJob.phase) : 'Gerar PNG'}</Button>
      </div>
    </header>
  )

  const restoreDialog = <><AlertDialog open={restoreDialogOpen} onOpenChange={setRestoreDialogOpen}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>Restaurar padrão do Template?</AlertDialogTitle><AlertDialogDescription>Os valores padrão do Template serão aplicados ao slide atual. Clique em Salvar para persistir.</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>Cancelar</AlertDialogCancel><AlertDialogAction onClick={restoreSlideDefault}>Restaurar</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
    <ProjectLibraryAssetPicker
      open={Boolean(pickerSlot)}
      onOpenChange={(open) => { if (!open) setAssetPickerSlot(null) }}
      projectId={context.project.id}
      selectedId={pickerSlot ? state.assetOverrides?.[pickerSlot.id]?.libraryFileId ?? null : null}
      allowedKinds={['image']}
      allowedMimeTypes={SLOT_IMAGE_MIME_TYPES}
      groupByOrigin
      title={pickerSlot ? `Trocar: ${pickerSlot.label}` : 'Trocar asset'}
      description="Escolha uma imagem do Projeto para este papel visual. O arquivo é referenciado, não copiado."
      onSelect={(file) => {
        if (!pickerSlot) return
        setProjectImages((current) => new Map(current).set(file.id, file))
        dispatch({ type: 'SET_ASSET_OVERRIDE', slot: pickerSlot.id, libraryFileId: file.id })
      }}
    />
    <Dialog open={addSlideOpen} onOpenChange={setAddSlideOpen}>
      <DialogContent className="max-w-[min(92vw,420px)]" data-testid="add-slide-dialog">
        <DialogHeader>
          <DialogTitle>Adicionar slide</DialogTitle>
          <DialogDescription>O novo slide entra no fim da sequência com os padrões do Template (conteúdo de exemplo, assets e ordem de camadas). Clique em Salvar para persistir.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3 text-sm">
          <div className="flex items-baseline gap-2"><span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Template</span><span data-testid="add-slide-template">{template.name}</span></div>
          <div className="space-y-1.5">
            <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Estrutura</span>
            <div className="flex flex-wrap gap-2" role="group" aria-label="Estrutura do novo slide">
              {template.layouts.map((option) => <Button key={option.id} size="sm" variant={addLayoutId === option.id ? 'default' : 'outline'} aria-pressed={addLayoutId === option.id} onClick={() => { setAddLayoutId(option.id); setAddAppearance(option.defaultAppearance) }}>{option.label}</Button>)}
            </div>
          </div>
          <div className="space-y-1.5">
            <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Aparência</span>
            <div className="flex flex-wrap gap-2" role="group" aria-label="Aparência do novo slide">
              {(getTemplateLayout(template, addLayoutId)?.supportedAppearances ?? []).map((appearance) => <Button key={appearance} size="sm" variant={addAppearance === appearance ? 'default' : 'outline'} aria-pressed={addAppearance === appearance} onClick={() => setAddAppearance(appearance)}>{appearance === 'light' ? 'Light' : 'Dark'}</Button>)}
            </div>
          </div>
          <p className="text-xs text-muted-foreground">Será o slide {slideTotal + 1}/{slideTotal + 1}.</p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setAddSlideOpen(false)}>Cancelar</Button>
          <Button onClick={addSlide} disabled={!getTemplateLayout(template, addLayoutId)}>Adicionar slide</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
    <Dialog open={Boolean(previewJob?.imageUrl)} onOpenChange={(open) => { if (!open) setPreviewJobSlideId(null) }}>
      <DialogContent className="max-w-[min(92vw,540px)]">
        <DialogHeader>
          <DialogTitle>PNG · Slide {previewJob?.slideIndex}/{previewJob?.slideTotal}</DialogTitle>
          <DialogDescription>Render gerado (rascunho). Use “Salvar nesta peça” para anexá-lo à peça.</DialogDescription>
        </DialogHeader>
        {/* eslint-disable-next-line @next/next/no-img-element -- short-lived presigned scratch URL, not an optimizable asset */}
        {previewJob?.imageUrl ? <img src={previewJob.imageUrl} alt={`PNG do slide ${previewJob.slideIndex}/${previewJob.slideTotal}`} className="max-h-[70vh] w-full rounded border border-border/60 object-contain" data-testid="render-preview-image" /> : null}
      </DialogContent>
    </Dialog></>

  if (!floating) {
    return <DashboardPage><div className="min-w-0 px-4 py-3">{header}<StackedWorkbench canvas={canvas} inspector={inspector} />{restoreDialog}</div></DashboardPage>
  }

  // Desktop: the editor owns exactly the viewport below the global top bar — no page scroll in the edit loop.
  return (
    <DashboardPage>
      <div className="flex h-[calc(100dvh-var(--studio-shell-top-bar-height))] min-h-0 min-w-0 flex-col px-[var(--studio-shell-page-padding)] pb-3 pt-2">
        {header}
        <CreativeWorkbench className="flex-1 overflow-hidden rounded-lg border border-border/50 bg-background" canvas={canvas} inspector={inspector} />
        {restoreDialog}
      </div>
    </DashboardPage>
  )
}

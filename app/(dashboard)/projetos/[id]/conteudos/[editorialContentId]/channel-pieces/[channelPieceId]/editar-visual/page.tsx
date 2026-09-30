'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { AlertCircle, ArrowLeft, ArrowRight, Check, ChevronDown, Download, Hand, Loader2, MousePointer2, PanelRight, Play, Plus, RotateCcw, Trash2, Undo2 } from 'lucide-react'
import { DashboardPage, DashboardPageContent } from '@/components/layout/dashboard-page'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog'
import { ContextMetadata } from '@/components/ui/context-metadata'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { DocumentaryCard, documentaryCardPropsFromResolvedInput } from '@/components/creative/documentary-card'
import { PrimitiveTransformControls, HeroTuningControls, TitleTuningControls } from '@/components/creative/authoring/primitive-controls'
import { LayoutSwitchDialog } from '@/components/creative/authoring/layout-switch-dialog'
import { TemplateElementsTab } from '@/components/creative/authoring/template-elements-tab'
import { resolveLayoutSections } from '@/lib/creative/templates/template-anatomy'
import { LayoutContentForm } from '@/components/creative/authoring/layout-content-form'
import { LAYOUT_CONTENT_FIELDS } from '@/lib/creative/authoring/layout-content-fields'
import { AssetSlotCard, StyleSourcePanel, TemplateReference } from '@/components/creative/authoring/inspector-panels'
import { ProjectLibraryAssetPicker } from '@/components/library/project-library-asset-picker'
import { previewOverrideAssets, resolveSlotResource, type SlotLibraryFile } from '@/lib/creative/authoring/asset-slots'
import { CreativeWorkbench, StackedWorkbench, useFloatingWorkbench } from '@/components/creative/editor/creative-workbench'
import { INSPECTOR_SECTIONS, channelFormatLabel, elementsForVariant, type InspectorSection } from '@/lib/creative/authoring/editor-workspace'
import {
  DEFAULT_TEMPLATE_ID, TITLE_LINE_HEIGHT_BOUNDS, getLayoutElement, getTemplateLayout, isAppearanceSupported, layoutAssetSlots, listTemplateDefinitions, resolveAuthoringTemplate,
  type AuthoringAssetSlotId, type TemplateAppearance,
} from '@/lib/creative/templates/template-definitions'
import { isDefaultElementOrder, resolveElementStack } from '@/lib/creative/templates/element-stack'
import { adaptProjectIdentityToVisualTokens } from '@/lib/creative/integration/project-identity-adapter'
import {
  authoringReducer, createContextualAuthoringState, deriveManifestFromState, derivePrimitiveSelectionRequest,
  derivePrimitiveTransformsRequest, deriveTuningOverrides, deriveElementOrderRequest, deriveHiddenElementsRequest, deriveAssetOverridesRequest, resolvePreviewInput, DEFAULT_TUNING,
  type AuthoringAction, type AuthoringProductContext, type AuthoringState, DEFAULT_PRIMITIVE_TRANSFORMS,
  STATIC_AUTHORING_STATE_SCHEMA_VERSION, sortedSlides, defaultCarouselSlides, authoringStateToPersistedSlide,
  persistedSlideToAuthoringState, type PersistedAuthoredSlide, createTemplateSlide, nextSlideId, nextSlideOrder,
  variantUsesContentImage, hasLayoutOwnedAuthoredWork,
} from '@/lib/creative/authoring'
import { contextualContentForChannelPiece } from '@/lib/creative/context/static-authoring'
import type { ProjectIdentity } from '@/lib/schemas/project-identity'
import type { StaticAuthoringTarget } from '@/lib/creative/context/static-authoring'
import type { Project, Production, EditorialContent, ChannelPiece } from '@/lib/types'
import type { PrimitiveListItem } from '@/lib/creative/primitives/discovery'
import { usePreviewViewport } from '@/components/creative/editor/use-preview-viewport'
import { ViewportZoomControls } from '@/components/creative/editor/viewport-zoom-controls'
import { removeSlideFromCollection } from '@/lib/creative/authoring/slide-collection'
import { visibleSlideIndexes } from '@/lib/creative/authoring/pagination'
import {
  activeExecutionIds, applyExecutionUpdate, attachExecution, failEnqueue, hydrateRenderJobs, isActiveRenderPhase, isRenderStale,
  patchJobByExecution, renderPhaseLabel, startRenderJob, type StaticRenderJob, type StaticRenderJobs,
} from '@/lib/creative/authoring/static-render-jobs'
import type { LibraryFile, RenderExecutionSummary } from '@/lib/types'
import { CompositionModePanel } from '@/components/creative/authoring/composition-mode-panel'
import { FreeSceneElements, freeElementLabel } from '@/components/creative/video/free-scene-panels'
import { FreeElementsOverlay } from '@/components/creative/video/free-scene-overlay'
import { FreeStage } from '@/components/creative/free/free-stage'
import { addFreeImageElement, addFreeTextElement, deriveFreeSegment, freeElements, setFreeElementBox, updateFreeElement, type FreeHost } from '@/lib/creative/video-editor/free-composition'
import type { FreeSceneComposition } from '@/lib/types'
import { DEFAULT_PREVIEW_INTERACTION_MODE, type PreviewInteractionMode } from '@/lib/creative/video-editor/free-manipulation'
import { createFreeStaticSlide, freeCompositionHasContent, type FreeStaticSlide, type StaticCompositionMode } from '@/lib/creative/authoring/free-static'
import { isPersistedFreeSlide, type PersistedStaticSlide } from '@/lib/creative/authoring/carousel-state'

/** Image types a slot replacement may use (what the renderer paints as a CSS background). */
const SLOT_IMAGE_MIME_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'] as const

type ContextResponse = { project: Project; production: Production | null; editorialContent: EditorialContent; channelPiece: ChannelPiece; target: StaticAuthoringTarget; projectIdentity: ProjectIdentity; primitiveProjectRef: string | null; primitives: PrimitiveListItem[] }
const RENDER_POLL_INTERVAL_MS = 2000
type StaticAuthoringStateResponse = { state: { schemaVersion: string; channelPieceId: string; composition?: StaticCompositionMode; templateId?: string | null; slides: PersistedStaticSlide[] } | null }
type AuthoringSlide = { id: string; order: number; state: AuthoringState }

/** Instagram's carousel ceiling — "Adicionar slide" stops there. */
const MAX_CAROUSEL_SLIDES = 20
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

/**
 * CREATIVE_EDITOR_FREE_DEFAULT_AND_TEMPLATE_ENTRY_V1 — the persisted composition
 * fields for either mode (the body minus schemaVersion/channelPieceId). FREE is
 * explicit (`composition: 'free'`, no templateId); TEMPLATE keeps its exact
 * previous shape, so every saved Template piece keeps an identical snapshot.
 */
function persistedBodyFields(mode: StaticCompositionMode, slides: AuthoringSlide[] | null, freeSlides: FreeStaticSlide[] | null, templateId: string) {
  if (mode === 'free') return { composition: 'free' as const, slides: (freeSlides ?? []).map(({ id, order, composition }) => ({ id, order, composition })) }
  return { templateId, slides: (slides ?? []).map(({ id, order, state }) => authoringStateToPersistedSlide(state, id, order, templateId)) }
}

function persistedSnapshot(mode: StaticCompositionMode, slides: AuthoringSlide[] | null, freeSlides: FreeStaticSlide[] | null, templateId: string): string {
  return JSON.stringify(persistedBodyFields(mode, slides, freeSlides, templateId))
}


export default function StaticAuthoringProductPage() {
  const params = useParams<{ id: string; editorialContentId: string; channelPieceId: string }>()
  const router = useRouter()
  const [context, setContext] = useState<ContextResponse | null>(null)
  const [slides, setSlides] = useState<AuthoringSlide[] | null>(null)
  // CREATIVE_EDITOR_FREE_DEFAULT_AND_TEMPLATE_ENTRY_V1: two modes, collection-level.
  // FREE (the default for new authoring) or TEMPLATE (explicit opt-in). Exactly one list is live.
  const [mode, setMode] = useState<StaticCompositionMode>('free')
  const [freeSlides, setFreeSlides] = useState<FreeStaticSlide[] | null>(null)
  // What "clean" means before the first save: the bootstrap itself (a blank free canvas is not an unsaved edit).
  const [baselineSnapshot, setBaselineSnapshot] = useState<string | null>(null)
  // Free canvas tool (UI only, never persisted): Mão pans, Selecionar moves/resizes free elements.
  const [interactionMode, setInteractionMode] = useState<PreviewInteractionMode>(DEFAULT_PREVIEW_INTERACTION_MODE)
  const [freeImagePicker, setFreeImagePicker] = useState<{ mode: 'add' } | { mode: 'replace'; elementId: string } | null>(null)
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
  const [zipBusy, setZipBusy] = useState(false)
  const [zipError, setZipError] = useState<string | null>(null)
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
  // WORKSPACE UI state: the floating Inspector's open/closed state (never authoring state).
  const [inspectorOpen, setInspectorOpen] = useState(true)
  const [removeDialogOpen, setRemoveDialogOpen] = useState(false)
  // STATIC_TEMPLATE_LAYOUT_SWITCH_STATE_TRUTH_V1: the Layout a destructive switch is waiting to confirm (UI-only; never authored state).
  const [pendingLayoutId, setPendingLayoutId] = useState<string | null>(null)
  // Slide ids never to reuse in this session: removed slides and slides with render history.
  const reservedSlideIdsRef = useRef(new Set<string>())
  const [restoreDialogOpen, setRestoreDialogOpen] = useState(false)
  // "Adicionar slide" dialog: the Layout/Appearance the new slide starts from.
  const [addSlideOpen, setAddSlideOpen] = useState(false)
  const [addLayoutId, setAddLayoutId] = useState<string>('info')
  const [addAppearance, setAddAppearance] = useState<TemplateAppearance>('light')
  const floating = useFloatingWorkbench()
  const skipNextAutosaveRef = useRef(true)
  // VIEWPORT (Static Detail Polish V1; shared with the Video Live Player since Video Static Parity V1):
  // the editor's camera only — never authoring state, never dirty.
  const { attach: attachPreviewViewport, ...viewport } = usePreviewViewport({ surfaceWidth: context?.target.canvas.width ?? 1080, surfaceHeight: context?.target.canvas.height ?? 1350, floating })

  const isCarousel = context?.channelPiece.format === 'carousel'
  // The live authored units of the active mode (a collection only for carousel).
  const units: { id: string; order: number }[] | null = mode === 'free' ? freeSlides : slides
  // Derived, not stored: comparing the live composition against the last-saved
  // snapshot (or, before any save, the bootstrap) is cheap and avoids a
  // setState-in-effect render cascade. Every static format persists now.
  const currentSnapshot = units ? persistedSnapshot(mode, slides, freeSlides, templateId) : null
  const dirty = currentSnapshot !== null && currentSnapshot !== (lastSavedSnapshot ?? baselineSnapshot)

  function setAutosaveEnabled(value: boolean) {
    setAutosaveEnabledState(value)
    writeAutosavePreference(value)
  }

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

      // Every static format (post, story, feed, carousel…) persists through the
      // SAME ChannelPiece-owned row; only a carousel is a collection.
      const stateResponse = await fetch(`/api/creative/static-authoring-state?channelPieceId=${payload.channelPiece.id}`)
      const statePayload = await stateResponse.json() as StaticAuthoringStateResponse & { error?: string }
      if (cancelled) return
      const persistedState = stateResponse.ok ? statePayload.state ?? null : null
      const canvas = canvasKind(payload)
      skipNextAutosaveRef.current = true
      setCurrentSlideIndex(0)

      if (persistedState && persistedState.composition === 'free') {
        // Saved FREE composition: stays free (never reinterpreted as a Template).
        const loaded = sortedSlides(persistedState.slides.filter(isPersistedFreeSlide)).map(({ id, order, composition }) => ({ id, order, composition }))
        const snapshot = persistedSnapshot('free', null, loaded, DEFAULT_TEMPLATE_ID)
        setMode('free')
        setFreeSlides(loaded)
        setSlides(null)
        setLastSavedSnapshot(snapshot)
        setBaselineSnapshot(snapshot)
        return
      }

      const persisted = persistedState ? persistedState.slides.filter((slide): slide is PersistedAuthoredSlide => !isPersistedFreeSlide(slide)) : []
      if (persisted.length > 0) {
        // Saved TEMPLATE composition (e.g. the Documentary carousel): opens exactly as authored.
        const { template, fallback } = resolveAuthoringTemplate(persistedState?.templateId ?? undefined)
        setTemplateId(template.id)
        setTemplateFallback(fallback)
        const hydrated = sortedSlides(persisted).map((slide) => ({ id: slide.id, order: slide.order, state: persistedSlideToAuthoringState(slide, productContext, canvas, template.id) }))
        const snapshot = persistedSnapshot('template', hydrated, null, template.id)
        setMode('template')
        setSlides(hydrated)
        setFreeSlides(null)
        setLastSavedSnapshot(snapshot)
        setBaselineSnapshot(snapshot)
        return
      }

      // Never saved: NEW authoring starts FREE — a blank canvas, no Template
      // implicitly selected, nothing written until the author saves.
      const blank = [createFreeStaticSlide('slide-1', 0)]
      setMode('free')
      setFreeSlides(blank)
      setSlides(null)
      setLastSavedSnapshot(null)
      setBaselineSnapshot(persistedSnapshot('free', null, blank, DEFAULT_TEMPLATE_ID))
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

  // Free compositions read the style tokens directly (no Template Appearance in between).
  const freeTokens = useMemo(() => (context ? adaptProjectIdentityToVisualTokens(context.project.id, context.projectIdentity) : null), [context])

  /** Authored state of one slide as the render/stale comparison sees it (not UI state). */
  function slideSignature(slideState: AuthoringState): string {
    return JSON.stringify(authoringStateToPersistedSlide(slideState, 'slide', 0, templateId))
  }
  /** Same, for either mode's unit. */
  function unitSignature(unit: AuthoringSlide | FreeStaticSlide): string {
    return 'state' in unit ? slideSignature(unit.state) : JSON.stringify(unit.composition)
  }

  /** Persists the current composition (either mode). Resolves true only when the row really saved. */
  async function saveNow(): Promise<boolean> {
    if (!units || !context) return false
    setSaveStatus('saving')
    const fields = persistedBodyFields(mode, slides, freeSlides, templateId)
    const snapshot = JSON.stringify(fields)
    try {
      const body = { schemaVersion: STATIC_AUTHORING_STATE_SCHEMA_VERSION, channelPieceId: context.channelPiece.id, ...fields }
      const response = await fetch('/api/creative/static-authoring-state', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
      if (!response.ok) throw new Error('persist failed')
      setLastSavedSnapshot(snapshot)
      setSaveStatus('saved')
      return true
    } catch {
      setSaveStatus('error')
      return false
    }
  }

  async function downloadCarouselZip() {
    if (!context || !isCarousel || zipBusy) return
    setZipBusy(true)
    setZipError(null)
    try {
      const response = await fetch(`/api/creative/static-authoring/export?channelPieceId=${encodeURIComponent(context.channelPiece.id)}`)
      if (!response.ok) {
        const payload = await response.json().catch(() => null) as { error?: string } | null
        throw new Error(payload?.error || 'Não foi possível preparar o ZIP.')
      }
      const blob = await response.blob()
      const url = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = 'carousel.zip'
      document.body.appendChild(anchor)
      anchor.click()
      anchor.remove()
      URL.revokeObjectURL(url)
    } catch (cause: unknown) {
      setZipError(cause instanceof Error ? cause.message : 'Não foi possível preparar o ZIP.')
    } finally {
      setZipBusy(false)
    }
  }

  // Optional autosave — OFF by default (see docs/productization/creative-rendering/
  // CREATIVE_EDITOR_STATIC_SHELL_FOUNDATION_V1.md for the previous always-on behavior
  // this replaces). Reuses the same 600ms debounce and the same PUT as explicit Save.
  useEffect(() => {
    if (!units) return
    // The skip exists only to never autosave the load/hydration itself. Consume it on
    // the first run after load regardless of autosave/dirty: it used to wait for the
    // first dirty run with autosave ON, silently swallowing the author's first real
    // edit (Authoring Usability Completion V1 production smoke finding).
    if (skipNextAutosaveRef.current) { skipNextAutosaveRef.current = false; return }
    if (!autosaveEnabled || !dirty) return
    const timeout = setTimeout(() => { void saveNow() }, 600)
    return () => clearTimeout(timeout)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slides, freeSlides, mode, autosaveEnabled, dirty])

  const currentSlide = mode === 'template' ? slides?.[currentSlideIndex] ?? null : null
  const currentFreeSlide = mode === 'free' ? freeSlides?.[currentSlideIndex] ?? null : null
  const currentUnit: AuthoringSlide | FreeStaticSlide | null = currentSlide ?? currentFreeSlide
  const state = currentSlide?.state ?? null

  /** One free-slide edit (the shared free-composition helpers), applied to the current free unit only. */
  function editCurrentFree(edit: (slide: FreeStaticSlide) => FreeStaticSlide) {
    setFreeSlides((current) => current ? current.map((slide, index) => (index === currentSlideIndex ? edit(slide) : slide)) : current)
  }

  /** STATIC_TEMPLATE_CUSTOM_ELEMENTS_V1: wrapper to edit the template's custom elements array using the free composition helpers. */
  function editCurrentCustomElements(edit: (scene: FreeHost & { id: string }) => FreeHost & { id: string }) {
    if (!state) return
    const host: FreeHost & { id: string } = { id: 'custom', composition: { kind: 'free' as const, elements: state.elements ?? [] } }
    const next = edit(host)
    if (next.composition && typeof next.composition === 'object' && 'kind' in next.composition && next.composition.kind === 'free') {
      dispatch({ type: 'SET_CUSTOM_ELEMENTS', elements: (next.composition as FreeSceneComposition).elements })
    }
  }

  /** A fresh slide id, never one used before in this session (removed, switched away from, or with renders). */
  function freshSlideIds(count: number): string[] {
    const taken = [...(units ?? []).map((unit) => unit.id), ...reservedSlideIdsRef.current]
    const ids: string[] = []
    for (let index = 0; index < count; index += 1) {
      const id = nextSlideId([...taken, ...ids])
      ids.push(id)
    }
    return ids
  }

  /**
   * Explicit Template entry: REPLACES the composition with the Template's own
   * defaults (the carousel's Cover + Info, or a single piece's contextual
   * Cover). No mapping from free elements. Unsaved until Salvar/autosave.
   */
  function enterTemplate(nextTemplateId: string) {
    if (!context) return
    const productContext = buildProductContext(context)
    const canvas = canvasKind(context)
    const created: AuthoringSlide[] = isCarousel
      ? defaultCarouselSlides(context.primitiveProjectRef, nextTemplateId).map((slide) => ({ id: slide.id, order: slide.order, state: persistedSlideToAuthoringState(slide, productContext, canvas, nextTemplateId) }))
      : [singleSlideDefault(context, productContext)]
    const ids = freshSlideIds(created.length)
    for (const unit of units ?? []) reservedSlideIdsRef.current.add(unit.id)
    setTemplateId(nextTemplateId)
    setTemplateFallback(false)
    setSlides(created.map((slide, index) => ({ ...slide, id: ids[index], order: index })))
    setFreeSlides(null)
    setMode('template')
    setCurrentSlideIndex(0)
    setOpenElementId(null)
  }

  /** Explicit free entry: REPLACES the Template composition with ONE blank free unit (no conversion). */
  function enterFree() {
    const [id] = freshSlideIds(1)
    for (const unit of units ?? []) reservedSlideIdsRef.current.add(unit.id)
    setFreeSlides([createFreeStaticSlide(id, 0)])
    setSlides(null)
    setMode('free')
    setCurrentSlideIndex(0)
    setOpenElementId(null)
  }

  function switchSlide(index: number) {
    // Render jobs are per-slide: switching never clears or rebinds them.
    setCurrentSlideIndex(index)
    // Free element ids are slide-local: a selection never survives into another slide.
    // (Template Camadas keep their disclosure: element ids are shared by slides of the same layout.)
    if (mode === 'free') setOpenElementId(null)
  }

  const dispatch = (action: AuthoringAction) => setSlides((current) => current
    ? current.map((slide, index) => index === currentSlideIndex ? { ...slide, state: authoringReducer(slide.state, action) } : slide)
    : current)

  /** Template Layout A → B: ONE deterministic replacement (Layout-owned state resets, Custom Elements stay). */
  function applyLayoutSwitch(layoutId: string) {
    const customIds = new Set((state?.elements ?? []).map((element) => element.id))
    dispatch({ type: 'SET_VARIANT', variant: layoutId as AuthoringState['variant'], templateId: template.id })
    // A Template element disclosure of the old Layout is closed; a selected Custom Element is kept.
    setOpenElementId((current) => (current && customIds.has(current) ? current : null))
  }
  /** Confirm only when meaningful Layout-owned authored work would be discarded. */
  function requestLayoutSwitch(layoutId: string) {
    if (state && hasLayoutOwnedAuthoredWork(state, template.id)) setPendingLayoutId(layoutId)
    else applyLayoutSwitch(layoutId)
  }

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
    const saved = JSON.parse(lastSavedSnapshot) as { composition?: 'free'; slides: PersistedStaticSlide[] }
    if (saved.composition === 'free') {
      // Back to the saved FREE composition (also undoes an unsaved Template entry).
      const restoredFree = sortedSlides(saved.slides.filter(isPersistedFreeSlide)).map(({ id, order, composition }) => ({ id, order, composition }))
      setMode('free')
      setFreeSlides(restoredFree)
      setSlides(null)
      setCurrentSlideIndex((index) => Math.min(index, restoredFree.length - 1))
      return
    }
    const persisted = JSON.parse(lastSavedSnapshot) as { templateId: string; slides: PersistedAuthoredSlide[] }
    const productContext = buildProductContext(context)
    const canvas = canvasKind(context)
    setMode('template')
    setFreeSlides(null)
    setTemplateId(persisted.templateId)
    const restored = sortedSlides(persisted.slides).map((slide) => ({ id: slide.id, order: slide.order, state: persistedSlideToAuthoringState(slide, productContext, canvas, persisted.templateId) }))
    setSlides(restored)
    // An unsaved added slide disappears on revert: keep the selection inside the restored collection.
    setCurrentSlideIndex((index) => Math.min(index, restored.length - 1))
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
    if (mode === 'free') { addFreeSlide(); return }
    const template = resolveAuthoringTemplate(templateId).template
    const layoutId = currentSlide?.state.variant && getTemplateLayout(template, currentSlide.state.variant) ? currentSlide.state.variant : template.layouts[0].id
    setAddLayoutId(layoutId)
    setAddAppearance(getTemplateLayout(template, layoutId)?.defaultAppearance ?? 'light')
    setAddSlideOpen(true)
  }

  /** Free carousel: appends one blank free slide and selects it. Unsaved until Salvar/autosave. */
  function addFreeSlide() {
    if (!freeSlides || freeSlides.length >= MAX_CAROUSEL_SLIDES) return
    const [id] = freshSlideIds(1)
    setFreeSlides([...freeSlides, createFreeStaticSlide(id, nextSlideOrder(freeSlides))])
    setCurrentSlideIndex(freeSlides.length)
    setOpenElementId(null)
  }

  /** Appends a Template-initialized slide (never a clone) and selects it. Unsaved until Salvar/autosave. */
  function addSlide() {
    if (!context || !slides || slides.length >= MAX_CAROUSEL_SLIDES) return
    const created = createTemplateSlide({
      templateId,
      layoutId: addLayoutId,
      appearance: addAppearance,
      id: nextSlideId([...slides.map((slide) => slide.id), ...reservedSlideIdsRef.current]),
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

  /**
   * Static Detail Polish V1 — "Remover slide": authored collection only (unsaved
   * until Salvar/autosave; Voltar ao salvo brings it back). Stable ids are kept,
   * orders are renumbered; durable outputs (LibraryFile, ChannelPieceMedia,
   * render executions, Gallery) are never touched.
   */
  function removeCurrentSlide() {
    if (!units || !currentUnit || units.length <= 1) return
    reservedSlideIdsRef.current.add(currentUnit.id)
    if (mode === 'free' && freeSlides) {
      const result = removeSlideFromCollection(freeSlides, currentSlideIndex)
      setFreeSlides(result.slides)
      setCurrentSlideIndex(result.selectedIndex)
      setOpenElementId(null)
      setRemoveDialogOpen(false)
      return
    }
    if (!slides) return
    const result = removeSlideFromCollection(slides, currentSlideIndex)
    setSlides(result.slides)
    setCurrentSlideIndex(result.selectedIndex)
    setOpenElementId(null)
    setRemoveDialogOpen(false)
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
    return { ...documentaryCardPropsFromResolvedInput(previewWithSequence, 'still', undefined, state.tuning, materials, undefined, { templateId, elementOrder: state.elementOrder, hiddenElements: deriveHiddenElementsRequest(state, templateId) }), primitiveTransforms: derivePrimitiveTransformsRequest(state) }
  }, [previewInput, state, slides, currentSlideIndex, templateId, projectImages])

  /** "Gerar PNG" of a FREE unit: the template-free still (same execution plane; no TemplateRef). */
  async function renderFree(unit: FreeStaticSlide) {
    if (!context || !freeSlides) return
    const slideRef = { id: unit.id, index: currentSlideIndex + 1, total: freeSlides.length }
    const previous = renderJobs[slideRef.id]
    if (previous && isActiveRenderPhase(previous.phase)) return
    const body = {
      context: { projectId: context.project.id, editorialContentId: context.editorialContent.id, channelPieceId: context.channelPiece.id },
      composition: unit.composition,
      idempotencyKey: crypto.randomUUID(),
      slide: slideRef,
      ...(previous?.phase === 'failed' && previous.executionId ? { retryOfExecutionId: previous.executionId } : {}),
    }
    setRenderJobs((jobs) => startRenderJob(jobs, slideRef, Date.now(), unitSignature(unit)))
    try {
      const response = await fetch('/api/creative/static-authoring/render', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
      const payload = await response.json().catch(() => null) as { executionId?: string; status?: RenderExecutionSummary['status']; error?: string } | null
      if (!response.ok || !payload?.executionId || !payload.status) throw new Error(payload?.error || 'Nao foi possivel enfileirar o render.')
      setRenderJobs((jobs) => attachExecution(jobs, slideRef.id, payload.executionId as string, payload.status as RenderExecutionSummary['status']))
    } catch (cause: unknown) {
      setRenderJobs((jobs) => failEnqueue(jobs, slideRef.id, cause instanceof Error ? cause.message : 'Nao foi possivel enfileirar o render.', Date.now()))
    }
  }

  async function render() {
    if (currentFreeSlide) { await renderFree(currentFreeSlide); return }
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
    const hiddenElements = deriveHiddenElementsRequest(state, templateId)
    const body = {
      manifest,
      context: { projectId: state.productContext.projectId, editorialContentId: state.productContext.editorialContentId, channelPieceId: state.productContext.channelPieceId },
      ...(selection ? { primitiveSelection: selection } : {}),
      ...(transforms ? { primitiveTransforms: transforms } : {}),
      ...(overrides ? { overrides } : {}),
      templateId,
      elementOrder: deriveElementOrderRequest(state, templateId),
      ...(hiddenElements ? { hiddenElements } : {}),
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

  const slidesRef = useRef<(AuthoringSlide | FreeStaticSlide)[] | null>(null)
  useEffect(() => { slidesRef.current = mode === 'free' ? freeSlides : slides }, [slides, freeSlides, mode])

  // Refresh/reopen: rebind recent executions to the slides that created them.
  const channelPieceIdForRenders = context?.channelPiece.id ?? null
  const slideIdsKey = units?.map((slide) => slide.id).join(',') ?? ''
  useEffect(() => {
    if (!channelPieceIdForRenders || !slideIdsKey || hydratedRenderJobsRef.current === channelPieceIdForRenders) return
    hydratedRenderJobsRef.current = channelPieceIdForRenders
    let cancelled = false
    void (async () => {
      try {
        const response = await fetch(`/api/render-executions?channelPieceId=${channelPieceIdForRenders}`)
        if (!response.ok) return
        const payload = await response.json() as { executions?: RenderExecutionSummary[] }
        for (const execution of payload.executions ?? []) if (execution.slide?.id) reservedSlideIdsRef.current.add(execution.slide.id)
        // Baseline for "Alterações ainda não renderizadas": the authored state at load. Any later edit is provably absent from these older renders.
        const signaturesAtLoad = Object.fromEntries((slidesRef.current ?? []).map((slide) => [slide.id, unitSignature(slide)]))
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
    // CREATIVE_EDITOR_FREE_DEFAULT_AND_TEMPLATE_ENTRY_V1: a durable output never
    // outlives its authored source. Unsaved authoring is saved FIRST; if that
    // save fails, nothing is attached.
    if (dirty && !(await saveNow())) {
      setRenderJobs((jobs) => patchJobByExecution(jobs, executionId, { save: 'error', saveError: 'Salve a autoria antes de anexar: o salvamento falhou.' }))
      return
    }
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

  if (error && !context) return <DashboardPage><DashboardPageContent width="4xl"><Card><CardContent className="p-6"><p className="text-sm text-muted-foreground">{error}</p><Button className="mt-4" variant="outline" onClick={() => router.back()}>Voltar</Button></CardContent></Card></DashboardPageContent></DashboardPage>
  if (!context || !units || !currentUnit) return <DashboardPage><DashboardPageContent width="4xl"><div className="flex justify-center py-24"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div></DashboardPageContent></DashboardPage>

  const template = resolveAuthoringTemplate(templateId).template
  const layout = state ? getTemplateLayout(template, state.variant) : undefined
  const elements = state ? elementsForVariant(state.variant, template.id) : []
  // The CURRENT slide's own render job only — other slides' jobs keep running
  // and stay bound to their slides (see static-render-jobs.ts).
  const currentRenderJob = renderJobs[currentUnit.id]
  const currentRenderActive = Boolean(currentRenderJob && isActiveRenderPhase(currentRenderJob.phase))
  const currentRenderStale = isRenderStale(currentRenderJob, unitSignature(currentUnit))
  const previewJob = previewJobSlideId ? renderJobs[previewJobSlideId] : undefined
  const slideTotal = units.length
  // Static Detail Polish V1 (O): the UI shows the page NUMBER only; the total stays in state/aria/render metadata.
  const slideLabel = `Slide ${currentSlideIndex + 1}`
  const currentHasSavedOutput = renderJobs[currentUnit.id]?.save === 'saved'
  // An expanded element the active layout does not have (layout switch) is simply closed.
  const openElement = openElementId && elements.some((element) => element.key === openElementId) ? openElementId : null
  const elementLabels = Object.fromEntries(elements.map((element) => [element.key, element.label]))
  const stack = state ? resolveElementStack(template.id, state.variant, state.elementOrder) : { order: [] as string[] }
  const stackIsDefault = layout ? isDefaultElementOrder(layout, stack.order) : true
  const slotsInUse = layout ? layoutAssetSlots(template, layout) : []
  // STATIC_TEMPLATE_ANATOMY_TREE_V1: derived Sections of this Layout's Elements (registry metadata, never persisted).
  const anatomySections = layout ? resolveLayoutSections(template, layout) : []
  const pickerSlot = assetPickerSlot ? slotsInUse.find(({ slot }) => slot.id === assetPickerSlot)?.slot ?? null : null

  /** The open element's own controls — exactly what its Template control contract supports. */
  function renderElementPanel(id: string) {
    const control = elements.find((element) => element.key === id)?.control
    if (!control || !state) return null
    if (control.type === 'tuning' && control.group === 'hero') return <HeroTuningControls tuning={state.tuning.hero} onChange={(field, value) => setTuningField('hero', field, value)} onReset={() => resetTuningField('hero')} />
    if (control.type === 'tuning') {
      const group = control.group
      const typography = layout ? getLayoutElement(layout, id)?.typography : undefined
      const lineHeight = group === 'title' && typography ? { defaultValue: typography.lineHeight, min: TITLE_LINE_HEIGHT_BOUNDS.min, max: TITLE_LINE_HEIGHT_BOUNDS.max } : undefined
      return <TitleTuningControls tuning={state.tuning[group]} lineHeight={lineHeight} onChange={(field, value) => setTuningField(group, field, value)} onReset={() => resetTuningField(group)} />
    }
    const key = control.key
    return <PrimitiveTransformControls slot={key} transforms={state.primitiveTransforms[key] ?? DEFAULT_PRIMITIVE_TRANSFORMS} onChange={(field, value) => dispatch({ type: 'SET_PRIMITIVE_TRANSFORM', slot: key, field, value })} onReset={() => dispatch({ type: 'RESET_PRIMITIVE_TRANSFORMS', slot: key })} />
  }

  // Structured layouts (Lista, Grade, Mapa, Rede, Citação, Encerramento) edit through their field descriptors.
  const structuredFields = state ? LAYOUT_CONTENT_FIELDS[state.variant] : undefined

  const templateChoices = listTemplateDefinitions().map((definition) => ({ id: definition.id, name: definition.name, description: definition.description }))
  const compositionScope = isCarousel ? 'desta peça (todos os slides)' : 'desta peça'
  const freeWording = { unit: isCarousel ? 'slide' as const : 'arte' as const, stage: 'do formato da peça' }
  const freeUnitElements = mode === 'free' && currentFreeSlide 
    ? freeElements(currentFreeSlide) 
    : state?.elements ?? []

  const freeInspector = currentFreeSlide ? (
    <Tabs value={activeTab} onValueChange={(value) => setActiveTab(value as InspectorSection)}>
      <TabsList className="flex w-full">
        {INSPECTOR_SECTIONS.map((section) => (
          <TabsTrigger key={section.value} value={section.value} className="min-w-0 flex-auto px-1 text-[11px]" title={section.label} aria-label={section.label}>
            <span className="inspector-tab-full">{section.label}</span>
            <span className="inspector-tab-compact" aria-hidden="true">{section.compactLabel}</span>
          </TabsTrigger>
        ))}
      </TabsList>
      <TabsContent value="template" className="space-y-3 pt-3">
        <CompositionModePanel mode="free" templates={templateChoices} scope={compositionScope} freeHasContent={freeCompositionHasContent(freeSlides ?? [])} onChooseTemplate={enterTemplate} onChooseFree={enterFree} />
      </TabsContent>
      <TabsContent value="content" className="space-y-3 pt-3">
        <p className="rounded-md border border-dashed border-border/60 p-2 text-[11px] text-muted-foreground" data-testid="free-static-content">Composição livre: os textos são elementos, editados em Elementos (sem estrutura de template).</p>
      </TabsContent>
      <TabsContent value="assets" className="space-y-2 pt-3">
        <p className="text-[11px] text-muted-foreground">Imagens da Biblioteca usadas pelos elementos {isCarousel ? 'deste slide' : 'desta arte'} (sem slots de template). Trocar aqui usa a mesma imagem do elemento; posição e encaixe ficam em Elementos.</p>
        {freeUnitElements.filter((element) => element.kind === 'image').length === 0 ? <p className="text-[11px] text-muted-foreground" data-testid="free-static-assets-empty">Nenhuma imagem ainda.</p> : null}
        {freeUnitElements.map((element) => element.kind === 'image' ? (
          <div key={element.id} className="flex items-center justify-between gap-2 rounded-md border border-border/60 p-1.5" data-testid="free-static-asset">
            <span className="min-w-0 truncate text-xs">{freeElementLabel(element, projectImages.get(element.library_file_id)?.name)}{element.hidden ? ' (oculta)' : ''}</span>
            <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setFreeImagePicker({ mode: 'replace', elementId: element.id })}>Trocar</Button>
          </div>
        ) : null)}
      </TabsContent>
      <TabsContent value="style" className="pt-3">
        <StyleSourcePanel tokens={freeTokens ?? undefined} free />
      </TabsContent>
      <TabsContent value="element" className="pt-3">
        <FreeSceneElements
          scene={currentFreeSlide}
          fileNames={new Map([...projectImages.values()].map((file) => [file.id, file.name]))}
          openId={openElementId}
          onOpen={setOpenElementId}
          onEdit={editCurrentFree}
          onAddText={() => { const id = crypto.randomUUID(); editCurrentFree((slide) => addFreeTextElement(slide, id)); setOpenElementId(id) }}
          onAddImage={() => setFreeImagePicker({ mode: 'add' })}
          onReplaceImage={(elementId) => setFreeImagePicker({ mode: 'replace', elementId })}
          onRemoved={(elementId) => setOpenElementId((current) => (current === elementId ? null : current))}
          wording={freeWording}
        />
      </TabsContent>
    </Tabs>
  ) : null

  const templateInspector = state ? (
    <Tabs value={activeTab} onValueChange={(value) => setActiveTab(value as InspectorSection)}>
      <TabsList className="flex w-full">
        {INSPECTOR_SECTIONS.map((section) => (
          <TabsTrigger key={section.value} value={section.value} className="min-w-0 flex-auto px-1 text-[11px]" title={section.label} aria-label={section.label}>
            <span className="inspector-tab-full">{section.label}</span>
            <span className="inspector-tab-compact" aria-hidden="true">{section.compactLabel}</span>
          </TabsTrigger>
        ))}
      </TabsList>
      <TabsContent value="template" className="space-y-3 pt-3">
        <CompositionModePanel mode="template" templates={templateChoices} currentTemplateId={template.id} scope={compositionScope} freeHasContent={false} onChooseTemplate={enterTemplate} onChooseFree={enterFree}>
        {/* CREATIVE_EDITOR_TRUTHFUL_CONSTRAINTS_CLEANUP_V1: the Template is named by the mode panel above and changed ONLY through it (confirmed replacement). */}
        {templateFallback ? <p className="text-xs text-destructive" role="alert">Template salvo não reconhecido; usando {template.name}.</p> : null}
        <div className="space-y-1">
          <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground" id="static-layout-label">Estrutura</span>
          <div className="flex flex-wrap gap-2" role="radiogroup" aria-labelledby="static-layout-label">{template.layouts.map((option) => { const checked = state.variant === option.id; return <Button key={option.id} size="sm" variant={checked ? 'default' : 'outline'} role="radio" aria-checked={checked} onClick={() => { if (!checked) requestLayoutSwitch(option.id) }} data-testid="static-layout-option" data-value={option.id}>{option.label}</Button> })}</div>
        </div>
        <div className="space-y-1">
          <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground" id="static-appearance-label">Aparência</span>
          <div className="flex flex-wrap gap-2" role="radiogroup" aria-labelledby="static-appearance-label">{(layout?.supportedAppearances ?? []).map((appearance) => { const checked = state.appearance === appearance; return <Button key={appearance} size="sm" variant={checked ? 'default' : 'outline'} role="radio" aria-checked={checked} onClick={() => { if (!checked && isAppearanceSupported(template, state.variant, appearance)) dispatch({ type: 'SET_APPEARANCE', appearance }) }} data-testid="static-appearance-option" data-value={appearance}>{appearance === 'light' ? 'Light' : 'Dark'}</Button> })}</div>
        </div>
        <p className="text-xs text-muted-foreground">{template.description}</p>
        <TemplateReference template={template} layout={layout} />
        </CompositionModePanel>
      </TabsContent>
      <TabsContent value="content" className="space-y-3 pt-3">
        {structuredFields ? <LayoutContentForm fields={structuredFields} content={state.contentOverride} dispatch={dispatch} /> : <>
          <div><Label htmlFor="visual-title">Título</Label><Textarea id="visual-title" value={(state.contentOverride as { title?: string }).title ?? ''} onChange={(event) => dispatch(state.variant === 'cover' ? { type: 'SET_COVER_FIELD', field: 'title', value: event.target.value } : { type: 'SET_INFO_FIELD', field: 'title', value: event.target.value })} rows={2} /></div>
          {state.variant === 'cover' ? <div><Label htmlFor="visual-subtitle">Texto</Label><Textarea id="visual-subtitle" value={(state.contentOverride as { subtitle?: string }).subtitle ?? ''} onChange={(event) => dispatch({ type: 'SET_COVER_FIELD', field: 'subtitle', value: event.target.value })} rows={4} /></div> : <><div><Label htmlFor="visual-intro">Introdução</Label><Textarea id="visual-intro" value={(state.contentOverride as { intro?: string }).intro ?? ''} onChange={(event) => dispatch({ type: 'SET_INFO_FIELD', field: 'intro', value: event.target.value })} rows={2} /></div><div><Label htmlFor="visual-body">Corpo (um parágrafo por linha)</Label><Textarea id="visual-body" value={(state.contentOverride as { body_blocks?: string[] }).body_blocks?.join('\n') ?? ''} onChange={(event) => dispatch({ type: 'SET_INFO_BODY', value: event.target.value })} rows={3} /></div></>}
        </>}
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
        {layout ? (
          <TemplateElementsTab
            layoutLabel={layout.label}
            sections={anatomySections}
            order={stack.order}
            labels={elementLabels}
            openId={openElement}
            isDefaultOrder={stackIsDefault}
            hidden={new Set(state.hiddenElements ?? [])}
            onToggle={(id) => setOpenElementId((current) => (current === id ? null : id))}
            onToggleVisibility={(id) => dispatch({ type: 'TOGGLE_ELEMENT_VISIBILITY', id })}
            onReorder={(order) => dispatch({ type: 'SET_ELEMENT_ORDER', order })}
            onRestoreDefault={() => dispatch({ type: 'RESET_ELEMENT_ORDER' })}
            renderPanel={renderElementPanel}
            custom={{
              scene: { id: 'custom', composition: { kind: 'free', elements: state.elements ?? [] } },
              fileNames: new Map([...projectImages.values()].map((file) => [file.id, file.name])),
              openId: openElementId,
              onOpen: setOpenElementId,
              onEdit: editCurrentCustomElements,
              onAddText: () => { const id = crypto.randomUUID(); editCurrentCustomElements((host) => addFreeTextElement(host, id)); setOpenElementId(id) },
              onAddImage: () => setFreeImagePicker({ mode: 'add' }),
              onReplaceImage: (elementId) => setFreeImagePicker({ mode: 'replace', elementId }),
              onRemoved: (elementId) => setOpenElementId((current) => (current === elementId ? null : current)),
              wording: freeWording,
            }}
          />
        ) : null}
      </TabsContent>
    </Tabs>
  ) : null

  const inspector = mode === 'free' ? freeInspector : templateInspector

  // Free canvas: the SAME drawing the still render uses (FreeStage), with the Library display URLs.
  const customSelecting = interactionMode === 'select'
  const freeStage = currentFreeSlide && freeTokens 
    ? deriveFreeSegment(currentFreeSlide.composition) 
    : mode === 'template' && state?.elements && state.elements.length > 0 && freeTokens
      ? deriveFreeSegment({ kind: 'free', elements: state.elements })
      : null
  const canvas = (
    <div className={floating ? 'flex h-full min-h-0 flex-col' : 'flex flex-col'}>
      <div
        ref={attachPreviewViewport}
        className={floating ? 'relative min-h-0 flex-1 overflow-hidden' : 'relative h-[min(62vh,560px)] overflow-hidden'}
        style={{ cursor: customSelecting ? 'default' : viewport.panning ? 'grabbing' : 'grab', touchAction: floating || customSelecting ? 'none' : 'pan-y' }}
        {...(customSelecting ? {} : viewport.panHandlers)}
        data-interaction-mode={interactionMode}
        aria-label="Canvas (arraste para mover a visualização)"
        data-testid="canvas-viewport"
        data-pan={`${Math.round(viewport.effectivePan.x)},${Math.round(viewport.effectivePan.y)}`}
      >
        <div className="absolute overflow-hidden" style={{ left: viewport.origin.left, top: viewport.origin.top, width: viewport.scaledWidth, height: viewport.scaledHeight }} data-testid="canvas-surface">
          <div style={{ position: 'relative', width: canvasW, height: canvasH, transform: `scale(${viewport.scale})`, transformOrigin: 'top left', pointerEvents: 'none' }}>
            {mode === 'template' && cardProps ? <DocumentaryCard {...cardProps} /> : null}
            {freeStage && freeTokens ? (
              <FreeStage
                overlay={mode === 'template'}
                elements={freeStage.payload.elements}
                width={canvasW}
                height={canvasH}
                tokens={freeTokens}
                imageUrl={(ref) => { const file = projectImages.get(freeStage.assets[ref]?.ref ?? ''); return file?.public_url ? { url: file.public_url, alt: file.name } : undefined }}
                // eslint-disable-next-line @next/next/no-img-element -- editor preview of a signed Library display URL
                ImageComponent={(props) => <img {...props} alt={props.alt ?? ''} />}
                dataAttributes={{ 'data-testid': 'free-static-stage' }}
              />
            ) : null}
          </div>
        </div>
        {currentFreeSlide && freeUnitElements.length === 0 ? (
          <p className="pointer-events-none absolute inset-x-0 top-3 mx-auto w-fit rounded bg-black/60 px-2 py-1 text-[11px] text-white" data-testid="free-static-empty-hint">Composição livre em branco · adicione texto ou imagem em Elementos, ou escolha um template na aba Template</p>
        ) : null}
        {customSelecting && freeUnitElements.length > 0 ? (
          <FreeElementsOverlay
            left={viewport.origin.left}
            top={viewport.origin.top}
            width={viewport.scaledWidth}
            height={viewport.scaledHeight}
            elements={freeUnitElements.filter((element) => !element.hidden)}
            editable
            selectedElementId={openElementId}
            onSelect={(elementId) => { setOpenElementId(elementId); if (elementId) setActiveTab('element') }}
            onBoxChange={(elementId, box) => mode === 'template' ? editCurrentCustomElements((host) => setFreeElementBox(host, elementId, box)) : editCurrentFree((slide) => setFreeElementBox(slide, elementId, box))}
            onInteractionStart={() => undefined}
            hostId={mode === 'template' ? 'custom' : currentFreeSlide?.id ?? 'free'}
          />
        ) : null}
      </div>
      <div className="flex shrink-0 flex-nowrap items-center justify-between gap-2 overflow-x-auto border-t border-border/40 px-3 py-1.5" data-testid="editor-lower-toolbar">
        {isCarousel && <div className="flex shrink-0 items-center gap-1" role="group" aria-label="Slides" data-testid="slide-nav">
          <Button size="icon-sm" variant="outline" onClick={() => switchSlide(Math.max(0, currentSlideIndex - 1))} disabled={currentSlideIndex === 0} aria-label="Slide anterior"><ArrowLeft className="h-3.5 w-3.5" /></Button>
          {visibleSlideIndexes(slideTotal, currentSlideIndex, viewport.size.width > 0 && viewport.size.width < 600 ? 3 : 5).map((index) => { const slide = units[index]; return <Button key={slide.id} size="sm" className="min-w-8 px-2 text-xs" variant={index === currentSlideIndex ? 'default' : 'outline'} aria-pressed={index === currentSlideIndex} aria-label={`Slide ${index + 1} de ${slideTotal}`} onClick={() => switchSlide(index)}>{index + 1}</Button> })}
          <Button size="icon-sm" variant="outline" onClick={() => switchSlide(Math.min(slideTotal - 1, currentSlideIndex + 1))} disabled={currentSlideIndex === slideTotal - 1} aria-label="Próximo slide"><ArrowRight className="h-3.5 w-3.5" /></Button>
          <Button size="icon-sm" variant="outline" className="ml-1" onClick={openAddSlide} disabled={slideTotal >= MAX_CAROUSEL_SLIDES} aria-label="Adicionar slide" title={slideTotal >= MAX_CAROUSEL_SLIDES ? `Limite de ${MAX_CAROUSEL_SLIDES} slides` : 'Adicionar slide'} data-testid="add-slide"><Plus className="h-3.5 w-3.5" /></Button>
          <Button size="icon-sm" variant="ghost" className="text-muted-foreground hover:text-destructive" onClick={() => setRemoveDialogOpen(true)} disabled={slideTotal <= 1} aria-label={`Remover slide ${currentSlideIndex + 1}`} title={slideTotal <= 1 ? 'O carrossel precisa de pelo menos um slide' : 'Remover slide'} data-testid="remove-slide"><Trash2 className="h-3.5 w-3.5" /></Button>
        </div>}
        <div className="flex shrink-0 items-center rounded-md border border-border/60 p-0.5" role="radiogroup" aria-label="Ferramenta do canvas" data-testid="preview-tool">
          <Button size="icon-sm" variant={interactionMode === 'select' ? 'secondary' : 'ghost'} role="radio" aria-checked={interactionMode === 'select'} onClick={() => setInteractionMode('select')} aria-label="Selecionar e editar" title="Selecionar e editar (mover e redimensionar elementos livres)" data-testid="preview-tool-select"><MousePointer2 className="h-3.5 w-3.5" /></Button>
          <Button size="icon-sm" variant={interactionMode === 'pan' ? 'secondary' : 'ghost'} role="radio" aria-checked={interactionMode === 'pan'} onClick={() => setInteractionMode('pan')} aria-label="Mão (mover a visualização)" title="Mão: arrastar move a visualização" data-testid="preview-tool-pan"><Hand className="h-3.5 w-3.5" /></Button>
        </div>
        <ViewportZoomControls
          zoom={viewport.zoom}
          fitScale={viewport.fitScale}
          onZoomChange={viewport.setZoom}
          onStep={viewport.step}
          onAction={viewport.action}
          trailing={floating && !inspectorOpen ? <Button size="icon-sm" variant="outline" onClick={() => setInspectorOpen(true)} aria-label="Abrir Inspector" title="Abrir Inspector" data-testid="inspector-launcher"><PanelRight className="h-3.5 w-3.5" /></Button> : null}
        />
        {<div className="flex shrink-0 items-center gap-1" role="group" aria-label="Estado da autoria">
          <Button size="sm" variant="ghost" className="h-8 shrink-0 gap-1 px-1.5 text-[11px]" disabled={!dirty || !lastSavedSnapshot} onClick={revert} title="Descartar alterações não salvas e restaurar o último estado salvo."><Undo2 className="h-3 w-3" />Voltar ao salvo</Button>
          {mode === 'template' ? <Button size="sm" variant="ghost" className="h-8 shrink-0 gap-1 px-1.5 text-[11px]" onClick={() => setRestoreDialogOpen(true)} title={`Aplicar ${isCarousel ? 'ao slide atual' : 'à arte'} os valores padrão do Template (ainda é preciso Salvar).`}><RotateCcw className="h-3 w-3" />Restaurar padrão do Template</Button> : null}
          <label className="ml-1 flex shrink-0 cursor-pointer items-center gap-1 text-[11px] text-muted-foreground"><input type="checkbox" checked={autosaveEnabled} onChange={(event) => setAutosaveEnabled(event.target.checked)} />Auto-save</label>
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
          <span aria-hidden="true">·</span><span className="shrink-0" data-testid="header-composition-mode">{mode === 'free' ? 'Livre' : template.name}</span>
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
          <button type="button" className="h-7 w-[22px] shrink-0 overflow-hidden rounded border border-border/60 bg-muted" onClick={() => setPreviewJobSlideId(currentRenderJob.slideId)} aria-label={isCarousel ? `Ver PNG do slide ${currentRenderJob.slideIndex} de ${currentRenderJob.slideTotal}` : 'Ver PNG da arte'} title="Ver PNG">
            {/* eslint-disable-next-line @next/next/no-img-element -- short-lived presigned scratch URL, not an optimizable asset */}
            {currentRenderJob.imageUrl ? <img src={currentRenderJob.imageUrl} alt="" className="h-full w-full object-cover" /> : null}
          </button>
          <Check className="h-3.5 w-3.5 text-[var(--indicator-success,theme(colors.green.600))]" />{renderPhaseLabel('ready')}{currentRenderJob.finishedAt ? ` · ${Math.max(1, Math.round((currentRenderJob.finishedAt - currentRenderJob.startedAt) / 1000))}s` : ''}
          {currentRenderJob.save === 'saved'
            ? <span className="flex items-center gap-1 text-foreground" data-testid="render-attached" title="Este PNG já está anexado à peça (Galeria / Imagens geradas).">✓ Salvo nesta peça</span>
            : <Button size="sm" variant="outline" className="h-7 px-2 text-[11px]" disabled={currentRenderJob.save === 'saving'} onClick={() => void saveRenderOutput(currentRenderJob)} title={currentRenderJob.saveError ?? 'Anexar este PNG à peça (fica disponível na Galeria / Imagens geradas).'}>{currentRenderJob.save === 'saving' ? 'Salvando…' : currentRenderJob.save === 'error' ? 'Tentar salvar de novo' : 'Salvar nesta peça'}</Button>}
        </span>}
        {currentRenderStale && <span className="text-xs text-amber-600 dark:text-amber-400" data-testid="render-stale" title="O PNG atual não inclui as alterações feitas depois dele. Gere um novo PNG para incluí-las.">Alterações ainda não renderizadas</span>}
        <span className="text-xs text-muted-foreground" data-testid="save-status">{saveStatusLabel}</span>
        {<Button size="sm" variant="outline" className="gap-1.5" disabled={!dirty && saveStatus !== 'error'} onClick={() => void saveNow()} title="Salvar o estado de autoria (não gera PNG nem anexa mídia).">{saveStatus === 'saving' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}Salvar</Button>}
        {isCarousel && <div className="flex shrink-0 items-center gap-1">
          <Button size="sm" variant="outline" className="gap-1.5" disabled={zipBusy} onClick={() => void downloadCarouselZip()} title="Baixar os PNGs duráveis do carrossel em um ZIP" data-testid="download-carousel-zip">{zipBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}Baixar ZIP</Button>
          {zipError ? <span className="max-w-40 truncate text-[11px] text-destructive" role="alert" title={zipError}>{zipError}</span> : null}
        </div>}
        <Button size="sm" onClick={() => void render()} disabled={currentRenderActive} className="gap-1.5" title={`Gerar um PNG do estado atual ${isCarousel ? 'deste slide' : 'desta arte'} (não salva a autoria).`}>{currentRenderActive ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}{currentRenderActive && currentRenderJob ? renderPhaseLabel(currentRenderJob.phase) : 'Gerar PNG'}</Button>
      </div>
    </header>
  )

  const removeDialog = <AlertDialog open={removeDialogOpen} onOpenChange={setRemoveDialogOpen}><AlertDialogContent data-testid="remove-slide-dialog"><AlertDialogHeader><AlertDialogTitle>Remover slide {currentSlideIndex + 1}?</AlertDialogTitle><AlertDialogDescription>Este slide será removido do estado de autoria (clique em Salvar para persistir). Arquivos e renders já salvos na peça não serão excluídos automaticamente.{currentHasSavedOutput ? ' Este slide tem um PNG salvo nesta peça: ele continua anexado à peça e na Galeria.' : ''}</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>Cancelar</AlertDialogCancel><AlertDialogAction className="bg-destructive text-destructive-foreground hover:bg-destructive/90" onClick={removeCurrentSlide}>Remover slide</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
  const pendingLayoutLabel = pendingLayoutId ? getTemplateLayout(template, pendingLayoutId)?.label : undefined
  const layoutSwitchDialog = <LayoutSwitchDialog layoutLabel={pendingLayoutLabel ?? null} onCancel={() => setPendingLayoutId(null)} onConfirm={() => { if (pendingLayoutId) applyLayoutSwitch(pendingLayoutId); setPendingLayoutId(null) }} />
  const restoreDialog = <>{layoutSwitchDialog}{removeDialog}<AlertDialog open={restoreDialogOpen} onOpenChange={setRestoreDialogOpen}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>Restaurar padrão do Template?</AlertDialogTitle><AlertDialogDescription>Os valores padrão do Template serão aplicados {isCarousel ? 'ao slide atual' : 'à arte'}. Clique em Salvar para persistir.</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>Cancelar</AlertDialogCancel><AlertDialogAction onClick={restoreSlideDefault}>Restaurar</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
    <ProjectLibraryAssetPicker
      open={Boolean(pickerSlot)}
      onOpenChange={(open) => { if (!open) setAssetPickerSlot(null) }}
      projectId={context.project.id}
      selectedId={pickerSlot ? state?.assetOverrides?.[pickerSlot.id]?.libraryFileId ?? null : null}
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
    <ProjectLibraryAssetPicker
      open={freeImagePicker !== null}
      onOpenChange={(open) => { if (!open) setFreeImagePicker(null) }}
      projectId={context.project.id}
      selectedId={freeImagePicker?.mode === 'replace' ? (freeUnitElements.find((element) => element.id === freeImagePicker.elementId) as { library_file_id?: string } | undefined)?.library_file_id ?? null : null}
      allowedKinds={['image']}
      allowedMimeTypes={SLOT_IMAGE_MIME_TYPES}
      groupByOrigin
      title="Imagem da composição livre"
      description="Escolha uma imagem do Projeto. Ela é referenciada (não copiada) e posicionada dentro do formato da peça."
      onSelect={(file) => {
        setProjectImages((current) => new Map(current).set(file.id, file))
        const picker = freeImagePicker
        if (mode === 'template') {
          if (picker?.mode === 'replace') editCurrentCustomElements((host) => updateFreeElement(host, picker.elementId, { library_file_id: file.id }))
          else { const id = crypto.randomUUID(); editCurrentCustomElements((host) => addFreeImageElement(host, id, file.id)); setOpenElementId(id) }
        } else {
          if (picker?.mode === 'replace') editCurrentFree((slide) => updateFreeElement(slide, picker.elementId, { library_file_id: file.id }))
          else { const id = crypto.randomUUID(); editCurrentFree((slide) => addFreeImageElement(slide, id, file.id)); setOpenElementId(id) }
        }
        setFreeImagePicker(null)
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
            <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Estrutura do novo slide">
              {template.layouts.map((option) => <Button key={option.id} size="sm" variant={addLayoutId === option.id ? 'default' : 'outline'} role="radio" aria-checked={addLayoutId === option.id} onClick={() => { setAddLayoutId(option.id); setAddAppearance(option.defaultAppearance) }}>{option.label}</Button>)}
            </div>
          </div>
          <div className="space-y-1.5">
            <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Aparência</span>
            <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Aparência do novo slide">
              {(getTemplateLayout(template, addLayoutId)?.supportedAppearances ?? []).map((appearance) => <Button key={appearance} size="sm" variant={addAppearance === appearance ? 'default' : 'outline'} role="radio" aria-checked={addAppearance === appearance} onClick={() => setAddAppearance(appearance)}>{appearance === 'light' ? 'Light' : 'Dark'}</Button>)}
            </div>
          </div>
          <p className="text-xs text-muted-foreground">Será o slide {slideTotal + 1}.</p>
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
          <DialogTitle>{isCarousel ? `PNG · Slide ${previewJob?.slideIndex}` : 'PNG da arte'}</DialogTitle>
          <DialogDescription>Render gerado (rascunho). Use “Salvar nesta peça” para anexá-lo à peça.</DialogDescription>
        </DialogHeader>
        {/* eslint-disable-next-line @next/next/no-img-element -- short-lived presigned scratch URL, not an optimizable asset */}
        {previewJob?.imageUrl ? <img src={previewJob.imageUrl} alt={isCarousel ? `PNG do slide ${previewJob.slideIndex} de ${previewJob.slideTotal}` : 'PNG da arte'} className="max-h-[70vh] w-full rounded border border-border/60 object-contain" data-testid="render-preview-image" /> : null}
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
        <CreativeWorkbench className="flex-1 overflow-hidden rounded-lg border border-border/50 bg-background" canvas={canvas} inspector={inspector} inspectorOpen={inspectorOpen} onInspectorOpenChange={setInspectorOpen} />
        {restoreDialog}
      </div>
    </DashboardPage>
  )
}

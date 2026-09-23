'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { AlertCircle, ArrowLeft, ArrowRight, Check, ChevronDown, Loader2, Minus, Play, Plus, RotateCcw, Undo2 } from 'lucide-react'
import { DashboardPage, DashboardPageContent } from '@/components/layout/dashboard-page'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog'
import { ContextMetadata } from '@/components/ui/context-metadata'
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { DocumentaryCard, documentaryCardPropsFromResolvedInput } from '@/components/creative/documentary-card'
import { PrimitivePicker, PrimitiveTransformControls, HeroTuningControls, TitleTuningControls } from '@/components/creative/authoring/primitive-controls'
import { CreativeWorkbench, StackedWorkbench, useFloatingWorkbench } from '@/components/creative/editor/creative-workbench'
import { INSPECTOR_SECTIONS, channelFormatLabel, type InspectorSection } from '@/lib/creative/authoring/editor-workspace'
import { adaptProjectIdentityToVisualTokens } from '@/lib/creative/integration/project-identity-adapter'
import {
  authoringReducer, createContextualAuthoringState, deriveManifestFromState, derivePrimitiveSelectionRequest,
  derivePrimitiveTransformsRequest, deriveTuningOverrides, resolvePreviewInput, DEFAULT_TUNING,
  type AuthoringAction, type AuthoringProductContext, type AuthoringState,
  STATIC_AUTHORING_STATE_SCHEMA_VERSION, sortedSlides, defaultCarouselSlides, authoringStateToPersistedSlide,
  persistedSlideToAuthoringState, type PersistedAuthoredSlide,
} from '@/lib/creative/authoring'
import { contextualContentForChannelPiece } from '@/lib/creative/context/static-authoring'
import type { ProjectIdentity } from '@/lib/schemas/project-identity'
import type { StaticAuthoringTarget } from '@/lib/creative/context/static-authoring'
import type { Project, Production, EditorialContent, ChannelPiece } from '@/lib/types'
import type { PrimitiveListItem } from '@/lib/creative/primitives/discovery'
import { calculatePreviewFitScale } from '@/lib/creative/authoring/viewport'

type ContextResponse = { project: Project; production: Production | null; editorialContent: EditorialContent; channelPiece: ChannelPiece; target: StaticAuthoringTarget; projectIdentity: ProjectIdentity; primitiveProjectRef: string | null; primitives: PrimitiveListItem[] }
type RenderResult = { image_data_url: string; duration_ms: number; output_identifier: string; diagnostics: unknown[] }
type StaticAuthoringStateResponse = { state: { schemaVersion: string; channelPieceId: string; slides: PersistedAuthoredSlide[] } | null }
type AuthoringSlide = { id: string; order: number; state: AuthoringState }
type ElementKey = 'title' | 'hero' | 'paper' | 'paperStrip' | 'tape1' | 'tape2' | 'tape3' | 'botanical' | 'pin'

const ZOOM_LEVELS = [0.25, 0.33, 0.4, 0.5, 0.75, 1, 1.25, 1.5]
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

function persistedSnapshot(slides: AuthoringSlide[]): string {
  return JSON.stringify(slides.map(({ id, order, state }) => authoringStateToPersistedSlide(state, id, order)))
}

function elementsForVariant(variant: AuthoringState['variant']): { key: ElementKey; label: string }[] {
  const shared: { key: ElementKey; label: string }[] = [
    { key: 'title', label: 'Título' },
    { key: 'paper', label: 'Paper' },
    { key: 'paperStrip', label: 'Faixa do título' },
    { key: 'tape1', label: 'Fita do título' },
    { key: 'tape2', label: 'Fita da imagem' },
    { key: 'tape3', label: 'Fita inferior' },
    { key: 'pin', label: 'Pin' },
    { key: 'botanical', label: 'Botânica' },
  ]
  return variant === 'cover' ? [shared[0], { key: 'hero', label: 'Hero' }, ...shared.slice(1)] : shared
}

export default function StaticAuthoringProductPage() {
  const params = useParams<{ id: string; editorialContentId: string; channelPieceId: string }>()
  const router = useRouter()
  const [context, setContext] = useState<ContextResponse | null>(null)
  const [slides, setSlides] = useState<AuthoringSlide[] | null>(null)
  const [currentSlideIndex, setCurrentSlideIndex] = useState(0)
  const [selectedElement, setSelectedElement] = useState<ElementKey>('title')
  const [activeTab, setActiveTab] = useState<InspectorSection>('template')
  const [error, setError] = useState<string | null>(null)
  const [rendering, setRendering] = useState(false)
  const [renderResult, setRenderResult] = useState<RenderResult | null>(null)
  const [renderError, setRenderError] = useState<string | null>(null)
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const [lastSavedSnapshot, setLastSavedSnapshot] = useState<string | null>(null)
  // Lazy initializer, not an effect: this page's real content only paints
  // after the async context/state load below (gated by the loading return),
  // so reading localStorage here carries no hydration-mismatch risk.
  const [autosaveEnabled, setAutosaveEnabledState] = useState(() => readAutosavePreference())
  const [zoom, setZoom] = useState<'fit' | number>('fit')
  const [previewSize, setPreviewSize] = useState({ width: 0, height: 0 })
  const [restoreDialogOpen, setRestoreDialogOpen] = useState(false)
  const floating = useFloatingWorkbench()
  const skipNextAutosaveRef = useRef(true)
  // Callback-ref state, not useRef: in the floating workbench the Canvas mounts inside a Dockview
  // portal AFTER this component's effects run, so a ref read in an effect could miss it (Fit stuck at fallback).
  const [previewContainer, setPreviewContainer] = useState<HTMLDivElement | null>(null)

  const isCarousel = context?.channelPiece.format === 'carousel'
  // Derived, not stored: comparing the live slides against the last-saved
  // snapshot is cheap and avoids a setState-in-effect render cascade.
  const dirty = isCarousel && slides ? persistedSnapshot(slides) !== lastSavedSnapshot : false

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

      skipNextAutosaveRef.current = true
      const hydrated = orderedSlides.map((slide) => ({ id: slide.id, order: slide.order, state: persistedSlideToAuthoringState(slide, productContext, canvas) }))
      setSlides(hydrated)
      setCurrentSlideIndex(0)
      // Reload/read-back baseline: "saved" only reflects what the API actually
      // has today. A freshly-defaulted (never-saved) carousel has no baseline
      // — the first explicit Save (or first autosave) establishes one.
      setLastSavedSnapshot(persisted && persisted.length > 0 ? persistedSnapshot(hydrated) : null)
    }
    load().catch((cause: unknown) => setError(cause instanceof Error ? cause.message : 'Erro ao carregar contexto.'))
    return () => { cancelled = true }
  }, [params.channelPieceId, params.editorialContentId, params.id])

  async function saveNow() {
    if (!isCarousel || !slides || !context) return
    setSaveStatus('saving')
    const snapshot = persistedSnapshot(slides)
    try {
      const body = {
        schemaVersion: STATIC_AUTHORING_STATE_SCHEMA_VERSION,
        channelPieceId: context.channelPiece.id,
        slides: slides.map(({ id, order, state }) => authoringStateToPersistedSlide(state, id, order)),
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
    if (!isCarousel || !autosaveEnabled || !dirty || !slides) return
    if (skipNextAutosaveRef.current) { skipNextAutosaveRef.current = false; return }
    const timeout = setTimeout(() => { void saveNow() }, 600)
    return () => clearTimeout(timeout)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slides, isCarousel, autosaveEnabled, dirty])

  const currentSlide = slides?.[currentSlideIndex] ?? null
  const state = currentSlide?.state ?? null

  function switchSlide(index: number) {
    setCurrentSlideIndex(index)
    setRenderResult(null)
    setRenderError(null)
    const nextVariant = slides?.[index]?.state.variant
    if (nextVariant !== 'cover' && selectedElement === 'hero') setSelectedElement('title')
  }

  const dispatch = (action: AuthoringAction) => setSlides((current) => current
    ? current.map((slide, index) => index === currentSlideIndex ? { ...slide, state: authoringReducer(slide.state, action) } : slide)
    : current)

  function setTuningField(group: 'hero' | 'title', field: string, value: number) {
    if (!state) return
    dispatch({ type: 'SET_TUNING', tuning: { ...state.tuning, [group]: { ...state.tuning[group], [field]: value } } })
  }
  function resetTuningField(group: 'hero' | 'title') {
    if (!state) return
    dispatch({ type: 'SET_TUNING', tuning: { ...state.tuning, [group]: { ...DEFAULT_TUNING[group] } } })
  }

  function revert() {
    if (!lastSavedSnapshot || !context) return
    const persisted = JSON.parse(lastSavedSnapshot) as PersistedAuthoredSlide[]
    const productContext = buildProductContext(context)
    const canvas = canvasKind(context)
    setSlides(sortedSlides(persisted).map((slide) => ({ id: slide.id, order: slide.order, state: persistedSlideToAuthoringState(slide, productContext, canvas) })))
  }

  function restoreSlideDefault() {
    if (!context || !currentSlide) return
    const defaults = defaultCarouselSlides(context.primitiveProjectRef)
    const matching = defaults.find((slide) => slide.order === currentSlide.order) ?? defaults[0]
    const productContext = buildProductContext(context)
    const nextState = persistedSlideToAuthoringState({ ...matching, id: currentSlide.id }, productContext, canvasKind(context))
    setSlides((current) => current ? current.map((slide, index) => index === currentSlideIndex ? { ...slide, state: nextState } : slide) : current)
    setRestoreDialogOpen(false)
  }

  const previewInput = useMemo(() => state ? resolvePreviewInput(state) : null, [state])
  const cardProps = useMemo(() => {
    if (!previewInput || !state) return null
    const sequence = slides && slides.length > 1 ? { index: currentSlideIndex + 1, total: slides.length } : { index: 1, total: 1 }
    const previewWithSequence = { ...previewInput, manifest: { ...previewInput.manifest, sequence } }
    return { ...documentaryCardPropsFromResolvedInput(previewWithSequence, 'still', undefined, state.tuning), primitiveTransforms: derivePrimitiveTransformsRequest(state) }
  }, [previewInput, state, slides, currentSlideIndex])

  async function render() {
    if (!state?.productContext || !slides) return
    setRendering(true); setRenderResult(null); setRenderError(null)
    try {
      const selection = derivePrimitiveSelectionRequest(state)
      const transforms = derivePrimitiveTransformsRequest(state)
      const overrides = deriveTuningOverrides(state)
      const sequence = slides.length > 1 ? { index: currentSlideIndex + 1, total: slides.length } : undefined
      const manifest = deriveManifestFromState(state, sequence)
      const response = await fetch('/api/creative/static-authoring/render', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          manifest,
          context: { projectId: state.productContext.projectId, editorialContentId: state.productContext.editorialContentId, channelPieceId: state.productContext.channelPieceId },
          identitySnapshot: state.productContext.identitySnapshot,
          ...(selection ? { primitiveSelection: selection } : {}),
          ...(transforms ? { primitiveTransforms: transforms } : {}),
          ...(overrides ? { overrides } : {}),
        }),
      })
      const payload = await response.json() as RenderResult & { error?: string; details?: string }
      if (!response.ok) throw new Error(payload.error || 'Render falhou.')
      setRenderResult(payload)
    } catch (cause: unknown) {
      setRenderError(cause instanceof Error ? cause.message : 'Render falhou.')
    } finally {
      setRendering(false)
    }
  }

  async function saveRenderOutput() {
    if (!renderResult || !context) return
    // Lazy import kept local: this action is independent of the AUTHORING
    // save above — AUTHORING SAVE != PNG RENDER != SAVE OUTPUT TO LIBRARY.
    const { saveRenderToChannelPiece } = await import('@/lib/creative/authoring')
    await saveRenderToChannelPiece({ imageDataUrl: renderResult.image_data_url, channelPieceId: context.channelPiece.id })
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

  const elements = elementsForVariant(state.variant)
  const slideTotal = slides.length
  const slideLabel = `${currentSlideIndex + 1}/${slideTotal}`
  const primitiveSlot = (['paper', 'paperStrip', 'tape1', 'tape2', 'tape3', 'botanical', 'pin'] as const).find((slot) => slot === selectedElement)

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
      <TabsContent value="template" className="pt-3">
        <div className="flex flex-wrap items-center gap-2"><span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Estrutura</span><Button size="sm" variant={state.variant === 'cover' ? 'default' : 'outline'} onClick={() => dispatch({ type: 'SET_VARIANT', variant: 'cover' })}>Cover</Button><Button size="sm" variant={state.variant === 'info' ? 'default' : 'outline'} onClick={() => dispatch({ type: 'SET_VARIANT', variant: 'info' })}>Info</Button></div>
        <p className="mt-2 text-xs text-muted-foreground">DocumentaryCard · o template estático atual.</p>
      </TabsContent>
      <TabsContent value="content" className="space-y-3 pt-3">
        <div><Label htmlFor="visual-title">Título</Label><Textarea id="visual-title" value={(state.contentOverride as { title?: string }).title ?? ''} onChange={(event) => dispatch(state.variant === 'cover' ? { type: 'SET_COVER_FIELD', field: 'title', value: event.target.value } : { type: 'SET_INFO_FIELD', field: 'title', value: event.target.value })} rows={2} /></div>
        {state.variant === 'cover' ? <div><Label htmlFor="visual-subtitle">Texto</Label><Textarea id="visual-subtitle" value={(state.contentOverride as { subtitle?: string }).subtitle ?? ''} onChange={(event) => dispatch({ type: 'SET_COVER_FIELD', field: 'subtitle', value: event.target.value })} rows={4} /></div> : <><div><Label htmlFor="visual-intro">Introdução</Label><Textarea id="visual-intro" value={(state.contentOverride as { intro?: string }).intro ?? ''} onChange={(event) => dispatch({ type: 'SET_INFO_FIELD', field: 'intro', value: event.target.value })} rows={2} /></div><div><Label htmlFor="visual-body">Corpo (um parágrafo por linha)</Label><Textarea id="visual-body" value={(state.contentOverride as { body_blocks?: string[] }).body_blocks?.join('\n') ?? ''} onChange={(event) => dispatch({ type: 'SET_INFO_BODY', value: event.target.value })} rows={3} /></div></>}
      </TabsContent>
      <TabsContent value="assets" className="space-y-4 pt-3">
        {context.primitiveProjectRef ? <><PrimitivePicker slot="paper" label="Paper" primitives={context.primitives} selectedKey={state.primitiveSelection.paper} onSelect={(key) => dispatch({ type: 'SET_PRIMITIVE_PAPER', key })} onReset={() => dispatch({ type: 'RESET_PRIMITIVE_PAPER' })} /><PrimitivePicker slot="tape" label="Tape" primitives={context.primitives} selectedKey={state.primitiveSelection.tape} onSelect={(key) => dispatch({ type: 'SET_PRIMITIVE_TAPE', key })} onReset={() => dispatch({ type: 'RESET_PRIMITIVE_TAPE' })} /></> : <p className="text-xs text-muted-foreground">Este Project não possui primitives registradas.</p>}
        {state.variant === 'cover' && <p className="text-xs text-muted-foreground">Hero: imagem padrão do template (sem seletor de imagem nesta versão).</p>}
      </TabsContent>
      <TabsContent value="style" className="pt-3"><div className="flex flex-wrap items-center gap-2"><span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Aparência</span><Button size="sm" variant={state.appearance === 'light' ? 'default' : 'outline'} onClick={() => dispatch({ type: 'SET_APPEARANCE', appearance: 'light' })}>Light</Button><Button size="sm" variant={state.appearance === 'dark' ? 'default' : 'outline'} onClick={() => dispatch({ type: 'SET_APPEARANCE', appearance: 'dark' })}>Dark</Button></div></TabsContent>
      <TabsContent value="element" className="space-y-3 pt-3">
        <div className="space-y-2"><Label htmlFor="element-selector">Elemento</Label><Select value={selectedElement} onValueChange={(value) => setSelectedElement(value as ElementKey)}><SelectTrigger id="element-selector" className="w-full"><SelectValue placeholder="Escolha um elemento" /></SelectTrigger><SelectContent>{elements.map((element) => <SelectItem key={element.key} value={element.key}>{element.label}</SelectItem>)}</SelectContent></Select></div>
        <div className="rounded-md border border-border/60 p-3">
          {selectedElement === 'title' && <TitleTuningControls tuning={state.tuning.title} onChange={(field, value) => setTuningField('title', field, value)} onReset={() => resetTuningField('title')} />}
          {selectedElement === 'hero' && state.variant === 'cover' && <HeroTuningControls tuning={state.tuning.hero} onChange={(field, value) => setTuningField('hero', field, value)} onReset={() => resetTuningField('hero')} />}
          {primitiveSlot && <PrimitiveTransformControls slot={primitiveSlot} transforms={state.primitiveTransforms[primitiveSlot] ?? state.primitiveTransforms.tape} onChange={(field, value) => dispatch({ type: 'SET_PRIMITIVE_TRANSFORM', slot: primitiveSlot, field, value })} onReset={() => dispatch({ type: 'RESET_PRIMITIVE_TRANSFORMS', slot: primitiveSlot })} />}
        </div>
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
        {isCarousel && slideTotal > 1 && <div className="flex items-center gap-1" role="group" aria-label="Slides">
          <Button size="icon-sm" variant="outline" onClick={() => switchSlide(Math.max(0, currentSlideIndex - 1))} disabled={currentSlideIndex === 0} aria-label="Slide anterior"><ArrowLeft className="h-3.5 w-3.5" /></Button>
          {slides.map((slide, index) => <Button key={slide.id} size="sm" className="px-2.5 text-xs" variant={index === currentSlideIndex ? 'default' : 'outline'} aria-pressed={index === currentSlideIndex} onClick={() => switchSlide(index)}>{index + 1}/{slideTotal}</Button>)}
          <Button size="icon-sm" variant="outline" onClick={() => switchSlide(Math.min(slideTotal - 1, currentSlideIndex + 1))} disabled={currentSlideIndex === slideTotal - 1} aria-label="Próximo slide"><ArrowRight className="h-3.5 w-3.5" /></Button>
        </div>}
        <div className="flex items-center gap-1" role="group" aria-label="Zoom">
          <Button size="icon-sm" variant="outline" onClick={() => stepZoom(-1)} aria-label="Diminuir zoom"><Minus className="h-3.5 w-3.5" /></Button>
          <select aria-label="Zoom da prévia" className="h-8 rounded-md border border-input bg-background px-2 text-xs" value={zoom === 'fit' ? 'fit' : String(zoom)} onChange={(event) => setZoom(event.target.value === 'fit' ? 'fit' : Number(event.target.value))}><option value="fit">Fit · {Math.round(fitScale * 100)}%</option>{ZOOM_LEVELS.map((level) => <option key={level} value={level}>{Math.round(level * 100)}%</option>)}</select>
          <Button size="icon-sm" variant="outline" onClick={() => stepZoom(1)} aria-label="Aumentar zoom"><Plus className="h-3.5 w-3.5" /></Button>
        </div>
        {isCarousel && <div className="flex items-center gap-1" role="group" aria-label="Estado do slide">
          <Button size="sm" variant="ghost" className="gap-1 px-2 text-xs" disabled={!dirty || !lastSavedSnapshot} onClick={revert}><Undo2 className="h-3 w-3" />Reverter</Button>
          <Button size="sm" variant="ghost" className="gap-1 px-2 text-xs" onClick={() => setRestoreDialogOpen(true)}><RotateCcw className="h-3 w-3" />Restaurar padrão</Button>
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
        {rendering && <span className="flex items-center gap-1 text-xs text-muted-foreground"><Loader2 className="h-3.5 w-3.5 animate-spin" />Renderizando…</span>}
        {renderError && !rendering && <span className="flex max-w-[18rem] items-center gap-1 text-xs text-destructive" title={renderError} role="alert"><AlertCircle className="h-3.5 w-3.5 shrink-0" /><span className="truncate">{renderError}</span></span>}
        {renderResult && !rendering && <span className="flex items-center gap-2 text-xs text-muted-foreground"><Check className="h-3.5 w-3.5 text-[var(--indicator-success,theme(colors.green.600))]" />Render · {renderResult.duration_ms} ms<Button size="sm" variant="outline" className="h-7 px-2 text-[11px]" onClick={() => void saveRenderOutput()}>Salvar nesta peça</Button></span>}
        {isCarousel && <span className="text-xs text-muted-foreground" data-testid="save-status">{saveStatusLabel}</span>}
        {isCarousel && <Button size="sm" variant="outline" className="gap-1.5" disabled={!dirty && saveStatus !== 'error'} onClick={() => void saveNow()}>{saveStatus === 'saving' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}Salvar</Button>}
        <Button size="sm" onClick={() => void render()} disabled={rendering} className="gap-1.5">{rendering ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}{rendering ? 'Renderizando…' : 'Gerar PNG'}</Button>
      </div>
    </header>
  )

  const restoreDialog = <AlertDialog open={restoreDialogOpen} onOpenChange={setRestoreDialogOpen}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>Restaurar slide?</AlertDialogTitle><AlertDialogDescription>As alterações atuais deste slide serão substituídas pelo padrão do template. Esta alteração só será persistida quando você clicar em Salvar.</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>Cancelar</AlertDialogCancel><AlertDialogAction onClick={restoreSlideDefault}>Restaurar</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>

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

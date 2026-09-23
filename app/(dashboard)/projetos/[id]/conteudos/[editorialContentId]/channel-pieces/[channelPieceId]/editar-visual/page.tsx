'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import Image from 'next/image'
import { useParams, useRouter } from 'next/navigation'
import { ArrowLeft, ArrowRight, Loader2, Play } from 'lucide-react'
import { DashboardPage, DashboardPageContent } from '@/components/layout/dashboard-page'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { DocumentaryCard, documentaryCardPropsFromResolvedInput } from '@/components/creative/documentary-card'
import { PrimitivePicker, PrimitiveTransformControls } from '@/components/creative/authoring/primitive-controls'
import { adaptProjectIdentityToVisualTokens } from '@/lib/creative/integration/project-identity-adapter'
import {
  authoringReducer, createContextualAuthoringState, deriveManifestFromState, derivePrimitiveSelectionRequest,
  derivePrimitiveTransformsRequest, resolvePreviewInput, type AuthoringAction, type AuthoringProductContext,
  type AuthoringState, initialSaveStatus, canSave, isSavedForCurrent, startSaving, saveSucceeded, saveFailed,
  resetForNewRender, saveRenderToChannelPiece, type RenderSaveStatus,
  STATIC_AUTHORING_STATE_SCHEMA_VERSION, sortedSlides, defaultCarouselSlides, authoringStateToPersistedSlide,
  persistedSlideToAuthoringState, type PersistedAuthoredSlide,
} from '@/lib/creative/authoring'
import { contextualContentForChannelPiece } from '@/lib/creative/context/static-authoring'
import type { ProjectIdentity } from '@/lib/schemas/project-identity'
import type { StaticAuthoringTarget } from '@/lib/creative/context/static-authoring'
import type { Project, Production, EditorialContent, ChannelPiece } from '@/lib/types'
import type { PrimitiveListItem } from '@/lib/creative/primitives/discovery'

type ContextResponse = { project: Project; production: Production | null; editorialContent: EditorialContent; channelPiece: ChannelPiece; target: StaticAuthoringTarget; projectIdentity: ProjectIdentity; primitiveProjectRef: string | null; primitives: PrimitiveListItem[] }
type RenderResult = { image_data_url: string; duration_ms: number; output_identifier: string; diagnostics: unknown[] }
type StaticAuthoringStateResponse = { state: { schemaVersion: string; channelPieceId: string; slides: PersistedAuthoredSlide[] } | null }

/** A slide's own identity/order, kept alongside its ephemeral AuthoringState. */
type AuthoringSlide = { id: string; order: number; state: AuthoringState }

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

/** Slice 1 — Portal Carousel V1: the non-carousel single-slide default, unchanged from before this slice. */
function singleSlideDefault(context: ContextResponse, productContext: AuthoringProductContext, canvas: 'portrait' | 'reel'): AuthoringSlide {
  const content = contextualContentForChannelPiece(context.editorialContent, context.channelPiece)
  const primitiveSelection = context.primitiveProjectRef ? { paper: 'paper-card-light-01', tape: 'tape-kraft-short-01' } : {}
  const state = createContextualAuthoringState(productContext, canvas, content, primitiveSelection)
  return { id: 'slide-1', order: 0, state }
}

export default function StaticAuthoringProductPage() {
  const params = useParams<{ id: string; editorialContentId: string; channelPieceId: string }>()
  const router = useRouter()
  const [context, setContext] = useState<ContextResponse | null>(null)
  const [slides, setSlides] = useState<AuthoringSlide[] | null>(null)
  const [currentSlideIndex, setCurrentSlideIndex] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [rendering, setRendering] = useState(false)
  const [renderResult, setRenderResult] = useState<RenderResult | null>(null)
  const [saveStatus, setSaveStatus] = useState<RenderSaveStatus>(initialSaveStatus())
  const [persistStatus, setPersistStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const skipNextPersistRef = useRef(true)

  const isCarousel = context?.channelPiece.format === 'carousel'

  useEffect(() => {
    let cancelled = false
    async function load() {
      const query = new URLSearchParams({ projectId: params.id, editorialContentId: params.editorialContentId, channelPieceId: params.channelPieceId })
      const response = await fetch(`/api/creative/static-authoring-context?${query.toString()}`)
      const payload = await response.json() as ContextResponse & { error?: string }
      if (!response.ok) throw new Error(payload.error || 'Contexto indisponível.')
      if (cancelled) return
      setContext(payload)

      const canvas: 'portrait' | 'reel' = payload.target.canvas.height === 1920 ? 'reel' : 'portrait'
      const productContext = buildProductContext(payload)

      if (payload.channelPiece.format !== 'carousel') {
        skipNextPersistRef.current = true
        setSlides([singleSlideDefault(payload, productContext, canvas)])
        return
      }

      // Carousel: try to reconstruct persisted slides first (Slice 1's
      // reproducibility contract); fall back to the Pack B acceptance
      // defaults (cover/dark, info/light) only when nothing was saved yet.
      const stateResponse = await fetch(`/api/creative/static-authoring-state?channelPieceId=${payload.channelPiece.id}`)
      const statePayload = await stateResponse.json() as StaticAuthoringStateResponse & { error?: string }
      if (cancelled) return
      const persisted = stateResponse.ok ? statePayload.state?.slides ?? null : null
      const orderedSlides = persisted && persisted.length > 0 ? sortedSlides(persisted) : defaultCarouselSlides(payload.primitiveProjectRef)

      skipNextPersistRef.current = true
      setSlides(orderedSlides.map((slide) => ({ id: slide.id, order: slide.order, state: persistedSlideToAuthoringState(slide, productContext, canvas) })))
      setCurrentSlideIndex(0)
    }
    load().catch((cause: unknown) => setError(cause instanceof Error ? cause.message : 'Erro ao carregar contexto.'))
    return () => { cancelled = true }
  }, [params.channelPieceId, params.editorialContentId, params.id])

  // Debounced autosave — only for carousel ChannelPieces. Non-carousel static
  // pieces never call this endpoint, so their behavior is entirely unchanged.
  useEffect(() => {
    if (!isCarousel || !slides || !context) return
    if (skipNextPersistRef.current) { skipNextPersistRef.current = false; return }
    setPersistStatus('saving')
    const timeout = setTimeout(() => {
      const body = {
        schemaVersion: STATIC_AUTHORING_STATE_SCHEMA_VERSION,
        channelPieceId: context.channelPiece.id,
        slides: slides.map(({ id, order, state }) => authoringStateToPersistedSlide(state, id, order)),
      }
      fetch('/api/creative/static-authoring-state', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
        .then((response) => { if (!response.ok) throw new Error('persist failed'); setPersistStatus('saved') })
        .catch(() => setPersistStatus('error'))
    }, 600)
    return () => clearTimeout(timeout)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slides, isCarousel])

  const currentSlide = slides?.[currentSlideIndex] ?? null
  const state = currentSlide?.state ?? null

  function switchSlide(index: number) {
    setCurrentSlideIndex(index)
    setRenderResult(null)
    setError(null)
    setSaveStatus(initialSaveStatus())
  }

  const dispatch = (action: AuthoringAction) => setSlides((current) => current
    ? current.map((slide, index) => index === currentSlideIndex ? { ...slide, state: authoringReducer(slide.state, action) } : slide)
    : current)
  const previewInput = useMemo(() => state ? resolvePreviewInput(state) : null, [state])
  const cardProps = useMemo(() => previewInput && state ? { ...documentaryCardPropsFromResolvedInput(previewInput, 'still'), primitiveTransforms: derivePrimitiveTransformsRequest(state) } : null, [previewInput, state])

  async function render() {
    if (!state?.productContext || !slides) return
    setRendering(true); setRenderResult(null); setError(null); setSaveStatus((current) => resetForNewRender(current))
    try {
      const selection = derivePrimitiveSelectionRequest(state)
      const transforms = derivePrimitiveTransformsRequest(state)
      const sequence = slides.length > 1 ? { index: currentSlideIndex + 1, total: slides.length } : undefined
      const manifest = deriveManifestFromState(state, sequence)
      const response = await fetch('/api/creative/static-authoring/render', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ manifest, context: { projectId: state.productContext.projectId, editorialContentId: state.productContext.editorialContentId, channelPieceId: state.productContext.channelPieceId }, identitySnapshot: state.productContext.identitySnapshot, ...(selection ? { primitiveSelection: selection } : {}), ...(transforms ? { primitiveTransforms: transforms } : {}) }) })
      const payload = await response.json() as RenderResult & { error?: string }; if (!response.ok) throw new Error(payload.error || 'Render falhou.'); setRenderResult(payload)
    } catch (cause: unknown) { setError(cause instanceof Error ? cause.message : 'Render falhou.') } finally { setRendering(false) }
  }

  async function saveRender() {
    if (!renderResult || !context) return
    const outputId = renderResult.output_identifier
    if (!canSave(saveStatus, outputId)) return
    setSaveStatus((current) => startSaving(current))
    const result = await saveRenderToChannelPiece({ imageDataUrl: renderResult.image_data_url, channelPieceId: context.channelPiece.id })
    setSaveStatus(result.ok ? saveSucceeded(outputId) : (current) => saveFailed(current, result.error))
  }

  if (error && !context) return <DashboardPage><DashboardPageContent width="4xl"><Card><CardHeader><CardTitle>Authoring indisponível</CardTitle></CardHeader><CardContent><p className="text-sm text-muted-foreground">{error}</p><Button className="mt-4" variant="outline" onClick={() => router.back()}>Voltar</Button></CardContent></Card></DashboardPageContent></DashboardPage>
  if (!context || !state || !slides) return <DashboardPage><DashboardPageContent width="4xl"><div className="flex justify-center py-24"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div></DashboardPageContent></DashboardPage>

  return <DashboardPage><DashboardPageContent width="7xl">
    <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
      <div>
        <Button variant="ghost" size="sm" className="mb-3 -ml-3 gap-2" onClick={() => router.back()}><ArrowLeft className="h-4 w-4" />Voltar ao conteúdo</Button>
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-2xl font-semibold">Editar visual</h1>
          <Badge variant="outline">Static</Badge>
          <Badge variant="outline">{context.channelPiece.channel}:{context.channelPiece.format}</Badge>
          {isCarousel && <Badge variant="secondary">Slide {currentSlideIndex + 1} de {slides.length}</Badge>}
        </div>
        <p className="mt-1 text-sm text-muted-foreground">{context.project.name} · {context.production?.title || 'Sem Production'} · {context.editorialContent.title}</p>
      </div>
      <Button onClick={() => void render()} disabled={rendering} className="gap-2">{rendering ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}{rendering ? 'Renderizando…' : 'Gerar PNG'}</Button>
    </div>

    {isCarousel && slides.length > 1 && (
      <Card className="mb-6">
        <CardContent className="flex flex-wrap items-center justify-between gap-4 py-4">
          <div className="flex items-center gap-2">
            <Button size="sm" variant="outline" onClick={() => switchSlide(Math.max(0, currentSlideIndex - 1))} disabled={currentSlideIndex === 0} className="gap-1"><ArrowLeft className="h-3.5 w-3.5" />Slide anterior</Button>
            <Button size="sm" variant="outline" onClick={() => switchSlide(Math.min(slides.length - 1, currentSlideIndex + 1))} disabled={currentSlideIndex === slides.length - 1} className="gap-1">Próximo slide<ArrowRight className="h-3.5 w-3.5" /></Button>
          </div>
          <div className="flex flex-wrap items-center gap-4">
            <div className="flex items-center gap-2">
              <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Estrutura</span>
              <Button size="sm" variant={state.variant === 'cover' ? 'default' : 'outline'} onClick={() => dispatch({ type: 'SET_VARIANT', variant: 'cover' })}>Cover</Button>
              <Button size="sm" variant={state.variant === 'info' ? 'default' : 'outline'} onClick={() => dispatch({ type: 'SET_VARIANT', variant: 'info' })}>Info</Button>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Aparência</span>
              <Button size="sm" variant={state.appearance === 'light' ? 'default' : 'outline'} onClick={() => dispatch({ type: 'SET_APPEARANCE', appearance: 'light' })}>Light</Button>
              <Button size="sm" variant={state.appearance === 'dark' ? 'default' : 'outline'} onClick={() => dispatch({ type: 'SET_APPEARANCE', appearance: 'dark' })}>Dark</Button>
            </div>
            <span className="text-xs text-muted-foreground">
              {persistStatus === 'saving' && 'Salvando edição…'}
              {persistStatus === 'saved' && 'Edição salva'}
              {persistStatus === 'error' && 'Falha ao salvar edição'}
            </span>
          </div>
        </CardContent>
      </Card>
    )}

    <div className="grid gap-6 xl:grid-cols-[20rem_minmax(0,1fr)_20rem]">
      <Card>
        <CardHeader><CardTitle className="text-base">Authoring</CardTitle><CardDescription>Controles compartilhados do Creative Core.</CardDescription></CardHeader>
        <CardContent className="space-y-6">
          {context.primitiveProjectRef ? <>
            <div className="space-y-3">
              <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Primitives do Project</div>
              <PrimitivePicker slot="paper" label="Paper" primitives={context.primitives} selectedKey={state.primitiveSelection.paper} onSelect={(key) => dispatch({ type: 'SET_PRIMITIVE_PAPER', key })} onReset={() => dispatch({ type: 'RESET_PRIMITIVE_PAPER' })} />
              <PrimitivePicker slot="tape" label="Tape" primitives={context.primitives} selectedKey={state.primitiveSelection.tape} onSelect={(key) => dispatch({ type: 'SET_PRIMITIVE_TAPE', key })} onReset={() => dispatch({ type: 'RESET_PRIMITIVE_TAPE' })} />
            </div>
            <div className="space-y-3">
              <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Transforms</div>
              <PrimitiveTransformControls slot="paper" transforms={state.primitiveTransforms.paper} onChange={(field, value) => dispatch({ type: 'SET_PRIMITIVE_TRANSFORM', slot: 'paper', field, value })} onReset={() => dispatch({ type: 'RESET_PRIMITIVE_TRANSFORMS', slot: 'paper' })} />
              <PrimitiveTransformControls slot="paperStrip" transforms={state.primitiveTransforms.paperStrip} onChange={(field, value) => dispatch({ type: 'SET_PRIMITIVE_TRANSFORM', slot: 'paperStrip', field, value })} onReset={() => dispatch({ type: 'RESET_PRIMITIVE_TRANSFORMS', slot: 'paperStrip' })} />
              <PrimitiveTransformControls slot="tape" transforms={state.primitiveTransforms.tape} onChange={(field, value) => dispatch({ type: 'SET_PRIMITIVE_TRANSFORM', slot: 'tape', field, value })} onReset={() => dispatch({ type: 'RESET_PRIMITIVE_TRANSFORMS', slot: 'tape' })} />
              <PrimitiveTransformControls slot="botanical" transforms={state.primitiveTransforms.botanical} onChange={(field, value) => dispatch({ type: 'SET_PRIMITIVE_TRANSFORM', slot: 'botanical', field, value })} onReset={() => dispatch({ type: 'RESET_PRIMITIVE_TRANSFORMS', slot: 'botanical' })} />
              <PrimitiveTransformControls slot="pin" transforms={state.primitiveTransforms.pin} onChange={(field, value) => dispatch({ type: 'SET_PRIMITIVE_TRANSFORM', slot: 'pin', field, value })} onReset={() => dispatch({ type: 'RESET_PRIMITIVE_TRANSFORMS', slot: 'pin' })} />
            </div>
          </> : <p className="text-xs text-muted-foreground">Este Project não possui primitives registradas.</p>}
          <div className="space-y-3">
            <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Conteúdo</div>
            <div><Label htmlFor="visual-title">Título</Label><Textarea id="visual-title" value={(state.contentOverride as { title?: string }).title ?? ''} onChange={(event) => dispatch(state.variant === 'cover' ? { type: 'SET_COVER_FIELD', field: 'title', value: event.target.value } : { type: 'SET_INFO_FIELD', field: 'title', value: event.target.value })} rows={3} /></div>
            {state.variant === 'cover'
              ? <div><Label htmlFor="visual-subtitle">Texto</Label><Textarea id="visual-subtitle" value={(state.contentOverride as { subtitle?: string }).subtitle ?? ''} onChange={(event) => dispatch({ type: 'SET_COVER_FIELD', field: 'subtitle', value: event.target.value })} rows={5} /></div>
              : <>
                  <div><Label htmlFor="visual-intro">Introdução</Label><Textarea id="visual-intro" value={(state.contentOverride as { intro?: string }).intro ?? ''} onChange={(event) => dispatch({ type: 'SET_INFO_FIELD', field: 'intro', value: event.target.value })} rows={2} /></div>
                  <div><Label htmlFor="visual-body">Corpo (um parágrafo por linha)</Label><Textarea id="visual-body" value={(state.contentOverride as { body_blocks?: string[] }).body_blocks?.join('\n') ?? ''} onChange={(event) => dispatch({ type: 'SET_INFO_BODY', value: event.target.value })} rows={4} /></div>
                </>}
          </div>
        </CardContent>
      </Card>

      <Card className="min-w-0">
        <CardHeader><CardTitle className="text-base">Preview</CardTitle><CardDescription>Mesmo DocumentaryCard do render final. O binary do preview pode permanecer proxy enquanto S3 preview está deferred.</CardDescription></CardHeader>
        <CardContent className="flex justify-center overflow-auto bg-muted/20 p-6">{cardProps ? <div className="origin-top scale-[0.55] sm:scale-[0.7]"><DocumentaryCard {...cardProps} /></div> : <p className="text-sm text-muted-foreground">Preview indisponível.</p>}</CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Contexto</CardTitle><CardDescription>Origem autorizada do authoring.</CardDescription></CardHeader>
        <CardContent className="space-y-3 text-sm">
          <div><span className="text-muted-foreground">Project</span><p className="font-medium">{context.project.name}</p></div>
          <div><span className="text-muted-foreground">Production</span><p>{context.production?.title || 'Sem Production'}</p></div>
          <div><span className="text-muted-foreground">EditorialContent</span><p>{context.editorialContent.title}</p></div>
          <div><span className="text-muted-foreground">ChannelPiece</span><p>{context.channelPiece.title || context.channelPiece.format}</p></div>
          <div><span className="text-muted-foreground">Identity</span><p>{context.projectIdentity.expression?.visual_identity || 'Project Identity V1'}</p></div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          {renderResult && <div className="border-t pt-3">
            <span className="text-muted-foreground">Último render</span>
            <Image alt="PNG renderizado" className="mt-2 h-auto w-full rounded border" height={340} src={renderResult.image_data_url} unoptimized width={272} />
            <p className="mt-2 text-xs text-muted-foreground">{renderResult.duration_ms} ms · {renderResult.output_identifier}</p>
            <div className="mt-3">
              <Button size="sm" variant="outline" className="w-full gap-2" disabled={!canSave(saveStatus, renderResult.output_identifier)} onClick={() => void saveRender()}>{saveStatus.state === 'saving' && <Loader2 className="h-3.5 w-3.5 animate-spin" />}{isSavedForCurrent(saveStatus, renderResult.output_identifier) ? 'Salvo nesta peça' : saveStatus.state === 'saving' ? 'Salvando…' : 'Salvar nesta peça'}</Button>
              {saveStatus.state === 'error' && saveStatus.error && <p className="mt-2 text-xs text-destructive">{saveStatus.error}</p>}
            </div>
          </div>}
        </CardContent>
      </Card>
    </div>
  </DashboardPageContent></DashboardPage>
}

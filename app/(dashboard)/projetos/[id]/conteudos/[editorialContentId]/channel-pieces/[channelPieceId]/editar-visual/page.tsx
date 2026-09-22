'use client'

import { useEffect, useMemo, useState } from 'react'
import Image from 'next/image'
import { useParams, useRouter } from 'next/navigation'
import { ArrowLeft, Loader2, Play } from 'lucide-react'
import { DashboardPage, DashboardPageContent } from '@/components/layout/dashboard-page'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { DocumentaryCard, documentaryCardPropsFromResolvedInput } from '@/components/creative/documentary-card'
import { PrimitivePicker, PrimitiveTransformControls } from '@/components/creative/authoring/primitive-controls'
import { adaptProjectIdentityToVisualTokens } from '@/lib/creative/integration/project-identity-adapter'
import { authoringReducer, createContextualAuthoringState, deriveManifestFromState, derivePrimitiveSelectionRequest, derivePrimitiveTransformsRequest, resolvePreviewInput, type AuthoringAction, type AuthoringState, initialSaveStatus, canSave, isSavedForCurrent, startSaving, saveSucceeded, saveFailed, resetForNewRender, saveRenderToChannelPiece, type RenderSaveStatus } from '@/lib/creative/authoring'
import { contextualContentForChannelPiece } from '@/lib/creative/context/static-authoring'
import type { ProjectIdentity } from '@/lib/schemas/project-identity'
import type { StaticAuthoringTarget } from '@/lib/creative/context/static-authoring'
import type { Project, Production, EditorialContent, ChannelPiece } from '@/lib/types'
import type { PrimitiveListItem } from '@/lib/creative/primitives/discovery'

type ContextResponse = { project: Project; production: Production | null; editorialContent: EditorialContent; channelPiece: ChannelPiece; target: StaticAuthoringTarget; projectIdentity: ProjectIdentity; primitiveProjectRef: string | null; primitives: PrimitiveListItem[] }
type RenderResult = { image_data_url: string; duration_ms: number; output_identifier: string; diagnostics: unknown[] }

function initialState(context: ContextResponse): AuthoringState {
  const identitySnapshot = adaptProjectIdentityToVisualTokens(context.project.id, context.projectIdentity)
  const productContext = {
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
  const content = contextualContentForChannelPiece(context.editorialContent, context.channelPiece)
  return createContextualAuthoringState(productContext, context.target.canvas.height === 1920 ? 'reel' : 'portrait', content, context.primitiveProjectRef ? { paper: 'paper-card-light-01', tape: 'tape-kraft-short-01' } : {})
}

export default function StaticAuthoringProductPage() {
  const params = useParams<{ id: string; editorialContentId: string; channelPieceId: string }>()
  const router = useRouter()
  const [context, setContext] = useState<ContextResponse | null>(null)
  const [state, setState] = useState<AuthoringState | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [rendering, setRendering] = useState(false)
  const [renderResult, setRenderResult] = useState<RenderResult | null>(null)
  const [saveStatus, setSaveStatus] = useState<RenderSaveStatus>(initialSaveStatus())

  useEffect(() => {
    const query = new URLSearchParams({ projectId: params.id, editorialContentId: params.editorialContentId, channelPieceId: params.channelPieceId })
    fetch(`/api/creative/static-authoring-context?${query.toString()}`).then(async (response) => {
      const payload = await response.json() as ContextResponse & { error?: string }
      if (!response.ok) throw new Error(payload.error || 'Contexto indisponível.')
      setContext(payload); setState(initialState(payload))
    }).catch((cause: unknown) => setError(cause instanceof Error ? cause.message : 'Erro ao carregar contexto.'))
  }, [params.channelPieceId, params.editorialContentId, params.id])

  const dispatch = (action: AuthoringAction) => setState((current) => current ? authoringReducer(current, action) : current)
  const previewInput = useMemo(() => state ? resolvePreviewInput(state) : null, [state])
  const cardProps = useMemo(() => previewInput && state ? { ...documentaryCardPropsFromResolvedInput(previewInput, 'still'), primitiveTransforms: derivePrimitiveTransformsRequest(state) } : null, [previewInput, state])

  async function render() {
    if (!state?.productContext) return
    setRendering(true); setRenderResult(null); setError(null); setSaveStatus((current) => resetForNewRender(current))
    try {
      const selection = derivePrimitiveSelectionRequest(state); const transforms = derivePrimitiveTransformsRequest(state)
      const response = await fetch('/api/creative/static-authoring/render', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ manifest: deriveManifestFromState(state), context: { projectId: state.productContext.projectId, editorialContentId: state.productContext.editorialContentId, channelPieceId: state.productContext.channelPieceId }, identitySnapshot: state.productContext.identitySnapshot, ...(selection ? { primitiveSelection: selection } : {}), ...(transforms ? { primitiveTransforms: transforms } : {}) }) })
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
  if (!context || !state) return <DashboardPage><DashboardPageContent width="4xl"><div className="flex justify-center py-24"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div></DashboardPageContent></DashboardPage>

  return <DashboardPage><DashboardPageContent width="7xl"><div className="mb-6 flex flex-wrap items-start justify-between gap-4"><div><Button variant="ghost" size="sm" className="mb-3 -ml-3 gap-2" onClick={() => router.back()}><ArrowLeft className="h-4 w-4" />Voltar ao conteúdo</Button><div className="flex flex-wrap items-center gap-2"><h1 className="text-2xl font-semibold">Editar visual</h1><Badge variant="outline">Static</Badge><Badge variant="outline">{context.channelPiece.channel}:{context.channelPiece.format}</Badge></div><p className="mt-1 text-sm text-muted-foreground">{context.project.name} · {context.production?.title || 'Sem Production'} · {context.editorialContent.title}</p></div><Button onClick={() => void render()} disabled={rendering} className="gap-2">{rendering ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}{rendering ? 'Renderizando…' : 'Gerar PNG'}</Button></div><div className="grid gap-6 xl:grid-cols-[20rem_minmax(0,1fr)_20rem]"><Card><CardHeader><CardTitle className="text-base">Authoring</CardTitle><CardDescription>Controles compartilhados do Creative Core.</CardDescription></CardHeader><CardContent className="space-y-6">{context.primitiveProjectRef ? <><div className="space-y-3"><div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Primitives do Project</div><PrimitivePicker slot="paper" label="Paper" primitives={context.primitives} selectedKey={state.primitiveSelection.paper} onSelect={(key) => dispatch({ type: 'SET_PRIMITIVE_PAPER', key })} onReset={() => dispatch({ type: 'RESET_PRIMITIVE_PAPER' })} /><PrimitivePicker slot="tape" label="Tape" primitives={context.primitives} selectedKey={state.primitiveSelection.tape} onSelect={(key) => dispatch({ type: 'SET_PRIMITIVE_TAPE', key })} onReset={() => dispatch({ type: 'RESET_PRIMITIVE_TAPE' })} /></div><div className="space-y-3"><div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Transforms</div><PrimitiveTransformControls slot="paper" transforms={state.primitiveTransforms.paper} onChange={(field, value) => dispatch({ type: 'SET_PRIMITIVE_TRANSFORM', slot: 'paper', field, value })} onReset={() => dispatch({ type: 'RESET_PRIMITIVE_TRANSFORMS', slot: 'paper' })} /><PrimitiveTransformControls slot="tape" transforms={state.primitiveTransforms.tape} onChange={(field, value) => dispatch({ type: 'SET_PRIMITIVE_TRANSFORM', slot: 'tape', field, value })} onReset={() => dispatch({ type: 'RESET_PRIMITIVE_TRANSFORMS', slot: 'tape' })} /></div></> : <p className="text-xs text-muted-foreground">Este Project não possui primitives registradas.</p>}<div className="space-y-3"><div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Conteúdo</div><div><Label htmlFor="visual-title">Título</Label><Textarea id="visual-title" value={(state.contentOverride as { title?: string }).title ?? ''} onChange={(event) => dispatch({ type: 'SET_COVER_FIELD', field: 'title', value: event.target.value })} rows={3} /></div><div><Label htmlFor="visual-subtitle">Texto</Label><Textarea id="visual-subtitle" value={(state.contentOverride as { subtitle?: string }).subtitle ?? ''} onChange={(event) => dispatch({ type: 'SET_COVER_FIELD', field: 'subtitle', value: event.target.value })} rows={5} /></div></div></CardContent></Card><Card className="min-w-0"><CardHeader><CardTitle className="text-base">Preview</CardTitle><CardDescription>Mesmo DocumentaryCard do render final. O binary do preview pode permanecer proxy enquanto S3 preview está deferred.</CardDescription></CardHeader><CardContent className="flex justify-center overflow-auto bg-muted/20 p-6">{cardProps ? <div className="origin-top scale-[0.55] sm:scale-[0.7]"><DocumentaryCard {...cardProps} /></div> : <p className="text-sm text-muted-foreground">Preview indisponível.</p>}</CardContent></Card><Card><CardHeader><CardTitle className="text-base">Contexto</CardTitle><CardDescription>Origem autorizada do authoring.</CardDescription></CardHeader><CardContent className="space-y-3 text-sm"><div><span className="text-muted-foreground">Project</span><p className="font-medium">{context.project.name}</p></div><div><span className="text-muted-foreground">Production</span><p>{context.production?.title || 'Sem Production'}</p></div><div><span className="text-muted-foreground">EditorialContent</span><p>{context.editorialContent.title}</p></div><div><span className="text-muted-foreground">ChannelPiece</span><p>{context.channelPiece.title || context.channelPiece.format}</p></div><div><span className="text-muted-foreground">Identity</span><p>{context.projectIdentity.expression?.visual_identity || 'Project Identity V1'}</p></div>{error && <p className="text-sm text-destructive">{error}</p>}{renderResult && <div className="border-t pt-3"><span className="text-muted-foreground">Último render</span><Image alt="PNG renderizado" className="mt-2 h-auto w-full rounded border" height={340} src={renderResult.image_data_url} unoptimized width={272} /><p className="mt-2 text-xs text-muted-foreground">{renderResult.duration_ms} ms · {renderResult.output_identifier}</p><div className="mt-3"><Button size="sm" variant="outline" className="w-full gap-2" disabled={!canSave(saveStatus, renderResult.output_identifier)} onClick={() => void saveRender()}>{saveStatus.state === 'saving' && <Loader2 className="h-3.5 w-3.5 animate-spin" />}{isSavedForCurrent(saveStatus, renderResult.output_identifier) ? 'Salvo nesta peça' : saveStatus.state === 'saving' ? 'Salvando…' : 'Salvar nesta peça'}</Button>{saveStatus.state === 'error' && saveStatus.error && <p className="mt-2 text-xs text-destructive">{saveStatus.error}</p>}</div></div>}</CardContent></Card></div></DashboardPageContent></DashboardPage>
}

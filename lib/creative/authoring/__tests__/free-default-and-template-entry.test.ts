/**
 * CREATIVE_EDITOR_FREE_DEFAULT_AND_TEMPLATE_ENTRY_V1 — two composition modes
 * (FREE, TEMPLATE), FREE by default for new authoring, Template as an explicit
 * opt-in; Static free as a real persisted + renderable composition; Video new
 * Scenes explicitly free while legacy (absent) compositions stay Cover.
 */
import { readFileSync } from 'fs'
import path from 'path'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import {
  StaticAuthoringStateSchema, STATIC_AUTHORING_STATE_SCHEMA_VERSION, createTemplateSlide, defaultCarouselSlides, isPersistedFreeSlide,
  type PersistedAuthoredSlide,
} from '../carousel-state'
import {
  buildStaticFreeRenderManifest, createFreeStaticSlide, freeCompositionHasContent, freeStaticImageIds, type FreeStaticSlide,
} from '../free-static'
import {
  addFreeImageElement, addFreeTextElement, freeElements, moveFreeElement, removeFreeElement, setFreeElementBox, setFreeElementHidden, updateFreeElement,
  createFreeScene,
} from '@/lib/creative/video-editor/free-composition'
import { applySceneFreeComposition, applySceneTemplate, resolveSceneComposition } from '@/lib/creative/video-editor/scene-composition'
import { createVideoDraftForCreativeEditor } from '@/lib/creative/video-editor/video-draft-entry'
import { adaptVideoDraftToTimelineManifest } from '@/lib/creative/timeline-adapter/video-draft-to-timeline'
import { StaticFreeRenderManifestSchema, StaticRenderManifestSchema, isStaticFreeRenderManifest } from '@/lib/schemas/creative/static-render'
import { buildStaticRenderExecutionSnapshot, parseStaticRenderExecutionSnapshot } from '@/lib/render-execution/static-snapshot'
import { resolveStaticRuntimeInput } from '@/lib/render-execution/resolve-static-runtime-input'
import { resolveStaticFreeRenderManifest } from '@/lib/creative/resolution/resolve-static-render'
import { adaptProjectIdentityToVisualTokens } from '@/lib/creative/integration/project-identity-adapter'
import { FreeStage } from '@/components/creative/free/free-stage'
import { DEFAULT_TEMPLATE_ID } from '@/lib/creative/templates/template-definitions'
import type { VideoScene } from '@/lib/types'

// EOL-agnostic: the working copy may be CRLF (core.autocrlf) or LF.
const read = (file: string) => readFileSync(path.join(process.cwd(), file), 'utf8').replace(/\r\n/g, '\n')
const PAGE = read('app/(dashboard)/projetos/[id]/conteudos/[editorialContentId]/channel-pieces/[channelPieceId]/editar-visual/page.tsx')
const ROUTE = read('app/api/creative/static-authoring-state/route.ts')
const RENDER_ROUTE = read('app/api/creative/static-authoring/render/route.ts')
const VIDEO_PAGE = read('app/(dashboard)/creative-editor/video/[draftId]/page.tsx')

const CP = '11111111-1111-4111-8111-111111111111'
const FILE_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const FILE_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const TEXT_ID = '22222222-2222-4222-8222-222222222222'
const IMAGE_ID = '33333333-3333-4333-8333-333333333333'
const tokens = adaptProjectIdentityToVisualTokens('p1', { schema_version: 1 } as never)

function authoredFreeSlide(): FreeStaticSlide {
  let slide = createFreeStaticSlide('slide-1', 0)
  slide = addFreeTextElement(slide, TEXT_ID)
  slide = updateFreeElement(slide, TEXT_ID, { text: 'Chamada livre', color: 'accent', size: 'title' })
  slide = addFreeImageElement(slide, IMAGE_ID, FILE_A)
  slide = setFreeElementBox(slide, IMAGE_ID, { x: 0.2, y: 0.3, width: 0.6, height: 0.5 })
  return slide
}

function freeBody(slides: FreeStaticSlide[]) {
  return { schemaVersion: STATIC_AUTHORING_STATE_SCHEMA_VERSION, channelPieceId: CP, composition: 'free' as const, slides: slides.map(({ id, order, composition }) => ({ id, order, composition })) }
}

// ── 1. Static bootstrap ───────────────────────────────────────────────────────
describe('1. Static bootstrap: new authoring is FREE', () => {
  it('a never-saved piece opens as ONE blank free unit, with no Template selected or written', () => {
    const bootstrap = PAGE.slice(PAGE.indexOf('// Never saved: NEW authoring starts FREE'), PAGE.indexOf("setBaselineSnapshot(persistedSnapshot('free', null, blank, DEFAULT_TEMPLATE_ID))"))
    expect(bootstrap).toContain("const blank = [createFreeStaticSlide('slide-1', 0)]")
    expect(bootstrap).toContain("setMode('free')")
    expect(bootstrap).not.toMatch(/defaultCarouselSlides|singleSlideDefault|saveNow|static-authoring-state/)
    // The initial mode state itself is free (never an implicit Template).
    expect(PAGE).toContain("useState<StaticCompositionMode>('free')")
  })

  it('an empty free composition (zero elements) is a VALID persisted composition', () => {
    const parsed = StaticAuthoringStateSchema.safeParse(freeBody([createFreeStaticSlide('slide-1', 0)]))
    expect(parsed.success).toBe(true)
  })

  it('the bootstrap is the clean baseline: a blank canvas is not an unsaved edit, and Save stays the only writer', () => {
    expect(PAGE).toContain('const dirty = currentSnapshot !== null && currentSnapshot !== (lastSavedSnapshot ?? baselineSnapshot)')
    expect(PAGE).not.toMatch(/useEffect\([^)]*saveNow\(\)[^)]*\[context\]/)
  })

  it('the free body never carries a templateId; the Template body keeps its exact previous shape', () => {
    const fields = PAGE.slice(PAGE.indexOf('function persistedBodyFields'), PAGE.indexOf('function persistedSnapshot'))
    expect(fields).toContain("if (mode === 'free') return { composition: 'free' as const, slides:")
    expect(fields).toContain('return { templateId, slides:')
  })

  it('a persisted Documentary carousel stays Template-backed (never reinterpreted as free)', () => {
    const slides = defaultCarouselSlides(null)
    const parsed = StaticAuthoringStateSchema.safeParse({ schemaVersion: STATIC_AUTHORING_STATE_SCHEMA_VERSION, channelPieceId: CP, templateId: DEFAULT_TEMPLATE_ID, slides })
    expect(parsed.success).toBe(true)
    expect(parsed.success && parsed.data.composition).toBeUndefined()
    expect(parsed.success && parsed.data.slides.some((slide) => isPersistedFreeSlide(slide))).toBe(false)
    // Route: only an explicit NULL template_id is free; every Template row reports its Template.
    expect(ROUTE).toContain("if (row.template_id === null) return")
    expect(ROUTE).toContain("composition: 'template' as const, templateId: row.template_id ?? DEFAULT_TEMPLATE_ID")
  })
})

// ── 2. Static free state ──────────────────────────────────────────────────────
describe('2. Static free state (same composition + helpers as a Video free Scene)', () => {
  it('adds text and image with stable ids, LibraryFile identity and stage-fraction geometry', () => {
    const slide = authoredFreeSlide()
    const [text, image] = freeElements(slide)
    expect(text).toMatchObject({ id: TEXT_ID, kind: 'text', text: 'Chamada livre', color: 'accent', size: 'title' })
    expect(image).toMatchObject({ id: IMAGE_ID, kind: 'image', library_file_id: FILE_A, box: { x: 0.2, y: 0.3, width: 0.6, height: 0.5 } })
    expect(Object.keys(slide)).toEqual(['id', 'order', 'composition'])
  })

  it('order, visibility, replace and remove are authored and persist exactly', () => {
    let slide = authoredFreeSlide()
    slide = moveFreeElement(slide, TEXT_ID, 'forward')
    slide = setFreeElementHidden(slide, TEXT_ID, true)
    slide = updateFreeElement(slide, IMAGE_ID, { library_file_id: FILE_B })
    expect(freeElements(slide).map((element) => element.id)).toEqual([IMAGE_ID, TEXT_ID])
    const body = freeBody([slide])
    const reloaded = StaticAuthoringStateSchema.parse(JSON.parse(JSON.stringify(body)))
    expect(reloaded.slides).toEqual(body.slides)
    expect(freeStaticImageIds([slide])).toEqual([FILE_B])
    const removed = removeFreeElement(slide, IMAGE_ID)
    expect(freeElements(removed).map((element) => element.id)).toEqual([TEXT_ID])
    expect(StaticAuthoringStateSchema.safeParse(freeBody([removed])).success).toBe(true)
  })

  it('the write boundary rejects a mixed or fake composition', () => {
    const template = createTemplateSlide({ templateId: DEFAULT_TEMPLATE_ID, layoutId: 'cover', id: 'slide-2', order: 1, primitiveProjectRef: null }) as PersistedAuthoredSlide
    const free = createFreeStaticSlide('slide-1', 0)
    // free + a Template slide
    expect(StaticAuthoringStateSchema.safeParse({ ...freeBody([free]), slides: [free, template] }).success).toBe(false)
    // free + a templateId (a Template disguised under a free composition)
    expect(StaticAuthoringStateSchema.safeParse({ ...freeBody([free]), templateId: DEFAULT_TEMPLATE_ID }).success).toBe(false)
    // Template mode holding a free slide
    expect(StaticAuthoringStateSchema.safeParse({ schemaVersion: STATIC_AUTHORING_STATE_SCHEMA_VERSION, channelPieceId: CP, templateId: DEFAULT_TEMPLATE_ID, slides: [free] }).success).toBe(false)
    // CSS/unknown keys in a free element
    const bad = { ...free, composition: { kind: 'free', elements: [{ id: 'x', kind: 'text', box: { x: 0, y: 0, width: 0.5, height: 0.5 }, text: 'a', typography: 'display', color: 'foreground', align: 'left', size: 'large', fontSize: 40 }] } }
    expect(StaticAuthoringStateSchema.safeParse(freeBody([bad as FreeStaticSlide])).success).toBe(false)
    // "blank" is not a Template id
    expect(StaticAuthoringStateSchema.safeParse({ schemaVersion: STATIC_AUTHORING_STATE_SCHEMA_VERSION, channelPieceId: CP, templateId: 'blank', slides: [template] }).success).toBe(false)
  })
})

// ── 3. Template entry ─────────────────────────────────────────────────────────
describe('3. Static Template entry (explicit, existing registry, Template defaults)', () => {
  it('entering a Template instantiates the Template defaults (carousel Cover+Info; single piece contextual Cover)', () => {
    const entry = PAGE.slice(PAGE.indexOf('function enterTemplate('), PAGE.indexOf('function enterFree('))
    expect(entry).toContain('defaultCarouselSlides(context.primitiveProjectRef, nextTemplateId)')
    expect(entry).toContain('[singleSlideDefault(context, productContext)]')
    expect(entry).toContain("setMode('template')")
    expect(entry).not.toMatch(/saveNow|static-authoring-state/) // dirty until Save/autosave
    expect(entry).not.toMatch(/freeElements|library_file_id/) // no mapping from free elements
  })

  it('the Template list comes from the existing registry (no second registry, no Blank entry)', () => {
    expect(PAGE).toContain('listTemplateDefinitions().map((definition) => ({ id: definition.id, name: definition.name, description: definition.description }))')
    expect(VIDEO_PAGE).toContain('templates={listTemplateDefinitions().map((template) => ({ id: template.id, name: template.name, description: template.description }))}')
  })

  it('a Template composition entered from free persists and reloads as Template', () => {
    const slides = defaultCarouselSlides(null, DEFAULT_TEMPLATE_ID)
    const body = { schemaVersion: STATIC_AUTHORING_STATE_SCHEMA_VERSION, channelPieceId: CP, templateId: DEFAULT_TEMPLATE_ID, slides }
    const parsed = StaticAuthoringStateSchema.parse(JSON.parse(JSON.stringify(body)))
    expect(parsed.templateId).toBe(DEFAULT_TEMPLATE_ID)
    expect(parsed.slides.map((slide) => (slide as PersistedAuthoredSlide).variant)).toEqual(['cover', 'info'])
  })
})

// ── 4. Destructive switch ─────────────────────────────────────────────────────
describe('4. Destructive switch semantics', () => {
  it('only an empty single free unit switches without confirmation', () => {
    expect(freeCompositionHasContent([createFreeStaticSlide('slide-1', 0)])).toBe(false)
    expect(freeCompositionHasContent([authoredFreeSlide()])).toBe(true)
    expect(freeCompositionHasContent([createFreeStaticSlide('slide-1', 0), createFreeStaticSlide('slide-2', 1)])).toBe(true)
  })

  it('Template → free replaces with ONE blank free unit and never reuses an old slide id', () => {
    const entry = PAGE.slice(PAGE.indexOf('function enterFree('), PAGE.indexOf('function enterFree(') + 600)
    expect(entry).toContain('setFreeSlides([createFreeStaticSlide(id, 0)])')
    expect(entry).toContain('setSlides(null)')
    expect(entry).toContain('reservedSlideIdsRef.current.add(unit.id)')
  })

  it('"Voltar ao salvo" restores the saved mode (undoing an unsaved switch)', () => {
    const revert = PAGE.slice(PAGE.indexOf('function revert()'), PAGE.indexOf('function restoreSlideDefault()'))
    expect(revert).toContain("if (saved.composition === 'free')")
    expect(revert).toContain("setMode('free')")
    expect(revert).toContain("setMode('template')")
  })
})

// ── 5. Static single piece ────────────────────────────────────────────────────
describe('5. Static single piece (post / story / feed) is durable, ONE unit', () => {
  it('every static format loads and saves through the ChannelPiece-owned row (no carousel gate)', () => {
    expect(PAGE).not.toContain("if (payload.channelPiece.format !== 'carousel') {")
    expect(PAGE).not.toContain('if (!isCarousel || !slides || !context) return')
    expect(PAGE).toContain('async function saveNow(): Promise<boolean> {\n    if (!units || !context) return false')
    expect(PAGE).toMatch(/<span className="text-xs text-muted-foreground" data-testid="save-status">/)
  })

  it('the API enforces cardinality one for non-carousel pieces', () => {
    expect(ROUTE).toContain("if (channelPiece.format !== 'carousel' && body.slides.length !== 1)")
    expect(ROUTE).toContain("template_id: body.composition === 'free' ? null : body.templateId ?? DEFAULT_TEMPLATE_ID")
  })

  it('no collection UI leaks into a single piece (slide nav, add slide and ZIP stay carousel-only)', () => {
    expect(PAGE).toContain('{isCarousel && <div className="flex shrink-0 items-center gap-1" role="group" aria-label="Slides" data-testid="slide-nav">')
    expect(PAGE).toContain('{isCarousel && <div className="flex shrink-0 items-center gap-1">\n          <Button size="sm" variant="outline" className="gap-1.5" disabled={zipBusy}')
  })

  it('attaching a durable output saves dirty authoring FIRST and attaches nothing if that fails', () => {
    const save = PAGE.slice(PAGE.indexOf('async function saveRenderOutput('), PAGE.indexOf('const canvasW ='))
    const guard = save.indexOf('if (dirty && !(await saveNow()))')
    expect(guard).toBeGreaterThan(-1)
    expect(guard).toBeLessThan(save.indexOf('saveRenderFileToChannelPiece'))
    expect(save.slice(guard, save.indexOf('try {', guard))).toContain('return')
  })

  it('migration 038 only relaxes NOT NULL (no rewrite, default kept)', () => {
    const sql = read('scripts/038_static_authoring_free_composition.sql')
    expect(sql).toContain('ALTER COLUMN template_id DROP NOT NULL')
    expect(sql).not.toMatch(/^\s*UPDATE|DROP DEFAULT|DROP COLUMN/m)
  })
})

// ── 6. Video bootstrap and switch ─────────────────────────────────────────────
describe('6. Video: new Scenes are explicitly free; legacy Scenes stay Cover', () => {
  const legacy: VideoScene = { id: 'legacy', order: 1, description: 'brief', prompt: null, image_url: null, library_file_id: FILE_A, duration: 4, movement: 'zoom_in' }

  it('a new VideoDraft starts with ONE explicit empty free Scene', async () => {
    const fetchImpl = vi.fn(async (_url: string, init: RequestInit) => new Response(JSON.stringify({ draft: { id: 'd1', echo: JSON.parse(String(init.body)) } }), { status: 201 }))
    const result = await createVideoDraftForCreativeEditor({ projectId: 'p', productionId: 'q', fetchImpl: fetchImpl as unknown as typeof fetch })
    expect(result.ok).toBe(true)
    const body = JSON.parse(String(fetchImpl.mock.calls[0][1].body)) as { scenes: VideoScene[] }
    expect(body.scenes).toHaveLength(1)
    expect(body.scenes[0].composition).toEqual({ kind: 'free', elements: [] })
  })

  it('"Nova cena" inserts an explicit free Scene (no Template dialog, no absent composition)', () => {
    const add = VIDEO_PAGE.slice(VIDEO_PAGE.indexOf('  function addScene() {'), VIDEO_PAGE.indexOf('  function removeSelectedScene()'))
    expect(add).toContain('createFreeScene(scenes.length + 1, crypto.randomUUID(), NEW_SCENE_DURATION_SECONDS)')
    expect(VIDEO_PAGE).not.toMatch(/addVideoScene\(|new-scene-template|setNewSceneOpen/)
  })

  it('a legacy Scene with an absent composition still resolves as the historical Cover', () => {
    expect(resolveSceneComposition(legacy).layoutId).toBe('cover')
    expect(legacy.composition).toBeUndefined()
  })

  it('free → Template writes an EXPLICIT Template composition and keeps Scene state', () => {
    let scene = createFreeScene(2, 's2', 3)
    scene = { ...addFreeTextElement(scene, TEXT_ID), element_timing: { [TEXT_ID]: { start_frame: 10, duration_frames: 20 } }, library_file_id: FILE_A, description: 'brief', movement: 'zoom_in' }
    const template = applySceneTemplate(scene)
    expect(template.composition).toEqual({ layout: 'cover', content: { title: 'Cena 2' } })
    expect(template.element_timing).toBeUndefined() // free ids no longer exist: no orphan timing
    expect(template).toMatchObject({ id: 's2', order: 2, duration: 3, movement: 'zoom_in', library_file_id: FILE_A, description: 'brief' })
    expect(resolveSceneComposition(template).authored.layout).toBe(true)
  })

  it('Template → free replaces with an EMPTY free composition (no conversion) and keeps Scene state', () => {
    const scene: VideoScene = { ...legacy, composition: { layout: 'quote', appearance: 'light' }, element_timing: { quote: { start_frame: 15 } } }
    const free = applySceneFreeComposition(scene)
    expect(free.composition).toEqual({ kind: 'free', elements: [] })
    expect(free.element_timing).toBeUndefined()
    expect(free).toMatchObject({ duration: 4, movement: 'zoom_in', library_file_id: FILE_A, description: 'brief' })
    // Legacy absent composition → free is an explicit switch too.
    expect(applySceneFreeComposition(legacy).composition).toEqual({ kind: 'free', elements: [] })
  })

  it('switching mode never touches the root timeline, the other Scenes, or durations', () => {
    const scenes: VideoScene[] = [legacy, createFreeScene(2, 's2', 3)]
    const switched = [scenes[0], applySceneTemplate(scenes[1])]
    const base = { id: 'd', project_id: 'p', production_id: 'q', timeline: { version: 1 as const, items: [{ id: 'i1', kind: 'text' as const, start_frame: 30, duration_frames: 60, text: 'Nome', style: 'lower_third' as const }] }, canvas: null }
    const before = adaptVideoDraftToTimelineManifest({ draft: { ...base, scenes } } as never)
    const after = adaptVideoDraftToTimelineManifest({ draft: { ...base, scenes: switched } } as never)
    expect(after.manifest.specification.duration_frames).toBe(before.manifest.specification.duration_frames)
    expect(after.manifest.segments[0]).toEqual(before.manifest.segments[0])
    expect(after.manifest.segments.filter((segment) => segment.track_id !== 'video-main')).toEqual(before.manifest.segments.filter((segment) => segment.track_id !== 'video-main'))
    expect(after.manifest.segments[1].kind).toBe('template')
  })
})

// ── 7. Render ─────────────────────────────────────────────────────────────────
describe('7. Static free still: template-free contract, same drawing as Video', () => {
  const manifest = buildStaticFreeRenderManifest({
    composition: authoredFreeSlide().composition,
    canvas: { width: 1080, height: 1350, unit: 'px' },
    channelPieceId: CP,
    projectId: 'p1',
    identitySnapshotRef: tokens.snapshot_ref,
    slideId: 'slide-1',
  })

  it('the manifest has no TemplateRef, no content, and binds images as library_file refs', () => {
    expect(StaticFreeRenderManifestSchema.safeParse(manifest).success).toBe(true)
    expect(StaticRenderManifestSchema.safeParse(manifest).success).toBe(false)
    expect(manifest).not.toHaveProperty('template')
    expect(manifest).not.toHaveProperty('content')
    expect(isStaticFreeRenderManifest(manifest)).toBe(true)
    expect(Object.values(manifest.assets)).toEqual([{ type: 'library_file', ref: FILE_A, fit: 'cover' }])
    expect(JSON.stringify(manifest)).not.toMatch(/documentary|blank|http/)
  })

  it('the frozen snapshot parses, and a free snapshot refuses Template-only fields', () => {
    const snapshot = buildStaticRenderExecutionSnapshot({ manifest, identitySnapshot: tokens, slide: { id: 'slide-1', index: 1, total: 1 } })
    expect(parseStaticRenderExecutionSnapshot(JSON.parse(JSON.stringify(snapshot))).ok).toBe(true)
    expect(parseStaticRenderExecutionSnapshot({ ...snapshot, templateId: DEFAULT_TEMPLATE_ID }).ok).toBe(false)
  })

  it('claim-time resolution presigns only the frozen, project-owned LibraryFiles', async () => {
    const snapshot = buildStaticRenderExecutionSnapshot({ manifest, identitySnapshot: tokens, slide: null })
    const ok = await resolveStaticRuntimeInput({
      rawSnapshot: JSON.parse(JSON.stringify(snapshot)),
      libraryFiles: [{ id: FILE_A, storage_path: 'u/p/a.png', deleted_at: null }],
      createPresignedReadUrl: async (storagePath) => `https://signed.example/${storagePath}`,
    })
    expect(ok.ok).toBe(true)
    if (!ok.ok) return
    expect(ok.staticInput.resolvedInput).toMatchObject({ kind: 'free' })
    expect(ok.staticInput.resolvedInput.resolvedAssets[`library_file:${FILE_A}`].url).toBe('https://signed.example/u/p/a.png')
    const missing = await resolveStaticRuntimeInput({ rawSnapshot: snapshot, libraryFiles: [], createPresignedReadUrl: async () => 'x' })
    expect(missing).toMatchObject({ ok: false, code: 'FREE_IMAGE_UNAVAILABLE' })
  })

  it('the still draws exactly the shared FreeStage (the same drawing the Video free segment uses)', () => {
    const resolved = resolveStaticFreeRenderManifest(manifest, { identitySnapshot: tokens })
    expect(resolved.valid).toBe(true)
    if (!resolved.valid) return
    const assets: Record<string, { url: string }> = { [`library_file:${FILE_A}`]: { url: 'https://signed.example/a.png' } }
    const html = renderToStaticMarkup(createElement(FreeStage, { elements: manifest.composition.elements, width: 1080, height: 1350, tokens: resolved.value.tokens, imageUrl: (ref: string) => assets[ref], ImageComponent: (props: { src: string; alt?: string }) => createElement('img', props), dataAttributes: { 'data-kind': 'free-still' } }))
    expect(html).toContain('data-kind="free-still"')
    expect(html).toContain('isolation:isolate')
    expect(html).toContain('Chamada livre')
    expect(html).toContain('font-size:118.8px') // "Título" step 0.11 × the stage's shorter side (1080)
    expect(html).toContain('src="https://signed.example/a.png"')
    expect(html).toContain(`color:${tokens.colors.accent}`)
    // Both the still and the Video segment draw through this ONE component.
    expect(read('remotion/DocumentaryCardComposition.tsx')).toContain('<FreeStage elements={elements} width={width} height={height} tokens={resolvedInput.tokens}')
    expect(read('remotion/timeline/FreeSegment.tsx')).toContain('<FreeStage')
  })

  it('the enqueue route accepts the free request shape and freezes the template-free manifest', () => {
    expect(RENDER_ROUTE).toContain("const { composition: rawFreeComposition, ...templateRequest } = renderRequest as Record<string, unknown>")
    expect(RENDER_ROUTE).toContain('buildStaticFreeRenderManifest({')
    expect(RENDER_ROUTE).toContain('canvas: target.canvas,')
    expect(RENDER_ROUTE).toContain("return fail(403, 'FREE_IMAGE_FORBIDDEN'")
    expect(RENDER_ROUTE).toContain("Composicao livre nao aceita campos de Template.")
  })

  it('the worker ships the shared drawing and the still composition branches by kind', () => {
    expect(read('infra/render-worker-runtime/export.mjs')).toContain("'components/creative/free/free-stage.tsx'")
    const composition = read('remotion/DocumentaryCardComposition.tsx')
    expect(composition).toContain('if (isFreeStillInput(resolvedInput)) return <StaticFreeStill resolvedInput={resolvedInput} />')
    // Only a type import of the resolver (erased): the worker bundle does not ship that module.
    expect(composition).toContain("import type { AnyResolvedStaticInput, ResolvedStaticFreeInput } from '@/lib/creative/resolution/resolve-static-render'")
    expect(composition).not.toMatch(/^import \{[^}]*\} from '@\/lib\/creative\/resolution\/resolve-static-render'/m)
  })
})

// ── 8. Carousel compatibility ─────────────────────────────────────────────────
describe('8. Existing Template carousel compatibility', () => {
  it('a 10-slide Template carousel body still parses unchanged as Template', () => {
    const layouts = ['cover', 'info', 'list', 'grid', 'map', 'network', 'quote', 'closing', 'info', 'closing']
    const slides = layouts.map((layoutId, order) => createTemplateSlide({ templateId: DEFAULT_TEMPLATE_ID, layoutId, id: `slide-${order + 1}`, order, primitiveProjectRef: 'portal' }) as PersistedAuthoredSlide)
    const body = { schemaVersion: STATIC_AUTHORING_STATE_SCHEMA_VERSION, channelPieceId: CP, templateId: DEFAULT_TEMPLATE_ID, slides }
    const parsed = StaticAuthoringStateSchema.parse(body)
    expect(parsed.slides).toHaveLength(10)
    expect(parsed.slides.every((slide) => !isPersistedFreeSlide(slide))).toBe(true)
  })

  it('an older client omitting templateId still means the Template, never free', () => {
    const parsed = StaticAuthoringStateSchema.parse({ schemaVersion: STATIC_AUTHORING_STATE_SCHEMA_VERSION, channelPieceId: CP, slides: defaultCarouselSlides(null) })
    expect(parsed.composition).toBeUndefined()
    expect(ROUTE).toContain("body.composition === 'free' ? null : body.templateId ?? DEFAULT_TEMPLATE_ID")
  })

  it('the Template editor path (render, ZIP, Restaurar padrão) is untouched in Template mode', () => {
    expect(PAGE).toContain("templateId,\n      elementOrder: deriveElementOrderRequest(state, templateId),")
    expect(PAGE).toContain('/api/creative/static-authoring/export?channelPieceId=')
    expect(PAGE).toContain("{mode === 'template' ? <Button size=\"sm\" variant=\"ghost\" className=\"h-8 shrink-0 gap-1 px-1.5 text-[11px]\" onClick={() => setRestoreDialogOpen(true)}")
  })
})

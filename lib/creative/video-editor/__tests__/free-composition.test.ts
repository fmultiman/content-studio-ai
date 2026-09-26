import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { FreeSceneComposition, LibraryFile, VideoScene } from '@/lib/types'
import { buildRenderExecutionSnapshot } from '@/lib/render-execution/build-snapshot'
import { resolveTimelineManifest } from '@/lib/creative/resolution/resolve-timeline'
import { TimelineSegmentSchema } from '@/lib/schemas/creative/timeline'
import { validateTimelineSemantics } from '@/lib/schemas/creative/validation'
import { prepareTimelineLibraryFileAssets } from '@/lib/creative/timeline-adapter/prepare-scene-assets'
import { buildLivePreviewInput } from '../live-preview-input'
import { buildVideoDraftSaveBody, insertVideoScene, normalizeLoadedScenes, persistedVideoSnapshot } from '../video-authoring'
import { reorderScenes } from '../scene-timeline'
import { resolveSceneComposition, setSceneLayout, validateSceneCompositionShape } from '../scene-composition'
import { sceneHasTemporalElements, sceneTimingRows, setSceneElementTiming } from '../element-timing'
import type { VideoTimeline } from '../temporal-items'
import { videoDraftCanvasSupport } from '../video-canvas'
import {
  MIN_FREE_BOX, addFreeImageElement, addFreeTextElement, clampFreeBox, createFreeScene, deriveFreeSegment, freeElements,
  freeImageLibraryFileIds, isFreeComposition, isFreeScene, moveFreeElement, removeFreeElement, setFreeElementBox,
  setFreeElementHidden, updateFreeElement, validateFreeCompositionShape,
} from '../free-composition'

// VIDEO_FREE_SCENE_COMPOSITION_V1

const IDENTITY = {
  schema_version: 'visual-tokens.v0' as const,
  snapshot_ref: 'project:11111111-1111-1111-1111-111111111111:snapshot',
  typography: {
    display: { family: 'Fraunces', weight: 700, style: 'normal' as const },
    body: { family: 'Source Sans 3', weight: 400, style: 'normal' as const },
  },
  colors: { background: '#F6F0E4', foreground: '#16352F', accent: '#A34A27' },
  spacing: { unit: 8, default_gap: 16 },
}
const DRAFT = { id: 'draft-1', project_id: '11111111-1111-1111-1111-111111111111', production_id: '22222222-2222-2222-2222-222222222222' }
const IMG = '33333333-3333-4333-8333-333333333333'
const IMG2 = '44444444-4444-4444-8444-444444444444'
const T1 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const I1 = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'

const templateScene = (id: string, order: number, extra: Partial<VideoScene> = {}): VideoScene => ({ id, order, description: '', prompt: null, image_url: null, library_file_id: null, duration: 3, movement: 'static', ...extra })
/** Free Scene with a text (back) and an image (front). */
function freeScene(id = 'free', order = 2): VideoScene {
  let scene = createFreeScene(order, id, 2)
  scene = addFreeTextElement(scene, T1)
  scene = updateFreeElement(scene, T1, { text: 'Sem template', color: 'accent', size: 'title', align: 'center' })
  scene = addFreeImageElement(scene, I1, IMG)
  return scene
}
const QUOTE_COMPOSITION = { layout: 'quote', content: { title: 'O que ficou', intro: 'Décadas depois.', bullets: ['a', 'b', 'c'], quote: 'Isso não diminui o valor do livro.', callout: 'Além.' } }
const MIXED: VideoScene[] = [
  templateScene('s1', 1),
  freeScene('s2', 2),
  templateScene('s3', 3, { duration: 4, composition: QUOTE_COMPOSITION as VideoScene['composition'], element_timing: { quote: { start_frame: 15, duration_frames: 60 } } }),
]
const TIMELINE: VideoTimeline = {
  version: 1,
  items: [
    { id: 'broll', kind: 'visual', start_frame: 60, duration_frames: 60, library_file_id: IMG2 },
    { id: 'lt', kind: 'text', start_frame: 80, duration_frames: 90, text: 'Nome\nfunção', style: 'lower_third' },
    { id: 'bed', kind: 'audio', start_frame: 0, library_file_id: '55555555-5555-4555-8555-555555555555', volume: 0.6, end_anchor: 'sequence_end' },
  ],
}
const snapshot = (scenes: VideoScene[], canvas: unknown = null) =>
  buildRenderExecutionSnapshot({ draft: { ...DRAFT, scenes, timeline: TIMELINE, canvas }, identitySnapshot: IDENTITY }).snapshot.manifest
const root = join(__dirname, '..', '..', '..', '..')
const read = (path: string) => readFileSync(join(root, path), 'utf8')
/** Every object key, recursively (to prove no Template identity field exists anywhere). */
const keysOf = (value: unknown): string[] => (value && typeof value === 'object' ? Object.entries(value).flatMap(([key, child]) => [key, ...keysOf(child)]) : [])
const TEMPLATE_KEYS = ['template', 'template_id', 'templateId', 'layout', 'variant', 'component_key', 'appearance', 'element_order', 'hidden_elements']

describe('Legacy and Template Scenes are untouched', () => {
  it('an absent composition stays the legacy Template Cover (never Blank)', () => {
    const scene = templateScene('legacy', 1)
    expect(isFreeScene(scene)).toBe(false)
    expect(resolveSceneComposition(scene).layoutId).toBe('cover')
    const segment = snapshot([scene]).segments[0]
    expect(segment.kind).toBe('template')
    expect(segment.kind === 'template' ? segment.payload.template.variant : null).toBe('cover')
  })

  it('stored Template compositions parse unchanged and carry no discriminant', () => {
    expect(validateSceneCompositionShape(QUOTE_COMPOSITION)).toEqual({ ok: true })
    expect(isFreeComposition(QUOTE_COMPOSITION)).toBe(false)
    expect(Object.keys(QUOTE_COMPOSITION)).not.toContain('kind')
    // any other discriminant value is an unknown key, not a mode
    expect(validateSceneCompositionShape({ kind: 'template', layout: 'cover' }).ok).toBe(false)
    expect(validateSceneCompositionShape({ kind: 'blank' }).ok).toBe(false)
  })

  it('a draft without free Scenes produces exactly the manifest it produced before (no free assets)', () => {
    const legacy = [templateScene('s1', 1), MIXED[2]]
    const manifest = snapshot(legacy)
    expect(manifest.segments.every((segment) => segment.kind !== 'free')).toBe(true)
    expect(Object.keys(manifest.assets)).toEqual([`library_file:${IMG2}`, 'library_file:55555555-5555-4555-8555-555555555555'])
  })
})

describe('Explicit free composition', () => {
  it('parses, validates and has no Template identity', () => {
    const scene = freeScene()
    expect(isFreeScene(scene)).toBe(true)
    expect(validateSceneCompositionShape(scene.composition)).toEqual({ ok: true })
    expect(() => resolveSceneComposition(scene)).toThrow(/free Scene/)
    expect(keysOf(scene.composition).filter((key) => TEMPLATE_KEYS.includes(key))).toEqual([])
    expect(JSON.stringify(scene.composition)).not.toMatch(/blank|documentary/i)
  })

  it('new free Scene: explicit kind, empty, static Motion, same sequence defaults', () => {
    const created = createFreeScene(4, 'new', 3)
    expect(created.composition).toEqual({ kind: 'free', elements: [] })
    expect(created).toMatchObject({ id: 'new', order: 4, duration: 3, movement: 'static', library_file_id: null })
    const inserted = insertVideoScene([templateScene('a', 1), templateScene('b', 2)], created, 0)
    expect(inserted.index).toBe(1)
    expect(inserted.scenes.map((scene) => [scene.id, scene.order])).toEqual([['a', 1], ['new', 2], ['b', 3]])
  })

  it('Template edits never map a free composition', () => {
    const scene = freeScene()
    expect(setSceneLayout(scene, 'quote')).toBe(scene)
  })
})

describe('Free element identity, geometry and style', () => {
  it('ids are the caller-generated stable ids, never array positions', () => {
    const scene = freeScene()
    expect(freeElements(scene).map((element) => element.id)).toEqual([T1, I1])
    const reordered = moveFreeElement(scene, I1, 'backward')
    expect(freeElements(reordered).map((element) => element.id)).toEqual([I1, T1])
    const reloaded = normalizeLoadedScenes(JSON.parse(JSON.stringify([reordered])))
    expect(freeElements(reloaded[0]).map((element) => element.id)).toEqual([I1, T1])
    expect(addFreeTextElement(scene, T1)).toBe(scene) // an existing id is never reused
  })

  it('rejects duplicate ids, missing ids, bad kinds and unknown keys', () => {
    const composition = freeScene().composition as FreeSceneComposition
    const [text, image] = composition.elements
    expect(validateFreeCompositionShape({ kind: 'free', elements: [text, { ...image, id: text.id }] }).ok).toBe(false)
    expect(validateFreeCompositionShape({ kind: 'free', elements: [{ ...text, id: '' }] }).ok).toBe(false)
    expect(validateFreeCompositionShape({ kind: 'free', elements: [{ ...text, kind: 'shape' }] }).ok).toBe(false)
    expect(validateFreeCompositionShape({ kind: 'free', elements: [{ ...text, css: 'left: 4%' }] }).ok).toBe(false)
    expect(validateFreeCompositionShape({ kind: 'free', elements: [], background: '#fff' }).ok).toBe(false)
  })

  it('geometry: stage fractions, top-left origin, on stage, minimum size; clamping keeps edits on stage', () => {
    const composition = freeScene().composition as FreeSceneComposition
    const [text] = composition.elements
    for (const box of [{ x: -0.1, y: 0, width: 0.5, height: 0.5 }, { x: 0.6, y: 0, width: 0.5, height: 0.5 }, { x: 0, y: 0, width: 0.001, height: 0.5 }, { x: 0, y: 0, width: 0.5 }]) {
      expect(validateFreeCompositionShape({ kind: 'free', elements: [{ ...text, box }] }).ok).toBe(false)
    }
    expect(clampFreeBox({ x: 0.9, y: -1, width: 0.5, height: 2 })).toEqual({ x: 0.5, y: 0, width: 0.5, height: 1 })
    expect(clampFreeBox({ x: 0.123456, y: 0, width: 0.001, height: 0.3 })).toEqual({ x: 0.1235, y: 0, width: MIN_FREE_BOX, height: 0.3 })
    const moved = setFreeElementBox(freeScene(), T1, { x: 0.2, width: 0.9 })
    expect(freeElements(moved)[0].box).toEqual({ x: 0.1, y: 0.1, width: 0.9, height: 0.2 })
  })

  it('text style is Identity roles only; image is LibraryFile identity only', () => {
    const composition = freeScene().composition as FreeSceneComposition
    const [text, image] = composition.elements
    expect(text).toMatchObject({ kind: 'text', typography: 'display', color: 'accent', size: 'title', align: 'center' })
    expect(validateFreeCompositionShape({ kind: 'free', elements: [{ ...text, color: '#ff0000' }] }).ok).toBe(false)
    expect(validateFreeCompositionShape({ kind: 'free', elements: [{ ...text, typography: 'Comic Sans' }] }).ok).toBe(false)
    expect(validateFreeCompositionShape({ kind: 'free', elements: [{ ...text, text: 'x'.repeat(501) }] }).ok).toBe(false)
    expect(image).toEqual({ id: I1, kind: 'image', box: { x: 0.1, y: 0.35, width: 0.8, height: 0.45 }, library_file_id: IMG, fit: 'cover' })
    expect(validateFreeCompositionShape({ kind: 'free', elements: [{ ...image, library_file_id: 'https://x/y.png' }] }).ok).toBe(false)
    expect(freeImageLibraryFileIds(MIXED)).toEqual([IMG])
  })

  it('visibility is authored state (not deletion, not opacity); remove deletes only that element', () => {
    const hidden = setFreeElementHidden(freeScene(), T1, true)
    expect(freeElements(hidden).find((element) => element.id === T1)?.hidden).toBe(true)
    expect(deriveFreeSegment(hidden.composition as FreeSceneComposition).payload.elements.map((element) => element.element_id)).toEqual([I1])
    expect(freeElements(setFreeElementHidden(hidden, T1, false))[0]).not.toHaveProperty('hidden')
    const removed = removeFreeElement(freeScene(), T1)
    expect(freeElements(removed).map((element) => element.id)).toEqual([I1])
    expect(freeImageLibraryFileIds([removeFreeElement(freeScene(), I1)])).toEqual([])
  })
})

describe('Neutral free render contract', () => {
  it('a free Scene becomes a `free` segment on the primary track with no Template identity', () => {
    const manifest = snapshot(MIXED)
    const free = manifest.segments.find((segment) => segment.id === 'scene:s2')
    expect(free?.kind).toBe('free')
    expect(free).toMatchObject({ track_id: 'video-main', start_frame: 90, duration_frames: 60 })
    expect(keysOf(free).filter((key) => TEMPLATE_KEYS.includes(key))).toEqual([])
    expect(JSON.stringify(free)).not.toMatch(/blank|documentary|component_key/i)
    expect(TimelineSegmentSchema.safeParse(free).success).toBe(true)
    // paint order = authored order (text back, image front)
    expect(free?.kind === 'free' ? free.payload.elements.map((element) => [element.kind, element.element_id]) : null).toEqual([['text', T1], ['image', I1]])
    expect(manifest.assets[`library_file:${IMG}`]).toEqual({ type: 'library_file', ref: IMG, fit: 'cover' })
    expect(JSON.stringify(manifest)).not.toMatch(/X-Amz|https?:\/\//)
  })

  it('neighbouring Template Scenes keep their exact segments', () => {
    const withFree = snapshot(MIXED)
    const templateOnly = snapshot([MIXED[0], templateScene('s2', 2, { duration: 2 }), MIXED[2]])
    const pick = (manifest: typeof withFree, id: string) => manifest.segments.find((segment) => segment.id === id)
    expect(pick(withFree, 'scene:s1')).toEqual(pick(templateOnly, 'scene:s1'))
    expect(pick(withFree, 'scene:s3')).toEqual(pick(templateOnly, 'scene:s3'))
  })

  it('semantic validation: unique element ids and known assets', () => {
    const manifest = snapshot(MIXED)
    expect(validateTimelineSemantics(manifest).valid).toBe(true)
    const broken = structuredClone(manifest)
    const free = broken.segments.find((segment) => segment.kind === 'free')
    if (free?.kind !== 'free') throw new Error('no free segment')
    free.payload.elements.push({ ...free.payload.elements[0] })
    delete broken.assets[`library_file:${IMG}`]
    const codes = validateTimelineSemantics(broken).issues.map((issue) => issue.code)
    expect(codes).toContain('duplicate_free_element_id')
    expect(codes).toContain('free_asset_not_found')
  })

  it('schema rejects an off-stage box and a free segment carrying a template', () => {
    const free = snapshot(MIXED).segments.find((segment) => segment.kind === 'free')
    expect(TimelineSegmentSchema.safeParse({ ...free, payload: { elements: [{ element_id: 'x', kind: 'text', box: { x: 0.8, y: 0, width: 0.5, height: 0.1 }, text: 'a', typography: 'body', color: 'foreground', align: 'left', size: 'small' }] } }).success).toBe(false)
    expect(TimelineSegmentSchema.safeParse({ ...free, payload: { ...(free as { payload: object }).payload, template: { id: 'blank' } } }).success).toBe(false)
  })
})

describe('Canvas: platform capability != Template compatibility', () => {
  it('mixed Template + Free: 9:16 and 4:5 draw; 16:9 stays blocked by the Template Scenes', () => {
    expect(videoDraftCanvasSupport(MIXED, { width: 1080, height: 1920 }).supported).toBe(true)
    expect(videoDraftCanvasSupport(MIXED, { width: 1080, height: 1350 }).supported).toBe(true)
    expect(videoDraftCanvasSupport(MIXED, { width: 1920, height: 1080 })).toMatchObject({ supported: false, templateBackedScenes: 2 })
    expect(resolveTimelineManifest(snapshot(MIXED, { width: 1920, height: 1080 }), { identitySnapshot: IDENTITY }).valid).toBe(false)
    expect(resolveTimelineManifest(snapshot(MIXED, { width: 1080, height: 1350 }), { identitySnapshot: IDENTITY }).valid).toBe(true)
  })

  it('a free-only draft draws any platform-valid stage, including 16:9', () => {
    const freeOnly = [freeScene('only', 1)]
    expect(videoDraftCanvasSupport(freeOnly, { width: 1920, height: 1080 })).toMatchObject({ supported: true, templateBackedScenes: 0 })
    expect(videoDraftCanvasSupport(freeOnly, { width: 1280, height: 720 }).supported).toBe(true)
    expect(videoDraftCanvasSupport(freeOnly, { width: 1081, height: 720 }).supported).toBe(false)
    const manifest = snapshot(freeOnly, { width: 1920, height: 1080 })
    expect(manifest.specification).toMatchObject({ width: 1920, height: 1080 })
    expect(resolveTimelineManifest(manifest, { identitySnapshot: IDENTITY }).valid).toBe(true)
  })

  it('the stage never comes from the image or the boxes', () => {
    const other = MIXED.map((scene) => (scene.id === 's2' ? updateFreeElement(setFreeElementBox(scene, I1, { width: 1, height: 1, x: 0, y: 0 }), I1, { library_file_id: IMG2 }) : scene))
    expect(snapshot(other, { width: 1080, height: 1350 }).specification).toEqual(snapshot(MIXED, { width: 1080, height: 1350 }).specification)
    expect(snapshot(other).specification).toMatchObject({ width: 1080, height: 1920 })
  })
})

describe('Runtime preparation and Player/render parity', () => {
  it('claim-time preparation signs free images through the manifest asset map (never persisted)', async () => {
    const manifest = snapshot(MIXED)
    const file = { id: IMG, project_id: DRAFT.project_id, kind: 'image', storage_path: 'users/u/p/img.png', mime_type: 'image/png', name: 'img.png', deleted_at: null } as unknown as LibraryFile
    const prepared = await prepareTimelineLibraryFileAssets(manifest, (ref) => (ref === IMG ? file : undefined), { createPresignedReadUrl: async (path: string) => `https://signed.example/${path}?sig=1` })
    expect(prepared.resolvedManifestAssets[`library_file:${IMG}`]?.url).toBe('https://signed.example/users/u/p/img.png?sig=1')
    expect(JSON.stringify(manifest)).not.toContain('signed.example')
  })

  it('the Live Player input is the render snapshot, with the browser display URL patched in', () => {
    const libraryFiles = new Map([[IMG, { id: IMG, name: 'img.png', public_url: 'https://display.example/img.png', mime_type: 'image/png', kind: 'image' as const }]])
    const live = buildLivePreviewInput({ draft: DRAFT, scenes: MIXED, timeline: TIMELINE, canvas: { width: 1080, height: 1350 }, identitySnapshot: IDENTITY, libraryFiles: libraryFiles as never })
    expect(live.ok).toBe(true)
    if (!live.ok) return
    expect(live.manifest).toEqual(snapshot(MIXED, { width: 1080, height: 1350 }))
    expect(live.resolvedInput.resolvedAssets[`library_file:${IMG}`]?.url).toBe('https://display.example/img.png')
  })
})

describe('Save / reload / dirty', () => {
  it('the free composition round-trips exactly through the save body and reload', () => {
    const body = JSON.parse(JSON.stringify(buildVideoDraftSaveBody(DRAFT, 'v', MIXED, TIMELINE)))
    const reloaded = normalizeLoadedScenes(body.scenes)
    expect(reloaded[1].composition).toEqual(MIXED[1].composition)
    expect(persistedVideoSnapshot('v', reloaded, TIMELINE)).toBe(persistedVideoSnapshot('v', MIXED, TIMELINE))
    expect(keysOf(body.scenes[1].composition).filter((key) => TEMPLATE_KEYS.includes(key) || /url/i.test(key))).toEqual([])
    expect(JSON.stringify(body.scenes[1])).not.toMatch(/X-Amz|https?:\/\//)
  })

  it('every authored free edit changes the dirty snapshot; UI state never enters it', () => {
    const base = persistedVideoSnapshot('v', MIXED)
    const edits: Array<(scene: VideoScene) => VideoScene> = [
      (scene) => addFreeTextElement(scene, 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'),
      (scene) => setFreeElementBox(scene, T1, { x: 0.05 }),
      (scene) => updateFreeElement(scene, T1, { text: 'Outro' }),
      (scene) => updateFreeElement(scene, I1, { library_file_id: IMG2 }),
      (scene) => setFreeElementHidden(scene, I1, true),
      (scene) => moveFreeElement(scene, I1, 'backward'),
      (scene) => removeFreeElement(scene, T1),
    ]
    for (const edit of edits) {
      expect(persistedVideoSnapshot('v', MIXED.map((scene) => (scene.id === 's2' ? edit(scene) : scene)))).not.toBe(base)
    }
    const editor = read('app/(dashboard)/creative-editor/video/[draftId]/page.tsx')
    expect(editor).not.toMatch(/persistedVideoSnapshot\([^)]*(openElementId|freeImagePicker|newSceneOpen)/)
    expect(editor).not.toMatch(/buildVideoDraftSaveBody\([^)]*(openElementId|freeImagePicker|newSceneOpen)/)
  })
})

describe('Sequence, timing and root regressions', () => {
  it('reordering moves the free Scene with its composition; root items stay absolute', () => {
    const reordered = reorderScenes(MIXED, 1, 0)
    expect(reordered[0].id).toBe('s2')
    expect(reordered[0].composition).toEqual(MIXED[1].composition)
    const manifest = snapshot(reordered)
    expect(manifest.segments.find((segment) => segment.id === 'scene:s2')).toMatchObject({ start_frame: 0, duration_frames: 60 })
    for (const id of ['item:broll', 'item:lt']) {
      expect(manifest.segments.find((segment) => segment.id === id)).toEqual(snapshot(MIXED).segments.find((segment) => segment.id === id))
    }
  })

  it('a free Scene gets no Template child timing rows; the Citação timing is unchanged', () => {
    expect(sceneHasTemporalElements(MIXED[1])).toBe(false)
    expect(sceneTimingRows(MIXED[1], 90, 60)).toEqual([])
    expect(setSceneElementTiming(MIXED[1], 'quote', { start_frame: 10 }, 60)).toBe(MIXED[1])
    expect(sceneHasTemporalElements(MIXED[2])).toBe(true)
    const quote = snapshot(MIXED).segments.find((segment) => segment.id === 'scene:s3')
    expect(quote?.kind === 'template' ? quote.payload.element_timing : null).toEqual([
      { element_id: 'quote', start_frame: 15, duration_frames: 60 },
      { element_id: 'tape1', start_frame: 15, duration_frames: 60 },
    ])
  })

  it('audio still follows the sequence end, which now includes the free Scene', () => {
    const manifest = snapshot(MIXED)
    expect(manifest.specification.duration_frames).toBe(90 + 60 + 120)
    expect(manifest.segments.find((segment) => segment.id === 'item:bed')).toMatchObject({ start_frame: 0, duration_frames: 270 })
  })

  it('the API refuses element timing on a free Scene and validates free images as Project images', () => {
    const api = read('app/api/video-drafts/route.ts')
    expect(api).toContain('composição livre não tem timing de elementos nesta versão')
    expect(api.match(/validateFreeImageBindings\(supabase/g)?.length).toBe(2)
    expect(read('app/api/video-drafts/[id]/render/route.ts')).toContain('freeImageLibraryFileIds(scenes)')
  })
})

describe('Renderer and Static boundaries', () => {
  it('the free renderer is chosen by segment kind and imports no Template component', () => {
    const renderer = read('remotion/timeline/FreeSegment.tsx')
    const imports = renderer.split(/\r?\n/).filter((line) => line.startsWith('import ')).join('\n')
    expect(imports).not.toMatch(/documentary-card|quote-card|component-resolver|template-definitions|templates\/registry/)
    expect(renderer).not.toMatch(/resolveTemplateBinding|createProps|getTemplateDefinition/)
    // Element z-index must stay inside the Scene: root overlays (lower third, B-roll) paint above it.
    expect(renderer).toMatch(/data-kind="free"/)
    expect(renderer).toMatch(/isolation: 'isolate'/)
    expect(read('remotion/timeline/TimelineComposition.tsx')).toContain("if (segment.kind === 'free') return <FreeSegmentLayer")
    expect(read('infra/render-worker-runtime/export.mjs')).toContain("'remotion/timeline/FreeSegment.tsx'")
  })

  it('Static stays Template-required and has no Blank', () => {
    for (const path of ['lib/creative/authoring/carousel-state.ts', 'app/(dashboard)/projetos/[id]/conteudos/[editorialContentId]/channel-pieces/[channelPieceId]/editar-visual/page.tsx']) {
      const source = read(path)
      expect(source).not.toContain('free-composition')
      expect(source).not.toMatch(/Em branco/)
    }
  })
})

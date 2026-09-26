import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { FreeSceneComposition, VideoScene } from '@/lib/types'
import { FreeSceneOverlay } from '@/components/creative/video/free-scene-overlay'
import { buildRenderExecutionSnapshot } from '@/lib/render-execution/build-snapshot'
import { buildVideoDraftSaveBody, normalizeLoadedScenes, persistedVideoSnapshot } from '../video-authoring'
import { deriveSceneRanges } from '../scene-timeline'
import { createFrameCursor } from '../frame-cursor'
import type { VideoTimeline } from '../temporal-items'
import {
  MIN_FREE_BOX, addFreeImageElement, addFreeTextElement, createFreeScene, deriveFreeSegment, freeElements, setFreeElementBox,
  setFreeElementHidden, updateFreeElement,
} from '../free-composition'
import {
  DEFAULT_PREVIEW_INTERACTION_MODE, RESIZE_HANDLES, moveFreeBox, pointerToStage, resizeFreeBox, sameFreeBox,
} from '../free-manipulation'

// VIDEO_FREE_SCENE_DIRECT_MANIPULATION_V1

const IDENTITY = {
  schema_version: 'visual-tokens.v0' as const,
  snapshot_ref: 'project:11111111-1111-1111-1111-111111111111:snapshot',
  typography: { display: { family: 'Fraunces', weight: 700, style: 'normal' as const }, body: { family: 'Source Sans 3', weight: 400, style: 'normal' as const } },
  colors: { background: '#F6F0E4', foreground: '#16352F', accent: '#A34A27' },
  spacing: { unit: 8, default_gap: 16 },
}
const DRAFT = { id: 'draft-1', project_id: '11111111-1111-1111-1111-111111111111', production_id: '22222222-2222-2222-2222-222222222222' }
const IMG = '33333333-3333-4333-8333-333333333333'
const T1 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const I1 = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'

const template = (id: string, order: number, extra: Partial<VideoScene> = {}): VideoScene => ({ id, order, description: '', prompt: null, image_url: null, library_file_id: null, duration: 3, movement: 'static', ...extra })
function freeScene(): VideoScene {
  let scene = createFreeScene(2, 'free', 3)
  scene = addFreeImageElement(scene, I1, IMG)
  scene = addFreeTextElement(scene, T1)
  return updateFreeElement(scene, T1, { text: 'Título livre', color: 'accent', size: 'title', align: 'center' })
}
const QUOTE = { layout: 'quote', content: { title: 'O que ficou', intro: 'x', bullets: ['a', 'b', 'c'], quote: 'q', callout: 'c' } }
const SCENES: VideoScene[] = [
  template('s1', 1),
  freeScene(),
  template('s3', 3, { duration: 4, composition: QUOTE as VideoScene['composition'], element_timing: { quote: { start_frame: 15, duration_frames: 60 } } }),
]
const TIMELINE: VideoTimeline = { version: 1, items: [
  { id: 'lt', kind: 'text', start_frame: 100, duration_frames: 90, text: 'Nome', style: 'lower_third' },
  { id: 'bed', kind: 'audio', start_frame: 0, library_file_id: '55555555-5555-4555-8555-555555555555', volume: 0.6, end_anchor: 'sequence_end' },
] }
const root = join(__dirname, '..', '..', '..', '..')
const read = (path: string) => readFileSync(join(root, path), 'utf8')
const boxOf = (scene: VideoScene, id: string) => freeElements(scene).find((element) => element.id === id)!.box

describe('Preview tool mode', () => {
  it('Hand/Pan is the default; the tool is UI state only', () => {
    expect(DEFAULT_PREVIEW_INTERACTION_MODE).toBe('pan')
    const editor = read('app/(dashboard)/creative-editor/video/[draftId]/page.tsx')
    expect(editor).toContain('useState<PreviewInteractionMode>(DEFAULT_PREVIEW_INTERACTION_MODE)')
    // pan handlers only in Hand mode; the tool never enters saved or dirty state
    expect(editor).toContain("{...(interactionMode === 'pan' ? viewport.panHandlers : {})}")
    expect(editor).not.toMatch(/persistedVideoSnapshot\([^)]*(interactionMode|viewport|openElementId)/)
    expect(editor).not.toMatch(/buildVideoDraftSaveBody\([^)]*(interactionMode|viewport|openElementId)/)
    expect(editor).not.toMatch(/localStorage[^\n]*interactionMode/)
  })

  it('selecting or opening an element never changes the authored snapshot', () => {
    const before = persistedVideoSnapshot('v', SCENES, TIMELINE)
    // selection lives in openElementId (UI); the Scene objects are untouched
    const selected = SCENES.map((scene) => ({ ...scene }))
    expect(persistedVideoSnapshot('v', selected, TIMELINE)).toBe(before)
  })
})

describe('Pointer -> stage mapping (Fit, 100%, pan)', () => {
  it('the same stage point maps to the same fraction whatever the on-screen scale and pan', () => {
    const stage = { width: 1080, height: 1350 }
    const at = (scale: number, panX: number, panY: number) => ({ left: 40 + panX, top: 20 + panY, width: stage.width * scale, height: stage.height * scale })
    const target = { x: 0.3, y: 0.62 }
    for (const rect of [at(0.25, 0, 0), at(1, 0, 0), at(1, -300, 120), at(0.5, 77, -40)]) {
      const point = pointerToStage(rect.left + target.x * rect.width, rect.top + target.y * rect.height, rect)
      expect(point.x).toBeCloseTo(0.3, 10)
      expect(point.y).toBeCloseTo(0.62, 10)
    }
    expect(pointerToStage(10, 10, { left: 0, top: 0, width: 0, height: 0 })).toEqual({ x: 0, y: 0 })
  })

  it('a pixel drag is scale-independent in stage fractions', () => {
    const fit = { left: 0, top: 0, width: 270, height: 337.5 }
    const full = { left: 0, top: 0, width: 1080, height: 1350 }
    const d = (rect: typeof fit, px: number) => pointerToStage(rect.left + px, 0, rect).x - pointerToStage(rect.left, 0, rect).x
    expect(d(fit, 27)).toBeCloseTo(d(full, 108), 10) // 10% of the stage either way
  })
})

describe('Move and resize geometry', () => {
  const start = { x: 0.1, y: 0.3, width: 0.5, height: 0.2 }

  it('move changes x/y only and stays on stage', () => {
    expect(moveFreeBox(start, 0.1, -0.05)).toEqual({ x: 0.2, y: 0.25, width: 0.5, height: 0.2 })
    expect(moveFreeBox(start, 5, 5)).toEqual({ x: 0.5, y: 0.8, width: 0.5, height: 0.2 })
    expect(moveFreeBox(start, -5, -5)).toEqual({ x: 0, y: 0, width: 0.5, height: 0.2 })
  })

  it('corner resize keeps the opposite corner fixed', () => {
    expect(resizeFreeBox(start, 'se', 0.1, 0.1)).toEqual({ x: 0.1, y: 0.3, width: 0.6, height: 0.3 })
    expect(resizeFreeBox(start, 'nw', -0.05, -0.1)).toEqual({ x: 0.05, y: 0.2, width: 0.55, height: 0.3 })
    expect(resizeFreeBox(start, 'ne', 0.2, 0.05)).toEqual({ x: 0.1, y: 0.35, width: 0.7, height: 0.15 })
    expect(resizeFreeBox(start, 'sw', 0.05, -0.1)).toEqual({ x: 0.15, y: 0.3, width: 0.45, height: 0.1 })
  })

  it('resize obeys the domain minimum and the stage bounds', () => {
    for (const handle of RESIZE_HANDLES) {
      const shrunk = resizeFreeBox(start, handle, handle.includes('w') ? 5 : -5, handle.includes('n') ? 5 : -5)
      expect(shrunk.width).toBeGreaterThanOrEqual(MIN_FREE_BOX - 1e-9)
      expect(shrunk.height).toBeGreaterThanOrEqual(MIN_FREE_BOX - 1e-9)
      const grown = resizeFreeBox(start, handle, handle.includes('w') ? -5 : 5, handle.includes('n') ? -5 : 5)
      expect(grown.x).toBeGreaterThanOrEqual(0)
      expect(grown.y).toBeGreaterThanOrEqual(0)
      expect(grown.x + grown.width).toBeLessThanOrEqual(1 + 1e-9)
      expect(grown.y + grown.height).toBeLessThanOrEqual(1 + 1e-9)
    }
  })

  it('sameFreeBox detects a no-op (a click without movement is not an edit)', () => {
    expect(sameFreeBox(moveFreeBox(start, 0, 0), start)).toBe(true)
    expect(sameFreeBox(moveFreeBox(start, 0.0001, 0), start)).toBe(false)
  })
})

describe('Applying a manipulation to the authored Scene', () => {
  it('only the box changes: id, kind, order, text style and LibraryFile are untouched', () => {
    const scene = SCENES[1]
    const movedText = setFreeElementBox(scene, T1, moveFreeBox(boxOf(scene, T1), 0.05, 0.1))
    const resizedImage = setFreeElementBox(movedText, I1, resizeFreeBox(boxOf(movedText, I1), 'se', -0.2, -0.1))
    const before = freeElements(scene)
    const after = freeElements(resizedImage)
    expect(after.map((element) => [element.id, element.kind])).toEqual(before.map((element) => [element.id, element.kind]))
    const strip = (element: (typeof before)[number]) => { const { box: _box, ...rest } = element; void _box; return rest }
    expect(after.map(strip)).toEqual(before.map(strip))
    const text = boxOf(resizedImage, T1)
    const image = boxOf(resizedImage, I1)
    expect([text.width, text.height]).toEqual([boxOf(scene, T1).width, boxOf(scene, T1).height]) // move keeps size
    expect(text.x).toBeCloseTo(boxOf(scene, T1).x + 0.05, 10)
    expect(text.y).toBeCloseTo(boxOf(scene, T1).y + 0.1, 10)
    expect([image.x, image.y]).toEqual([boxOf(scene, I1).x, boxOf(scene, I1).y]) // se resize keeps the top-left corner
    expect(image.width).toBeCloseTo(boxOf(scene, I1).width - 0.2, 10)
    expect(image.height).toBeCloseTo(boxOf(scene, I1).height - 0.1, 10)
  })

  it('a Template Scene is never mutated by free manipulation', () => {
    expect(setFreeElementBox(SCENES[0], T1, { x: 0.5 })).toBe(SCENES[0])
    expect(setFreeElementBox(SCENES[2], T1, { x: 0.5 })).toBe(SCENES[2])
  })

  it('save -> reload keeps the manipulated box exactly; the renderer gets the same geometry', () => {
    const scenes = SCENES.map((scene) => (scene.id === 'free' ? setFreeElementBox(scene, T1, resizeFreeBox(boxOf(scene, T1), 'nw', 0.0333, 0.0125)) : scene))
    const body = JSON.parse(JSON.stringify(buildVideoDraftSaveBody(DRAFT, 'v', scenes, TIMELINE)))
    const reloaded = normalizeLoadedScenes(body.scenes)
    expect(boxOf(reloaded[1], T1)).toEqual(boxOf(scenes[1], T1))
    expect(persistedVideoSnapshot('v', reloaded, TIMELINE)).toBe(persistedVideoSnapshot('v', scenes, TIMELINE))
    const payload = deriveFreeSegment(reloaded[1].composition as FreeSceneComposition).payload
    expect(payload.elements.find((element) => element.element_id === T1)?.box).toEqual(boxOf(scenes[1], T1))
    expect(JSON.stringify(body)).not.toMatch(/interaction|select|handle|viewport|zoom|pan/i)
  })

  it('Template timing, Template segments and root items are unaffected by a free box edit', () => {
    const edited = SCENES.map((scene) => (scene.id === 'free' ? setFreeElementBox(scene, I1, { x: 0, y: 0 }) : scene))
    const a = buildRenderExecutionSnapshot({ draft: { ...DRAFT, scenes: SCENES, timeline: TIMELINE }, identitySnapshot: IDENTITY }).snapshot.manifest
    const b = buildRenderExecutionSnapshot({ draft: { ...DRAFT, scenes: edited, timeline: TIMELINE }, identitySnapshot: IDENTITY }).snapshot.manifest
    expect(b.segments.filter((segment) => segment.id !== 'scene:free')).toEqual(a.segments.filter((segment) => segment.id !== 'scene:free'))
    expect(b.specification).toEqual(a.specification)
    expect(edited[2].element_timing).toEqual(SCENES[2].element_timing)
  })
})

describe('Editor-only overlay', () => {
  const ranges = deriveSceneRanges(SCENES)
  const render = (frame: number, scenes: VideoScene[] = SCENES, selected: string | null = null) => renderToStaticMarkup(createElement(FreeSceneOverlay, {
    scenes, ranges: deriveSceneRanges(scenes), cursor: createFrameCursor(frame), left: 10, top: 20, width: 270, height: 337,
    selectedElementId: selected, onSelect: () => {}, onBoxChange: () => {}, onInteractionStart: () => {},
  }))

  it('only the free Scene under the playhead gets targets, keyed by stable ids, in paint order', () => {
    const html = render(ranges[1].startFrame + 10)
    expect(html.match(/data-testid="free-overlay-element"/g)?.length).toBe(2)
    expect(html.indexOf(`data-element-id="${I1}"`)).toBeLessThan(html.indexOf(`data-element-id="${T1}"`))
    expect(html).not.toContain('free-overlay-handle')
  })

  it('handles appear on the selected element only', () => {
    const html = render(ranges[1].startFrame + 10, SCENES, T1)
    expect(html.match(/data-testid="free-overlay-handle"/g)?.length).toBe(4)
    expect(html).toMatch(new RegExp(`data-element-id="${T1}" data-kind="text" data-selected="true"`))
  })

  it('a hidden element has no hit target', () => {
    const hidden = SCENES.map((scene) => (scene.id === 'free' ? setFreeElementHidden(scene, I1, true) : scene))
    const html = render(ranges[1].startFrame + 10, hidden, I1)
    expect(html).not.toContain(`data-element-id="${I1}"`)
    expect(html).not.toContain('free-overlay-handle')
  })

  it('no free targets or chrome while a Template Scene is on the Player (no spill across Scene boundaries)', () => {
    for (const frame of [ranges[0].endFrame - 1, ranges[2].startFrame]) {
      const html = render(frame, SCENES, T1)
      expect(html).not.toContain('free-overlay-element')
      expect(html).toContain('free-overlay-template-hint')
    }
  })

  it('the overlay never enters the Player/render tree', () => {
    for (const path of ['remotion/timeline/FreeSegment.tsx', 'remotion/timeline/TimelineComposition.tsx', 'remotion/player/LiveTimelinePlayer.tsx', 'infra/render-worker-runtime/export.mjs']) {
      expect(read(path)).not.toMatch(/free-scene-overlay|FreeSceneOverlay|free-manipulation/)
    }
  })
})

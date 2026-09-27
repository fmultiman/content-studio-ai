import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { VideoScene, VideoSceneComposition } from '@/lib/types'
import { buildRenderExecutionSnapshot } from '@/lib/render-execution/build-snapshot'
import { resolveTimelineManifest } from '@/lib/creative/resolution/resolve-timeline'
import { TemplateSegment } from '@/remotion/timeline'
import { authoringReducer, createInitialAuthoringState } from '@/lib/creative/authoring'
import { EDITORIAL_DOCUMENTARY_COLLAGE_TEMPLATE, layoutUsesContentImage } from '@/lib/creative/templates/template-definitions'
import { buildLivePreviewInput } from '../live-preview-input'
import { buildVideoDraftSaveBody, motionOptions, normalizeLoadedScenes, persistedVideoSnapshot } from '../video-authoring'
import { movementToMotion } from '@/lib/creative/timeline-adapter/video-draft-to-timeline'
import { reorderScenes, setSceneDuration } from '../scene-timeline'
import {
  VIDEO_SCENE_LAYOUT_IDS, applySceneContentAction, resetSceneElementOrder, resolveSceneComposition, sceneContentFields,
  setSceneAppearance, setSceneElementOrder, setSceneLayout, toggleSceneElementVisibility, validateSceneCompositionShape,
} from '../scene-composition'
import { videoSceneComposition } from '../video-workspace'

// VIDEO_SCENE_COMPOSITION_PARITY_V1

const IDENTITY_SNAPSHOT = {
  schema_version: 'visual-tokens.v0' as const,
  snapshot_ref: 'project:11111111-1111-1111-1111-111111111111:snapshot',
  typography: {
    display: { family: 'Fraunces', weight: 700, style: 'normal' as const },
    body: { family: 'Source Sans 3', weight: 400, style: 'normal' as const },
  },
  colors: { background: '#F6F0E4', foreground: '#16352F' },
  spacing: { unit: 8, default_gap: 16 },
}
const DRAFT = { id: 'draft-1', project_id: '11111111-1111-1111-1111-111111111111', production_id: '22222222-2222-2222-2222-222222222222' }
const FILE_A = 'afa6868e-a2d6-473d-9df7-bbf713ad8b02'

/** A Scene exactly as persisted BEFORE this mission (no `composition`). */
function legacyScene(id: string, order: number, extra: Partial<VideoScene> = {}): VideoScene {
  return { id, order, description: 'roteiro', prompt: null, image_url: null, library_file_id: null, duration: 3, movement: 'static', ...extra }
}

function templateSegments(scenes: VideoScene[]) {
  const { snapshot } = buildRenderExecutionSnapshot({ draft: { ...DRAFT, scenes }, identitySnapshot: IDENTITY_SNAPSHOT })
  return snapshot.manifest.segments.flatMap((segment) => (segment.kind === 'template' ? [segment] : []))
}

describe('backward compatibility: Scenes authored before composition existed', () => {
  it('resolve to the composition they always rendered with (Cover · Dark · "Cena N" · default stack)', () => {
    const resolved = resolveSceneComposition(legacyScene('a', 2))
    expect(resolved.layoutId).toBe('cover')
    expect(resolved.appearance).toBe('dark')
    expect(resolved.content).toEqual({ title: 'Cena 2' })
    expect(resolved.elementOrder).toEqual(EDITORIAL_DOCUMENTARY_COLLAGE_TEMPLATE.layouts[0].defaultStackOrder)
    expect(resolved.hiddenElements).toEqual([])
    expect(resolved.authored).toEqual({ layout: false, appearance: false, content: false, elementOrder: false, hiddenElements: false })
  })

  it('produce the same manifest segment as before (only appearance is now explicit, and it equals the old fallback)', () => {
    const [segment] = templateSegments([legacyScene('a', 1, { library_file_id: FILE_A })])
    expect(segment.payload.template).toEqual({ id: 'editorial.documentary-card', version: '0.1.0', variant: 'cover', appearance: 'dark', scope: 'system' })
    expect(segment.payload.content).toEqual({ title: 'Cena 1' })
    expect(segment.payload.assets).toEqual({ hero: { type: 'library_file', ref: FILE_A, fit: 'cover' } })
    expect(segment.payload).not.toHaveProperty('layering')
  })

  it('are never rewritten on load (no migration-on-read, no dirty state)', () => {
    const scenes = [legacyScene('a', 1), legacyScene('b', 2)]
    const loaded = normalizeLoadedScenes(JSON.parse(JSON.stringify(scenes)))
    expect(loaded).toEqual(scenes)
    expect(loaded.every((scene) => !('composition' in scene))).toBe(true)
  })

  it('an unsupported authored value falls back to the Template default without touching storage', () => {
    const scene = legacyScene('a', 1, { composition: { layout: 'poster', appearance: 'sepia' as never } })
    const resolved = resolveSceneComposition(scene)
    expect(resolved.layoutId).toBe('cover')
    expect(resolved.appearance).toBe('dark')
    expect(resolved.fallbacks).toEqual(['layout', 'appearance'])
    expect(scene.composition).toEqual({ layout: 'poster', appearance: 'sepia' })
  })
})

describe('Scene composition edits are Scene-scoped and touch only `composition`', () => {
  const base = [legacyScene('s1', 1, { library_file_id: FILE_A, movement: 'zoom_in', duration: 4 }), legacyScene('s2', 2), legacyScene('s3', 3)]

  it('content: editing Scene 1 leaves Scene 2 and every temporal field untouched', () => {
    const edited = base.map((scene) => (scene.id === 's1' ? applySceneContentAction(scene, { type: 'SET_CONTENT_VALUE', path: ['title'], value: 'Abertura' }) : scene))
    expect(resolveSceneComposition(edited[0]).content).toEqual({ title: 'Abertura' })
    expect(edited[1]).toBe(base[1])
    expect(resolveSceneComposition(edited[1]).content).toEqual({ title: 'Cena 2' })
    expect(edited[0]).toMatchObject({ duration: 4, movement: 'zoom_in', library_file_id: FILE_A, description: 'roteiro' })
  })

  it('layout: switching carries the title, starts from the Template example, restores the default stack', () => {
    let scene = applySceneContentAction(base[0], { type: 'SET_CONTENT_VALUE', path: ['title'], value: 'Três ideias' })
    scene = toggleSceneElementVisibility(scene, 'note')
    scene = setSceneLayout(scene, 'list')
    const resolved = resolveSceneComposition(scene)
    expect(resolved.layoutId).toBe('list')
    expect(resolved.content.title).toBe('Três ideias')
    expect(Array.isArray(resolved.content.items)).toBe(true)
    expect(resolved.hiddenElements).toEqual([])
    expect(resolved.elementOrderIsDefault).toBe(true)
    expect(scene).toMatchObject({ duration: 4, movement: 'zoom_in', library_file_id: FILE_A })
  })

  it('layout: re-selecting the current structure on an untouched Scene is a no-op', () => {
    expect(setSceneLayout(base[1], 'cover')).toBe(base[1])
  })

  it('appearance: only the layout-supported values; kept across a switch when still supported', () => {
    const light = setSceneAppearance(base[0], 'light')
    expect(resolveSceneComposition(light).appearance).toBe('light')
    const network = setSceneLayout(light, 'network')
    expect(resolveSceneComposition(network).appearance).toBe('light')
    expect(setSceneAppearance(base[0], 'sepia' as never)).toBe(base[0])
  })

  it('elements: order and visibility are normalized; the default stack is stored as "no override"', () => {
    const layout = resolveSceneComposition(base[0]).layout
    const front = [...layout.defaultStackOrder.filter((id) => id !== 'ornament'), 'ornament']
    const reordered = setSceneElementOrder(base[0], front)
    expect((reordered.composition as VideoSceneComposition | undefined)?.element_order).toEqual(front)
    expect(resetSceneElementOrder(reordered).composition).toBeUndefined()
    expect(setSceneElementOrder(base[0], layout.defaultStackOrder).composition).toBeUndefined()
    const hidden = toggleSceneElementVisibility(toggleSceneElementVisibility(base[0], 'title'), 'tape1')
    expect((hidden.composition as VideoSceneComposition | undefined)?.hidden_elements).toEqual(['tape1', 'title'])
    expect((toggleSceneElementVisibility(hidden, 'title').composition as VideoSceneComposition | undefined)?.hidden_elements).toEqual(['tape1'])
    expect(toggleSceneElementVisibility(base[0], 'not-an-element')).toBe(base[0])
  })

  it('reorder and duration edits preserve each Scene composition; composition edits preserve duration', () => {
    const composed = [setSceneLayout(base[0], 'quote'), setSceneAppearance(base[1], 'light'), base[2]]
    const reordered = reorderScenes(composed, 0, 2)
    expect(reordered.map((scene) => scene.id)).toEqual(['s2', 's3', 's1'])
    expect(resolveSceneComposition(reordered[2]).layoutId).toBe('quote')
    expect(resolveSceneComposition(reordered[0]).appearance).toBe('light')
    const retimed = setSceneDuration(reordered, 's1', 7)
    expect(retimed[2].composition).toEqual(reordered[2].composition)
    expect(retimed[2].duration).toBe(7)
  })
})

describe('persistence: VideoScene JSONB is the only authoring truth', () => {
  it('composition round-trips through the PATCH body and reload exactly', () => {
    const scene = toggleSceneElementVisibility(setSceneAppearance(setSceneLayout(legacyScene('s1', 1), 'info'), 'dark'), 'source')
    const body = buildVideoDraftSaveBody({ id: DRAFT.id, project_id: DRAFT.project_id, production_id: DRAFT.production_id }, 'Vídeo', [scene])
    const reloaded = normalizeLoadedScenes(JSON.parse(JSON.stringify(body)).scenes)
    expect(reloaded[0].composition).toEqual(scene.composition)
    expect(resolveSceneComposition(reloaded[0])).toEqual(resolveSceneComposition(scene))
  })

  it('dirty tracking sees composition changes', () => {
    const scenes = [legacyScene('s1', 1)]
    expect(persistedVideoSnapshot('v', scenes)).not.toBe(persistedVideoSnapshot('v', [setSceneAppearance(scenes[0], 'light')]))
  })

  it('the write boundary rejects malformed compositions', () => {
    expect(validateSceneCompositionShape(undefined)).toEqual({ ok: true })
    expect(validateSceneCompositionShape({ layout: 'list', appearance: 'dark', content: { title: 'x' }, element_order: ['title'], hidden_elements: [] })).toEqual({ ok: true })
    expect(validateSceneCompositionShape({ layout: 'poster' }).ok).toBe(false)
    expect(validateSceneCompositionShape({ appearance: 'sepia' }).ok).toBe(false)
    expect(validateSceneCompositionShape({ content: ['x'] }).ok).toBe(false)
    expect(validateSceneCompositionShape({ content: { blob: 'x'.repeat(20_000) } }).ok).toBe(false)
    expect(validateSceneCompositionShape({ element_order: [1, 2] }).ok).toBe(false)
    expect(validateSceneCompositionShape({ tuning: {} }).ok).toBe(false)
    expect(validateSceneCompositionShape('cover').ok).toBe(false)
  })

  it('the API validates compositions on POST and PATCH, and the render route validates the manifest before enqueueing', () => {
    const api = readFileSync(join(process.cwd(), 'app/api/video-drafts/route.ts'), 'utf8')
    expect(api.match(/const compositionError = sceneCompositionErrorResponse\(scenes\)/g)).toHaveLength(2)
    const render = readFileSync(join(process.cwd(), 'app/api/video-drafts/[id]/render/route.ts'), 'utf8')
    expect(render).toContain('resolveTimelineManifest(snapshotResult.snapshot.manifest, { identitySnapshot })')
    expect(render).toContain("code: 'SCENE_COMPOSITION_INVALID'")
  })
})

describe('Live Player and final render derive from the same authored values', () => {
  const scenes = [
    applySceneContentAction(setSceneAppearance(legacyScene('s1', 1, { library_file_id: FILE_A, movement: 'zoom_in' }), 'light'), { type: 'SET_CONTENT_VALUE', path: ['title'], value: 'Abertura' }),
    toggleSceneElementVisibility(setSceneLayout(legacyScene('s2', 2, { duration: 2 }), 'list'), 'callout'),
    setSceneElementOrder(setSceneLayout(legacyScene('s3', 3, { duration: 4 }), 'closing'), ['botanical', 'ornament', 'botanicalLeaf', 'note', 'tape1', 'title']),
  ]

  it('the preview manifest IS the render snapshot manifest (layout, appearance, content, assets, layering, motion, duration)', () => {
    const preview = buildLivePreviewInput({ draft: DRAFT, scenes, identitySnapshot: IDENTITY_SNAPSHOT, libraryFiles: new Map() })
    expect(preview.ok).toBe(true)
    if (!preview.ok) return
    const { snapshot } = buildRenderExecutionSnapshot({ draft: { ...DRAFT, scenes }, identitySnapshot: IDENTITY_SNAPSHOT })
    expect(preview.manifest).toEqual(snapshot.manifest)
    const segments = templateSegments(scenes)
    expect(segments.map((segment) => [segment.payload.template.variant, segment.payload.template.appearance])).toEqual([['cover', 'light'], ['list', 'light'], ['closing', 'dark']])
    expect(segments[0].payload.content).toEqual({ title: 'Abertura' })
    expect(segments[0].payload.motion).toEqual({ preset: 'slow_push' })
    expect(segments[1].payload.layering).toEqual({ hidden_elements: ['callout'] })
    expect(segments[2].payload.layering?.element_order?.slice(0, 2)).toEqual(['botanical', 'ornament'])
    expect(segments[2].payload.assets).toEqual({})
    expect(segments.map((segment) => segment.duration_frames)).toEqual([90, 60, 120])
  })

  it('every Video layout, with its starting content, is a valid 1080×1920 video segment', () => {
    for (const layoutId of VIDEO_SCENE_LAYOUT_IDS) {
      const scene = setSceneLayout(legacyScene('s', 1), layoutId)
      const preview = buildLivePreviewInput({ draft: DRAFT, scenes: [scene], identitySnapshot: IDENTITY_SNAPSHOT, libraryFiles: new Map() })
      expect(preview.ok, layoutId).toBe(true)
      const layout = EDITORIAL_DOCUMENTARY_COLLAGE_TEMPLATE.layouts.find((candidate) => candidate.id === layoutId)
      expect(resolveSceneComposition(scene).usesHero, layoutId).toBe(layoutUsesContentImage(layout ?? null))
    }
  })

  it('a composition the Template rejects is reported (never silently rendered)', () => {
    const empty = applySceneContentAction(setSceneLayout(legacyScene('s', 1), 'list'), { type: 'SET_CONTENT_VALUE', path: ['title'], value: '' })
    const preview = buildLivePreviewInput({ draft: DRAFT, scenes: [empty], identitySnapshot: IDENTITY_SNAPSHOT, libraryFiles: new Map() })
    expect(preview.ok).toBe(false)
    const { snapshot } = buildRenderExecutionSnapshot({ draft: { ...DRAFT, scenes: [empty] }, identitySnapshot: IDENTITY_SNAPSHOT })
    expect(resolveTimelineManifest(snapshot.manifest, { identitySnapshot: IDENTITY_SNAPSHOT }).valid).toBe(false)
  })

  it('the shared renderer (TemplateSegment -> DocumentaryCard) paints the authored appearance, order and visibility', () => {
    const render = (scene: VideoScene) => {
      const { snapshot } = buildRenderExecutionSnapshot({ draft: { ...DRAFT, scenes: [scene] }, identitySnapshot: IDENTITY_SNAPSHOT })
      const resolved = resolveTimelineManifest(snapshot.manifest, { identitySnapshot: IDENTITY_SNAPSHOT })
      if (!resolved.valid) throw new Error(resolved.errors.map((error) => error.message).join('; '))
      return renderToStaticMarkup(createElement(TemplateSegment, { globalFrame: 0, resolvedInput: resolved.value, resolvedSegment: resolved.value.resolvedTemplateSegments[0], adaptTemplateProps: (props) => props }))
    }
    const legacy = render(legacyScene('s', 1))
    expect(legacy).toContain('radial-gradient(120% 90% at 20% 10%, #16203a')
    expect(legacy).toMatch(/data-element="Ornamento celeste" style="[^"]*z-index:10/)

    const layout = resolveSceneComposition(legacyScene('s', 1)).layout
    const authored = render(toggleSceneElementVisibility(setSceneElementOrder(setSceneAppearance(legacyScene('s', 1), 'light'), [...layout.defaultStackOrder.filter((id) => id !== 'ornament'), 'ornament']), 'botanical'))
    expect(authored).not.toContain('radial-gradient(120% 90% at 20% 10%, #16203a')
    expect(authored).toMatch(/data-element="Ornamento celeste" style="[^"]*z-index:28/)
    expect(authored).not.toContain('data-element="Botânica seca"')
    expect(legacy).toContain('data-element="Botânica seca"')
  })
})

describe('Inspector hydration and bounded forms', () => {
  it('the Inspector view is derived from the selected Scene (no bleed between Scenes)', () => {
    const a = setSceneLayout(legacyScene('a', 1), 'map')
    const b = setSceneAppearance(legacyScene('b', 2), 'light')
    expect(videoSceneComposition(a)).toMatchObject({ layout: { id: 'map' }, usesHero: false })
    expect(videoSceneComposition(b)).toMatchObject({ layout: { id: 'cover' }, appearance: 'light', usesHero: true })
    expect(videoSceneComposition(a).elementLabels).not.toEqual(videoSceneComposition(b).elementLabels)
  })

  it('every Video layout has a bounded content form covering its required fields', () => {
    for (const layoutId of VIDEO_SCENE_LAYOUT_IDS) {
      const keys = sceneContentFields(layoutId).map((field) => field.key)
      expect(keys, layoutId).toContain('title')
      expect(keys.length, layoutId).toBeGreaterThan(1)
    }
  })

  // VIDEO_MOTION_CAPABILITY_TRUTH_V1: motionOptions is now the truthful, layout-derived,
  // ONLY-selectable set (no "sem efeito visível" entries offered as a false choice).
  it('Motion offers only what each Layout genuinely draws: Cover gets zoom_in, others do not', () => {
    const cover = motionOptions('cover').map((option) => option.value)
    const list = motionOptions('list').map((option) => option.value)
    expect(cover).toEqual(['static', 'fade', 'zoom_in'])
    expect(list).toEqual(['static', 'fade'])
    expect(list).not.toContain('zoom_in')
    expect(cover).not.toContain('pan_left')
    expect(cover).not.toContain('tilt_up')
  })

  it('every offered value maps to a real preset (never a legacy/unmapped one, even a mistakenly declared one)', () => {
    for (const layoutId of VIDEO_SCENE_LAYOUT_IDS) {
      for (const option of motionOptions(layoutId)) {
        expect(movementToMotion(option.value).diagnostic, `${layoutId}:${option.value}`).toBeNull()
      }
    }
  })
})

describe('Static regression: the shared content edit is behaviour-identical', () => {
  it('authoringReducer structured-content actions still edit, bound and clear exactly as before', () => {
    const state = createInitialAuthoringState('list')
    const edited = authoringReducer(state, { type: 'SET_CONTENT_VALUE', path: ['items', 0, 'text'], value: 'novo' })
    expect((edited.contentOverride as { items: { text: string }[] }).items[0].text).toBe('novo')
    const items = (state.contentOverride as { items: unknown[] }).items.length
    const atMax = Array.from({ length: 4 - items }).reduce<typeof state>((current) => authoringReducer(current, { type: 'ADD_CONTENT_ITEM', path: ['items'], item: { icon: 'dot', text: 'x' }, max: 4 }), state)
    expect(authoringReducer(atMax, { type: 'ADD_CONTENT_ITEM', path: ['items'], item: { icon: 'dot', text: 'x' }, max: 4 })).toBe(atMax)
    const withIntro = authoringReducer(state, { type: 'SET_CONTENT_VALUE', path: ['intro'], value: '', optional: true })
    expect(withIntro.contentOverride).not.toHaveProperty('intro')
  })
})

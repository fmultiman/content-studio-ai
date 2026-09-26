import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { VideoScene } from '@/lib/types'
import { buildRenderExecutionSnapshot } from '@/lib/render-execution/build-snapshot'
import { resolveTimelineManifest } from '@/lib/creative/resolution/resolve-timeline'
import { adaptVideoDraftToTimelineManifest } from '@/lib/creative/timeline-adapter/video-draft-to-timeline'
import { validateTimelineSemantics } from '@/lib/schemas/creative/validation'
import { TemplateSegment } from '@/remotion/timeline'
import { inactiveElementIds } from '@/remotion/timeline/frame-model'
import { buildLivePreviewInput } from '../live-preview-input'
import { buildVideoDraftSaveBody, normalizeLoadedScenes, persistedVideoSnapshot } from '../video-authoring'
import { deriveSceneRanges, reorderScenes, setSceneDuration } from '../scene-timeline'
import { resolveSceneComposition, setSceneElementOrder, setSceneLayout, toggleSceneElementVisibility } from '../scene-composition'
import { packAudioRows, type VideoTimeline } from '../temporal-items'
import {
  deriveSegmentElementTiming, effectiveElementRange, isTemporalElement, readSceneElementTiming, resetSceneElementTiming,
  sceneHasTemporalElements, sceneTimingRows, setSceneElementTiming, temporalElements, validateSceneElementTimingShape,
} from '../element-timing'

// VIDEO_HIERARCHICAL_SCENE_TIMING_SPIKE_V1

const IDENTITY = {
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

const base = (id: string, order: number, duration: number, extra: Partial<VideoScene> = {}): VideoScene => ({ id, order, description: '', prompt: null, image_url: null, library_file_id: null, duration, movement: 'static', ...extra })
/** The real production test draft's Scene 3 composition (Citação). */
const QUOTE_COMPOSITION = {
  layout: 'quote',
  content: {
    title: 'O que ficou',
    intro: 'Décadas depois, outras pesquisas trouxeram contrapontos.',
    quote: 'Isso não diminui o valor do livro. Muda a forma de lê-lo.',
    bullets: ['muitas experiências foram breves'],
    callout: 'Além de falar das comunidades, ele registra as expectativas de uma época.',
  },
  element_order: ['hero', 'callout', 'quote', 'tape1', 'paperStrip', 'title', 'botanicalLeaf'],
}
const S1 = base('s1', 1, 3) // 90 frames, Cover (legacy)
const S2 = base('s2', 2, 2.1667, { composition: { layout: 'list' } }) // 65 frames
const S3 = base('s3', 3, 4, { movement: 'zoom_in', composition: QUOTE_COMPOSITION }) // 120 frames, starts at 155
const TIMED: VideoScene = { ...S3, element_timing: { quote: { start_frame: 15, duration_frames: 60 }, callout: { start_frame: 45 } } }
const SCENES = [S1, S2, TIMED]
const ROOT: VideoTimeline = {
  version: 1,
  items: [
    { id: 'broll', kind: 'visual', start_frame: 60, duration_frames: 60, library_file_id: '664a9e53-53c8-4df1-9a0d-699e7cf04f23' },
    { id: 'lower', kind: 'text', text: 'Carlos A. P. Tavares', style: 'lower_third', start_frame: 135, duration_frames: 90 },
    { id: 'bed', kind: 'audio', start_frame: 0, end_anchor: 'sequence_end', library_file_id: '03e92637-a52d-48e4-8de9-2660d7e318a9', volume: 0.6 },
    { id: 'voice', kind: 'audio', start_frame: 90, duration_frames: 120, library_file_id: 'e7d9d8e5-b369-464b-baf0-b4169bc360fc', volume: 1, source_in_frame: 60 },
  ],
}

const manifestFor = (scenes: VideoScene[], timeline?: unknown) => buildRenderExecutionSnapshot({ draft: { ...DRAFT, scenes, timeline }, identitySnapshot: IDENTITY }).snapshot.manifest
const templateSegment = (scenes: VideoScene[], sceneId: string) => {
  const segment = manifestFor(scenes).segments.find((candidate) => candidate.id === `scene:${sceneId}`)
  if (!segment || segment.kind !== 'template') throw new Error('missing segment')
  return segment
}
const rowsOf = (scenes: VideoScene[], sceneId: string) => {
  const index = scenes.findIndex((scene) => scene.id === sceneId)
  const range = deriveSceneRanges(scenes)[index]
  return sceneTimingRows(scenes[index], range.startFrame, range.durationFrames)
}
const quoteLayout = () => resolveSceneComposition(S3).layout

describe('backward compatibility', () => {
  it('a Scene without element_timing renders every element for the whole Scene (no element_timing in the payload)', () => {
    for (const scene of [S1, S2, S3]) expect(templateSegment([S1, S2, S3], scene.id).payload).not.toHaveProperty('element_timing')
    expect(rowsOf([S1, S2, S3], 's3').map((row) => [row.elementId, row.range.startFrame, row.range.endFrame, row.authored])).toEqual([
      ['title', 0, 120, null], ['quote', 0, 120, null], ['hero', 0, 120, null], ['callout', 0, 120, null],
    ])
  })

  it('an untouched Scene keeps its exact persisted shape (nothing is backfilled)', () => {
    expect(normalizeLoadedScenes([S3])[0]).not.toHaveProperty('element_timing')
    expect(JSON.stringify(buildVideoDraftSaveBody(DRAFT, 'x', [S3]).scenes[0])).not.toContain('element_timing')
    expect(setSceneElementTiming(S3, 'quote', { start_frame: 0 }, 120)).not.toHaveProperty('element_timing')
  })
})

describe('Template capability: only declared elements are temporal', () => {
  it('the Quote layout exposes its four content-bearing elements, in Template element order', () => {
    expect(temporalElements(quoteLayout()).map((element) => element.id)).toEqual(['title', 'quote', 'hero', 'callout'])
    expect(isTemporalElement(quoteLayout(), 'tape1')).toBe(false)
    expect(isTemporalElement(quoteLayout(), 'botanicalLeaf')).toBe(false)
    expect(sceneHasTemporalElements(S3)).toBe(true)
  })

  it('layouts without declared elements (Cover, Lista) have no timing and no expansion', () => {
    expect(sceneHasTemporalElements(S1)).toBe(false)
    expect(sceneHasTemporalElements(S2)).toBe(false)
  })

  it('a non-temporal element cannot be timed and a stored entry for one is ignored', () => {
    expect(setSceneElementTiming(S3, 'tape1', { start_frame: 10 }, 120)).toBe(S3)
    expect(setSceneElementTiming(S3, 'nope', { start_frame: 10 }, 120)).toBe(S3)
    const foreign = { ...S3, element_timing: { tape1: { start_frame: 10 }, quote: { start_frame: 5 } } }
    expect(readSceneElementTiming(foreign, quoteLayout())).toEqual({ quote: { start_frame: 5 } })
  })
})

describe('local time and the local → global mapping', () => {
  it('global = Scene start + local; the authored values stay local', () => {
    const rows = rowsOf(SCENES, 's3')
    const quote = rows.find((row) => row.elementId === 'quote')!
    const callout = rows.find((row) => row.elementId === 'callout')!
    expect([quote.globalStartFrame, quote.globalEndFrame]).toEqual([170, 230])
    expect([callout.globalStartFrame, callout.globalEndFrame, callout.range.followsScene]).toEqual([200, 275, true])
    expect(TIMED.element_timing).toEqual({ quote: { start_frame: 15, duration_frames: 60 }, callout: { start_frame: 45 } })
  })

  it('child rows never leave the owning Scene interval', () => {
    const range = deriveSceneRanges(SCENES)[2]
    for (const row of rowsOf(SCENES, 's3')) {
      expect(row.globalStartFrame).toBeGreaterThanOrEqual(range.startFrame)
      expect(row.globalEndFrame).toBeLessThanOrEqual(range.endFrame)
    }
  })

  it('child row order is the Template element order, never paint order or JSON key order', () => {
    const restacked = setSceneElementOrder({ ...TIMED, element_timing: { callout: { start_frame: 45 }, quote: { start_frame: 15, duration_frames: 60 } } }, ['title', 'quote', 'callout', 'hero', 'tape1', 'paperStrip', 'botanicalLeaf'])
    expect(rowsOf([S1, S2, restacked], 's3').map((row) => row.elementId)).toEqual(['title', 'quote', 'hero', 'callout'])
  })
})

describe('Scene reorder: timing is owned by the Scene', () => {
  it('moving the Scene moves its elements globally; the persisted local values are not rewritten', () => {
    const before = JSON.stringify(TIMED.element_timing)
    const reordered = reorderScenes(SCENES, 2, 0)
    expect(reordered[0].id).toBe('s3')
    expect(JSON.stringify(reordered[0].element_timing)).toBe(before)
    const quote = rowsOf(reordered, 's3').find((row) => row.elementId === 'quote')!
    expect([quote.globalStartFrame, quote.globalEndFrame]).toEqual([15, 75])
    // The neutral payload is Scene-local, so it is identical before and after the reorder.
    expect(templateSegment(reordered, 's3').payload.element_timing).toEqual(templateSegment(SCENES, 's3').payload.element_timing)
  })

  it('root items keep their absolute frames (they never become Scene children)', () => {
    const root = (scenes: VideoScene[]) => manifestFor(scenes, ROOT).segments.filter((segment) => !segment.id.startsWith('scene:')).map((segment) => `${segment.id}@${segment.start_frame}+${segment.duration_frames}`)
    expect(root(reorderScenes(SCENES, 2, 0))).toEqual(root(SCENES))
    expect(root(SCENES)).toContain('item:broll@60+60')
  })
})

describe('Scene retime: authored intent preserved, effective range clipped', () => {
  it('a shorter Scene clips the effective range; the authored value is untouched and comes back when the Scene grows', () => {
    const short = setSceneDuration(SCENES, 's3', 2) // 60 frames
    expect(short[2].element_timing).toEqual(TIMED.element_timing)
    const rows = rowsOf(short, 's3')
    const quote = rows.find((row) => row.elementId === 'quote')!
    expect([quote.range.startFrame, quote.range.endFrame, quote.range.clipped]).toEqual([15, 60, true])
    const grown = setSceneDuration(short, 's3', 4)
    expect(rowsOf(grown, 's3').find((row) => row.elementId === 'quote')!.range).toMatchObject({ startFrame: 15, endFrame: 75, clipped: false })
  })

  it('an element whose start is past the Scene end does not appear, and both cases are reported', () => {
    const tiny = setSceneDuration(SCENES, 's3', 1) // 30 frames
    const callout = rowsOf(tiny, 's3').find((row) => row.elementId === 'callout')!
    expect(callout.range).toMatchObject({ startFrame: 30, endFrame: 30, outside: true })
    const segment = templateSegment(tiny, 's3')
    expect(segment.payload.element_timing).toEqual([
      { element_id: 'quote', start_frame: 15, duration_frames: 15 },
      { element_id: 'tape1', start_frame: 15, duration_frames: 15 },
      { element_id: 'callout', start_frame: 30, duration_frames: 0 },
    ])
    const { diagnostics } = adaptVideoDraftToTimelineManifest({ draft: { ...DRAFT, scenes: tiny }, identity: { type: 'fixture', ref: 'x' } as never })
    expect(diagnostics.map((diagnostic) => diagnostic.code)).toEqual(expect.arrayContaining(['element_timing_clipped', 'element_timing_outside_scene']))
  })

  it('authoring is bounded to the Scene as it is now', () => {
    const edited = setSceneElementTiming(S3, 'quote', { start_frame: 500, duration_frames: 999 }, 120)
    expect(edited.element_timing).toEqual({ quote: { start_frame: 119, duration_frames: 1 } })
    expect(effectiveElementRange({ start_frame: 10 }, 120)).toMatchObject({ startFrame: 10, endFrame: 120, followsScene: true })
  })
})

describe('Save / reload and validation', () => {
  it('element timing round-trips through the save body and the dirty snapshot', () => {
    const body = buildVideoDraftSaveBody(DRAFT, 'x', SCENES)
    const reloaded = normalizeLoadedScenes(JSON.parse(JSON.stringify(body.scenes)) as VideoScene[])
    expect(reloaded[2].element_timing).toEqual(TIMED.element_timing)
    expect(persistedVideoSnapshot('x', reloaded)).toBe(persistedVideoSnapshot('x', SCENES))
  })

  it('the API shape check accepts local frames and rejects anything else', () => {
    expect(validateSceneElementTimingShape(undefined)).toEqual({ ok: true })
    expect(validateSceneElementTimingShape(TIMED.element_timing)).toEqual({ ok: true })
    expect(validateSceneElementTimingShape([]).ok).toBe(false)
    expect(validateSceneElementTimingShape({ quote: { start_frame: -1 } }).ok).toBe(false)
    expect(validateSceneElementTimingShape({ quote: { start_frame: 1.5 } }).ok).toBe(false)
    expect(validateSceneElementTimingShape({ quote: { start_frame: 0, duration_frames: 0 } }).ok).toBe(false)
    expect(validateSceneElementTimingShape({ quote: { start_frame: 0, global_start: 155 } }).ok).toBe(false)
    const api = readFileSync(join(process.cwd(), 'app/api/video-drafts/route.ts'), 'utf8')
    expect(api).toContain('validateSceneElementTimingShape(elementTiming)')
  })

  it('reset returns the element to the whole Scene and drops the empty map', () => {
    const once = resetSceneElementTiming(TIMED, 'quote')
    expect(once.element_timing).toEqual({ callout: { start_frame: 45 } })
    expect(resetSceneElementTiming(once, 'callout')).not.toHaveProperty('element_timing')
  })

  it('the manifest validator rejects a range that leaves its segment', () => {
    const manifest = manifestFor(SCENES)
    expect(validateTimelineSemantics(manifest).valid).toBe(true)
    const broken = structuredClone(manifest)
    const segment = broken.segments.find((candidate) => candidate.id === 'scene:s3')
    if (segment?.kind === 'template') segment.payload.element_timing = [{ element_id: 'quote', start_frame: 100, duration_frames: 60 }]
    expect(validateTimelineSemantics(broken).valid).toBe(false)
  })
})

describe('boundaries: visibility, order, Motion, layout, expansion', () => {
  it('timing never touches composition, duration or Motion; Motion edits never touch timing', () => {
    const edited = setSceneElementTiming(S3, 'hero', { start_frame: 30 }, 120)
    expect(edited.composition).toBe(S3.composition)
    expect([edited.duration, edited.movement]).toEqual([S3.duration, S3.movement])
    expect(templateSegment([S1, S2, edited], 's3').payload.motion).toEqual(templateSegment([S1, S2, S3], 's3').payload.motion)
    const moved = { ...TIMED, movement: 'static' }
    expect(moved.element_timing).toBe(TIMED.element_timing)
  })

  it('element order and visibility stay spatial state; a hidden element is marked hidden whatever its timing', () => {
    const hidden = toggleSceneElementVisibility(TIMED, 'quote')
    expect(hidden.element_timing).toBe(TIMED.element_timing)
    expect(rowsOf([S1, S2, hidden], 's3').find((row) => row.elementId === 'quote')!.hidden).toBe(true)
    expect(resolveSceneComposition(TIMED).elementOrder).toEqual(resolveSceneComposition(S3).elementOrder)
  })

  it('switching the layout drops the old element timing with the old element set', () => {
    expect(setSceneLayout(TIMED, 'list')).not.toHaveProperty('element_timing')
    expect(setSceneLayout(TIMED, 'quote')).toBe(TIMED)
  })

  it('expansion is Timeline view state: never in the save body, never dirty', () => {
    const timelineSource = readFileSync(join(process.cwd(), 'components/creative/video/scene-timeline.tsx'), 'utf8')
    expect(timelineSource).toContain('const [expandedSceneId, setExpandedSceneId] = useState<string | null>(null)')
    const authoringSource = readFileSync(join(process.cwd(), 'lib/creative/video-editor/video-authoring.ts'), 'utf8')
    expect(authoringSource).not.toMatch(/expanded|isExpanded|openRows/)
    expect(JSON.stringify(buildVideoDraftSaveBody(DRAFT, 'x', SCENES))).not.toMatch(/expanded|row|lane|track/i)
  })

  it('AUDIO V1 rows and root items are independent of Scene element timing', () => {
    expect(packAudioRows(ROOT.items, 275)).toEqual({ rowOf: { bed: 0, voice: 1 }, rowCount: 2 })
    const withTiming = manifestFor(SCENES, ROOT).segments.filter((segment) => !segment.id.startsWith('scene:'))
    const withoutTiming = manifestFor([S1, S2, S3], ROOT).segments.filter((segment) => !segment.id.startsWith('scene:'))
    expect(withTiming).toEqual(withoutTiming)
  })
})

describe('renderer: one semantics for Live Player and final render', () => {
  it('the Live Player receives the same element timing the render snapshot freezes', () => {
    const preview = buildLivePreviewInput({ draft: DRAFT, scenes: SCENES, identitySnapshot: IDENTITY, libraryFiles: new Map() })
    if (!preview.ok) throw new Error('preview failed')
    const previewSegment = preview.resolvedInput.manifest.segments.find((segment) => segment.id === 'scene:s3')
    expect(previewSegment?.kind === 'template' && previewSegment.payload.element_timing).toEqual(templateSegment(SCENES, 's3').payload.element_timing)
  })

  it('the shared tree draws an element only inside its Scene-local range (end exclusive), companions with it', () => {
    const { snapshot } = buildRenderExecutionSnapshot({ draft: { ...DRAFT, scenes: SCENES }, identitySnapshot: IDENTITY })
    const resolved = resolveTimelineManifest(snapshot.manifest, { identitySnapshot: IDENTITY })
    if (!resolved.valid) throw new Error(resolved.errors.map((error) => error.message).join('; '))
    const segment = resolved.value.resolvedTemplateSegments.find((candidate) => candidate.segment.id === 'scene:s3')!
    const at = (globalFrame: number) => renderToStaticMarkup(createElement(TemplateSegment, { globalFrame, resolvedInput: resolved.value, resolvedSegment: segment, adaptTemplateProps: (props) => props }))
    const has = (markup: string, label: string) => markup.includes(`data-element="${label}"`)
    // Scene 3 starts at 155: quote local 15..75 → global 170..230; callout local 45.. → 200..275.
    expect(has(at(169), 'Papel da citação')).toBe(false)
    expect(has(at(169), 'Fita da citação')).toBe(false)
    expect(has(at(170), 'Papel da citação')).toBe(true)
    expect(has(at(170), 'Fita da citação')).toBe(true)
    expect(has(at(229), 'Papel da citação')).toBe(true)
    expect(has(at(230), 'Papel da citação')).toBe(false)
    expect(has(at(199), 'Caixa de destaque')).toBe(false)
    expect(has(at(200), 'Caixa de destaque')).toBe(true)
    expect(has(at(274), 'Caixa de destaque')).toBe(true)
    expect(at(275)).toBe('') // outside the Scene: nothing leaks into the next frame
    // Visibility wins over timing.
    const hidden = buildRenderExecutionSnapshot({ draft: { ...DRAFT, scenes: [S1, S2, toggleSceneElementVisibility(TIMED, 'quote')] }, identitySnapshot: IDENTITY })
    const hiddenResolved = resolveTimelineManifest(hidden.snapshot.manifest, { identitySnapshot: IDENTITY })
    if (!hiddenResolved.valid) throw new Error('invalid')
    const hiddenSegment = hiddenResolved.value.resolvedTemplateSegments.find((candidate) => candidate.segment.id === 'scene:s3')!
    expect(renderToStaticMarkup(createElement(TemplateSegment, { globalFrame: 180, resolvedInput: hiddenResolved.value, resolvedSegment: hiddenSegment, adaptTemplateProps: (props) => props }))).not.toContain('data-element="Papel da citação"')
  })

  it('inactiveElementIds evaluates ranges end-exclusive and leaves untimed elements alone', () => {
    const timing = [{ element_id: 'quote', start_frame: 15, duration_frames: 60 }, { element_id: 'callout', start_frame: 30, duration_frames: 0 }]
    expect(inactiveElementIds(timing, 14)).toEqual(['quote', 'callout'])
    expect(inactiveElementIds(timing, 15)).toEqual(['callout'])
    expect(inactiveElementIds(timing, 75)).toEqual(['quote', 'callout'])
    expect(inactiveElementIds(undefined, 10)).toEqual([])
  })

  it('derivation is Scene-local, clipped, and carries companions (never global frames, never engine objects)', () => {
    expect(deriveSegmentElementTiming(TIMED, quoteLayout(), 120)).toEqual([
      { element_id: 'quote', start_frame: 15, duration_frames: 60 },
      { element_id: 'tape1', start_frame: 15, duration_frames: 60 },
      { element_id: 'callout', start_frame: 45, duration_frames: 75 },
    ])
    const domain = readFileSync(join(process.cwd(), 'lib/creative/video-editor/element-timing.ts'), 'utf8')
    expect(domain).not.toMatch(/from 'remotion'|@remotion|Sequence|durationInFrames/)
  })

  it('Static never sees element timing (the still path has no timing input)', () => {
    const card = readFileSync(join(process.cwd(), 'components/creative/documentary-card/DocumentaryCard.tsx'), 'utf8')
    expect(card).not.toMatch(/element_timing|elementTiming|inactiveElementIds/)
    const still = readFileSync(join(process.cwd(), 'remotion/DocumentaryCardComposition.tsx'), 'utf8')
    expect(still).not.toMatch(/element_timing|inactiveElementIds/)
  })
})

import { describe, expect, it } from 'vitest'
import type { VideoScene } from '@/lib/types'
import { buildRenderExecutionSnapshot } from '@/lib/render-execution/build-snapshot'
import { TimelineSegmentSchema } from '@/lib/schemas/creative/timeline'
import { validateTimelineSemantics } from '@/lib/schemas/creative/validation'
import { inactiveElementIds } from '@/remotion/timeline/frame-model'
import { buildLivePreviewInput } from '../live-preview-input'
import { buildVideoDraftSaveBody, normalizeLoadedScenes, persistedVideoSnapshot } from '../video-authoring'
import { deriveSceneRanges, reorderScenes, setSceneDuration } from '../scene-timeline'
import {
  defaultFreeElementLabel, deriveFreeSegmentElementTiming, effectiveElementRange, freeElementsActiveAt,
  orphanFreeTimingIds, readFreeElementTiming, resetSceneElementTiming, sceneHasTemporalElements,
  sceneTimingRows, setSceneElementTiming, validateSceneElementTimingShape,
} from '../element-timing'
import {
  addFreeImageElement, addFreeTextElement, createFreeScene, freeElements, moveFreeElement,
  removeFreeElement, setFreeElementBox, setFreeElementHidden, updateFreeElement,
} from '../free-composition'

// VIDEO_FREE_ELEMENT_TIMING_V1: a mixed sequence, including an independent image and audio track.
const DRAFT = { id: 'draft-timing', project_id: '11111111-1111-1111-1111-111111111111', production_id: '22222222-2222-2222-2222-222222222222' }
const IMAGE = '33333333-3333-4333-8333-333333333333'
const OTHER_IMAGE = '44444444-4444-4444-8444-444444444444'
const TEXT = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const PHOTO = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const IDENTITY = {
  schema_version: 'visual-tokens.v0' as const,
  snapshot_ref: 'project:11111111-1111-1111-1111-111111111111:snapshot',
  typography: { display: { family: 'Fraunces', weight: 700, style: 'normal' as const }, body: { family: 'Source Sans 3', weight: 400, style: 'normal' as const } },
  colors: { background: '#F6F0E4', foreground: '#16352F', accent: '#A34A27' },
  spacing: { unit: 8, default_gap: 16 },
}
const template = (id: string, order: number): VideoScene => ({ id, order, description: '', prompt: null, image_url: null, library_file_id: null, duration: 3, movement: 'static' })
let free = createFreeScene(2, 'free', 3)
free = addFreeTextElement(free, TEXT)
free = updateFreeElement(free, TEXT, { text: 'Linha principal\nsegunda linha' })
free = addFreeImageElement(free, PHOTO, IMAGE)
const timed: VideoScene = { ...free, element_timing: { [TEXT]: { start_frame: 15, duration_frames: 45 }, [PHOTO]: { start_frame: 30 } } }
const scenes = [template('before', 1), timed, template('after', 3)]
const sceneRange = () => deriveSceneRanges(scenes)[1]
const rows = (scene: VideoScene = timed) => sceneTimingRows(scene, sceneRange().startFrame, sceneRange().durationFrames)
const snapshot = (input: VideoScene[] = scenes) => buildRenderExecutionSnapshot({ draft: { ...DRAFT, scenes: input }, identitySnapshot: IDENTITY })
const freeSegment = (input: VideoScene[] = scenes) => {
  const segment = snapshot(input).snapshot.manifest.segments.find((item) => item.id === 'scene:free')
  if (segment?.kind !== 'free') throw new Error('free segment missing')
  return segment
}

describe('free timing authoring and persistence', () => {
  it('1. untouched free elements have no persisted timing', () => expect(free).not.toHaveProperty('element_timing'))
  it('2. reads only valid entries for existing ids', () => expect(readFreeElementTiming({ ...timed, element_timing: { ...timed.element_timing, foreign: { start_frame: 1 } } })).toEqual(timed.element_timing))
  it('3. finds foreign timing ids for the free write boundary', () => expect(orphanFreeTimingIds({ ...timed, element_timing: { ...timed.element_timing, foreign: { start_frame: 1 } } })).toEqual(['foreign']))
  it('4. accepts the common persisted timing shape', () => expect(validateSceneElementTimingShape(timed.element_timing).ok).toBe(true))
  it('5. rejects noninteger Scene-local frames', () => expect(validateSceneElementTimingShape({ [TEXT]: { start_frame: 1.5 } }).ok).toBe(false))
  it('6. authors text timing without changing composition', () => {
    const edited = setSceneElementTiming(free, TEXT, { start_frame: 15, duration_frames: 45 }, 90)
    expect(edited.element_timing?.[TEXT]).toEqual({ start_frame: 15, duration_frames: 45 })
    expect(edited.composition).toBe(free.composition)
  })
  it('7. authors image timing with the same map', () => expect(setSceneElementTiming(free, PHOTO, { start_frame: 30 }, 90).element_timing).toEqual({ [PHOTO]: { start_frame: 30 } }))
  it('8. ignores an id outside this Scene', () => expect(setSceneElementTiming(free, 'foreign', { start_frame: 4 }, 90)).toBe(free))
  it('9. represents the full Scene as no entry', () => expect(setSceneElementTiming(free, TEXT, { start_frame: 0 }, 90)).not.toHaveProperty('element_timing'))
  it('10. bounds an authored start to the last Scene frame', () => expect(setSceneElementTiming(free, TEXT, { start_frame: 200 }, 90).element_timing?.[TEXT]).toEqual({ start_frame: 89 }))
  it('11. bounds a fixed duration to the current Scene end', () => expect(setSceneElementTiming(free, TEXT, { start_frame: 80, duration_frames: 40 }, 90).element_timing?.[TEXT]).toEqual({ start_frame: 80, duration_frames: 10 }))
  it('12. resets one entry and preserves its neighbour', () => expect(resetSceneElementTiming(timed, TEXT).element_timing).toEqual({ [PHOTO]: { start_frame: 30 } }))
  it('13. resets the last entry to the default absent map', () => expect(resetSceneElementTiming(resetSceneElementTiming(timed, TEXT), PHOTO)).not.toHaveProperty('element_timing'))
  it('14. hide and show preserve authored timing', () => expect(setFreeElementHidden(setFreeElementHidden(timed, TEXT, true), TEXT, false).element_timing).toBe(timed.element_timing))
  it('15. removing an element atomically drops its timing', () => expect(removeFreeElement(timed, TEXT).element_timing).toEqual({ [PHOTO]: { start_frame: 30 } }))
  it('16. removing the last timed element drops the map', () => expect(removeFreeElement(resetSceneElementTiming(timed, TEXT), PHOTO)).not.toHaveProperty('element_timing'))
  it('17. moving elements changes paint order without rewriting timing', () => expect(moveFreeElement(timed, TEXT, 'forward').element_timing).toBe(timed.element_timing))
  it('18. replacing the Library image preserves its stable timed id', () => expect(updateFreeElement(timed, PHOTO, { library_file_id: OTHER_IMAGE }).element_timing).toBe(timed.element_timing))
  it('19. changing a box preserves timing', () => expect(setFreeElementBox(timed, TEXT, { x: 0.2 }).element_timing).toBe(timed.element_timing))
  it('20. a save body round trip keeps timing under VideoScene', () => {
    const body = buildVideoDraftSaveBody(DRAFT, 'name', scenes)
    const loaded = normalizeLoadedScenes(JSON.parse(JSON.stringify(body.scenes)) as VideoScene[])
    expect(loaded[1].element_timing).toEqual(timed.element_timing)
    expect(persistedVideoSnapshot('name', loaded)).toBe(persistedVideoSnapshot('name', scenes))
  })
})

describe('one ruler, free child rows and participation', () => {
  it('21. a free Scene with elements can expand', () => expect(sceneHasTemporalElements(free)).toBe(true))
  it('22. a blank free Scene has no child rows', () => expect(sceneTimingRows(createFreeScene(2, 'blank', 3), 90, 90)).toEqual([]))
  it('23. child rows follow authored order', () => expect(rows().map((row) => row.elementId)).toEqual([TEXT, PHOTO]))
  it('24. default text label uses its first line', () => expect(defaultFreeElementLabel(freeElements(free)[0])).toBe('Texto · Linha principal'))
  it('25. image labels can resolve a Library filename', () => expect(sceneTimingRows(timed, 90, 90, (element) => element.kind === 'image' ? 'Imagem · retrato.png' : 'Texto').map((row) => row.label)).toEqual(['Texto', 'Imagem · retrato.png']))
  it('26. global row start is Scene start plus local start', () => expect(rows().map((row) => row.globalStartFrame)).toEqual([105, 120]))
  it('27. a hidden row stays addressable and retains its range', () => expect(rows(setFreeElementHidden(timed, TEXT, true))[0]).toMatchObject({ hidden: true, globalStartFrame: 105 }))
  it('28. the frame before a text range has no text target', () => expect(freeElementsActiveAt(timed, 14, 90).map((element) => element.id)).toEqual([]))
  it('29. both timed elements participate at overlap', () => expect(freeElementsActiveAt(timed, 30, 90).map((element) => element.id)).toEqual([TEXT, PHOTO]))
  it('30. the fixed text end is exclusive', () => expect(freeElementsActiveAt(timed, 60, 90).map((element) => element.id)).toEqual([PHOTO]))
  it('31. the Scene end excludes all targets', () => expect(freeElementsActiveAt(timed, 90, 90)).toEqual([]))
  it('32. hidden beats an active range', () => expect(freeElementsActiveAt(setFreeElementHidden(timed, PHOTO, true), 45, 90).map((element) => element.id)).toEqual([TEXT]))
  it('33. reordering a Scene changes only global projection', () => {
    const moved = reorderScenes(scenes, 1, 0)
    expect(moved[0].element_timing).toEqual(timed.element_timing)
    expect(sceneTimingRows(moved[0], 0, 90).map((row) => row.globalStartFrame)).toEqual([15, 30])
  })
  it('34. retiming clips without changing authored duration', () => {
    const shorter = setSceneDuration(scenes, 'free', 1)
    expect(shorter[1].element_timing).toEqual(timed.element_timing)
    expect(sceneTimingRows(shorter[1], 90, 30)[0].range).toMatchObject({ endFrame: 30, clipped: true })
  })
  it('35. a late authored start becomes outside, and grows back', () => {
    const late = { ...free, element_timing: { [TEXT]: { start_frame: 70 } } }
    expect(effectiveElementRange(late.element_timing[TEXT], 30).outside).toBe(true)
    expect(effectiveElementRange(late.element_timing[TEXT], 90).outside).toBe(false)
  })
})

describe('neutral payload and renderer contract', () => {
  it('36. untouched free payload is byte-compatible with the old shape', () => expect(freeSegment([scenes[0], free, scenes[2]]).payload).not.toHaveProperty('element_timing'))
  it('37. timed payload contains clipped local entries', () => expect(freeSegment().payload.element_timing).toEqual([
    { element_id: TEXT, start_frame: 15, duration_frames: 45 },
    { element_id: PHOTO, start_frame: 30, duration_frames: 60 },
  ]))
  it('38. hidden elements and their timing are absent from the payload', () => {
    const payload = freeSegment([scenes[0], setFreeElementHidden(timed, TEXT, true), scenes[2]]).payload
    expect(payload.elements.map((element) => element.element_id)).toEqual([PHOTO])
    expect(payload.element_timing?.map((entry) => entry.element_id)).toEqual([PHOTO])
  })
  it('39. an empty text and its timing are absent from the payload', () => {
    const payload = freeSegment([scenes[0], updateFreeElement(timed, TEXT, { text: '' }), scenes[2]]).payload
    expect(payload.elements.map((element) => element.element_id)).toEqual([PHOTO])
    expect(payload.element_timing?.map((entry) => entry.element_id)).toEqual([PHOTO])
  })
  it('40. a duration reduction produces clipped payload and a diagnostic', () => {
    const reduced = setSceneDuration(scenes, 'free', 1)
    const output = snapshot(reduced)
    const payload = freeSegment(reduced).payload
    expect(payload.element_timing).toEqual([
      { element_id: TEXT, start_frame: 15, duration_frames: 15 },
      { element_id: PHOTO, start_frame: 30, duration_frames: 0 },
    ])
    expect(output.diagnostics.some((item) => item.code === 'element_timing_clipped')).toBe(true)
    expect(output.diagnostics.some((item) => item.code === 'element_timing_outside_scene')).toBe(true)
  })
  it('41. the neutral manifest stays timeline.v0 and has no free TemplateRef', () => {
    const manifest = snapshot().snapshot.manifest
    expect(manifest.schema_version).toBe('timeline.v0')
    expect(freeSegment().payload).not.toHaveProperty('template')
  })
  it('42. the schema accepts the additive optional entries', () => expect(TimelineSegmentSchema.safeParse(freeSegment()).success).toBe(true))
  it('43. semantic validation rejects a foreign timed id', () => {
    const manifest = structuredClone(snapshot().snapshot.manifest)
    const segment = manifest.segments.find((item) => item.kind === 'free')
    if (segment?.kind !== 'free') throw new Error('free missing')
    segment.payload.element_timing = [{ element_id: 'foreign', start_frame: 0, duration_frames: 1 }]
    expect(validateTimelineSemantics(manifest).issues.some((issue) => issue.code === 'invalid_element_timing')).toBe(true)
  })
  it('44. semantic validation rejects duplicate timed ids', () => {
    const manifest = structuredClone(snapshot().snapshot.manifest)
    const segment = manifest.segments.find((item) => item.kind === 'free')
    if (segment?.kind !== 'free') throw new Error('free missing')
    segment.payload.element_timing = [segment.payload.element_timing![0], segment.payload.element_timing![0]]
    expect(validateTimelineSemantics(manifest).issues.some((issue) => issue.code === 'invalid_element_timing')).toBe(true)
  })
  it('45. semantic validation rejects a range beyond the segment', () => {
    const manifest = structuredClone(snapshot().snapshot.manifest)
    const segment = manifest.segments.find((item) => item.kind === 'free')
    if (segment?.kind !== 'free') throw new Error('free missing')
    segment.payload.element_timing = [{ element_id: TEXT, start_frame: 89, duration_frames: 2 }]
    expect(validateTimelineSemantics(manifest).issues.some((issue) => issue.code === 'invalid_element_timing')).toBe(true)
  })
  it('46. renderer frame arithmetic is end exclusive for free ids', () => {
    const entries = freeSegment().payload.element_timing
    expect(inactiveElementIds(entries, 14)).toEqual([TEXT, PHOTO])
    expect(inactiveElementIds(entries, 30)).toEqual([])
    expect(inactiveElementIds(entries, 60)).toEqual([TEXT])
  })
  it('47. the Live Player and frozen render snapshot receive equal free timing', () => {
    const preview = buildLivePreviewInput({ draft: DRAFT, scenes, identitySnapshot: IDENTITY, libraryFiles: new Map() })
    if (!preview.ok) throw new Error(preview.message)
    const segment = preview.manifest.segments.find((item) => item.id === 'scene:free')
    expect(segment?.kind === 'free' && segment.payload.element_timing).toEqual(freeSegment().payload.element_timing)
  })
  it('48. root track positions remain independent of free timing', () => {
    const bare = snapshot([scenes[0], free, scenes[2]]).snapshot.manifest
    const withTiming = snapshot().snapshot.manifest
    expect(withTiming.tracks).toEqual(bare.tracks)
    expect(withTiming.specification).toEqual(bare.specification)
  })
  it('49. derived entries include only drawn ids', () => expect(deriveFreeSegmentElementTiming(timed, [PHOTO], 90)).toEqual([{ element_id: PHOTO, start_frame: 30, duration_frames: 60 }]))
})

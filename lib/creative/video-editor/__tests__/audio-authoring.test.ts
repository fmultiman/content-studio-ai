import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { LibraryFile, VideoScene } from '@/lib/types'
import { buildRenderExecutionSnapshot } from '@/lib/render-execution/build-snapshot'
import { resolveTimelineManifest } from '@/lib/creative/resolution/resolve-timeline'
import { prepareTimelineLibraryFileAssets } from '@/lib/creative/timeline-adapter/prepare-scene-assets'
import { audioEnvelope } from '@/remotion/timeline/IndependentSegments'
import { buildLivePreviewInput, type PreviewLibraryFile } from '../live-preview-input'
import { buildVideoDraftSaveBody } from '../video-authoring'
import { reorderScenes, setSceneDuration, snapItemStart } from '../scene-timeline'
import {
  addTemporalItem, deriveTemporalSegments, effectiveDurationFrames, followsSequenceEnd, moveTemporalItem, packAudioRows, persistedVideoTimeline,
  readVideoTimeline, resizeTemporalItem, setAudioEndsWithSequence, setAudioTiming, updateTemporalItem, validateVideoTimeline,
  type AudioItem, type VideoTimeline,
} from '../temporal-items'

// VIDEO_AUDIO_AUTHORING_V1

const IDENTITY = {
  schema_version: 'visual-tokens.v0' as const,
  snapshot_ref: 'project:11111111-1111-1111-1111-111111111111:snapshot',
  typography: { display: { family: 'Fraunces', weight: 700, style: 'normal' as const }, body: { family: 'Source Sans 3', weight: 400, style: 'normal' as const } },
  colors: { background: '#F6F0E4', foreground: '#16352F' },
  spacing: { unit: 8, default_gap: 16 },
}
const DRAFT = { id: 'draft-1', project_id: '11111111-1111-1111-1111-111111111111', production_id: '22222222-2222-2222-2222-222222222222' }
const BED = '03e92637-a52d-48e4-8de9-2660d7e318a9'
const VOICE = '7d7c3d4e-2f0e-4a5b-9c1d-0e1f2a3b4c5d'
const VIDEO = '664a9e53-53c8-4df1-9a0d-699e7cf04f23'
const scene = (id: string, order: number, duration: number): VideoScene => ({ id, order, description: '', prompt: null, image_url: null, library_file_id: null, duration, movement: 'static' })
const SCENES = [scene('s1', 1, 3), scene('s2', 2, 2.1667), scene('s3', 3, 4)] // 275 frames
const TOTAL = 275

/** The Gate B item exactly as persisted in production (no AUDIO V1 fields). */
const LEGACY_AUDIO: AudioItem = { id: 'music', kind: 'audio', start_frame: 0, duration_frames: 275, library_file_id: BED, volume: 1 }
const PROOF: VideoTimeline = {
  version: 1,
  items: [
    { id: 'broll', kind: 'visual', start_frame: 60, duration_frames: 60, library_file_id: VIDEO },
    { id: 'lower', kind: 'text', start_frame: 135, duration_frames: 90, style: 'lower_third', text: 'Carlos A. P. Tavares' },
    { id: 'bed', kind: 'audio', start_frame: 0, end_anchor: 'sequence_end', library_file_id: BED, volume: 0.6, fade_in_frames: 30, fade_out_frames: 45 },
    { id: 'voice', kind: 'audio', start_frame: 90, duration_frames: 120, library_file_id: VOICE, volume: 1, source_in_frame: 60, fade_in_frames: 15, fade_out_frames: 15 },
  ],
}
const manifestFor = (scenes: VideoScene[], timeline: unknown) => buildRenderExecutionSnapshot({ draft: { ...DRAFT, scenes, timeline }, identitySnapshot: IDENTITY }).snapshot.manifest
const audioSegments = (manifest: ReturnType<typeof manifestFor>) => manifest.segments.filter((segment) => segment.kind === 'audio')

describe('backward compatibility: the Gate B audio item', () => {
  it('stays a valid FIXED item with deterministic defaults (source in 0, no fades, same volume)', () => {
    expect(validateVideoTimeline({ version: 1, items: [LEGACY_AUDIO] })).toEqual({ ok: true })
    expect(followsSequenceEnd(LEGACY_AUDIO)).toBe(false)
    const [segment] = audioSegments(manifestFor(SCENES, { version: 1, items: [LEGACY_AUDIO] }))
    expect(segment).toEqual({ id: 'item:music', track_id: 'audio-main', start_frame: 0, duration_frames: 275, kind: 'audio', payload: { asset_ref: `library_file:${BED}`, gain: 1 } })
  })

  it('never starts following the sequence by itself: a longer video leaves it at its fixed end', () => {
    const longer = setSceneDuration(SCENES, 's3', 6) // 335 frames
    const [segment] = audioSegments(manifestFor(longer, { version: 1, items: [LEGACY_AUDIO] }))
    expect(segment.duration_frames).toBe(275)
  })
})

describe('concurrent audio without a persisted lane', () => {
  it('two overlapping audio items are valid; visual/text overlap is still rejected', () => {
    expect(validateVideoTimeline(PROOF)).toEqual({ ok: true })
    const twoBrolls = { version: 1, items: [PROOF.items[0], { ...PROOF.items[0], id: 'broll2', start_frame: 100 }] }
    expect(validateVideoTimeline(twoBrolls).ok).toBe(false)
  })

  it('rows are derived by deterministic interval packing (lowest free row, stable by start then id)', () => {
    const a: AudioItem = { id: 'a', kind: 'audio', start_frame: 0, duration_frames: 275, library_file_id: BED, volume: 1 }
    const b: AudioItem = { id: 'b', kind: 'audio', start_frame: 60, duration_frames: 120, library_file_id: VOICE, volume: 1 }
    const c: AudioItem = { id: 'c', kind: 'audio', start_frame: 190, duration_frames: 40, library_file_id: VOICE, volume: 1 }
    expect(packAudioRows([c, b, a], TOTAL)).toEqual({ rowOf: { a: 0, b: 1, c: 1 }, rowCount: 2 })
    expect(packAudioRows([a, b, c], TOTAL)).toEqual(packAudioRows([c, a, b], TOTAL))
    // Same start: id breaks the tie deterministically; end-exclusive intervals share a row.
    expect(packAudioRows([{ ...b, id: 'z', start_frame: 0 }, { ...b, id: 'y', start_frame: 0 }], TOTAL).rowOf).toEqual({ y: 0, z: 1 })
    expect(packAudioRows([{ ...b, start_frame: 0, duration_frames: 60 }, { ...c, start_frame: 60 }], TOTAL).rowCount).toBe(1)
    // Moving an item re-packs (rows are projection, not identity).
    const moved = moveTemporalItem({ version: 1, items: [a, b, c] }, 'b', 200)
    expect(packAudioRows(moved.items, TOTAL)).toEqual({ rowOf: { a: 0, c: 1, b: 2 }, rowCount: 3 })
    // A sequence-anchored bed occupies its row until the sequence end.
    expect(packAudioRows([{ ...a, duration_frames: undefined, end_anchor: 'sequence_end' }, { ...c, start_frame: 260 }], TOTAL).rowCount).toBe(2)
  })

  it('no row/lane/track identity is ever authored or accepted', () => {
    const saved = JSON.stringify(persistedVideoTimeline(PROOF))
    expect(saved).not.toMatch(/"(row|lane|lane_id|track|track_id|audio_track_id)"/)
    for (const key of ['lane', 'row', 'track_id', 'audio_track_id']) {
      expect(validateVideoTimeline({ version: 1, items: [{ ...LEGACY_AUDIO, [key]: 1 }] }).ok, key).toBe(false)
    }
  })

  it('the derived manifest carries both audio items on ONE derived track, overlapping (legal in timeline.v0)', () => {
    const manifest = manifestFor(SCENES, PROOF)
    expect(manifest.tracks.filter((track) => track.kind === 'audio')).toEqual([{ id: 'audio-main', kind: 'audio', order: 3 }])
    const [bed, voice] = audioSegments(manifest)
    expect(bed).toMatchObject({ start_frame: 0, duration_frames: 275, payload: { asset_ref: `library_file:${BED}`, gain: 0.6, fade_in_frames: 30, fade_out_frames: 45 } })
    expect(voice).toMatchObject({ start_frame: 90, duration_frames: 120, payload: { asset_ref: `library_file:${VOICE}`, gain: 1, source_in_frame: 60, fade_in_frames: 15, fade_out_frames: 15 } })
    expect(resolveTimelineManifest(manifest, { identitySnapshot: IDENTITY }).valid).toBe(true)
    expect(manifest.render_intent.audio).toBe(true)
  })
})

describe('source in, fades, volume', () => {
  it('source in and fades round-trip through save/reload and derive unchanged', () => {
    const body = JSON.parse(JSON.stringify(buildVideoDraftSaveBody(DRAFT, 'v', SCENES, PROOF)))
    expect(readVideoTimeline(body.timeline)).toEqual(PROOF)
    expect(manifestFor(SCENES, body.timeline)).toEqual(manifestFor(SCENES, PROOF))
  })

  it('moving or resizing the placement never changes the source offset or the fades', () => {
    const moved = moveTemporalItem(PROOF, 'voice', 30).items.find((item) => item.id === 'voice') as AudioItem
    expect(moved).toMatchObject({ start_frame: 30, source_in_frame: 60, fade_in_frames: 15, fade_out_frames: 15, duration_frames: 120 })
    const resized = resizeTemporalItem(PROOF, 'voice', 200).items.find((item) => item.id === 'voice') as AudioItem
    expect(resized).toMatchObject({ duration_frames: 200, source_in_frame: 60 })
    // Never shorter than its own fades (fades are not silently changed).
    expect((resizeTemporalItem(PROOF, 'voice', 5).items.find((item) => item.id === 'voice') as AudioItem).duration_frames).toBe(30)
  })

  it('fades are validated against a fixed placement and capped when edited; 0 removes them', () => {
    expect(validateVideoTimeline({ version: 1, items: [{ ...LEGACY_AUDIO, duration_frames: 40, fade_in_frames: 30, fade_out_frames: 20 }] }).ok).toBe(false)
    expect(validateVideoTimeline({ version: 1, items: [{ ...LEGACY_AUDIO, source_in_frame: -1 }] }).ok).toBe(false)
    expect(validateVideoTimeline({ version: 1, items: [{ ...LEGACY_AUDIO, fade_in_frames: 1.5 }] }).ok).toBe(false)
    const capped = setAudioTiming(PROOF, 'voice', { fade_in_frames: 200 }).items.find((item) => item.id === 'voice') as AudioItem
    expect(capped.fade_in_frames).toBe(105) // 120 - fade_out 15
    const cleared = setAudioTiming(PROOF, 'voice', { source_in_frame: 0, fade_out_frames: 0 }).items.find((item) => item.id === 'voice') as AudioItem
    expect(cleared).not.toHaveProperty('source_in_frame')
    expect(cleared).not.toHaveProperty('fade_out_frames')
    expect(updateTemporalItem<'audio'>(PROOF, 'voice', { volume: 0.25 }).items.find((item) => item.id === 'voice')).toMatchObject({ volume: 0.25, source_in_frame: 60 })
  })

  it('the fade envelope is linear, bounded and never exceeds 1', () => {
    expect(audioEnvelope(0, 120, 15, 15)).toBe(0)
    expect(audioEnvelope(15, 120, 15, 15)).toBe(1)
    expect(audioEnvelope(60, 120, 15, 15)).toBe(1)
    expect(audioEnvelope(112.5, 120, 15, 15)).toBeCloseTo(0.5)
    expect(audioEnvelope(120, 120, 15, 15)).toBe(0)
    expect(audioEnvelope(50, 120)).toBe(1)
  })
})

describe('explicit end intent: fixed vs ends with the video', () => {
  it('one authority for the end: anchored items store no duration; the combination is rejected', () => {
    expect(validateVideoTimeline({ version: 1, items: [{ ...LEGACY_AUDIO, end_anchor: 'sequence_end' }] }).ok).toBe(false)
    expect(validateVideoTimeline({ version: 1, items: [{ ...LEGACY_AUDIO, duration_frames: undefined, end_anchor: 'loop' }] }).ok).toBe(false)
    const anchored = setAudioEndsWithSequence({ version: 1, items: [LEGACY_AUDIO] }, 'music', true, TOTAL).items[0] as AudioItem
    expect(anchored).toEqual({ id: 'music', kind: 'audio', start_frame: 0, library_file_id: BED, volume: 1, end_anchor: 'sequence_end' })
    const fixedAgain = setAudioEndsWithSequence({ version: 1, items: [anchored] }, 'music', false, 335).items[0] as AudioItem
    expect(fixedAgain).toMatchObject({ duration_frames: 335 })
    expect(fixedAgain).not.toHaveProperty('end_anchor')
  })

  it('the effective end follows Scene retiming immediately; nothing else is rewritten', () => {
    const longer = setSceneDuration(SCENES, 's3', 6) // 335
    const shorter = setSceneDuration(SCENES, 's3', 2) // 215
    expect(audioSegments(manifestFor(longer, PROOF))[0]).toMatchObject({ start_frame: 0, duration_frames: 335 })
    const short = manifestFor(shorter, PROOF)
    expect(audioSegments(short)[0]).toMatchObject({ duration_frames: 215 })
    // The fixed voice-over and the B-roll/lower third keep their authored frames.
    expect(audioSegments(short)[1]).toMatchObject({ start_frame: 90, duration_frames: 120 })
    expect(short.segments.find((segment) => segment.kind === 'media')).toMatchObject({ start_frame: 60, duration_frames: 60 })
    expect(effectiveDurationFrames(PROOF.items[2], 215)).toBe(215)
    expect(PROOF.items[2]).not.toHaveProperty('duration_frames')
    // Scene reorder keeps every independent item where it is.
    expect(manifestFor(reorderScenes(SCENES, 2, 0), PROOF).segments.filter((segment) => segment.kind !== 'template')).toEqual(manifestFor(SCENES, PROOF).segments.filter((segment) => segment.kind !== 'template'))
  })

  it('fades of an anchored item that no longer fit are shortened proportionally in the DERIVED segment only', () => {
    const tiny = [scene('s1', 1, 2)] // 60 frames, fades 30 + 45 = 75
    const derived = deriveTemporalSegments({ version: 1, items: [PROOF.items[2]] }, 60)
    expect(derived.segments[0]).toMatchObject({ duration_frames: 60, payload: { fade_in_frames: 24, fade_out_frames: 36 } })
    expect(derived.diagnostics.map((issue) => issue.code)).toEqual(['fade_clamped'])
    expect(resolveTimelineManifest(manifestFor(tiny, { version: 1, items: [PROOF.items[2]] }), { identitySnapshot: IDENTITY }).valid).toBe(true)
  })

  it('a new bed can be created anchored; later audio is fixed at the requested frame', () => {
    const bed = addTemporalItem({ version: 1, items: [] }, { kind: 'audio', library_file_id: BED, endsWithSequence: true }, 0, 150, 'b')!.item
    expect(bed).toEqual({ id: 'b', start_frame: 0, kind: 'audio', library_file_id: BED, volume: 1, end_anchor: 'sequence_end' })
    const voice = addTemporalItem({ version: 1, items: [bed] }, { kind: 'audio', library_file_id: VOICE }, 90, 150, 'v')!.item
    expect(voice).toMatchObject({ start_frame: 90, duration_frames: 150 })
  })
})

describe('snap across derived audio rows', () => {
  it('an item can snap to an edge of an audio item on another row (edges are row-agnostic)', () => {
    expect(snapItemStart(208.4, 40, { pixelsPerFrame: 3.2, edges: [210] })).toEqual({ frame: 210, snappedTo: 'scene-edge' })
    expect(snapItemStart(208.4, 40, { pixelsPerFrame: 3.2, edges: [210], disabled: true })).toEqual({ frame: 208, snappedTo: null })
  })
})

describe('Live Player and final render: one temporal preparation', () => {
  const files = new Map<string, PreviewLibraryFile>([
    [BED, { id: BED, name: 'bed.mp3', public_url: 'https://storage.example/bed.mp3?X-Amz-Signature=a', mime_type: 'audio/mpeg', thumbnail_url: null, kind: 'audio' }],
    [VOICE, { id: VOICE, name: 'voice.mp3', public_url: 'https://storage.example/voice.mp3?X-Amz-Signature=b', mime_type: 'audio/mpeg', thumbnail_url: null, kind: 'audio' }],
    [VIDEO, { id: VIDEO, name: 'b.mp4', public_url: 'https://storage.example/b.mp4?X-Amz-Signature=c', mime_type: 'video/mp4', thumbnail_url: null, kind: 'video' }],
  ])

  it('the preview manifest IS the render snapshot manifest, with both audio sources resolved', () => {
    const preview = buildLivePreviewInput({ draft: DRAFT, scenes: SCENES, timeline: PROOF, identitySnapshot: IDENTITY, libraryFiles: files })
    expect(preview.ok).toBe(true)
    if (!preview.ok) return
    expect(preview.manifest).toEqual(manifestFor(SCENES, PROOF))
    expect(preview.resolvedInput.resolvedAssets[`library_file:${BED}`]).toMatchObject({ mime_type: 'audio/mpeg' })
    expect(preview.resolvedInput.resolvedAssets[`library_file:${VOICE}`]).toMatchObject({ mime_type: 'audio/mpeg' })
  })

  it('claim-time preparation presigns both audio sources', async () => {
    const file = (id: string, kind: LibraryFile['kind'], mime: string) => ({ id, kind, mime_type: mime, storage_path: `users/u/${id}`, name: id } as LibraryFile)
    const lookup = new Map([[BED, file(BED, 'audio', 'audio/mpeg')], [VOICE, file(VOICE, 'audio', 'audio/mpeg')], [VIDEO, file(VIDEO, 'video', 'video/mp4')]])
    const prepared = await prepareTimelineLibraryFileAssets(manifestFor(SCENES, PROOF), (ref) => lookup.get(ref), { createPresignedReadUrl: async (path) => `https://signed/${path}` })
    expect(Object.keys(prepared.resolvedManifestAssets).sort()).toEqual([`library_file:${BED}`, `library_file:${VIDEO}`, `library_file:${VOICE}`].sort())
    expect(prepared.diagnostics).toEqual([])
  })

  it('the adapter maps neutral fields to the engine only inside remotion/ (no engine names authored)', () => {
    const adapter = readFileSync(join(process.cwd(), 'remotion/timeline/IndependentSegments.tsx'), 'utf8')
    expect(adapter).toContain('<Audio src={asset.url} startFrom={sourceIn} volume={volume} />')
    expect(adapter).toContain('gain * audioEnvelope(localFrame, segment.duration_frames, fadeIn, fadeOut)')
    const domain = readFileSync(join(process.cwd(), 'lib/creative/video-editor/temporal-items.ts'), 'utf8')
    expect(domain).not.toMatch(/from 'remotion'|@remotion\/|startFrom|trimBefore|interpolate/)
    expect(JSON.stringify(persistedVideoTimeline(PROOF))).not.toMatch(/Sequence|startFrom|trimBefore|volume\(/)
  })
})

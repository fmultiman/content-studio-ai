import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { LibraryFile, VideoScene } from '@/lib/types'
import { buildRenderExecutionSnapshot } from '@/lib/render-execution/build-snapshot'
import { resolveTimelineManifest } from '@/lib/creative/resolution/resolve-timeline'
import { prepareTimelineLibraryFileAssets } from '@/lib/creative/timeline-adapter/prepare-scene-assets'
import { isRenderableLibraryFile } from '@/lib/creative/integration/library-file-adapter'
import { buildLivePreviewInput, type PreviewLibraryFile } from '../live-preview-input'
import { buildVideoDraftSaveBody, persistedVideoSnapshot } from '../video-authoring'
import { reorderScenes, setSceneDuration, snapItemStart } from '../scene-timeline'
import {
  EMPTY_TIMELINE, MAX_TEMPORAL_ITEMS, TEMPORAL_TRACKS, addTemporalItem, deriveTemporalSegments, moveTemporalItem, persistedVideoTimeline,
  readVideoTimeline, removeTemporalItem, resizeTemporalItem, timelineLibraryFileRefs, updateTemporalItem, validateVideoTimeline,
  type VideoTimeline,
} from '../temporal-items'

// VIDEO_TIMELINE_GATE_B_INDEPENDENT_TEMPORAL_COMPOSITION_V1

const IDENTITY = {
  schema_version: 'visual-tokens.v0' as const,
  snapshot_ref: 'project:11111111-1111-1111-1111-111111111111:snapshot',
  typography: { display: { family: 'Fraunces', weight: 700, style: 'normal' as const }, body: { family: 'Source Sans 3', weight: 400, style: 'normal' as const } },
  colors: { background: '#F6F0E4', foreground: '#16352F' },
  spacing: { unit: 8, default_gap: 16 },
}
const DRAFT = { id: 'draft-1', project_id: '11111111-1111-1111-1111-111111111111', production_id: '22222222-2222-2222-2222-222222222222' }
const VIDEO = '664a9e53-53c8-4df1-9a0d-699e7cf04f23'
const AUDIO = '03e92637-a52d-48e4-8de9-2660d7e318a9'

const scene = (id: string, order: number, duration: number): VideoScene => ({ id, order, description: '', prompt: null, image_url: null, library_file_id: null, duration, movement: 'static' })
/** The real proof draft: 3 s + 2.1667 s + 4 s = 90 + 65 + 120 frames (boundaries at 90 and 155). */
const SCENES = [scene('s1', 1, 3), scene('s2', 2, 2.1667), scene('s3', 3, 4)]
const PROOF: VideoTimeline = {
  version: 1,
  items: [
    { id: 'broll', kind: 'visual', start_frame: 60, duration_frames: 60, library_file_id: VIDEO },
    { id: 'lower', kind: 'text', start_frame: 135, duration_frames: 90, style: 'lower_third', text: 'Carlos A. P. Tavares\nautor' },
    { id: 'music', kind: 'audio', start_frame: 0, duration_frames: 275, library_file_id: AUDIO, volume: 0.8 },
  ],
}
const manifestFor = (scenes: VideoScene[], timeline: unknown) => buildRenderExecutionSnapshot({ draft: { ...DRAFT, scenes, timeline }, identitySnapshot: IDENTITY }).snapshot.manifest

describe('backward compatibility: drafts without an independent layer', () => {
  it('NULL/absent/garbage reads as no items and never rewrites storage', () => {
    expect(readVideoTimeline(null)).toEqual(EMPTY_TIMELINE)
    expect(readVideoTimeline(undefined)).toEqual(EMPTY_TIMELINE)
    expect(readVideoTimeline({ nope: true })).toEqual(EMPTY_TIMELINE)
    expect(persistedVideoTimeline(EMPTY_TIMELINE)).toBeNull()
  })

  it('the derived manifest is exactly the pre-Gate-B one (one primary track, no assets, audio intent off)', () => {
    const manifest = manifestFor(SCENES, null)
    expect(manifest.tracks).toEqual([{ id: 'video-main', kind: 'video', order: 0 }])
    expect(manifest.assets).toEqual({})
    expect(manifest.render_intent).toEqual({ purpose: 'preview', container: 'mp4', audio: false, captions: 'none' })
    expect(manifest.segments.every((segment) => segment.kind === 'template')).toBe(true)
  })

  it('save body / dirty snapshot of a draft without items are unchanged', () => {
    expect(persistedVideoSnapshot('v', SCENES, EMPTY_TIMELINE)).toBe(JSON.stringify({ name: 'v', scenes: SCENES }))
    expect(buildVideoDraftSaveBody(DRAFT, 'v', SCENES, EMPTY_TIMELINE).timeline).toBeNull()
    expect(buildVideoDraftSaveBody(DRAFT, 'v', SCENES)).not.toHaveProperty('timeline')
  })
})

describe('independent timing, overlap and cross-Scene spans (derived neutral manifest)', () => {
  const manifest = manifestFor(SCENES, PROOF)

  it('primary Scenes stay contiguous template segments; items keep their own absolute frames', () => {
    const templates = manifest.segments.filter((segment) => segment.kind === 'template')
    expect(templates.map((segment) => [segment.start_frame, segment.duration_frames])).toEqual([[0, 90], [90, 65], [155, 120]])
    const media = manifest.segments.find((segment) => segment.kind === 'media')
    const text = manifest.segments.find((segment) => segment.kind === 'text')
    const audio = manifest.segments.find((segment) => segment.kind === 'audio')
    expect(media).toMatchObject({ start_frame: 60, duration_frames: 60, track_id: 'video-broll', payload: { asset_ref: `library_file:${VIDEO}`, fit: 'cover' } })
    expect(text).toMatchObject({ start_frame: 135, duration_frames: 90, track_id: 'overlay-text', payload: { text: 'Carlos A. P. Tavares\nautor', role: 'lower_third' } })
    expect(audio).toMatchObject({ start_frame: 0, duration_frames: 275, track_id: 'audio-main', payload: { asset_ref: `library_file:${AUDIO}`, gain: 0.8 } })
  })

  it('B-roll crosses the Scene 1→2 boundary and the lower third crosses Scene 2→3; audio spans every Scene', () => {
    const media = manifest.segments.find((segment) => segment.kind === 'media')!
    const text = manifest.segments.find((segment) => segment.kind === 'text')!
    const audio = manifest.segments.find((segment) => segment.kind === 'audio')!
    expect(media.start_frame < 90 && media.start_frame + media.duration_frames > 90).toBe(true)
    expect(text.start_frame < 155 && text.start_frame + text.duration_frames > 155).toBe(true)
    expect(audio.start_frame).toBe(0)
    expect(audio.duration_frames).toBe(manifest.specification.duration_frames)
  })

  it('tracks are DERIVED from kind with a deterministic paint order; assets are identities, never URLs', () => {
    expect(manifest.tracks).toEqual([{ id: 'video-main', kind: 'video', order: 0 }, TEMPORAL_TRACKS.visual, TEMPORAL_TRACKS.text, TEMPORAL_TRACKS.audio])
    expect(manifest.assets).toEqual({ [`library_file:${VIDEO}`]: { type: 'library_file', ref: VIDEO, fit: 'cover' }, [`library_file:${AUDIO}`]: { type: 'library_file', ref: AUDIO } })
    expect(manifest.render_intent.audio).toBe(true)
    // Neutral contract: no URLs, no signatures, no engine component names (the lowercase `sequence` is the neutral slide/Scene context).
    expect(JSON.stringify(manifest)).not.toMatch(/https?:|X-Amz|Sequence|OffthreadVideo|Remotion|@remotion/)
  })

  it('the neutral resolver accepts the overlapping manifest', () => {
    expect(resolveTimelineManifest(manifest, { identitySnapshot: IDENTITY }).valid).toBe(true)
  })

  it('items reaching past the primary sequence are clipped in the DERIVED manifest only (authored item untouched)', () => {
    const short = setSceneDuration(SCENES, 's3', 1) // total 90 + 65 + 30 = 185
    const derived = deriveTemporalSegments(PROOF, 185)
    expect(derived.segments.find((segment) => segment.kind === 'audio')?.duration_frames).toBe(185)
    expect(derived.segments.find((segment) => segment.kind === 'text')?.duration_frames).toBe(50)
    expect(derived.diagnostics.map((issue) => issue.code)).toEqual(['item_clipped', 'item_clipped'])
    expect(deriveTemporalSegments(PROOF, 50).segments.map((segment) => segment.kind)).toEqual(['audio'])
    expect(resolveTimelineManifest(manifestFor(short, PROOF), { identitySnapshot: IDENTITY }).valid).toBe(true)
    expect(PROOF.items.find((item) => item.id === 'music')?.duration_frames).toBe(275)
  })
})

describe('anchoring: ABSOLUTE timeline frames (Scene reorder/retime never moves an item)', () => {
  it('reordering Scenes changes what is under an item, not where the item is', () => {
    const reordered = reorderScenes(SCENES, 2, 0)
    const before = manifestFor(SCENES, PROOF).segments.filter((segment) => segment.kind !== 'template')
    const after = manifestFor(reordered, PROOF).segments.filter((segment) => segment.kind !== 'template')
    expect(after).toEqual(before)
    const templatesAfter = manifestFor(reordered, PROOF).segments.filter((segment) => segment.kind === 'template').map((segment) => segment.id)
    expect(templatesAfter).toEqual(['scene:s3', 'scene:s1', 'scene:s2'])
  })
})

describe('authoring edits: one lane per kind, never overlapping within a kind', () => {
  it('add places at the first free slot of its lane (other kinds may overlap)', () => {
    const added = addTemporalItem(PROOF, { kind: 'visual', library_file_id: VIDEO }, 90, 60, 'b2')!
    expect(added.item).toMatchObject({ kind: 'visual', start_frame: 120, duration_frames: 60 })
    const text = addTemporalItem(PROOF, { kind: 'text', text: 'x' }, 10, 30, 't2')!
    expect(text.item.start_frame).toBe(10)
    // VIDEO_AUDIO_AUTHORING_V1: audio mixes, so a second audio is placed exactly where asked (overlap allowed).
    const audioOverlap = addTemporalItem(PROOF, { kind: 'audio', library_file_id: AUDIO }, 0, 30, 'a2')!
    expect(audioOverlap.item.start_frame).toBe(0)
  })

  it('move keeps duration and stops at a same-kind neighbour; resize is bounded by the next one', () => {
    const two = addTemporalItem(PROOF, { kind: 'visual', library_file_id: VIDEO }, 180, 60, 'b2')!.timeline
    expect(moveTemporalItem(two, 'broll', 150).items.find((item) => item.id === 'broll')?.start_frame).toBe(120)
    expect(moveTemporalItem(two, 'broll', -20).items.find((item) => item.id === 'broll')?.start_frame).toBe(0)
    expect(resizeTemporalItem(two, 'broll', 500).items.find((item) => item.id === 'broll')?.duration_frames).toBe(120)
    expect(resizeTemporalItem(two, 'broll', 2).items.find((item) => item.id === 'broll')?.duration_frames).toBe(15)
    expect(removeTemporalItem(two, 'b2').items.map((item) => item.id)).toEqual(['broll', 'lower', 'music'])
    expect(updateTemporalItem<'audio'>(PROOF, 'music', { volume: 0.4 }).items.find((item) => item.id === 'music')).toMatchObject({ volume: 0.4, start_frame: 0 })
  })

  it('item snapping reuses the Scene-edge snapper (start first, then end; Alt bypass)', () => {
    expect(snapItemStart(88.4, 60, { pixelsPerFrame: 3.2, edges: [90] })).toEqual({ frame: 90, snappedTo: 'scene-edge' })
    expect(snapItemStart(31, 60, { pixelsPerFrame: 3.2, edges: [90] })).toEqual({ frame: 30, snappedTo: 'second' })
    expect(snapItemStart(88.4, 60, { pixelsPerFrame: 3.2, edges: [90], disabled: true })).toEqual({ frame: 88, snappedTo: null })
  })
})

describe('persistence: one authoring truth, no manifest and no viewport persisted', () => {
  it('the save body carries the authored layer and round-trips exactly', () => {
    const body = buildVideoDraftSaveBody(DRAFT, 'v', SCENES, PROOF)
    const reloaded = readVideoTimeline(JSON.parse(JSON.stringify(body)).timeline)
    expect(reloaded).toEqual(PROOF)
    expect(persistedVideoSnapshot('v', SCENES, PROOF)).not.toBe(persistedVideoSnapshot('v', SCENES, EMPTY_TIMELINE))
  })

  it('the write boundary rejects invalid temporal state (and any non-authored field)', () => {
    expect(validateVideoTimeline(PROOF)).toEqual({ ok: true })
    expect(validateVideoTimeline(null)).toEqual({ ok: true })
    const bad = (items: unknown[], extra: Record<string, unknown> = {}) => validateVideoTimeline({ version: 1, items, ...extra }).ok
    expect(bad([{ ...PROOF.items[0], start_frame: -1 }])).toBe(false)
    expect(bad([{ ...PROOF.items[0], duration_frames: 10.5 }])).toBe(false)
    expect(bad([{ ...PROOF.items[0], duration_frames: 5 }])).toBe(false)
    expect(bad([{ ...PROOF.items[1], text: '' }])).toBe(false)
    expect(bad([{ ...PROOF.items[1], text: 'x'.repeat(121) }])).toBe(false)
    expect(bad([{ ...PROOF.items[2], volume: 1.5 }])).toBe(false)
    expect(bad([{ ...PROOF.items[0], library_file_id: 'https://s3/x.mp4' }])).toBe(false)
    expect(bad([{ ...PROOF.items[0], track_id: 'video-broll' }])).toBe(false)
    expect(bad([{ ...PROOF.items[0], kind: 'caption' }])).toBe(false)
    expect(bad([PROOF.items[0], { ...PROOF.items[0], id: 'dup' }, { ...PROOF.items[0], id: 'dup', start_frame: 300 }])).toBe(false)
    expect(bad([PROOF.items[0], { ...PROOF.items[0], id: 'b2', start_frame: 100 }])).toBe(false)
    expect(bad(Array.from({ length: MAX_TEMPORAL_ITEMS + 1 }, (_, i) => ({ ...PROOF.items[1], id: `t${i}`, start_frame: i * 20 })))).toBe(false)
    expect(bad([], { zoom: 1.6 })).toBe(false)
    expect(bad([], { manifest: {} })).toBe(false)
    expect(validateVideoTimeline({ version: 2, items: [] }).ok).toBe(false)
  })

  it('media refs are LibraryFile identities checked by kind at the API; the render route freezes the layer', () => {
    expect(timelineLibraryFileRefs(PROOF)).toEqual([{ id: VIDEO, kind: 'visual' }, { id: AUDIO, kind: 'audio' }])
    const api = readFileSync(join(process.cwd(), 'app/api/video-drafts/route.ts'), 'utf8')
    expect(api.match(/validateTimelineBody\(supabase, user\.id,/g)).toHaveLength(2)
    expect(api).toContain("if (Object.hasOwn(body, 'timeline'))")
    const render = readFileSync(join(process.cwd(), 'app/api/video-drafts/[id]/render/route.ts'), 'utf8')
    expect(render).toContain("select('id, user_id, project_id, production_id, scenes, timeline')")
    expect(render).toContain('draft: { id: draft.id, project_id: draft.project_id, production_id: draft.production_id, scenes, timeline }')
  })
})

describe('Live Player and final render: same authored truth, same manifest', () => {
  const files = new Map<string, PreviewLibraryFile>([
    [VIDEO, { id: VIDEO, name: 'b.mp4', public_url: 'https://storage.example/b.mp4?X-Amz-Signature=a', mime_type: 'video/mp4', thumbnail_url: null, kind: 'video' }],
    [AUDIO, { id: AUDIO, name: 'a.mp3', public_url: 'https://storage.example/a.mp3?X-Amz-Signature=b', mime_type: 'audio/mpeg', thumbnail_url: null, kind: 'audio' }],
  ])

  it('the preview manifest IS the render snapshot manifest, and preview media resolve from the Library listing', () => {
    const preview = buildLivePreviewInput({ draft: DRAFT, scenes: SCENES, timeline: PROOF, identitySnapshot: IDENTITY, libraryFiles: files })
    expect(preview.ok).toBe(true)
    if (!preview.ok) return
    expect(preview.manifest).toEqual(manifestFor(SCENES, PROOF))
    expect(preview.resolvedInput.resolvedAssets[`library_file:${VIDEO}`]).toMatchObject({ mime_type: 'video/mp4', url: 'https://storage.example/b.mp4?X-Amz-Signature=a' })
    expect(preview.resolvedInput.resolvedAssets[`library_file:${AUDIO}`]).toMatchObject({ mime_type: 'audio/mpeg' })
    expect(preview.missingAssets).toEqual([])
    const missing = buildLivePreviewInput({ draft: DRAFT, scenes: SCENES, timeline: PROOF, identitySnapshot: IDENTITY, libraryFiles: new Map() })
    expect(missing.ok && missing.missingAssets).toEqual([VIDEO, AUDIO])
  })

  it('claim-time preparation presigns the independent media, never lets video into an image-only template slot', async () => {
    const file = (id: string, kind: LibraryFile['kind'], mime: string) => ({ id, kind, mime_type: mime, storage_path: `users/u/${id}`, name: id } as LibraryFile)
    const lookup = new Map([[VIDEO, file(VIDEO, 'video', 'video/mp4')], [AUDIO, file(AUDIO, 'audio', 'audio/mpeg')]])
    const manifest = manifestFor(SCENES, PROOF)
    const prepared = await prepareTimelineLibraryFileAssets(manifest, (ref) => lookup.get(ref), { createPresignedReadUrl: async (path) => `https://signed/${path}` })
    expect(prepared.resolvedManifestAssets[`library_file:${VIDEO}`]).toMatchObject({ url: `https://signed/users/u/${VIDEO}`, mime_type: 'video/mp4' })
    expect(prepared.resolvedManifestAssets[`library_file:${AUDIO}`]).toMatchObject({ mime_type: 'audio/mpeg' })
    const heroAsVideo = manifestFor([{ ...SCENES[0], library_file_id: VIDEO }], null)
    const rejected = await prepareTimelineLibraryFileAssets(heroAsVideo, (ref) => lookup.get(ref), { createPresignedReadUrl: async (path) => `https://signed/${path}` })
    expect(rejected.resolvedAssets).toEqual({})
    expect(rejected.diagnostics[0].code).toBe('library_file_unresolvable')
  })

  it('renderable media are bounded (no SVG, no documents, known containers only)', () => {
    expect(isRenderableLibraryFile({ kind: 'image', mime_type: 'image/png' })).toBe(true)
    expect(isRenderableLibraryFile({ kind: 'image', mime_type: 'image/svg+xml' })).toBe(false)
    expect(isRenderableLibraryFile({ kind: 'video', mime_type: 'video/mp4' })).toBe(true)
    expect(isRenderableLibraryFile({ kind: 'video', mime_type: 'video/x-matroska' })).toBe(false)
    expect(isRenderableLibraryFile({ kind: 'audio', mime_type: 'audio/mpeg' })).toBe(true)
    expect(isRenderableLibraryFile({ kind: 'document', mime_type: 'text/xml' })).toBe(false)
  })

  it('the renderer paints visual tracks in track order and plays audio tracks (engine detail stays in remotion/)', () => {
    const composition = readFileSync(join(process.cwd(), 'remotion/timeline/TimelineComposition.tsx'), 'utf8')
    expect(composition).toContain('.sort((a, b) => a.order - b.order)')
    expect(composition).toContain("if (segment.kind === 'media') return <MediaSegmentLayer")
    expect(composition).toContain("if (segment.kind === 'text') return <TextSegmentLayer")
    expect(composition).toContain("return segment.kind === 'audio' ? <AudioSegmentLayer")
    const independent = readFileSync(join(process.cwd(), 'remotion/timeline/IndependentSegments.tsx'), 'utf8')
    expect(independent).toContain('<Sequence from={segment.start_frame} durationInFrames={segment.duration_frames}')
    expect(independent).toContain('<OffthreadVideo src={asset.url} muted')
    const exporter = readFileSync(join(process.cwd(), 'infra/render-worker-runtime/export.mjs'), 'utf8')
    expect(exporter).toContain("'remotion/timeline/IndependentSegments.tsx'")
    const domain = readFileSync(join(process.cwd(), 'lib/creative/video-editor/temporal-items.ts'), 'utf8')
    expect(domain).not.toMatch(/from 'remotion'|@remotion\//)
  })
})

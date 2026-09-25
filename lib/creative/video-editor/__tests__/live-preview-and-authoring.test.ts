import { describe, expect, it } from 'vitest'
import type { VideoScene } from '@/lib/types'
import { buildRenderExecutionSnapshot } from '@/lib/render-execution/build-snapshot'
import { buildLivePreviewInput, previewLibraryFileAsset, type PreviewLibraryFile } from '../live-preview-input'
import {
  addVideoScene, buildVideoDraftSaveBody, createVideoScene, motionOptions, normalizeLoadedScenes, persistedVideoSnapshot,
  removeVideoScene, updateVideoScene,
} from '../video-authoring'
import { deriveSceneRanges, reorderScenes, setSceneDuration } from '../scene-timeline'
import { VIDEO_INSPECTOR_SECTIONS, videoCreativeEditorHref } from '../video-workspace'

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

const FILE_A = 'afa6868e-a2d6-473d-9df7-bbf713ad8b02'
const FILE_B = 'b1f5c3a2-7d44-4e21-9a0b-3c2d1e0f9a88'
const DRAFT = { id: 'draft-1', project_id: '11111111-1111-1111-1111-111111111111', production_id: '22222222-2222-2222-2222-222222222222' }

function scene(id: string, order: number, duration: number, extra: Partial<VideoScene> = {}): VideoScene {
  return { id, order, description: '', prompt: null, image_url: null, library_file_id: null, duration, movement: 'static', ...extra }
}

const SCENES = [
  scene('s1', 1, 3, { library_file_id: FILE_A, movement: 'zoom_in' }),
  scene('s2', 2, 5, { library_file_id: FILE_B, movement: 'pan_left' }),
  scene('s3', 3, 2),
]

const FILES = new Map<string, PreviewLibraryFile>([
  [FILE_A, { id: FILE_A, name: 'a.jpg', public_url: 'https://storage.example/a.jpg?X-Amz-Signature=abc', mime_type: 'image/jpeg' }],
  [FILE_B, { id: FILE_B, name: 'b.png', public_url: 'https://storage.example/b.png?X-Amz-Signature=def', mime_type: 'image/png' }],
])

describe('Live Authoring Player input', () => {
  it('uses the exact manifest the final render snapshot freezes for the same scenes', () => {
    const live = buildLivePreviewInput({ draft: DRAFT, scenes: SCENES, identitySnapshot: IDENTITY_SNAPSHOT, libraryFiles: FILES })
    expect(live.ok).toBe(true)
    if (!live.ok) return
    const { snapshot } = buildRenderExecutionSnapshot({ draft: { ...DRAFT, scenes: SCENES }, identitySnapshot: IDENTITY_SNAPSHOT })
    expect(live.manifest).toEqual(snapshot.manifest)
    expect(live.resolvedInput.manifest.specification.duration_frames).toBe(300)
    expect(live.resolvedInput.resolvedTemplateSegments.map((s) => s.segment.payload.motion?.preset)).toEqual(['slow_push', 'slow_pan', 'none'])
  })

  it('authored state updates the preview (duration / order / asset changes are reflected)', () => {
    const base = buildLivePreviewInput({ draft: DRAFT, scenes: SCENES, identitySnapshot: IDENTITY_SNAPSHOT, libraryFiles: FILES })
    const longer = buildLivePreviewInput({ draft: DRAFT, scenes: setSceneDuration(SCENES, 's3', 4), identitySnapshot: IDENTITY_SNAPSHOT, libraryFiles: FILES })
    const reordered = buildLivePreviewInput({ draft: DRAFT, scenes: reorderScenes(SCENES, 2, 0), identitySnapshot: IDENTITY_SNAPSHOT, libraryFiles: FILES })
    if (!base.ok || !longer.ok || !reordered.ok) throw new Error('expected ok')
    expect(longer.resolvedInput.manifest.specification.duration_frames).toBe(360)
    expect(reordered.resolvedInput.manifest.segments.map((s) => s.id)).toEqual(['scene:s3', 'scene:s1', 'scene:s2'])
    expect(reordered.resolvedInput.manifest.segments.map((s) => s.start_frame)).toEqual([0, 60, 150])
  })

  it('paints LibraryFile assets from display URLs only in the transient resolved input, never in the manifest', () => {
    const live = buildLivePreviewInput({ draft: DRAFT, scenes: SCENES, identitySnapshot: IDENTITY_SNAPSHOT, libraryFiles: FILES })
    if (!live.ok) throw new Error('expected ok')
    expect(live.resolvedInput.resolvedTemplateSegments[0].resolvedAssets.hero.url).toContain('a.jpg')
    expect(live.resolvedInput.resolvedTemplateSegments[1].resolvedAssets.hero.url).toContain('b.png')
    // Scene without binding keeps the Template's default hero (same as the render path).
    expect(live.resolvedInput.resolvedTemplateSegments[2].resolvedAssets.hero.source).not.toBe('library_file')
    expect(JSON.stringify(live.manifest)).not.toContain('X-Amz')
    expect(live.missingAssets).toEqual([])
  })

  it('reports not-yet-loaded LibraryFiles instead of inventing a URL', () => {
    const live = buildLivePreviewInput({ draft: DRAFT, scenes: SCENES, identitySnapshot: IDENTITY_SNAPSHOT, libraryFiles: new Map() })
    if (!live.ok) throw new Error('expected ok')
    expect(live.missingAssets).toEqual([FILE_A, FILE_B])
    expect(previewLibraryFileAsset({ id: 'x', name: 'x', public_url: '', mime_type: 'image/png' })).toBeNull()
  })

  it('refuses honestly without scenes or Project/Production context', () => {
    expect(buildLivePreviewInput({ draft: DRAFT, scenes: [], identitySnapshot: IDENTITY_SNAPSHOT, libraryFiles: FILES })).toMatchObject({ ok: false, reason: 'no_scenes' })
    expect(buildLivePreviewInput({ draft: { ...DRAFT, production_id: null }, scenes: SCENES, identitySnapshot: IDENTITY_SNAPSHOT, libraryFiles: FILES })).toMatchObject({ ok: false, reason: 'missing_context' })
  })
})

describe('Scene authoring over VideoScene[]', () => {
  it('adds a Scene after the selected one with the legacy defaults and renumbers', () => {
    const { scenes, index } = addVideoScene(SCENES, 0, 'new')
    expect(index).toBe(1)
    expect(scenes.map((s) => s.id)).toEqual(['s1', 'new', 's2', 's3'])
    expect(scenes.map((s) => s.order)).toEqual([1, 2, 3, 4])
    expect(scenes[1]).toMatchObject({ duration: 3, movement: 'static', library_file_id: null, description: '' })
    expect(addVideoScene(SCENES, undefined, 'end').index).toBe(3)
    expect(createVideoScene([], 'x').order).toBe(1)
  })

  it('removes and updates Scenes without touching other Scenes', () => {
    expect(removeVideoScene(SCENES, 's1').map((s) => [s.id, s.order])).toEqual([['s2', 1], ['s3', 2]])
    const updated = updateVideoScene(SCENES, 's2', { description: 'nova', movement: 'tilt_up' })
    expect(updated[1]).toMatchObject({ id: 's2', order: 2, description: 'nova', movement: 'tilt_up', duration: 5 })
    expect(updated[0]).toBe(SCENES[0])
  })

  it('keeps the stored array order (the render sequence) on load, fixing only order numbers', () => {
    const legacy = [scene('x', 3, 2), scene('y', 1, 2)]
    expect(normalizeLoadedScenes(legacy).map((s) => [s.id, s.order])).toEqual([['x', 1], ['y', 2]])
    expect(normalizeLoadedScenes(null)).toEqual([])
  })

  it('persists through the same VideoDraft PATCH body with only authored fields', () => {
    const edited = setSceneDuration(reorderScenes(SCENES, 0, 2), 's1', 4.5)
    const body = buildVideoDraftSaveBody(DRAFT, 'Meu vídeo', edited)
    expect(Object.keys(body).sort()).toEqual(['id', 'name', 'productionId', 'projectId', 'scenes'])
    expect(body.scenes.map((s) => [s.id, s.order, s.duration])).toEqual([['s2', 1, 5], ['s3', 2, 2], ['s1', 3, 4.5]])
    const serialized = JSON.stringify(body)
    for (const forbidden of ['start_frame', 'startFrame', 'pixelsPerFrame', 'scrollLeft', 'timelineZoom', 'currentFrame', 'playhead', 'selected', 'segments', 'manifest']) {
      expect(serialized).not.toContain(`"${forbidden}"`)
    }
    // Every persisted Scene carries only VideoScene's own fields.
    for (const persisted of body.scenes) {
      expect(Object.keys(persisted).sort()).toEqual(['description', 'duration', 'id', 'image_url', 'library_file_id', 'movement', 'order', 'prompt'])
    }
    // reload = the same derived sequence
    const reloaded = normalizeLoadedScenes(JSON.parse(serialized).scenes)
    expect(deriveSceneRanges(reloaded)).toEqual(deriveSceneRanges(edited))
  })

  it('dirty snapshot is name + scenes only', () => {
    expect(persistedVideoSnapshot('a', SCENES)).toBe(JSON.stringify({ name: 'a', scenes: SCENES }))
    expect(persistedVideoSnapshot('a', SCENES)).not.toBe(persistedVideoSnapshot('a', setSceneDuration(SCENES, 's1', 4)))
  })

  it('Motion keeps the existing movement vocabulary and labels presets truthfully', () => {
    const options = Object.fromEntries(motionOptions().map((o) => [o.value, o]))
    expect(options.static).toMatchObject({ preset: 'none', supported: true })
    expect(options.zoom_in).toMatchObject({ preset: 'slow_push', supported: true })
    expect(options.pan_right).toMatchObject({ preset: 'slow_pan', supported: true })
    expect(options.zoom_out).toMatchObject({ supported: false })
    expect(options.dolly).toMatchObject({ supported: false })
  })
})

describe('Video workspace surface', () => {
  it('Inspector has Motion, no generic Timing tab and no empty Elementos tab', () => {
    const values = VIDEO_INSPECTOR_SECTIONS.map((s) => s.value)
    expect(values).toEqual(['template', 'content', 'assets', 'style', 'motion'])
    expect(VIDEO_INSPECTOR_SECTIONS.map((s) => s.label.toLowerCase())).not.toContain('timing')
  })

  it('entry route is keyed by the VideoDraft only', () => {
    expect(videoCreativeEditorHref('abc-123')).toBe('/creative-editor/video/abc-123')
  })
})

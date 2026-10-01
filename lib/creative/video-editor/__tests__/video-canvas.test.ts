import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { VideoScene } from '@/lib/types'
import { buildRenderExecutionSnapshot } from '@/lib/render-execution/build-snapshot'
import { resolveTimelineManifest } from '@/lib/creative/resolution/resolve-timeline'
import { staticAuthoringTarget } from '@/lib/creative/context/static-authoring'
import { listTemplates } from '@/lib/creative/templates/registry'
import { buildLivePreviewInput } from '../live-preview-input'
import { buildVideoDraftSaveBody, persistedVideoSnapshot } from '../video-authoring'
import type { VideoTimeline } from '../temporal-items'
import {
  LEGACY_VIDEO_CANVAS, VIDEO_CANVAS_LIMITS, VIDEO_CANVAS_PRESETS, effectiveVideoCanvas, matchVideoCanvasPreset, readVideoCanvas,
  sameVideoCanvas, validateVideoCanvas, videoCanvasRatio, videoTemplateCanvasSupport,
} from '../video-canvas'

// VIDEO_CANVAS_OUTPUT_FORMAT_V1

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
const scene = (id: string, order: number, duration: number, extra: Partial<VideoScene> = {}): VideoScene => ({ id, order, description: '', prompt: null, image_url: null, library_file_id: null, duration, movement: 'static', ...extra })
const QUOTE = {
  layout: 'quote',
  content: { title: 'O que ficou', intro: 'Décadas depois.', bullets: ['a', 'b', 'c'], quote: 'Isso não diminui o valor do livro.', callout: 'Além de falar das comunidades.' },
}
const SCENES: VideoScene[] = [
  scene('s1', 1, 3, { library_file_id: '33333333-3333-3333-3333-333333333333' }),
  scene('s2', 2, 4, { composition: QUOTE as VideoScene['composition'], element_timing: { quote: { start_frame: 15, duration_frames: 60 }, callout: { start_frame: 45 } } }),
]
const TIMELINE: VideoTimeline = {
  version: 1,
  items: [
    { id: 'lt', kind: 'text', start_frame: 60, duration_frames: 90, text: 'Nome\nfunção', style: 'lower_third' },
    { id: 'bed', kind: 'audio', start_frame: 0, library_file_id: '44444444-4444-4444-4444-444444444444', volume: 0.6, end_anchor: 'sequence_end', fade_in_frames: 30, fade_out_frames: 45 },
  ],
}
const snapshotFor = (canvas: unknown, scenes = SCENES) =>
  buildRenderExecutionSnapshot({ draft: { ...DRAFT, scenes, timeline: TIMELINE, canvas }, identitySnapshot: IDENTITY }).snapshot.manifest
const root = join(__dirname, '..', '..', '..', '..')
const read = (path: string) => readFileSync(join(root, path), 'utf8')

describe('Backward compatibility — missing canvas = the legacy 1080×1920 stage', () => {
  it('an old draft (no canvas key, null, or undefined) renders exactly as before', () => {
    expect(LEGACY_VIDEO_CANVAS).toEqual({ width: 1080, height: 1920 })
    for (const missing of [undefined, null]) {
      expect(readVideoCanvas(missing)).toBeNull()
      expect(effectiveVideoCanvas(missing)).toEqual(LEGACY_VIDEO_CANVAS)
      expect(snapshotFor(missing).specification).toMatchObject({ width: 1080, height: 1920, fps: 30 })
    }
    const withoutKey = buildRenderExecutionSnapshot({ draft: { ...DRAFT, scenes: SCENES, timeline: TIMELINE }, identitySnapshot: IDENTITY }).snapshot
    expect(withoutKey).toEqual(buildRenderExecutionSnapshot({ draft: { ...DRAFT, scenes: SCENES, timeline: TIMELINE, canvas: null }, identitySnapshot: IDENTITY }).snapshot)
  })

  it('an unauthored draft keeps its exact pre-canvas snapshot and save body (never backfilled)', () => {
    expect(persistedVideoSnapshot('v', SCENES, TIMELINE, null)).toBe(persistedVideoSnapshot('v', SCENES, TIMELINE))
    expect(persistedVideoSnapshot('v', SCENES)).toBe(JSON.stringify({ name: 'v', scenes: SCENES }))
    expect(buildVideoDraftSaveBody(DRAFT, 'v', SCENES, TIMELINE, null)).not.toHaveProperty('canvas')
    expect(buildVideoDraftSaveBody(DRAFT, 'v', SCENES)).not.toHaveProperty('canvas')
  })

  it('a malformed stored value reads as legacy instead of breaking the draft', () => {
    for (const bad of [{ width: 1081, height: 1920 }, { width: '1080', height: 1920 }, [1080, 1920], {}, 'reel']) {
      expect(readVideoCanvas(bad)).toBeNull()
      expect(effectiveVideoCanvas(bad)).toEqual(LEGACY_VIDEO_CANVAS)
    }
  })
})

describe('Authored dimensions are the stage', () => {
  it('an explicit canvas drives the neutral specification; nothing else changes', () => {
    const portrait = snapshotFor({ width: 1080, height: 1350 })
    const legacy = snapshotFor(null)
    expect(portrait.specification).toEqual({ ...legacy.specification, width: 1080, height: 1350 })
    expect(portrait.segments).toEqual(legacy.segments)
    expect(portrait.tracks).toEqual(legacy.tracks)
    expect(portrait.assets).toEqual(legacy.assets)
  })

  it('save → reload round-trips the exact dimensions and dirty tracking sees the change', () => {
    const canvas = { width: 1080, height: 1350 }
    const body = JSON.parse(JSON.stringify(buildVideoDraftSaveBody(DRAFT, 'v', SCENES, TIMELINE, canvas)))
    expect(body.canvas).toEqual(canvas)
    expect(readVideoCanvas(body.canvas)).toEqual(canvas)
    expect(persistedVideoSnapshot('v', SCENES, TIMELINE, canvas)).not.toBe(persistedVideoSnapshot('v', SCENES, TIMELINE, null))
    expect(persistedVideoSnapshot('v', SCENES, TIMELINE, readVideoCanvas(body.canvas))).toBe(persistedVideoSnapshot('v', SCENES, TIMELINE, canvas))
    // choosing 9:16 explicitly is authored state too (differs from "never chosen")
    expect(persistedVideoSnapshot('v', SCENES, TIMELINE, LEGACY_VIDEO_CANVAS)).not.toBe(persistedVideoSnapshot('v', SCENES, TIMELINE, null))
  })

  it('the save body carries only width and height', () => {
    const body = buildVideoDraftSaveBody(DRAFT, 'v', SCENES, TIMELINE, { width: 1080, height: 1080 })
    expect(Object.keys(body.canvas ?? {}).sort()).toEqual(['height', 'width'])
    expect(JSON.stringify(body)).not.toMatch(/aspect|preset|zoom|pan|viewport|fit/i)
  })
})

describe('Presets are shortcuts; dimensions persist', () => {
  it('lists the four product presets with concrete dimensions', () => {
    expect(VIDEO_CANVAS_PRESETS.map(({ ratio, width, height }) => [ratio, width, height])).toEqual([
      ['9:16', 1080, 1920], ['4:5', 1080, 1350], ['1:1', 1080, 1080], ['16:9', 1920, 1080],
    ])
  })

  it('derives the preset label from dimensions; anything else is Personalizado', () => {
    expect(matchVideoCanvasPreset({ width: 1080, height: 1350 })?.id).toBe('portrait')
    expect(matchVideoCanvasPreset({ width: 1280, height: 720 })).toBeNull()
    expect(videoCanvasRatio({ width: 1920, height: 1080 })).toBe('16:9')
    expect(videoCanvasRatio({ width: 1280, height: 720 })).toBe('16:9')
    expect(videoCanvasRatio({ width: 1000, height: 1200 })).toBe('5:6')
    expect(sameVideoCanvas({ width: 1080, height: 1350 }, { width: 1080, height: 1350 })).toBe(true)
    expect(sameVideoCanvas(null, null)).toBe(true)
    expect(sameVideoCanvas(null, LEGACY_VIDEO_CANVAS)).toBe(false)
  })
})

describe('Custom dimensions are bounded truthfully', () => {
  it('accepts even integers within the platform bounds', () => {
    expect(validateVideoCanvas({ width: 1280, height: 720 })).toEqual({ ok: true, canvas: { width: 1280, height: 720 } })
    expect(validateVideoCanvas({ width: VIDEO_CANVAS_LIMITS.minSide, height: VIDEO_CANVAS_LIMITS.maxSide }).ok).toBe(true)
  })

  it('rejects odd, fractional, out-of-range, non-numeric and extra fields with a message', () => {
    const cases: unknown[] = [
      { width: 1081, height: 1920 }, { width: 1080.5, height: 1920 }, { width: 358, height: 1920 }, { width: 1080, height: 1922 },
      { width: 4096, height: 2160 }, { width: '1080', height: 1920 }, { width: 1080 }, { width: 1080, height: 1920, aspect_ratio: '9:16' },
      null, [1080, 1920], 'reel',
    ]
    for (const raw of cases) {
      const result = validateVideoCanvas(raw)
      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.message.length).toBeGreaterThan(0)
    }
  })

  it('the API validates the stage and treats an absent field as "keep"', () => {
    const route = read('app/api/video-drafts/route.ts')
    expect(route).toContain('validateVideoCanvas(raw)')
    expect(route.match(/Object\.hasOwn\(body, 'canvas'\)/g)?.length).toBe(2)
    expect(route).toContain("code: 'INVALID_VIDEO_CANVAS'")
  })
})

describe('Source media never defines the stage', () => {
  it('swapping a Scene image (any shape) leaves the stage untouched', () => {
    const swapped = SCENES.map((item) => (item.id === 's1' ? { ...item, library_file_id: '55555555-5555-5555-5555-555555555555' } : item))
    expect(snapshotFor({ width: 1080, height: 1350 }, swapped).specification).toEqual(snapshotFor({ width: 1080, height: 1350 }).specification)
    expect(snapshotFor(null, swapped).specification).toEqual(snapshotFor(null).specification)
  })

  it('nothing in the canvas path reads media dimensions', () => {
    for (const path of ['lib/creative/video-editor/video-canvas.ts', 'lib/render-execution/build-snapshot.ts']) {
      expect(read(path)).not.toMatch(/naturalWidth|videoWidth|image_width|media_width|file\.width/)
    }
  })
})

describe('Stage != preview viewport', () => {
  it('the editor feeds the stage to the viewport and keeps zoom/pan out of authored state', () => {
    const editor = read('app/(dashboard)/creative-editor/video/[draftId]/page.tsx')
    expect(editor).toContain('usePreviewViewport({ surfaceWidth: stage.width, surfaceHeight: stage.height')
    expect(editor).not.toMatch(/persistedVideoSnapshot\([^)]*(viewport|zoom|pan)/)
    expect(editor).not.toMatch(/buildVideoDraftSaveBody\([^)]*(viewport|zoom|pan)/)
    expect(editor).not.toContain('DEFAULT_TIMELINE_CANVAS')
    expect(editor).not.toContain('Reel 9:16')
  })
})

describe('Live Player and final render read the same stage', () => {
  it('the Live Player input and the render snapshot carry identical dimensions', () => {
    for (const canvas of [null, { width: 1080, height: 1350 }]) {
      const live = buildLivePreviewInput({ draft: DRAFT, scenes: SCENES, timeline: TIMELINE, canvas, identitySnapshot: IDENTITY, libraryFiles: new Map() })
      expect(live.ok).toBe(true)
      if (!live.ok) return
      expect(live.resolvedInput.manifest.specification).toEqual(snapshotFor(canvas).specification)
      expect(live.manifest).toEqual(snapshotFor(canvas))
    }
  })

  it('the render route freezes the saved stage into the snapshot', () => {
    const route = read('app/api/video-drafts/[id]/render/route.ts')
    expect(route).toContain("select('id, user_id, project_id, production_id, scenes, timeline, canvas')")
    expect(route).toContain('canvas: draft.canvas')
  })
})

describe('Template compatibility is the Template’s own declaration', () => {
  it('the Video Template family draws 9:16 and 4:5 only', () => {
    expect(videoTemplateCanvasSupport({ width: 1080, height: 1920 }).supported).toBe(true)
    expect(videoTemplateCanvasSupport({ width: 1080, height: 1350 }).supported).toBe(true)
    expect(videoTemplateCanvasSupport({ width: 1080, height: 1080 }).supported).toBe(false)
    expect(videoTemplateCanvasSupport({ width: 1920, height: 1080 }).supported).toBe(false)
    expect(videoTemplateCanvasSupport({ width: 1280, height: 720 }).supported).toBe(false)
    expect(videoTemplateCanvasSupport(LEGACY_VIDEO_CANVAS).supportedSizes).toEqual([{ width: 1080, height: 1350 }, { width: 1080, height: 1920 }])
  })

  it('an undeclared stage is platform-valid but the resolver refuses it before any preview or render', () => {
    const wide = { width: 1920, height: 1080 }
    expect(validateVideoCanvas(wide).ok).toBe(true)
    const live = buildLivePreviewInput({ draft: DRAFT, scenes: SCENES, timeline: TIMELINE, canvas: wide, identitySnapshot: IDENTITY, libraryFiles: new Map() })
    expect(live.ok).toBe(false)
    const resolved = resolveTimelineManifest(snapshotFor(wide), { identitySnapshot: IDENTITY })
    expect(resolved.valid).toBe(false)
    if (!resolved.valid) expect(resolved.errors.some((issue) => issue.code === 'canvas_not_supported')).toBe(true)
    expect(read('app/api/video-drafts/[id]/render/route.ts')).toContain("code: 'VIDEO_CANVAS_UNSUPPORTED_BY_TEMPLATE'")
  })
})

describe('Temporal authoring is untouched by the stage', () => {
  it('Scene durations, element timing, root items and audio keep their exact frames', () => {
    const legacy = snapshotFor(null)
    for (const canvas of [{ width: 1080, height: 1350 }, { width: 1920, height: 1080 }]) {
      const manifest = snapshotFor(canvas)
      expect(manifest.specification.duration_frames).toBe(legacy.specification.duration_frames)
      expect(manifest.segments.map(({ id, start_frame, duration_frames }) => [id, start_frame, duration_frames]))
        .toEqual(legacy.segments.map(({ id, start_frame, duration_frames }) => [id, start_frame, duration_frames]))
      const quote = manifest.segments.find((segment) => segment.id === 'scene:s2')
      expect(quote?.kind === 'template' ? quote.payload.element_timing : null).toEqual([
        { element_id: 'quote', start_frame: 15, duration_frames: 60 },
        { element_id: 'quoteText', start_frame: 15, duration_frames: 60 },
        { element_id: 'tape1', start_frame: 15, duration_frames: 60 },
        { element_id: 'callout', start_frame: 45, duration_frames: 75 },
        { element_id: 'calloutText', start_frame: 45, duration_frames: 75 },
      ])
      const bed = manifest.segments.find((segment) => segment.id === 'item:bed')
      expect(bed).toMatchObject({ start_frame: 0, duration_frames: legacy.specification.duration_frames })
    }
  })
})

describe('Static keeps its own canvas', () => {
  it('Static targets and the registry are unchanged by the Video stage', () => {
    expect(staticAuthoringTarget('instagram', 'carousel')).toMatchObject({ mode: 'static', canvas: { width: 1080, height: 1350 } })
    const documentary = listTemplates().find((template) => template.id === 'editorial.documentary-card')
    expect(documentary?.canvas_support).toEqual({ strategy: 'declared_sizes', sizes: [{ width: 1080, height: 1350, unit: 'px' }, { width: 1080, height: 1920, unit: 'px' }] })
    expect(read('lib/creative/context/static-authoring.ts')).not.toContain('video-canvas')
  })
})

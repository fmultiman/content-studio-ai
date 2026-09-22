import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  DEFAULT_HERO_ASSET_REF,
  DEFAULT_TIMELINE_FPS,
  adaptVideoDraftToTimelineManifest,
  movementToMotion,
  sceneToSegment,
  type AdaptVideoDraftInput,
} from '@/lib/creative/timeline-adapter/video-draft-to-timeline'
import { TimelineManifestSchema } from '@/lib/schemas/creative/timeline'
import { validateTimelineSemantics } from '@/lib/schemas/creative/validation'
import { resolveTimelineManifest } from '@/lib/creative/resolution/resolve-timeline'
import type { VideoDraft, VideoScene } from '@/lib/types'

const FIXTURE_IDENTITY = { snapshot_ref: 'fixture:identity:comunidades-alternativas:v1', token_profile: 'default' }

function makeScene(overrides: Partial<VideoScene> = {}): VideoScene {
  return {
    id: 'scene-1',
    order: 1,
    description: 'Uma pessoa caminha por uma trilha ao amanhecer.',
    prompt: 'cinematic wide shot, golden hour, walking path',
    image_url: null,
    duration: 3,
    movement: 'static',
    ...overrides,
  }
}

function makeDraft(scenes: VideoScene[], overrides: Partial<VideoDraft> = {}): AdaptVideoDraftInput['draft'] {
  return {
    id: 'draft-1111',
    project_id: 'project-aaaa',
    production_id: 'production-bbbb',
    scenes,
    ...overrides,
  }
}

describe('adaptVideoDraftToTimelineManifest — basic', () => {
  it('produces a valid TimelineManifest for a single-scene VideoDraft', () => {
    const draft = makeDraft([makeScene()])
    const { manifest } = adaptVideoDraftToTimelineManifest({ draft, identity: FIXTURE_IDENTITY })
    expect(manifest.schema_version).toBe('timeline.v0')
    expect(manifest.segments).toHaveLength(1)
  })

  it('is deterministic for the same input', () => {
    const draft = makeDraft([makeScene()])
    const first = adaptVideoDraftToTimelineManifest({ draft, identity: FIXTURE_IDENTITY })
    const second = adaptVideoDraftToTimelineManifest({ draft, identity: FIXTURE_IDENTITY })
    expect(first.manifest).toEqual(second.manifest)
  })

  it('emits schema_version "timeline.v0"', () => {
    const draft = makeDraft([makeScene()])
    const { manifest } = adaptVideoDraftToTimelineManifest({ draft, identity: FIXTURE_IDENTITY })
    expect(manifest.schema_version).toBe('timeline.v0')
  })

  it('carries the VideoDraft id as video_work_ref (the field TimelineManifest already reserves for this)', () => {
    const draft = makeDraft([makeScene()])
    const { manifest } = adaptVideoDraftToTimelineManifest({ draft, identity: FIXTURE_IDENTITY })
    expect(manifest.context.video_work_ref).toBe('draft-1111')
    expect(manifest.context.project_ref).toBe('project-aaaa')
    expect(manifest.context.production_ref).toBe('production-bbbb')
  })

  it('requires project_id and production_id to be present', () => {
    const draft = makeDraft([makeScene()], { project_id: null })
    expect(() => adaptVideoDraftToTimelineManifest({ draft, identity: FIXTURE_IDENTITY })).toThrow(/project_id/)
  })

  it('requires at least one scene', () => {
    const draft = makeDraft([])
    expect(() => adaptVideoDraftToTimelineManifest({ draft, identity: FIXTURE_IDENTITY })).toThrow(/at least one scene/)
  })
})

describe('adaptVideoDraftToTimelineManifest — time mapping', () => {
  it('converts scene.duration (seconds) to duration_frames using 30fps by default', () => {
    const draft = makeDraft([makeScene({ duration: 3 })])
    const { manifest } = adaptVideoDraftToTimelineManifest({ draft, identity: FIXTURE_IDENTITY })
    expect(DEFAULT_TIMELINE_FPS).toBe(30)
    expect(manifest.segments[0].duration_frames).toBe(90) // 3s * 30fps
  })

  it('places the single scene starting at frame 0', () => {
    const draft = makeDraft([makeScene({ duration: 5 })])
    const { manifest } = adaptVideoDraftToTimelineManifest({ draft, identity: FIXTURE_IDENTITY })
    expect(manifest.segments[0].start_frame).toBe(0)
  })

  it('sets the timeline total duration_frames to the segment duration for a single scene', () => {
    const draft = makeDraft([makeScene({ duration: 4 })])
    const { manifest } = adaptVideoDraftToTimelineManifest({ draft, identity: FIXTURE_IDENTITY })
    expect(manifest.specification.duration_frames).toBe(120) // 4s * 30fps
    expect(manifest.segments[0].start_frame + manifest.segments[0].duration_frames).toBe(manifest.specification.duration_frames)
  })

  it('respects a caller-supplied fps', () => {
    const draft = makeDraft([makeScene({ duration: 2 })])
    const { manifest } = adaptVideoDraftToTimelineManifest({ draft, identity: FIXTURE_IDENTITY, canvas: { width: 1080, height: 1920, fps: 24 } })
    expect(manifest.segments[0].duration_frames).toBe(48)
    expect(manifest.specification.fps).toBe(24)
  })
})

describe('adaptVideoDraftToTimelineManifest — order', () => {
  it('maps scene.order into sequence.index and scene count into sequence.total', () => {
    const scene = makeScene({ order: 1 })
    const { segment } = sceneToSegment(scene, 0, 30, 'video-main', 1, DEFAULT_HERO_ASSET_REF)
    expect(segment.kind).toBe('template')
    if (segment.kind === 'template') {
      expect(segment.payload.sequence).toEqual({ index: 1, total: 1 })
    }
  })

  it('does not hardcode segments[0] semantics — sceneToSegment works for an arbitrary start frame', () => {
    const scene = makeScene({ order: 2, duration: 2 })
    const { segment } = sceneToSegment(scene, 90, 30, 'video-main', 5, DEFAULT_HERO_ASSET_REF)
    expect(segment.start_frame).toBe(90)
    if (segment.kind === 'template') {
      expect(segment.payload.sequence).toEqual({ index: 2, total: 5 })
    }
  })
})

describe('movementToMotion', () => {
  it('maps "static" to the "none" preset', () => {
    expect(movementToMotion('static')).toEqual({ motion: { preset: 'none' }, diagnostic: null })
  })

  it('maps "zoom_in" to the "slow_push" preset (matches editorial.documentary-card capabilities and Wave 7 proof)', () => {
    expect(movementToMotion('zoom_in')).toEqual({ motion: { preset: 'slow_push' }, diagnostic: null })
  })

  it('maps pan/tilt movements to "slow_pan" with the matching direction (template-declared capability)', () => {
    expect(movementToMotion('pan_left').motion).toEqual({ preset: 'slow_pan', direction: 'left' })
    expect(movementToMotion('pan_right').motion).toEqual({ preset: 'slow_pan', direction: 'right' })
    expect(movementToMotion('tilt_up').motion).toEqual({ preset: 'slow_pan', direction: 'up' })
    expect(movementToMotion('tilt_down').motion).toEqual({ preset: 'slow_pan', direction: 'down' })
  })

  it('has no invented preset for "zoom_out" — falls back to "none" with an explicit diagnostic', () => {
    const result = movementToMotion('zoom_out')
    expect(result.motion).toEqual({ preset: 'none' })
    expect(result.diagnostic?.kind).toBe('motion_unsupported')
  })

  it('has no invented preset for "dolly" — falls back to "none" with an explicit diagnostic', () => {
    const result = movementToMotion('dolly')
    expect(result.motion).toEqual({ preset: 'none' })
    expect(result.diagnostic?.kind).toBe('motion_unsupported')
  })

  it('handles null/unknown movement explicitly rather than silently reinterpreting it', () => {
    const result = movementToMotion(null)
    expect(result.motion).toEqual({ preset: 'none' })
    expect(result.diagnostic?.code).toBe('movement_no_preset_equivalent')

    const unknown = movementToMotion('made_up_value')
    expect(unknown.diagnostic?.code).toBe('movement_no_preset_equivalent')
  })
})

describe('adaptVideoDraftToTimelineManifest — content boundary', () => {
  it('never places scene.description into the manifest content, and flags it as unused', () => {
    const draft = makeDraft([makeScene({ description: 'SENSITIVE_MARKER_DESCRIPTION' })])
    const { manifest, diagnostics } = adaptVideoDraftToTimelineManifest({ draft, identity: FIXTURE_IDENTITY })
    expect(JSON.stringify(manifest)).not.toContain('SENSITIVE_MARKER_DESCRIPTION')
    expect(diagnostics.some((d) => d.code === 'scene_description_not_used')).toBe(true)
  })

  it('never places scene.prompt into the manifest content, and flags it as unused', () => {
    const draft = makeDraft([makeScene({ prompt: 'SENSITIVE_MARKER_PROMPT' })])
    const { manifest, diagnostics } = adaptVideoDraftToTimelineManifest({ draft, identity: FIXTURE_IDENTITY })
    expect(JSON.stringify(manifest)).not.toContain('SENSITIVE_MARKER_PROMPT')
    expect(diagnostics.some((d) => d.code === 'scene_prompt_not_used')).toBe(true)
  })

  it('uses a positional placeholder title rather than fabricating one from scene text, and flags it as defaulted', () => {
    const draft = makeDraft([makeScene({ order: 3 })])
    const { manifest, diagnostics } = adaptVideoDraftToTimelineManifest({ draft, identity: FIXTURE_IDENTITY })
    const segment = manifest.segments[0]
    expect(segment.kind).toBe('template')
    if (segment.kind === 'template') {
      expect(segment.payload.content).toEqual({ title: 'Cena 3' })
    }
    expect(diagnostics.some((d) => d.code === 'content_title_placeholder')).toBe(true)
  })
})

describe('adaptVideoDraftToTimelineManifest — asset boundary', () => {
  it('accepts the fixture AssetRef for the hero slot', () => {
    const draft = makeDraft([makeScene()])
    const { manifest } = adaptVideoDraftToTimelineManifest({ draft, identity: FIXTURE_IDENTITY })
    const segment = manifest.segments[0]
    if (segment.kind === 'template') {
      expect(segment.payload.assets.hero).toEqual(DEFAULT_HERO_ASSET_REF)
      expect(segment.payload.assets.hero.type).toBe('fixture')
    }
  })

  it('never turns scene.image_url (base64) into the canonical manifest asset, even when present', () => {
    const draft = makeDraft([makeScene({ image_url: 'data:image/png;base64,SENSITIVE_BASE64_MARKER' })])
    const { manifest, diagnostics } = adaptVideoDraftToTimelineManifest({ draft, identity: FIXTURE_IDENTITY })
    expect(JSON.stringify(manifest)).not.toContain('SENSITIVE_BASE64_MARKER')
    expect(JSON.stringify(manifest)).not.toContain('base64')
    const segment = manifest.segments[0]
    if (segment.kind === 'template') {
      expect(segment.payload.assets.hero).toEqual(DEFAULT_HERO_ASSET_REF)
    }
    expect(diagnostics.some((d) => d.code === 'scene_image_url_not_used')).toBe(true)
  })

  it('does not flag image_url as unused when the scene has none', () => {
    const draft = makeDraft([makeScene({ image_url: null })])
    const { diagnostics } = adaptVideoDraftToTimelineManifest({ draft, identity: FIXTURE_IDENTITY })
    expect(diagnostics.some((d) => d.code === 'scene_image_url_not_used')).toBe(false)
  })
})

describe('adaptVideoDraftToTimelineManifest — template', () => {
  it('emits a valid, registered TemplateRef without leaking a React component name', () => {
    const draft = makeDraft([makeScene()])
    const { manifest } = adaptVideoDraftToTimelineManifest({ draft, identity: FIXTURE_IDENTITY })
    const segment = manifest.segments[0]
    expect(segment.kind).toBe('template')
    if (segment.kind === 'template') {
      expect(segment.payload.template).toEqual({ id: 'editorial.documentary-card', version: '0.1.0', variant: 'cover', scope: 'system' })
    }
    expect(JSON.stringify(manifest)).not.toMatch(/DocumentaryCard|Remotion|Composition/)
  })
})

describe('adaptVideoDraftToTimelineManifest — resolution', () => {
  it('validates through TimelineManifestSchema', () => {
    const draft = makeDraft([makeScene()])
    const { manifest } = adaptVideoDraftToTimelineManifest({ draft, identity: FIXTURE_IDENTITY })
    const parsed = TimelineManifestSchema.safeParse(manifest)
    expect(parsed.success).toBe(true)
  })

  it('passes timeline semantic validation (unique ids, track references, bounds)', () => {
    const draft = makeDraft([makeScene()])
    const { manifest } = adaptVideoDraftToTimelineManifest({ draft, identity: FIXTURE_IDENTITY })
    const result = validateTimelineSemantics(manifest)
    expect(result.issues.filter((i) => i.severity === 'error')).toEqual([])
  })

  it('is accepted end-to-end by resolveTimelineManifest (the real Shared Creative Core resolver)', () => {
    const draft = makeDraft([makeScene({ movement: 'zoom_in' })])
    const { manifest } = adaptVideoDraftToTimelineManifest({ draft, identity: FIXTURE_IDENTITY })
    const result = resolveTimelineManifest(manifest)
    expect(result.valid).toBe(true)
    if (result.valid) {
      expect(result.value.resolvedTemplateSegments).toHaveLength(1)
      expect(result.value.resolvedTemplateSegments[0].resolvedAssets.hero).toBeDefined()
    }
  })

  it('is accepted by resolveTimelineManifest for every mapped movement value', () => {
    const movements: Array<VideoScene['movement']> = ['static', 'zoom_in', 'pan_left', 'pan_right', 'tilt_up', 'tilt_down', 'zoom_out', 'dolly', null]
    for (const movement of movements) {
      const draft = makeDraft([makeScene({ movement })])
      const { manifest } = adaptVideoDraftToTimelineManifest({ draft, identity: FIXTURE_IDENTITY })
      const result = resolveTimelineManifest(manifest)
      expect(result.valid, `movement "${movement}" should resolve`).toBe(true)
    }
  })
})

describe('domain adapter boundary isolation', () => {
  const ADAPTER_DIR = join(process.cwd(), 'lib', 'creative', 'timeline-adapter')
  const FORBIDDEN_IMPORT_RE =
    /from\s+['"](remotion|@remotion\/[^'"]+|react|react-dom|next(?:\/[^'"]+)?|@\/lib\/supabase\/[^'"]+|@\/lib\/storage\/s3|@aws-sdk\/[^'"]+)['"]/

  function listFiles(dir: string, acc: string[] = []): string[] {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry)
      if (statSync(full).isDirectory()) listFiles(full, acc)
      else if (entry.endsWith('.ts')) acc.push(full)
    }
    return acc
  }

  it('never imports Supabase, S3, Remotion, React, or Next from the timeline-adapter module', () => {
    const offenders: string[] = []
    for (const file of listFiles(ADAPTER_DIR)) {
      const contents = readFileSync(file, 'utf8')
      if (FORBIDDEN_IMPORT_RE.test(contents)) offenders.push(file)
    }
    expect(offenders).toEqual([])
  })

  it('does not perform any fetch/network/filesystem call', () => {
    const contents = readFileSync(join(ADAPTER_DIR, 'video-draft-to-timeline.ts'), 'utf8')
    expect(contents).not.toMatch(/\bfetch\(|require\(['"]fs['"]\)|from ['"]node:fs['"]/)
  })
})

import { describe, expect, it } from 'vitest'
import { documentaryCardTimelinePreview } from '@/lib/creative/fixtures/timeline-preview-fixtures'
import {
  DEFAULT_VIDEO_RENDER_OPTIONS,
  OFFICIAL_TIMELINE_OUTPUT_PATH,
  resolveOfficialTimeline,
} from '@/scripts/creative/render-timeline-manifest'

describe('Wave 8 official TimelineManifest video path', () => {
  it('accepts the Wave 7 fixture and derives execution dimensions from the manifest', () => {
    const resolved = resolveOfficialTimeline(documentaryCardTimelinePreview)
    expect(resolved.manifest.specification).toStrictEqual({ width: 1080, height: 1920, fps: 30, duration_frames: 180 })
    expect(resolved.resolvedTemplateSegments[0].resolvedTemplate.descriptor.component_key).toBe('editorial.documentary-card')
    expect(resolved.resolvedTemplateSegments[0].segment.payload.motion).toMatchObject({ preset: 'slow_push' })
  })

  it('keeps renderer options outside the TimelineManifest', () => {
    expect(JSON.stringify(documentaryCardTimelinePreview)).not.toContain('codec')
    expect(JSON.stringify(documentaryCardTimelinePreview)).not.toContain('concurrency')
    expect(DEFAULT_VIDEO_RENDER_OPTIONS).toStrictEqual({ codec: 'h264', concurrency: 1 })
    expect(OFFICIAL_TIMELINE_OUTPUT_PATH).toBe('.tmp/creative/timeline-render/documentary-card-cover-1080x1920-a.mp4')
  })

  it('rejects invalid and missing-template manifests before bundling', () => {
    expect(() => resolveOfficialTimeline({})).toThrow(/could not be resolved/i)
    const [templateSegment] = documentaryCardTimelinePreview.segments
    if (templateSegment.kind !== 'template') throw new Error('fixture drift: expected template segment')
    expect(() => resolveOfficialTimeline({
      ...documentaryCardTimelinePreview,
      segments: [{
        ...templateSegment,
        payload: { ...templateSegment.payload, template: { ...templateSegment.payload.template, id: 'missing.template' } },
      }],
    })).toThrow(/could not be resolved/i)
  })

  it('fails predictably when an unsupported required segment is present', () => {
    const manifest = {
      ...documentaryCardTimelinePreview,
      segments: [...documentaryCardTimelinePreview.segments, {
        id: 'audio-required', track_id: 'visual-main', start_frame: 0, duration_frames: 180,
        kind: 'audio' as const, payload: { asset_ref: 'fixture:asset:missing' },
      }],
    }
    expect(() => resolveOfficialTimeline(manifest)).toThrow(/unsupported/i)
  })
})

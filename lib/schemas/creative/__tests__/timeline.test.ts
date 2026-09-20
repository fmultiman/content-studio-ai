import { describe, expect, it } from 'vitest'
import { TimelineManifestSchema } from '../timeline'
import { validateTimelineSemantics } from '../validation'
import { validNeutralTimelineManifest, validPortalTimelineManifest } from './fixtures'

describe('TimelineManifestSchema (structural)', () => {
  it('accepts the Portal fixture', () => {
    expect(TimelineManifestSchema.safeParse(validPortalTimelineManifest).success).toBe(true)
  })

  it('accepts a fully neutral, non-Portal fixture (second project)', () => {
    expect(TimelineManifestSchema.safeParse(validNeutralTimelineManifest).success).toBe(true)
  })

  it('accepts a manifest without the optional video_work_ref (decision C2)', () => {
    const result = TimelineManifestSchema.safeParse(validPortalTimelineManifest)
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.context.video_work_ref).toBeUndefined()
    }
  })

  it('rejects an incorrect schema_version', () => {
    const result = TimelineManifestSchema.safeParse({
      ...validPortalTimelineManifest,
      schema_version: 'timeline.v1',
    })
    expect(result.success).toBe(false)
  })

  it('rejects an empty tracks array', () => {
    const result = TimelineManifestSchema.safeParse({
      ...validPortalTimelineManifest,
      tracks: [],
    })
    expect(result.success).toBe(false)
  })

  it('rejects a zero-duration segment', () => {
    const manifest = validPortalTimelineManifest
    const [segment] = manifest.segments
    const result = TimelineManifestSchema.safeParse({
      ...manifest,
      segments: [{ ...segment, duration_frames: 0 }],
    })
    expect(result.success).toBe(false)
  })

  it('rejects a segment with an unknown discriminant kind', () => {
    const manifest = validPortalTimelineManifest
    const [segment] = manifest.segments
    const result = TimelineManifestSchema.safeParse({
      ...manifest,
      segments: [{ ...segment, kind: 'transition', payload: {} }],
    })
    expect(result.success).toBe(false)
  })

  it('rejects an unknown root field (.strict())', () => {
    const result = TimelineManifestSchema.safeParse({
      ...validPortalTimelineManifest,
      video_work_ref_placeholder: 'not-allowed',
    })
    expect(result.success).toBe(false)
  })

  it('rejects a template segment whose sequence.index exceeds total', () => {
    const manifest = validPortalTimelineManifest
    const [segment] = manifest.segments
    if (segment.kind !== 'template') throw new Error('fixture drift: expected a template segment')
    const result = TimelineManifestSchema.safeParse({
      ...manifest,
      segments: [
        {
          ...segment,
          payload: { ...segment.payload, sequence: { index: 11, total: 10 } },
        },
      ],
    })
    expect(result.success).toBe(false)
  })
})

describe('validateTimelineSemantics (post-parse)', () => {
  it('accepts the Portal fixture with no issues', () => {
    const parsed = TimelineManifestSchema.parse(validPortalTimelineManifest)
    const result = validateTimelineSemantics(parsed)
    expect(result.valid).toBe(true)
    expect(result.issues).toEqual([])
  })

  it('rejects a segment referencing a non-existent track', () => {
    const parsed = TimelineManifestSchema.parse(validPortalTimelineManifest)
    const result = validateTimelineSemantics({
      ...parsed,
      segments: [{ ...parsed.segments[0], track_id: 'does-not-exist' }],
    })
    expect(result.valid).toBe(false)
    expect(result.issues.map((issue) => issue.code)).toContain('segment_track_not_found')
  })

  it('rejects a segment that ends after the timeline duration', () => {
    const parsed = TimelineManifestSchema.parse(validPortalTimelineManifest)
    const result = validateTimelineSemantics({
      ...parsed,
      segments: [{ ...parsed.segments[0], start_frame: 100, duration_frames: 180 }],
    })
    expect(result.valid).toBe(false)
    expect(result.issues.map((issue) => issue.code)).toContain('segment_out_of_bounds')
  })

  it('rejects duplicate track ids', () => {
    const parsed = TimelineManifestSchema.parse(validPortalTimelineManifest)
    const result = validateTimelineSemantics({
      ...parsed,
      tracks: [...parsed.tracks, { ...parsed.tracks[0] }],
    })
    expect(result.valid).toBe(false)
    expect(result.issues.map((issue) => issue.code)).toContain('duplicate_track_id')
  })

  it('rejects duplicate segment ids', () => {
    const parsed = TimelineManifestSchema.parse(validPortalTimelineManifest)
    const result = validateTimelineSemantics({
      ...parsed,
      segments: [...parsed.segments, { ...parsed.segments[0] }],
    })
    expect(result.valid).toBe(false)
    expect(result.issues.map((issue) => issue.code)).toContain('duplicate_segment_id')
  })

  it('rejects a media segment where source_out_frame <= source_in_frame', () => {
    const parsed = TimelineManifestSchema.parse({
      ...validPortalTimelineManifest,
      segments: [
        {
          id: 'media-01',
          track_id: 'visual-main',
          start_frame: 0,
          duration_frames: 60,
          kind: 'media' as const,
          payload: { asset_ref: 'fixture:asset:b-roll-01', source_in_frame: 100, source_out_frame: 50 },
        },
      ],
    })
    const result = validateTimelineSemantics(parsed)
    expect(result.valid).toBe(false)
    expect(result.issues.map((issue) => issue.code)).toContain('invalid_source_range')
  })
})

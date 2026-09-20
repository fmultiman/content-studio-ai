import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { documentaryCardFadeTimelinePreview, documentaryCardTimelinePreview } from '@/lib/creative/fixtures/timeline-preview-fixtures'
import { resolveTimelineManifest } from '@/lib/creative/resolution/resolve-timeline'
import { timelineAdapterDiagnostics, TemplateSegment, segmentFrameState } from '@/remotion/timeline'

describe('Wave 7 Timeline adapter', () => {
  it('resolves the canonical 180-frame fixture through neutral resolution', () => {
    const result = resolveTimelineManifest(documentaryCardTimelinePreview)
    expect(result.valid).toBe(true)
    if (!result.valid) return
    expect(result.value.manifest.specification).toMatchObject({ width: 1080, height: 1920, fps: 30, duration_frames: 180 })
    expect(result.value.resolvedTemplateSegments).toHaveLength(1)
    expect(result.value.resolvedTemplateSegments[0].resolvedTemplate.descriptor.component_key).toBe('editorial.documentary-card')
    expect(result.value.resolvedTemplateSegments[0].segment.payload.sequence).toStrictEqual({ index: 1, total: 10 })
  })

  it('keeps identity B on the same template branch', () => {
    const result = resolveTimelineManifest(documentaryCardFadeTimelinePreview)
    expect(result.valid).toBe(true)
    if (!result.valid) return
    expect(result.value.tokens.snapshot_ref).toContain('acme-labs')
    expect(result.value.resolvedTemplateSegments[0].resolvedTemplate.descriptor.component_key).toBe('editorial.documentary-card')
  })

  it.each([
    [-1, false, null],
    [0, true, 0],
    [90, true, 90],
    [179, true, 179],
    [180, false, null],
  ])('calculates segment boundaries for global frame %s', (globalFrame, visible, localFrame) => {
    expect(segmentFrameState(globalFrame, 0, 180)).toMatchObject({ visible, localFrame })
  })

  it('translates slow_push through local frame into a deterministic hero transform', () => {
    const result = resolveTimelineManifest(documentaryCardTimelinePreview)
    expect(result.valid).toBe(true)
    if (!result.valid) return
    const segment = result.value.resolvedTemplateSegments[0]
    const atStart = renderToStaticMarkup(createElement(TemplateSegment, { globalFrame: 0, resolvedInput: result.value, resolvedSegment: segment }))
    const atMiddle = renderToStaticMarkup(createElement(TemplateSegment, { globalFrame: 90, resolvedInput: result.value, resolvedSegment: segment }))
    const atMiddleAgain = renderToStaticMarkup(createElement(TemplateSegment, { globalFrame: 90, resolvedInput: result.value, resolvedSegment: segment }))
    expect(atStart).toContain('scale(1)')
    expect(atMiddle).toContain('scale(1.03')
    expect(atMiddle).toBe(atMiddleAgain)
    expect(atStart).not.toBe(atMiddle)
    expect(renderToStaticMarkup(createElement(TemplateSegment, { globalFrame: 180, resolvedInput: result.value, resolvedSegment: segment }))).toBe('')
  })

  it('translates fade through frame-aware DocumentaryCard video mode', () => {
    const result = resolveTimelineManifest(documentaryCardFadeTimelinePreview)
    expect(result.valid).toBe(true)
    if (!result.valid) return
    const segment = result.value.resolvedTemplateSegments[0]
    const atStart = renderToStaticMarkup(createElement(TemplateSegment, { globalFrame: 0, resolvedInput: result.value, resolvedSegment: segment }))
    const atMiddle = renderToStaticMarkup(createElement(TemplateSegment, { globalFrame: 90, resolvedInput: result.value, resolvedSegment: segment }))
    expect(atStart).toContain('opacity:0')
    expect(atMiddle).toContain('opacity:1')
    expect(atStart).not.toBe(atMiddle)
  })

  it('keeps none motion stable across frames', () => {
    const noMotion = {
      ...documentaryCardTimelinePreview,
      segments: [{
        ...documentaryCardTimelinePreview.segments[0],
        payload: { ...documentaryCardTimelinePreview.segments[0].payload, motion: { preset: 'none' as const } },
      }],
    }
    const result = resolveTimelineManifest(noMotion)
    expect(result.valid).toBe(true)
    if (!result.valid) return
    const segment = result.value.resolvedTemplateSegments[0]
    const atStart = renderToStaticMarkup(createElement(TemplateSegment, { globalFrame: 0, resolvedInput: result.value, resolvedSegment: segment }))
    const atMiddle = renderToStaticMarkup(createElement(TemplateSegment, { globalFrame: 90, resolvedInput: result.value, resolvedSegment: segment }))
    expect(atStart).toBe(atMiddle)
  })

  it('does not mutate the neutral manifest and reports unsupported kinds explicitly', () => {
    const before = JSON.stringify(documentaryCardTimelinePreview)
    const result = resolveTimelineManifest(documentaryCardTimelinePreview)
    expect(JSON.stringify(documentaryCardTimelinePreview)).toBe(before)
    expect(result.valid).toBe(true)
    if (!result.valid) return
    expect(timelineAdapterDiagnostics(result.value)).toEqual([])

    const withAudio = {
      ...documentaryCardTimelinePreview,
      segments: [...documentaryCardTimelinePreview.segments, {
        id: 'audio-deferred', track_id: 'visual-main', start_frame: 0, duration_frames: 10,
        kind: 'audio' as const, payload: { asset_ref: 'fixture:asset:missing' },
      }],
    }
    const resolvedWithAudio = resolveTimelineManifest(withAudio)
    expect(resolvedWithAudio.valid).toBe(true)
    if (resolvedWithAudio.valid) {
      expect(timelineAdapterDiagnostics(resolvedWithAudio.value)).toEqual([
        expect.objectContaining({ code: 'unsupported_segment_kind', segment_id: 'audio-deferred' }),
      ])
    }
  })
})

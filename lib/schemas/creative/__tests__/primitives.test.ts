import { describe, expect, it } from 'vitest'
import {
  AssetRefSchema,
  CanvasSpecSchema,
  FocalPointSchema,
  MotionSpecSchema,
  SequenceContextSchema,
  TemplateRefSchema,
  TransitionSpecSchema,
} from '../primitives'

describe('CanvasSpecSchema', () => {
  it('accepts a valid canvas', () => {
    const result = CanvasSpecSchema.safeParse({ width: 1080, height: 1350, unit: 'px' })
    expect(result.success).toBe(true)
  })

  it('rejects non-positive dimensions', () => {
    const result = CanvasSpecSchema.safeParse({ width: -1, height: 1350, unit: 'px' })
    expect(result.success).toBe(false)
  })

  it('rejects a fractional dimension', () => {
    const result = CanvasSpecSchema.safeParse({ width: 1080.5, height: 1350, unit: 'px' })
    expect(result.success).toBe(false)
  })

  it('rejects an unknown unit', () => {
    const result = CanvasSpecSchema.safeParse({ width: 1080, height: 1350, unit: 'in' })
    expect(result.success).toBe(false)
  })

  it('rejects an unknown field (.strict())', () => {
    const result = CanvasSpecSchema.safeParse({ width: 1080, height: 1350, unit: 'px', aspectRatio: '4:5' })
    expect(result.success).toBe(false)
  })
})

describe('TemplateRefSchema', () => {
  it('accepts a valid system template ref', () => {
    const result = TemplateRefSchema.safeParse({
      id: 'editorial.documentary-card',
      version: '0.1.0',
      variant: 'cover',
      scope: 'system',
    })
    expect(result.success).toBe(true)
  })

  it('rejects a ref missing version', () => {
    const result = TemplateRefSchema.safeParse({
      id: 'editorial.documentary-card',
      scope: 'system',
    })
    expect(result.success).toBe(false)
  })

  it('rejects an unknown scope', () => {
    const result = TemplateRefSchema.safeParse({
      id: 'editorial.documentary-card',
      version: '0.1.0',
      scope: 'portal',
    })
    expect(result.success).toBe(false)
  })
})

describe('AssetRefSchema', () => {
  it('accepts a valid fixture asset', () => {
    const result = AssetRefSchema.safeParse({
      type: 'fixture',
      ref: 'fixture:asset:hero-01',
      fit: 'cover',
      focal_point: { x: 0.5, y: 0.4 },
    })
    expect(result.success).toBe(true)
  })

  it('rejects an asset missing ref', () => {
    const result = AssetRefSchema.safeParse({ type: 'fixture' })
    expect(result.success).toBe(false)
  })

  it('rejects an unknown type', () => {
    const result = AssetRefSchema.safeParse({ type: 'unknown', ref: 'x' })
    expect(result.success).toBe(false)
  })

  it('does not carry a generic role field (decision C7)', () => {
    const shape = AssetRefSchema.shape as Record<string, unknown>
    expect(Object.keys(shape)).not.toContain('role')
  })
})

describe('FocalPointSchema', () => {
  it('accepts coordinates within 0..1', () => {
    expect(FocalPointSchema.safeParse({ x: 0, y: 1 }).success).toBe(true)
  })

  it('rejects out-of-range coordinates', () => {
    expect(FocalPointSchema.safeParse({ x: 1.2, y: 0.5 }).success).toBe(false)
  })
})

describe('SequenceContextSchema (decision C7)', () => {
  it('accepts index <= total', () => {
    expect(SequenceContextSchema.safeParse({ index: 1, total: 10 }).success).toBe(true)
    expect(SequenceContextSchema.safeParse({ index: 10, total: 10 }).success).toBe(true)
  })

  it('rejects index > total', () => {
    const result = SequenceContextSchema.safeParse({ index: 11, total: 10 })
    expect(result.success).toBe(false)
  })

  it('rejects non-positive index/total', () => {
    expect(SequenceContextSchema.safeParse({ index: 0, total: 10 }).success).toBe(false)
    expect(SequenceContextSchema.safeParse({ index: 1, total: 0 }).success).toBe(false)
  })

  it('rejects an unknown field (.strict())', () => {
    const result = SequenceContextSchema.safeParse({ index: 1, total: 10, appearance: 'capsule' })
    expect(result.success).toBe(false)
  })
})

describe('MotionSpecSchema / TransitionSpecSchema', () => {
  it('accepts a supported preset', () => {
    expect(MotionSpecSchema.safeParse({ preset: 'slow_push', intensity: 0.35 }).success).toBe(true)
  })

  it('rejects an unsupported preset', () => {
    expect(MotionSpecSchema.safeParse({ preset: 'zoom_in' }).success).toBe(false)
  })

  it('rejects intensity outside 0..1', () => {
    expect(MotionSpecSchema.safeParse({ preset: 'fade', intensity: 1.5 }).success).toBe(false)
  })

  it('accepts a valid transition', () => {
    expect(TransitionSpecSchema.safeParse({ preset: 'crossfade', duration_frames: 12 }).success).toBe(true)
  })

  it('rejects an unsupported transition preset', () => {
    expect(TransitionSpecSchema.safeParse({ preset: 'wipe' }).success).toBe(false)
  })
})

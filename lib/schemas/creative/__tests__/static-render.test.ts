import { describe, expect, it } from 'vitest'
import { StaticRenderManifestSchema } from '../static-render'
import { validNeutralStaticRenderManifest, validPortalStaticRenderManifest } from './fixtures'

describe('StaticRenderManifestSchema', () => {
  it('accepts the Portal fixture', () => {
    const result = StaticRenderManifestSchema.safeParse(validPortalStaticRenderManifest)
    expect(result.success).toBe(true)
  })

  it('accepts a fully neutral, non-Portal fixture (second project)', () => {
    const result = StaticRenderManifestSchema.safeParse(validNeutralStaticRenderManifest)
    expect(result.success).toBe(true)
  })

  it('accepts a manifest without the optional sequence field', () => {
    const { sequence: _sequence, ...withoutSequence } = validPortalStaticRenderManifest
    const result = StaticRenderManifestSchema.safeParse(withoutSequence)
    expect(result.success).toBe(true)
  })

  it('rejects an incorrect schema_version', () => {
    const result = StaticRenderManifestSchema.safeParse({
      ...validPortalStaticRenderManifest,
      schema_version: 'static-render.v1',
    })
    expect(result.success).toBe(false)
  })

  it('rejects a negative canvas dimension', () => {
    const result = StaticRenderManifestSchema.safeParse({
      ...validPortalStaticRenderManifest,
      canvas: { width: -1080, height: 1350, unit: 'px' },
    })
    expect(result.success).toBe(false)
  })

  it('rejects a template ref missing version', () => {
    const { version: _version, ...templateWithoutVersion } = validPortalStaticRenderManifest.template
    const result = StaticRenderManifestSchema.safeParse({
      ...validPortalStaticRenderManifest,
      template: templateWithoutVersion,
    })
    expect(result.success).toBe(false)
  })

  it('rejects an asset ref missing ref', () => {
    const result = StaticRenderManifestSchema.safeParse({
      ...validPortalStaticRenderManifest,
      assets: { hero: { type: 'fixture' } },
    })
    expect(result.success).toBe(false)
  })

  it('rejects an unknown root field (.strict())', () => {
    const result = StaticRenderManifestSchema.safeParse({
      ...validPortalStaticRenderManifest,
      composition: { density: 'balanced', artifact_plan: 'cover-collage-01' },
    })
    expect(result.success).toBe(false)
  })

  it('rejects sequence.index greater than sequence.total', () => {
    const result = StaticRenderManifestSchema.safeParse({
      ...validPortalStaticRenderManifest,
      sequence: { index: 11, total: 10 },
    })
    expect(result.success).toBe(false)
  })

  it('does not require production_ref', () => {
    const { production_ref: _productionRef, ...contextWithoutProduction } =
      validPortalStaticRenderManifest.context
    const result = StaticRenderManifestSchema.safeParse({
      ...validPortalStaticRenderManifest,
      context: contextWithoutProduction,
    })
    expect(result.success).toBe(true)
  })
})

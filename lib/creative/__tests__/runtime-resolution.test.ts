import { describe, expect, it } from 'vitest'
import {
  listTemplates,
  resolveTemplate,
  selectTemplateBindingSchemas,
  validateTemplateAssetBindings,
  validateTemplateCanvas,
  validateTemplateContent,
  validateTemplateMotion,
} from '@/lib/creative/templates/registry'
import { IDENTITY_FIXTURES } from '@/lib/creative/identity/fixtures'
import { resolveIdentitySnapshot } from '@/lib/creative/identity/resolve-identity-snapshot'
import { resolveAsset } from '@/lib/creative/assets/resolve-asset'
import { resolveStaticRenderManifest } from '@/lib/creative/resolution/resolve-static-render'
import { resolveTimelineManifest } from '@/lib/creative/resolution/resolve-timeline'
import {
  validNeutralStaticRenderManifest,
  validPortalStaticRenderManifest,
  validPortalTimelineManifest,
} from '@/lib/schemas/creative/__tests__/fixtures'

const documentaryCoverRef = validPortalStaticRenderManifest.template

describe('Wave 3 template registry', () => {
  it('resolves the registered documentary-card template and descriptor', () => {
    const result = resolveTemplate(documentaryCoverRef)
    expect(result.valid).toBe(true)
    if (!result.valid) return
    expect(result.value.descriptor.id).toBe('editorial.documentary-card')
    expect(result.value.descriptor.version).toBe('0.1.0')
    expect(result.value.descriptor.scope).toBe('system')
    expect(result.value.descriptor.component_key).toBe('editorial.documentary-card')
    expect(selectTemplateBindingSchemas(result.value).valid).toBe(true)
    expect(listTemplates()).toHaveLength(1)
  })

  it.each([
    ['missing id', { ...documentaryCoverRef, id: 'missing.template' }, 'template_not_found'],
    ['missing version', { ...documentaryCoverRef, version: '9.9.9' }, 'template_version_not_found'],
    ['invalid variant', { ...documentaryCoverRef, variant: 'standard' }, 'variant_not_supported'],
  ])('%s fails with a structured registry error', (_label, ref, code) => {
    const result = resolveTemplate(ref)
    expect(result.valid).toBe(false)
    if (result.valid) return
    expect(result.error.code).toBe(code)
  })

  it('selects the cover and info schemas and validates canvas/motion capabilities', () => {
    const cover = resolveTemplate(documentaryCoverRef)
    const info = resolveTemplate({ ...documentaryCoverRef, variant: 'info' })
    expect(cover.valid && info.valid).toBe(true)
    if (!cover.valid || !info.valid) return

    expect(validateTemplateContent(cover.value, { title: 'A cover' }).valid).toBe(true)
    expect(validateTemplateContent(info.value, {
      title: 'An info card',
      body_blocks: ['Paragraph'],
      fact_cards: [{ primary: 'One fact' }],
    }).valid).toBe(true)
    expect(validateTemplateCanvas(cover.value, { width: 1080, height: 1350, unit: 'px' }).valid).toBe(true)
    expect(validateTemplateCanvas(cover.value, { width: 800, height: 800, unit: 'px' }).valid).toBe(false)
    expect(validateTemplateMotion(cover.value, { preset: 'reveal' }).valid).toBe(false)
  })
})

describe('Wave 3 fixture identity and asset resolvers', () => {
  it('resolves both deterministic identity snapshots with different tokens', () => {
    const first = resolveIdentitySnapshot({ snapshot_ref: IDENTITY_FIXTURES[0].snapshot_ref })
    const second = resolveIdentitySnapshot({ snapshot_ref: IDENTITY_FIXTURES[1].snapshot_ref })
    expect(first.valid).toBe(true)
    expect(second.valid).toBe(true)
    if (!first.valid || !second.valid) return
    expect(first.value).not.toEqual(second.value)
    expect(first.value.colors.background).not.toBe(second.value.colors.background)
  })

  it('fails missing identity, missing fixture asset, and unsupported asset types explicitly', () => {
    const identity = resolveIdentitySnapshot({ snapshot_ref: 'fixture:identity:missing:v1' })
    expect(identity.valid).toBe(false)
    if (!identity.valid) expect(identity.error.code).toBe('identity_not_found')

    const missing = resolveAsset({ type: 'fixture', ref: 'fixture:asset:missing' })
    expect(missing.valid).toBe(false)
    if (!missing.valid) expect(missing.error.code).toBe('asset_not_found')

    const unsupported = resolveAsset({ type: 'external', ref: 'https://example.invalid/asset.png' })
    expect(unsupported.valid).toBe(false)
    if (!unsupported.valid) expect(unsupported.error.code).toBe('asset_type_not_supported')
  })

  it('resolves a local fixture asset to runtime metadata without external IO', () => {
    const result = resolveAsset(validPortalStaticRenderManifest.assets.hero)
    expect(result.valid).toBe(true)
    if (!result.valid) return
    expect(result.value.source).toBe('fixture')
    expect(result.value.mime_type).toBe('image/svg+xml')
    expect(result.value.width).toBe(1080)
    expect(result.value.path).toContain('public/creative-fixtures/')
  })
})

describe('Wave 3 static resolution', () => {
  it('resolves cover and second-project static manifests through the same pipeline', () => {
    const cover = resolveStaticRenderManifest(validPortalStaticRenderManifest)
    const secondProject = resolveStaticRenderManifest(validNeutralStaticRenderManifest)
    expect(cover.valid).toBe(true)
    expect(secondProject.valid).toBe(true)
    if (!cover.valid || !secondProject.valid) return
    expect(cover.value.resolvedTemplate.descriptor.id).toBe('editorial.documentary-card')
    expect(cover.value.resolvedAssets.hero.url).toContain('creative-fixtures')
    expect(cover.value.tokens.snapshot_ref).not.toBe(secondProject.value.tokens.snapshot_ref)
    expect(secondProject.value.tokens.colors.background).not.toBe(cover.value.tokens.colors.background)
  })

  it('returns schema, binding, identity, and asset diagnostics predictably', () => {
    const noHero = {
      ...validPortalStaticRenderManifest,
      assets: {},
    }
    const invalidContent = {
      ...validPortalStaticRenderManifest,
      content: { subtitle: 'missing title' },
    }
    const missingIdentity = {
      ...validPortalStaticRenderManifest,
      identity: { snapshot_ref: 'fixture:identity:missing:v1' },
    }
    const missingAsset = {
      ...validPortalStaticRenderManifest,
      assets: { hero: { type: 'fixture' as const, ref: 'fixture:asset:missing' } },
    }

    expect(resolveStaticRenderManifest(noHero).errors[0]).toMatchObject({ kind: 'binding_error', code: 'asset_binding_invalid' })
    expect(resolveStaticRenderManifest(invalidContent).errors[0]).toMatchObject({ kind: 'binding_error', code: 'content_invalid' })
    expect(resolveStaticRenderManifest(missingIdentity).errors[0]).toMatchObject({ kind: 'identity_error', code: 'identity_not_found' })
    expect(resolveStaticRenderManifest(missingAsset).errors[0]).toMatchObject({ kind: 'asset_error', code: 'asset_not_found' })
    expect(resolveStaticRenderManifest({ ...validPortalStaticRenderManifest, schema_version: 'wrong' }).errors[0].kind).toBe('schema_error')
  })

  it('resolves info with no hero and rejects content that belongs to another variant', () => {
    const info = {
      ...validPortalStaticRenderManifest,
      template: { ...validPortalStaticRenderManifest.template, variant: 'info' },
      content: {
        title: 'Context',
        body_blocks: ['One paragraph'],
        fact_cards: [{ primary: 'One fact' }],
      },
      assets: {},
    }
    const result = resolveStaticRenderManifest(info)
    expect(result.valid).toBe(true)
    expect(resolveStaticRenderManifest({ ...info, content: { title: 'Context', body_blocks: [], fact_cards: [] } }).valid).toBe(false)
  })
})

describe('Wave 3 timeline resolution', () => {
  it('resolves the minimum 1080x1920/30fps/180-frame template timeline', () => {
    const result = resolveTimelineManifest(validPortalTimelineManifest)
    expect(result.valid).toBe(true)
    if (!result.valid) return
    expect(result.value.manifest.specification).toMatchObject({ width: 1080, height: 1920, fps: 30, duration_frames: 180 })
    expect(result.value.resolvedTemplateSegments).toHaveLength(1)
    expect(result.value.resolvedTemplateSegments[0].resolvedAssets.hero.mime_type).toBe('image/svg+xml')
    expect(JSON.stringify(result.value)).not.toMatch(/remotion/i)
  })

  it('rejects invalid template content, motion, and missing assets', () => {
    const invalidContent = {
      ...validPortalTimelineManifest,
      segments: [{
        ...validPortalTimelineManifest.segments[0],
        kind: 'template' as const,
        payload: { ...validPortalTimelineManifest.segments[0].payload, content: { subtitle: 'missing title' } },
      }],
    }
    const invalidMotion = {
      ...validPortalTimelineManifest,
      segments: [{
        ...validPortalTimelineManifest.segments[0],
        kind: 'template' as const,
        payload: { ...validPortalTimelineManifest.segments[0].payload, motion: { preset: 'reveal' as const } },
      }],
    }
    const missingAsset = {
      ...validPortalTimelineManifest,
      segments: [{
        ...validPortalTimelineManifest.segments[0],
        kind: 'template' as const,
        payload: {
          ...validPortalTimelineManifest.segments[0].payload,
          assets: { hero: { type: 'fixture' as const, ref: 'fixture:asset:missing' } },
        },
      }],
    }

    expect(resolveTimelineManifest(invalidContent).errors).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'binding_error', code: 'content_invalid' }),
    ]))
    expect(resolveTimelineManifest(invalidMotion).errors).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'template_error', code: 'motion_not_supported' }),
    ]))
    expect(resolveTimelineManifest(missingAsset).errors).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'asset_error', code: 'asset_not_found' }),
    ]))
  })
})

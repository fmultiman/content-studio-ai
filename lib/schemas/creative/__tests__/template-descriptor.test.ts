import { describe, expect, it } from 'vitest'
import { TemplateDescriptorSchema } from '../template-descriptor'

const validDescriptor = {
  id: 'editorial.documentary-card',
  version: '0.1.0',
  scope: 'system' as const,
  label: 'Documentary Card',
  supported_modes: ['still', 'video'] as const,
  variants: ['cover', 'info'],
  canvas_support: {
    strategy: 'declared_sizes' as const,
    sizes: [
      { width: 1080, height: 1350, unit: 'px' as const },
      { width: 1080, height: 1920, unit: 'px' as const },
    ],
  },
  schemas: {
    content: 'editorial.documentary-card.content.v0',
    assets: 'editorial.documentary-card.assets.v0',
  },
  capabilities: {
    motion_presets: ['none', 'fade', 'slow_push'] as const,
    supports_transparency: false,
  },
  identity_requirements: ['typography.display', 'typography.body'],
  text_policy: { default_overflow_policy: 'human_review' as const },
  component_key: 'editorial-documentary-card',
}

describe('TemplateDescriptorSchema', () => {
  it('accepts a valid descriptor with declared_sizes canvas support', () => {
    expect(TemplateDescriptorSchema.safeParse(validDescriptor).success).toBe(true)
  })

  it('announces only cover and info as variants (decision C5 — no "standard")', () => {
    expect(validDescriptor.variants).toEqual(['cover', 'info'])
  })

  it('applies default identity_requirements when omitted', () => {
    const { identity_requirements: _identityRequirements, ...withoutRequirements } = validDescriptor
    const result = TemplateDescriptorSchema.safeParse(withoutRequirements)
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.identity_requirements).toEqual([])
    }
  })

  it('rejects an id with uppercase characters', () => {
    const result = TemplateDescriptorSchema.safeParse({ ...validDescriptor, id: 'Editorial.DocumentaryCard' })
    expect(result.success).toBe(false)
  })

  it('rejects an unsupported mode', () => {
    const result = TemplateDescriptorSchema.safeParse({ ...validDescriptor, supported_modes: ['gif'] })
    expect(result.success).toBe(false)
  })

  it('rejects an empty variants array', () => {
    const result = TemplateDescriptorSchema.safeParse({ ...validDescriptor, variants: [] })
    expect(result.success).toBe(false)
  })

  it('accepts a fixed canvas support strategy', () => {
    const result = TemplateDescriptorSchema.safeParse({
      ...validDescriptor,
      canvas_support: { strategy: 'fixed', size: { width: 1080, height: 1080, unit: 'px' } },
    })
    expect(result.success).toBe(true)
  })

  it('rejects an unknown canvas_support strategy', () => {
    const result = TemplateDescriptorSchema.safeParse({
      ...validDescriptor,
      canvas_support: { strategy: 'responsive' },
    })
    expect(result.success).toBe(false)
  })

  it('rejects an unknown root field (.strict())', () => {
    const result = TemplateDescriptorSchema.safeParse({ ...validDescriptor, portalOverride: true })
    expect(result.success).toBe(false)
  })
})

import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { QuoteCardContentSchema } from '@/lib/schemas/creative/quote-card'
import { resolveStaticRenderManifest } from '@/lib/creative/resolution/resolve-static-render'
import { resolveTimelineManifest } from '@/lib/creative/resolution/resolve-timeline'
import { listTemplates, resolveTemplate, selectTemplateBindingSchemas } from '@/lib/creative/templates/registry'
import { resolveTemplateBinding, resolveTemplateComponent } from '@/lib/creative/templates/component-resolver'
import { quoteCardManifest, quoteCardTimelinePreview, resolveQuoteCardFixture } from '@/lib/creative/fixtures/quote-card-fixtures'
import { documentaryCardTimelinePreview } from '@/lib/creative/fixtures/timeline-preview-fixtures'
import { TemplateSegment } from '@/remotion/timeline'

describe('Wave 9A polymorphic template proof', () => {
  it('registers documentary and quote templates through one registry', () => {
    const templates = listTemplates()
    expect(templates.map((template) => template.id)).toEqual(['editorial.documentary-card', 'editorial.quote-card'])
    const quote = resolveTemplate({ id: 'editorial.quote-card', version: '0.1.0', variant: 'default', scope: 'system' })
    expect(quote.valid).toBe(true)
    if (quote.valid) expect(selectTemplateBindingSchemas(quote.value).valid).toBe(true)
    expect(resolveTemplate({ id: 'missing.template', version: '0.1.0', variant: 'default', scope: 'system' }).valid).toBe(false)
  })

  it('keeps template component keys distinct and resolves both bindings', () => {
    expect(resolveTemplateComponent('editorial.documentary-card')).toBeDefined()
    expect(resolveTemplateComponent('editorial.quote-card')).toBeDefined()
    expect(resolveTemplateComponent('editorial.documentary-card')).not.toBe(resolveTemplateComponent('editorial.quote-card'))
    expect(resolveTemplateBinding('editorial.quote-card')).toBeDefined()
  })

  it('validates quote content and rejects invalid payloads', () => {
    expect(QuoteCardContentSchema.safeParse({ quote: 'A valid quote' }).success).toBe(true)
    expect(QuoteCardContentSchema.safeParse({ quote: '' }).success).toBe(false)
    expect(QuoteCardContentSchema.safeParse({ quote: 'valid', extra: true }).success).toBe(false)
  })

  it('resolves Quote Card through the existing static manifest path for both identities', () => {
    const a = resolveStaticRenderManifest(quoteCardManifest({ width: 1080, height: 1350, unit: 'px' }))
    const b = resolveStaticRenderManifest(quoteCardManifest({ width: 1080, height: 1350, unit: 'px' }, { snapshot_ref: 'fixture:identity:acme-labs:v1', token_profile: 'default' }))
    expect(a.valid).toBe(true)
    expect(b.valid).toBe(true)
    if (a.valid && b.valid) {
      expect(a.value.resolvedTemplate.descriptor.component_key).toBe('editorial.quote-card')
      expect(a.value.tokens.snapshot_ref).not.toBe(b.value.tokens.snapshot_ref)
      const binding = resolveTemplateBinding(a.value.resolvedTemplate.descriptor.component_key)
      expect(binding).toBeDefined()
      if (binding) {
        const props = binding.createProps({ variant: 'default', content: a.value.manifest.content, assets: {}, tokens: a.value.tokens, canvas: a.value.manifest.canvas }, { mode: 'still' })
        expect(renderToStaticMarkup(createElement(binding.component, props as object))).toContain('The work becomes clearer')
      }
    }
  })

  it('renders Quote Card and Documentary Card timeline segments with the same adapter', () => {
    const quote = resolveTimelineManifest(quoteCardTimelinePreview)
    const documentary = resolveTimelineManifest(documentaryCardTimelinePreview)
    expect(quote.valid).toBe(true)
    expect(documentary.valid).toBe(true)
    if (quote.valid) {
      const segment = quote.value.resolvedTemplateSegments[0]
      expect(segment.resolvedTemplate.descriptor.component_key).toBe('editorial.quote-card')
      const markup = renderToStaticMarkup(createElement(TemplateSegment, { globalFrame: 45, resolvedInput: quote.value, resolvedSegment: segment }))
      expect(markup).toContain('The work becomes clearer')
    }
    if (documentary.valid) {
      const segment = documentary.value.resolvedTemplateSegments[0]
      expect(renderToStaticMarkup(createElement(TemplateSegment, { globalFrame: 90, resolvedInput: documentary.value, resolvedSegment: segment })).length).toBeGreaterThan(0)
    }
  })

  it('keeps Quote Card fixture resolution renderer-independent', () => {
    const resolved = resolveQuoteCardFixture('a')
    expect(resolved.resolvedAssets).toEqual({})
    expect(resolved.manifest.assets).toEqual({})
  })
})

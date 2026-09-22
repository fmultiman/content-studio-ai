import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { documentaryCardTimelinePreview } from '@/lib/creative/fixtures/timeline-preview-fixtures'
import { quoteCardManifest, quoteCardTimelinePreview } from '@/lib/creative/fixtures/quote-card-fixtures'
import { resolveStaticRenderManifest } from '@/lib/creative/resolution/resolve-static-render'
import { resolveTimelineManifest } from '@/lib/creative/resolution/resolve-timeline'
import { prepareTypography } from '@/lib/creative/typography/prepare-typography'
import { awaitTypographyReady, resolveTypography } from '@/lib/creative/typography/resolve-typography'
import { IDENTITY_FIXTURES } from '@/lib/creative/identity/fixtures'
import { resolveTemplateBinding } from '@/lib/creative/templates/component-resolver'

describe('Wave 9B/9C deterministic typography proof', () => {
  it('resolves display/body/label through the project-local fixture', () => {
    const result = resolveTypography(IDENTITY_FIXTURES[0])
    expect(result.valid).toBe(true)
    if (result.valid) {
      expect(result.value.display.family).toBe('Fraunces')
      expect(result.value.display.requested_family).toBe('Fraunces')
      expect(result.value.body.source).toBe('project_local')
      expect(result.value.label?.weight).toBe(600)
      expect(result.value.cssText).toContain('/creative-fonts/fraunces-700.woff2')
    }
  })

  it('fails explicitly for unknown family and unavailable weight', () => {
    const unknown = resolveTypography({ ...IDENTITY_FIXTURES[0], typography: { ...IDENTITY_FIXTURES[0].typography, display: { ...IDENTITY_FIXTURES[0].typography.display, family: 'Unknown Font' } } })
    expect(unknown.valid).toBe(false)
    if (!unknown.valid) expect(unknown.errors[0]).toMatchObject({ kind: 'typography_error', code: 'font_not_found' })
    const weight = resolveTypography({ ...IDENTITY_FIXTURES[0], typography: { ...IDENTITY_FIXTURES[0].typography, display: { ...IDENTITY_FIXTURES[0].typography.display, weight: 350 } } })
    expect(weight.valid).toBe(false)
    if (!weight.valid) expect(weight.errors[0]).toMatchObject({ kind: 'typography_error', code: 'weight_not_available' })
  })

  it('prepares the local font file without network access', async () => {
    const result = await prepareTypography(IDENTITY_FIXTURES[0])
    expect(result.valid).toBe(true)
    if (result.valid) expect(result.value.preparation_ms).toBeGreaterThanOrEqual(0)
    if (result.valid) expect(await awaitTypographyReady(result.value.typography)).toEqual([])
  })

  it('uses one resolved typography object across static and timeline inputs', () => {
    const staticResult = resolveStaticRenderManifest(quoteCardManifest({ width: 1080, height: 1350, unit: 'px' }))
    const quoteTimeline = resolveTimelineManifest(quoteCardTimelinePreview)
    const documentaryTimeline = resolveTimelineManifest(documentaryCardTimelinePreview)
    expect(staticResult.valid).toBe(true)
    expect(quoteTimeline.valid).toBe(true)
    expect(documentaryTimeline.valid).toBe(true)
    if (staticResult.valid && quoteTimeline.valid && documentaryTimeline.valid) {
      expect(staticResult.value.typography.display.family).toBe(quoteTimeline.value.typography.display.family)
      expect(quoteTimeline.value.typography.cssText).toBe(documentaryTimeline.value.typography.cssText)
      expect(staticResult.value.tokens.typography.display.family).toBe('Fraunces')
    }
  })

  it('makes both template trees consume resolved runtime typography', () => {
    const staticResult = resolveStaticRenderManifest(quoteCardManifest({ width: 1080, height: 1350, unit: 'px' }))
    const documentary = resolveStaticRenderManifest({
      ...quoteCardManifest({ width: 1080, height: 1350, unit: 'px' }),
      template: { id: 'editorial.documentary-card', version: '0.1.0', variant: 'cover', scope: 'system' },
      content: { title: 'A deterministic headline', subtitle: 'A stable body line.' },
      assets: { hero: { type: 'fixture', ref: 'fixture:asset:documentary-card:hero-archival-01', fit: 'cover' } },
    })
    expect(staticResult.valid).toBe(true)
    expect(documentary.valid).toBe(true)
    if (staticResult.valid && documentary.valid) {
      const quoteBinding = resolveTemplateBinding(staticResult.value.resolvedTemplate.descriptor.component_key)
      const documentaryBinding = resolveTemplateBinding(documentary.value.resolvedTemplate.descriptor.component_key)
      expect(quoteBinding).toBeDefined()
      expect(documentaryBinding).toBeDefined()
      if (quoteBinding && documentaryBinding) {
        const quoteProps = quoteBinding.createProps({ variant: 'default', content: staticResult.value.manifest.content, assets: {}, tokens: staticResult.value.tokens, canvas: staticResult.value.manifest.canvas }, { mode: 'still' })
        const documentaryProps = documentaryBinding.createProps({ variant: 'cover', content: documentary.value.manifest.content, assets: documentary.value.resolvedAssets, tokens: documentary.value.tokens, canvas: documentary.value.manifest.canvas }, { mode: 'still' })
        expect(renderToStaticMarkup(createElement(quoteBinding.component, quoteProps as object))).toContain('Fraunces')
        expect(renderToStaticMarkup(createElement(documentaryBinding.component, documentaryProps as object))).toContain('Fraunces')
      }
    }
  })

  it('resolves Identity B to its declared families without an identity branch', () => {
    const result = resolveTypography(IDENTITY_FIXTURES[1])
    expect(result.valid).toBe(true)
    if (result.valid) {
      expect(result.value.display).toMatchObject({ requested_family: 'Space Grotesk', family: 'Space Grotesk', weight: 700 })
      expect(result.value.body).toMatchObject({ requested_family: 'Inter', family: 'Inter', weight: 400 })
      expect(result.value.label).toMatchObject({ requested_family: 'Inter', family: 'Inter', weight: 600 })
    }
  })
})

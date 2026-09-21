import { describe, it, expect } from 'vitest'
import { adaptProjectIdentityToVisualTokens } from '../project-identity-adapter'
import type { ProjectIdentity } from '@/lib/schemas/project-identity'
import { tokensWithResolvedTypography, resolveTypography } from '@/lib/creative/typography/resolve-typography'
import { resolveAsset } from '@/lib/creative/assets/resolve-asset'
import { DocumentaryCard } from '@/components/creative/documentary-card/DocumentaryCard'
import { QuoteCard } from '@/components/creative/quote-card/QuoteCard'
import * as React from 'react'
import { renderToString } from 'react-dom/server'

describe('Productization Phase 1A: Real Identity Render Proof', () => {
  it('should flow Project Identity through the adapter into Typography Resolution and both Templates', () => {
    // 1. PROJECT IDENTITY V1
    const canonicalIdentity: ProjectIdentity = {
      schema_version: 1,
      expression: { visual_identity: 'Raw documentary' }
    }
    const projectId = 'test-proj-identity'

    // 2. PRODUCT INTEGRATION ADAPTER
    const creativeSnapshot = adaptProjectIdentityToVisualTokens(projectId, canonicalIdentity)
    
    // Expect adapter output matches creative rendering contract
    expect(creativeSnapshot.schema_version).toBe('visual-tokens.v0')
    expect(creativeSnapshot.colors.background).toBe('#F6F0E4')

    // 3. TYPOGRAPHY RESOLUTION
    const typographyResult = resolveTypography(creativeSnapshot)
    expect(typographyResult.valid).toBe(true)
    if (!typographyResult.valid) throw new Error('Typography resolution failed')
    
    const renderReadyTokens = tokensWithResolvedTypography(creativeSnapshot, typographyResult.value)


    // Verify typography runtime resolved against the adapter's snapshot
    expect(renderReadyTokens.typography.display.family).toBe('Fraunces')
    expect(typographyResult.value.display.source).toBe('project_local')

    // 4. TEMPLATE BINDINGS (DOCUMENTARY CARD)
    const docElement = React.createElement(DocumentaryCard, {
      tokens: renderReadyTokens,
      variant: 'cover',
      canvas: { width: 1080, height: 1350, unit: 'px' },
      content: {
        title: 'Proof Title',
        subtitle: 'Proof Subtitle'
      },
      assets: {
        hero: (resolveAsset({ type: 'fixture', ref: 'fixture:asset:documentary-card:hero-archival-01' }) as any).value
      },
      sequence: { index: 1, total: 3 },
      mode: 'still'
    })

    const docStr = renderToString(docElement)
    // Prove it successfully generated markup containing typography assertions
    expect(docStr).toContain('Proof Title')
    expect(docStr).toContain('Fraunces')

    // 5. TEMPLATE BINDINGS (QUOTE CARD)
    const quoteElement = React.createElement(QuoteCard, {
      tokens: renderReadyTokens,
      variant: 'default',
      canvas: { width: 1080, height: 1350, unit: 'px' },
      content: {
        quote: 'A proof of concept.',
        attribution: 'Phase 1A'
      },
      assets: {},
      mode: 'still'
    })

    const quoteStr = renderToString(quoteElement)
    expect(quoteStr).toContain('A proof of concept.')
    expect(quoteStr).toContain('Fraunces')
  })
})

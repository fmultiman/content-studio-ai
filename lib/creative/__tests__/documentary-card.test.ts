import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { DocumentaryCard } from '@/components/creative/documentary-card'
import { documentaryCardFixtures } from '@/lib/creative/fixtures/documentary-card-fixtures'
import { resolveTemplateComponent } from '@/lib/creative/templates/component-resolver'

describe('Wave 4 Documentary Card composition', () => {
  it('resolves the neutral registry component key at the visual boundary', () => {
    expect(resolveTemplateComponent('editorial.documentary-card')).toBe(DocumentaryCard)
    expect(resolveTemplateComponent('missing.component')).toBeUndefined()
  })

  it('renders cover from a resolved input with sequence, hero, and content', () => {
    const input = documentaryCardFixtures.cover45
    const markup = renderToStaticMarkup(createElement(DocumentaryCard, {
      variant: 'cover',
      content: input.manifest.content as never,
      assets: input.resolvedAssets,
      tokens: input.tokens,
      canvas: input.manifest.canvas,
      mode: 'still',
      sequence: input.manifest.sequence,
    }))

    expect(markup).toContain('O que são comunidades alternativas?')
    expect(markup).toContain('1/10')
    expect(markup).toContain('Documentary hero evidence')
    expect(markup).toContain('Project identity')
  })

  it('renders info without a hero and preserves both fact cards', () => {
    const input = documentaryCardFixtures.info45
    const markup = renderToStaticMarkup(createElement(DocumentaryCard, {
      variant: 'info',
      content: input.manifest.content as never,
      assets: input.resolvedAssets,
      tokens: input.tokens,
      canvas: input.manifest.canvas,
      mode: 'still',
      sequence: input.manifest.sequence,
    }))

    expect(markup).toContain('Uma pergunta, duas edições')
    expect(markup).toContain('1983')
    expect(markup).toContain('1985')
    expect(markup).not.toContain('Documentary hero evidence')
  })

  it('uses the same family at 4:5 and 9:16 and changes with identity tokens', () => {
    const cover45 = documentaryCardFixtures.cover45
    const cover916 = documentaryCardFixtures.cover916
    const neutral = documentaryCardFixtures.coverNeutral45
    const render = (input: typeof cover45) => renderToStaticMarkup(createElement(DocumentaryCard, {
      variant: 'cover',
      content: input.manifest.content as never,
      assets: input.resolvedAssets,
      tokens: input.tokens,
      canvas: input.manifest.canvas,
      mode: 'still',
      sequence: input.manifest.sequence,
    }))

    expect(render(cover45)).toMatch(/height:1350px;.*width:1080px/)
    expect(render(cover916)).toMatch(/height:1920px;.*width:1080px/)
    expect(render(cover45)).not.toBe(render(neutral))
  })

  it('still is frame-independent while video accepts slow_push and fade motion', () => {
    const input = documentaryCardFixtures.cover45
    const props = {
      variant: 'cover' as const,
      content: input.manifest.content as never,
      assets: input.resolvedAssets,
      tokens: input.tokens,
      canvas: input.manifest.canvas,
      sequence: input.manifest.sequence,
    }
    const still0 = renderToStaticMarkup(createElement(DocumentaryCard, { ...props, mode: 'still' as const, frame: 0, motion: { preset: 'slow_push' as const } }))
    const still100 = renderToStaticMarkup(createElement(DocumentaryCard, { ...props, mode: 'still' as const, frame: 100, motion: { preset: 'slow_push' as const } }))
    const video = renderToStaticMarkup(createElement(DocumentaryCard, { ...props, mode: 'video' as const, frame: 100, durationInFrames: 180, motion: { preset: 'slow_push' as const } }))
    expect(still0).toBe(still100)
    expect(video).toContain('scale(1.033')
  })
})

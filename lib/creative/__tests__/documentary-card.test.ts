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
    // Template Foundation V1: the old hardcoded "Field notes" placeholder is
    // gone — the brand label is content (brand_label), absent in this fixture.
    expect(markup).not.toContain('Field notes')
    expect(markup).toContain('Project brand mark')
    expect(markup).toContain('paper-card-light-01.png')
  })

  it('renders the cover brand label from content (Pack B Slide 1 brand block)', () => {
    const input = documentaryCardFixtures.cover45
    const markup = renderToStaticMarkup(createElement(DocumentaryCard, {
      variant: 'cover',
      content: { ...(input.manifest.content as object), brand_label: 'Portal Comunidades Alternativas' } as never,
      assets: input.resolvedAssets, tokens: input.tokens, canvas: input.manifest.canvas, mode: 'still', sequence: input.manifest.sequence,
    }))
    expect(markup).toContain('Portal Comunidades Alternativas')
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

    // Pack B Slide 2 sets the title on two strips, split after the first comma.
    expect(markup).toContain('Uma pergunta,')
    expect(markup).toContain('duas edições')
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

  it('applies the same runtime tuning tree used by authoring preview', () => {
    const input = documentaryCardFixtures.cover45
    const markup = renderToStaticMarkup(createElement(DocumentaryCard, {
      variant: 'cover',
      content: input.manifest.content as never,
      assets: input.resolvedAssets,
      tokens: input.tokens,
      canvas: input.manifest.canvas,
      mode: 'still',
      sequence: input.manifest.sequence,
      previewTuning: {
        hero: { offsetX: 42, offsetY: -24, rotation: 2, scale: 1.08 },
        title: { offsetX: 9, offsetY: 4, rotation: -1 },
        source: { offsetX: 0, offsetY: 0, rotation: 0 },
      },
    }))
    // Template base rotation (hero 3.2deg, title -1deg) + the authored refinement.
    expect(markup).toContain('translate(42px, -24px) rotate(5.2deg) scale(1.08)')
    expect(markup).toContain('translate(9px, 4px) rotate(-2deg)')
  })

  it('keeps Wave 5 transforms absent when no override is supplied', () => {
    const input = documentaryCardFixtures.cover45
    const markup = renderToStaticMarkup(createElement(DocumentaryCard, {
      variant: 'cover', content: input.manifest.content as never, assets: input.resolvedAssets,
      tokens: input.tokens, canvas: input.manifest.canvas, mode: 'still', sequence: input.manifest.sequence,
    }))
    expect(markup).not.toContain('translate(42px')
  })

  // ── Slice 1 — Portal Carousel V1: appearance independent of variant ─────────

  it('defaults cover to dark and info to light when appearance is absent (legacy behavior preserved)', () => {
    const cover = documentaryCardFixtures.cover45
    const info = documentaryCardFixtures.info45
    const coverMarkup = renderToStaticMarkup(createElement(DocumentaryCard, {
      variant: 'cover', content: cover.manifest.content as never, assets: cover.resolvedAssets,
      tokens: cover.tokens, canvas: cover.manifest.canvas, mode: 'still', sequence: cover.manifest.sequence,
    }))
    const infoMarkup = renderToStaticMarkup(createElement(DocumentaryCard, {
      variant: 'info', content: info.manifest.content as never, assets: info.resolvedAssets,
      tokens: info.tokens, canvas: info.manifest.canvas, mode: 'still', sequence: info.manifest.sequence,
    }))
    expect(coverMarkup).toContain('background:#0b1020')
    expect(infoMarkup).not.toContain('background:#0b1020')
  })

  it('renders a light cover when appearance="light" is explicit, overriding the legacy dark default', () => {
    const input = documentaryCardFixtures.cover45
    const dark = renderToStaticMarkup(createElement(DocumentaryCard, {
      variant: 'cover', appearance: 'dark', content: input.manifest.content as never, assets: input.resolvedAssets,
      tokens: input.tokens, canvas: input.manifest.canvas, mode: 'still', sequence: input.manifest.sequence,
    }))
    const light = renderToStaticMarkup(createElement(DocumentaryCard, {
      variant: 'cover', appearance: 'light', content: input.manifest.content as never, assets: input.resolvedAssets,
      tokens: input.tokens, canvas: input.manifest.canvas, mode: 'still', sequence: input.manifest.sequence,
    }))
    expect(dark).toContain('background:#0b1020')
    expect(light).not.toContain('background:#0b1020')
    expect(dark).not.toBe(light)
  })

  it('renders a dark info when appearance="dark" is explicit, proving appearance is not locked to cover', () => {
    const input = documentaryCardFixtures.info45
    const light = renderToStaticMarkup(createElement(DocumentaryCard, {
      variant: 'info', appearance: 'light', content: input.manifest.content as never, assets: input.resolvedAssets,
      tokens: input.tokens, canvas: input.manifest.canvas, mode: 'still', sequence: input.manifest.sequence,
    }))
    const dark = renderToStaticMarkup(createElement(DocumentaryCard, {
      variant: 'info', appearance: 'dark', content: input.manifest.content as never, assets: input.resolvedAssets,
      tokens: input.tokens, canvas: input.manifest.canvas, mode: 'still', sequence: input.manifest.sequence,
    }))
    expect(dark).toContain('background:#0b1020')
    expect(light).not.toContain('background:#0b1020')
  })

  it('applies resolved paper and tape transforms to the shared material slots', () => {
    const input = documentaryCardFixtures.cover45
    const markup = renderToStaticMarkup(createElement(DocumentaryCard, {
      variant: 'cover', content: input.manifest.content as never, assets: input.resolvedAssets,
      tokens: input.tokens, canvas: input.manifest.canvas, mode: 'still', sequence: input.manifest.sequence,
      primitiveTransforms: {
        paper: { offsetX: 64, offsetY: -38, rotation: 11, scale: 1.24, opacity: 0.8 },
        tape: { offsetX: -27, offsetY: 19, rotation: -8, scale: 0.82, opacity: 0.63 },
      },
    }))
    // Papel do título (base -1deg) and the legacy shared `tape` channel, which
    // still drives every tape instance that has no own channel (base 6deg / -3deg).
    expect(markup).toContain('translate(64px, -38px) rotate(10deg) scale(1.24)')
    expect(markup).toContain('translate(-27px, 19px) rotate(-2deg) scale(0.82)')
    expect(markup).toContain('translate(-27px, 19px) rotate(-11deg) scale(0.82)')
    expect(markup).toContain('opacity:0.8')
    expect(markup).toContain('opacity:0.63')
  })

  // ── Creative Editor Template Foundation V1: element stack ────────────────
  // Every authored element is its own absolutely positioned layer at the card
  // root (no element is nested inside another's clip), and its z-index comes
  // from the normalized stack — so reordering is a pure z-index change.

  const zIndexOf = (markup: string, label: string) => {
    const at = markup.indexOf(`aria-label="${label}"`)
    expect(at).toBeGreaterThan(-1)
    const style = markup.slice(at, markup.indexOf('>', at))
    return Number(/z-index:(\d+)/.exec(style)?.[1])
  }

  it('paints Fita da imagem above Imagem principal by default (template stack)', () => {
    const input = documentaryCardFixtures.cover45
    const markup = renderToStaticMarkup(createElement(DocumentaryCard, {
      variant: 'cover', content: input.manifest.content as never, assets: input.resolvedAssets,
      tokens: input.tokens, canvas: input.manifest.canvas, mode: 'still', sequence: input.manifest.sequence,
    }))
    expect(zIndexOf(markup, 'Fita da imagem')).toBeGreaterThan(zIndexOf(markup, 'Imagem principal'))
  })

  it('an authored elementOrder moves Imagem principal above Fita da imagem', () => {
    const input = documentaryCardFixtures.cover45
    const markup = renderToStaticMarkup(createElement(DocumentaryCard, {
      variant: 'cover', content: input.manifest.content as never, assets: input.resolvedAssets,
      tokens: input.tokens, canvas: input.manifest.canvas, mode: 'still', sequence: input.manifest.sequence,
      elementOrder: ['ornament', 'archival', 'botanicalLeaf', 'botanical', 'tape1', 'hero', 'note', 'tape2', 'paper', 'title'],
    }))
    expect(zIndexOf(markup, 'Imagem principal')).toBeGreaterThan(zIndexOf(markup, 'Fita da imagem'))
  })

  it('reorders pins against cards on Info (Pin do cartão 1 behind Cartão 1)', () => {
    const input = documentaryCardFixtures.info45
    const base = { variant: 'info' as const, content: input.manifest.content as never, assets: input.resolvedAssets, tokens: input.tokens, canvas: input.manifest.canvas, mode: 'still' as const, sequence: input.manifest.sequence }
    const standard = renderToStaticMarkup(createElement(DocumentaryCard, base))
    expect(zIndexOf(standard, 'Pin do cartão 1')).toBeGreaterThan(zIndexOf(standard, 'Cartão 1'))
    const reordered = renderToStaticMarkup(createElement(DocumentaryCard, { ...base, elementOrder: ['archival', 'botanicalLeaf', 'tape1', 'tape2', 'botanical', 'pin', 'card1', 'paper', 'pin2', 'tape3', 'paperStrip', 'paperDark', 'title', 'source'] }))
    expect(zIndexOf(reordered, 'Pin do cartão 1')).toBeLessThan(zIndexOf(reordered, 'Cartão 1'))
  })

  it('ignores unknown / duplicate ids in a rendered elementOrder (normalized, never throws)', () => {
    const input = documentaryCardFixtures.cover45
    const markup = renderToStaticMarkup(createElement(DocumentaryCard, {
      variant: 'cover', content: input.manifest.content as never, assets: input.resolvedAssets,
      tokens: input.tokens, canvas: input.manifest.canvas, mode: 'still', sequence: input.manifest.sequence,
      elementOrder: ['ghost', 'hero', 'hero', 'tape1'],
    }))
    expect(zIndexOf(markup, 'Fita da imagem')).toBeGreaterThan(zIndexOf(markup, 'Imagem principal'))
  })

  // Final Authoring Polish V2.1: InfoVariant used to spread the Title's own
  // style object (`titleTextStyle`) into the Fonte/source_line element too,
  // so moving Título also moved the source line. Each now gets its own
  // tuning slot and its own style object — a shared transform string would
  // print on BOTH elements (count 2); independent tuning prints it once.
  it('moving Título does not move Fonte (Info)', () => {
    const input = documentaryCardFixtures.info45
    const markup = renderToStaticMarkup(createElement(DocumentaryCard, {
      variant: 'info', content: input.manifest.content as never, assets: input.resolvedAssets,
      tokens: input.tokens, canvas: input.manifest.canvas, mode: 'still', sequence: input.manifest.sequence,
      previewTuning: {
        hero: { offsetX: 0, offsetY: 0, rotation: 0, scale: 1 },
        title: { offsetX: 37, offsetY: -11, rotation: 1.3 },
        source: { offsetX: 0, offsetY: 0, rotation: 0 },
      },
    }))
    const titleTransform = 'translate(37px, -11px) rotate(1.3deg)'
    expect(markup.split(titleTransform).length - 1).toBe(1)
  })

  it('moving Fonte does not move Título (Info)', () => {
    const input = documentaryCardFixtures.info45
    const markup = renderToStaticMarkup(createElement(DocumentaryCard, {
      variant: 'info', content: input.manifest.content as never, assets: input.resolvedAssets,
      tokens: input.tokens, canvas: input.manifest.canvas, mode: 'still', sequence: input.manifest.sequence,
      previewTuning: {
        hero: { offsetX: 0, offsetY: 0, rotation: 0, scale: 1 },
        title: { offsetX: 0, offsetY: 0, rotation: 0 },
        source: { offsetX: -22, offsetY: 14, rotation: -0.6 },
      },
    }))
    const sourceTransform = 'translate(-22px, 14px) rotate(-4.6deg)'
    expect(markup.split(sourceTransform).length - 1).toBe(1)
  })
})

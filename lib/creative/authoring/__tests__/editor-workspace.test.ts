import { describe, expect, it } from 'vitest'
import {
  INSPECTOR_PALETTE_MARGIN, INSPECTOR_PALETTE_MIN, INSPECTOR_SECTIONS, channelFormatLabel, constrainPaletteBox, elementsForVariant, initialInspectorPaletteBox,
} from '../editor-workspace'

describe('initialInspectorPaletteBox', () => {
  it('leaves vertical travel room in a laptop-sized workbench (no "horizontal rail")', () => {
    // ~1366×768 workbench after the compact header.
    const box = initialInspectorPaletteBox(1150, 640)
    expect(box.height).toBeLessThan(640 - 2 * INSPECTOR_PALETTE_MARGIN)
    expect(640 - box.height).toBeGreaterThanOrEqual(100)
    expect(box.width).toBeGreaterThanOrEqual(INSPECTOR_PALETTE_MIN.width)
  })

  it('places the palette inside the workbench on the right', () => {
    const box = initialInspectorPaletteBox(1150, 640)
    expect(box.left + box.width).toBe(1150 - INSPECTOR_PALETTE_MARGIN)
    expect(box.top).toBe(INSPECTOR_PALETTE_MARGIN)
  })

  it('never goes below the readable minimum size', () => {
    const box = initialInspectorPaletteBox(280, 200)
    expect(box.width).toBe(INSPECTOR_PALETTE_MIN.width)
    expect(box.height).toBe(INSPECTOR_PALETTE_MIN.height)
    expect(box.left).toBe(0)
  })
})

describe('constrainPaletteBox', () => {
  it('does not move a palette that already fits', () => {
    const box = { top: 40, left: 200, width: 340, height: 400 }
    expect(constrainPaletteBox(box, 1150, 640)).toEqual(box)
  })

  it('pulls a stranded palette back into a shrunken workbench', () => {
    const next = constrainPaletteBox({ top: 500, left: 1000, width: 340, height: 500 }, 900, 560)
    expect(next.left + next.width).toBeLessThanOrEqual(900)
    expect(next.top + next.height).toBeLessThanOrEqual(560)
    expect(next.top).toBeGreaterThanOrEqual(0)
  })
})

describe('labels', () => {
  it('renders the channel/format in product language', () => {
    expect(channelFormatLabel('instagram', 'carousel')).toBe('Instagram Carousel')
  })

  it('keeps five Inspector sections with correct UTF-8 labels', () => {
    expect(INSPECTOR_SECTIONS.map((section) => section.label)).toEqual(['Template', 'Conteúdo', 'Assets', 'Estilo', 'Elementos'])
    expect(INSPECTOR_SECTIONS.map((section) => section.compactLabel)).toEqual(['Tpl.', 'Cont.', 'Assets', 'Estilo', 'Elem.'])
  })
})

describe('elementsForVariant', () => {
  // Final Authoring Polish V2.1: Fonte (source/credit) is an independently authored element only where the
  // renderer reads a tuning slot for it. COVER_ELEMENT_COMPLETENESS_V1 gave Cover's source_line that slot
  // (the same `source` group as Info), so it is exposed there too; the layouts that draw no source line still do not.
  it('exposes the source line only on the layouts whose renderer positions it (Info, Cover)', () => {
    expect(elementsForVariant('info').map((element) => element.key)).toContain('source')
    expect(elementsForVariant('cover').map((element) => element.key)).toContain('source')
    for (const variant of ['list', 'grid', 'map', 'network', 'quote', 'closing'] as const) expect(elementsForVariant(variant).map((element) => element.key)).not.toContain('source')
  })

  it('labels the Info Fonte element correctly', () => {
    const source = elementsForVariant('info').find((element) => element.key === 'source')
    expect(source?.label).toBe('Fonte')
  })

  it('exposes Hero only on the Cover variant', () => {
    expect(elementsForVariant('cover').map((element) => element.key)).toContain('hero')
    expect(elementsForVariant('info').map((element) => element.key)).not.toContain('hero')
  })

  it('never exposes raw primitive-instance ids as element labels', () => {
    const labels = [...elementsForVariant('cover'), ...elementsForVariant('info')].map((element) => element.label)
    expect(labels).not.toContain('tape1')
    expect(labels).not.toContain('tape2')
    expect(labels).not.toContain('tape3')
  })
})

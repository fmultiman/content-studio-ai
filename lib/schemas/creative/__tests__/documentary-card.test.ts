import { describe, expect, it } from 'vitest'
import {
  DocumentaryCardCoverAssetsSchema,
  DocumentaryCardCoverContentSchema,
  DocumentaryCardInfoAssetsSchema,
  DocumentaryCardInfoContentSchema,
} from '../documentary-card'
import { portalHeroAsset } from './fixtures'

describe('DocumentaryCardCoverContentSchema', () => {
  const validCover = {
    eyebrow: 'MEMÓRIA VIVA • LIVROS',
    title: 'O QUE SÃO COMUNIDADES ALTERNATIVAS?',
    subtitle: 'Uma pergunta lançada num país em transição.',
    source_line: 'Publicado originalmente em 1983.',
    detail_note: 'Edição apresentada: Nova Cultural / Brasiliense, 1985.',
  }

  it('accepts a full cover content object', () => {
    expect(DocumentaryCardCoverContentSchema.safeParse(validCover).success).toBe(true)
  })

  it('accepts a minimal cover with only title', () => {
    expect(DocumentaryCardCoverContentSchema.safeParse({ title: 'Terra Una' }).success).toBe(true)
  })

  it('accepts a fully neutral, non-Portal cover', () => {
    expect(
      DocumentaryCardCoverContentSchema.safeParse({
        eyebrow: 'Product update',
        title: 'Shipping Launch Week',
      }).success,
    ).toBe(true)
  })

  it('rejects a cover missing title', () => {
    const { title: _title, ...withoutTitle } = validCover
    expect(DocumentaryCardCoverContentSchema.safeParse(withoutTitle).success).toBe(false)
  })

  it('rejects an unknown field, e.g. a generic footer (decision C6)', () => {
    const result = DocumentaryCardCoverContentSchema.safeParse({ ...validCover, footer: 'Some footer text' })
    expect(result.success).toBe(false)
  })

  it('rejects a title over the V0 length limit', () => {
    const result = DocumentaryCardCoverContentSchema.safeParse({ title: 'x'.repeat(121) })
    expect(result.success).toBe(false)
  })
})

describe('DocumentaryCardCoverAssetsSchema', () => {
  it('accepts a hero-only asset binding', () => {
    expect(DocumentaryCardCoverAssetsSchema.safeParse({ hero: portalHeroAsset }).success).toBe(true)
  })

  it('rejects a binding missing hero', () => {
    expect(DocumentaryCardCoverAssetsSchema.safeParse({}).success).toBe(false)
  })
})

describe('DocumentaryCardInfoContentSchema', () => {
  const validInfo = {
    title: 'UMA PERGUNTA, DUAS EDIÇÕES',
    body_blocks: [
      'Há registro de uma edição Brasiliense de 1983, na Coleção Primeiros Passos nº 108.',
      'O exemplar apresentado aqui é a edição Nova Cultural / Brasiliense, de 1985.',
    ],
    fact_cards: [
      { primary: '1983', secondary: 'ed. Brasiliense', tertiary: 'nº 108' },
      { primary: '1985', secondary: 'ed. Nova Cultural / Brasiliense', tertiary: 'nº 58' },
    ],
  }

  it('accepts a valid info content with 2 fact cards', () => {
    expect(DocumentaryCardInfoContentSchema.safeParse(validInfo).success).toBe(true)
  })

  it('accepts a valid info content with 1 fact card', () => {
    expect(
      DocumentaryCardInfoContentSchema.safeParse({
        ...validInfo,
        fact_cards: [validInfo.fact_cards[0]],
      }).success,
    ).toBe(true)
  })

  it('accepts a fully neutral, non-Portal info', () => {
    expect(
      DocumentaryCardInfoContentSchema.safeParse({
        title: 'Two releases, one roadmap',
        body_blocks: ['Version 1 shipped in March.'],
        fact_cards: [{ primary: 'v1.0', secondary: 'March 2026' }],
      }).success,
    ).toBe(true)
  })

  it('rejects info without fact_cards (min 1)', () => {
    const { fact_cards: _factCards, ...withoutFactCards } = validInfo
    expect(DocumentaryCardInfoContentSchema.safeParse({ ...withoutFactCards, fact_cards: [] }).success).toBe(
      false,
    )
  })

  it('rejects info with 3 fact_cards (max 2, decision C5)', () => {
    const result = DocumentaryCardInfoContentSchema.safeParse({
      ...validInfo,
      fact_cards: [...validInfo.fact_cards, { primary: '2020' }],
    })
    expect(result.success).toBe(false)
  })

  it('rejects info without body_blocks (min 1)', () => {
    const result = DocumentaryCardInfoContentSchema.safeParse({ ...validInfo, body_blocks: [] })
    expect(result.success).toBe(false)
  })

  it('rejects info missing title', () => {
    const { title: _title, ...withoutTitle } = validInfo
    expect(DocumentaryCardInfoContentSchema.safeParse(withoutTitle).success).toBe(false)
  })
})

describe('DocumentaryCardInfoAssetsSchema', () => {
  it('does not require a hero (info does not depend on it)', () => {
    expect(DocumentaryCardInfoAssetsSchema.safeParse({}).success).toBe(true)
  })

  it('rejects an unknown field (.strict())', () => {
    expect(DocumentaryCardInfoAssetsSchema.safeParse({ hero: portalHeroAsset }).success).toBe(false)
  })
})

import { describe, it, expect } from 'vitest'
import {
  ProjectIdentitySchema,
  IDENTITY_TEXT_MAX_CHARS,
  IDENTITY_ARRAY_ITEM_MAX_CHARS,
  IDENTITY_ARRAY_MAX_ITEMS,
} from '../project-identity'

// ─── Helpers ─────────────────────────────────────────────────────────────────

const validMinimal = { schema_version: 1 as const }

const validFull = {
  schema_version: 1 as const,
  foundation: { purpose: 'Existir para iluminar.' },
  relationship: { audience: 'Criadores independentes.' },
  expression: {
    visual_identity: 'Paleta terrosa, tipografia serifada.',
    voice: 'Direto e poético.',
  },
  governance: {
    principles: ['Autenticidade acima de tudo'],
    restrictions: ['Sem logos de terceiros'],
  },
  practice: {
    generation_preferences: ['Composição quadrada', 'Luz natural'],
  },
}

// ─── schema_version ───────────────────────────────────────────────────────────

describe('ProjectIdentitySchema — schema_version', () => {
  it('accepts schema_version: 1', () => {
    expect(ProjectIdentitySchema.safeParse(validMinimal).success).toBe(true)
  })

  it('rejects missing schema_version', () => {
    const result = ProjectIdentitySchema.safeParse({})
    expect(result.success).toBe(false)
  })

  it('rejects schema_version: 2', () => {
    const result = ProjectIdentitySchema.safeParse({ schema_version: 2 })
    expect(result.success).toBe(false)
  })

  it('rejects schema_version: "1" (string)', () => {
    const result = ProjectIdentitySchema.safeParse({ schema_version: '1' })
    expect(result.success).toBe(false)
  })
})

// ─── Strict shape ─────────────────────────────────────────────────────────────

describe('ProjectIdentitySchema — strict shape', () => {
  it('accepts a fully-populated valid identity', () => {
    const result = ProjectIdentitySchema.safeParse(validFull)
    expect(result.success).toBe(true)
  })

  it('rejects unknown top-level keys', () => {
    const result = ProjectIdentitySchema.safeParse({ ...validMinimal, extra: 'x' })
    expect(result.success).toBe(false)
  })

  it('rejects unknown keys inside a zone', () => {
    const result = ProjectIdentitySchema.safeParse({
      ...validMinimal,
      foundation: { purpose: 'ok', unknown_field: 'x' },
    })
    expect(result.success).toBe(false)
  })
})

// ─── optionalText ─────────────────────────────────────────────────────────────

describe('ProjectIdentitySchema — optionalText fields', () => {
  it('accepts undefined (field omitted)', () => {
    const result = ProjectIdentitySchema.safeParse({
      ...validMinimal,
      foundation: {},
    })
    expect(result.success).toBe(true)
  })

  it('rejects empty string', () => {
    const result = ProjectIdentitySchema.safeParse({
      ...validMinimal,
      foundation: { purpose: '' },
    })
    expect(result.success).toBe(false)
  })

  it('rejects whitespace-only string (after trim becomes empty)', () => {
    const result = ProjectIdentitySchema.safeParse({
      ...validMinimal,
      foundation: { purpose: '   ' },
    })
    expect(result.success).toBe(false)
  })

  it('trims leading/trailing whitespace and stores clean value', () => {
    const result = ProjectIdentitySchema.safeParse({
      ...validMinimal,
      foundation: { purpose: '  Hello  ' },
    })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.foundation?.purpose).toBe('Hello')
    }
  })

  it('rejects string exceeding IDENTITY_TEXT_MAX_CHARS', () => {
    const result = ProjectIdentitySchema.safeParse({
      ...validMinimal,
      foundation: { purpose: 'x'.repeat(IDENTITY_TEXT_MAX_CHARS + 1) },
    })
    expect(result.success).toBe(false)
  })

  it('accepts string exactly at IDENTITY_TEXT_MAX_CHARS', () => {
    const result = ProjectIdentitySchema.safeParse({
      ...validMinimal,
      foundation: { purpose: 'x'.repeat(IDENTITY_TEXT_MAX_CHARS) },
    })
    expect(result.success).toBe(true)
  })
})

// ─── optionalStringArray ──────────────────────────────────────────────────────

describe('ProjectIdentitySchema — optionalStringArray fields', () => {
  it('deduplicates array items via transform', () => {
    const result = ProjectIdentitySchema.safeParse({
      ...validMinimal,
      governance: { principles: ['A', 'B', 'A'] },
    })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.governance?.principles).toEqual(['A', 'B'])
    }
  })

  it('rejects items exceeding IDENTITY_ARRAY_ITEM_MAX_CHARS', () => {
    const result = ProjectIdentitySchema.safeParse({
      ...validMinimal,
      governance: { principles: ['x'.repeat(IDENTITY_ARRAY_ITEM_MAX_CHARS + 1)] },
    })
    expect(result.success).toBe(false)
  })

  it('rejects arrays exceeding IDENTITY_ARRAY_MAX_ITEMS', () => {
    const items = Array.from({ length: IDENTITY_ARRAY_MAX_ITEMS + 1 }, (_, i) => `item-${i}`)
    const result = ProjectIdentitySchema.safeParse({
      ...validMinimal,
      practice: { generation_preferences: items },
    })
    expect(result.success).toBe(false)
  })

  it('rejects array items that are empty strings', () => {
    const result = ProjectIdentitySchema.safeParse({
      ...validMinimal,
      governance: { restrictions: [''] },
    })
    expect(result.success).toBe(false)
  })

  it('trims whitespace from array items', () => {
    const result = ProjectIdentitySchema.safeParse({
      ...validMinimal,
      governance: { principles: ['  Clean  '] },
    })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.governance?.principles?.[0]).toBe('Clean')
    }
  })

  it('accepts an empty array', () => {
    const result = ProjectIdentitySchema.safeParse({
      ...validMinimal,
      governance: { restrictions: [] },
    })
    expect(result.success).toBe(true)
  })
})

// ─── All zones optional ───────────────────────────────────────────────────────

describe('ProjectIdentitySchema — all zones are optional', () => {
  it('accepts identity with only schema_version', () => {
    expect(ProjectIdentitySchema.safeParse({ schema_version: 1 }).success).toBe(true)
  })

  it('accepts identity with only expression zone', () => {
    const result = ProjectIdentitySchema.safeParse({
      schema_version: 1,
      expression: { visual_identity: 'Minimalista.' },
    })
    expect(result.success).toBe(true)
  })

  it('accepts identity with only practice zone', () => {
    const result = ProjectIdentitySchema.safeParse({
      schema_version: 1,
      practice: { generation_preferences: ['Preto e branco'] },
    })
    expect(result.success).toBe(true)
  })
})

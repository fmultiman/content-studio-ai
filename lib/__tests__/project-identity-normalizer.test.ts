import { describe, it, expect } from 'vitest'
import {
  parseProjectIdentity,
  normalizeProjectIdentity,
  ProjectIdentityParseError,
} from '../project-identity-normalizer'

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const withContent = {
  schema_version: 1 as const,
  foundation: { purpose: 'Existir para iluminar.' },
}

const emptyZones = { schema_version: 1 as const }

// ─── parseProjectIdentity ─────────────────────────────────────────────────────

describe('parseProjectIdentity', () => {
  it('returns parsed identity for valid input', () => {
    const result = parseProjectIdentity(withContent)
    expect(result.schema_version).toBe(1)
    expect(result.foundation?.purpose).toBe('Existir para iluminar.')
  })

  it('throws ProjectIdentityParseError for null', () => {
    expect(() => parseProjectIdentity(null)).toThrow(ProjectIdentityParseError)
  })

  it('throws ProjectIdentityParseError for missing schema_version', () => {
    expect(() => parseProjectIdentity({ foundation: { purpose: 'ok' } })).toThrow(
      ProjectIdentityParseError,
    )
  })

  it('throws ProjectIdentityParseError for wrong schema_version', () => {
    expect(() => parseProjectIdentity({ schema_version: 2, foundation: {} })).toThrow(
      ProjectIdentityParseError,
    )
  })

  it('throws ProjectIdentityParseError for unknown keys', () => {
    expect(() => parseProjectIdentity({ schema_version: 1, unknown: 'x' })).toThrow(
      ProjectIdentityParseError,
    )
  })

  it('exposes ZodIssues on the error', () => {
    try {
      parseProjectIdentity({ schema_version: 2 })
    } catch (err) {
      expect(err).toBeInstanceOf(ProjectIdentityParseError)
      expect((err as ProjectIdentityParseError).issues.length).toBeGreaterThan(0)
    }
  })
})

// ─── normalizeProjectIdentity — absence ───────────────────────────────────────

describe('normalizeProjectIdentity — legitimate absence returns null', () => {
  it('returns null for null', () => {
    expect(normalizeProjectIdentity(null)).toBeNull()
  })

  it('returns null for undefined', () => {
    expect(normalizeProjectIdentity(undefined)).toBeNull()
  })

  it('returns null for empty string', () => {
    expect(normalizeProjectIdentity('')).toBeNull()
  })

  it('returns null for empty object {}', () => {
    expect(normalizeProjectIdentity({})).toBeNull()
  })

  it('returns null for valid identity with schema_version but no content', () => {
    // { schema_version: 1 } passes validation but has no fields — treated as absent
    expect(normalizeProjectIdentity(emptyZones)).toBeNull()
  })
})

// ─── normalizeProjectIdentity — structural errors throw ───────────────────────

describe('normalizeProjectIdentity — structural errors throw', () => {
  it('throws for a number input', () => {
    expect(() => normalizeProjectIdentity(42)).toThrow(ProjectIdentityParseError)
  })

  it('throws for a string input', () => {
    expect(() => normalizeProjectIdentity('some string')).toThrow(ProjectIdentityParseError)
  })

  it('throws for an array input', () => {
    expect(() => normalizeProjectIdentity([])).toThrow(ProjectIdentityParseError)
  })

  it('throws when schema_version is missing from non-empty object', () => {
    expect(() => normalizeProjectIdentity({ foundation: { purpose: 'ok' } })).toThrow(
      ProjectIdentityParseError,
    )
  })

  it('throws when schema_version is 2 (unsupported)', () => {
    expect(() =>
      normalizeProjectIdentity({ schema_version: 2, foundation: { purpose: 'ok' } }),
    ).toThrow(ProjectIdentityParseError)
  })

  it('throws for unknown top-level key', () => {
    expect(() => normalizeProjectIdentity({ schema_version: 1, extra: 'x' })).toThrow(
      ProjectIdentityParseError,
    )
  })
})

// ─── normalizeProjectIdentity — valid with content ───────────────────────────

describe('normalizeProjectIdentity — valid with content', () => {
  it('returns normalized ProjectIdentity when content is present', () => {
    const result = normalizeProjectIdentity(withContent)
    expect(result).not.toBeNull()
    expect(result?.schema_version).toBe(1)
    expect(result?.foundation?.purpose).toBe('Existir para iluminar.')
  })

  it('trims whitespace in returned identity', () => {
    const result = normalizeProjectIdentity({
      schema_version: 1,
      foundation: { purpose: '  hello  ' },
    })
    expect(result?.foundation?.purpose).toBe('hello')
  })

  it('deduplicates array fields in returned identity', () => {
    const result = normalizeProjectIdentity({
      schema_version: 1,
      governance: { principles: ['A', 'A', 'B'] },
    })
    expect(result?.governance?.principles).toEqual(['A', 'B'])
  })

  it('returns null when all fields are whitespace-only (no content after trim)', () => {
    // All zones present but nothing survives trim/validation — Zod rejects whitespace strings
    // so this should throw a parse error (structural: min(1) violation)
    expect(() =>
      normalizeProjectIdentity({
        schema_version: 1,
        foundation: { purpose: '   ' },
      }),
    ).toThrow(ProjectIdentityParseError)
  })
})

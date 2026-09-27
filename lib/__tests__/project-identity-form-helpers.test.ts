import { describe, it, expect } from 'vitest'
import type { ProjectIdentity } from '@/lib/schemas/project-identity'
import {
  emptyFormState,
  identityToFormState,
  formStateToIdentityInput,
  lineStringToArray,
  arrayToLineString,
} from '@/lib/project-identity-form-helpers'
import {
  normalizeProjectIdentity,
  ProjectIdentityParseError,
} from '@/lib/project-identity-normalizer'

// ─── Case 1: null → emptyFormState ───────────────────────────────────────────

describe('case 1 — identity null → emptyFormState', () => {
  it('returns all-empty strings for null input', () => {
    const state = identityToFormState(null)
    expect(state).toEqual(emptyFormState())
    expect(state.purpose).toBe('')
    expect(state.audience).toBe('')
    expect(state.visual_identity).toBe('')
    expect(state.voice).toBe('')
    expect(state.principles).toBe('')
    expect(state.restrictions).toBe('')
    expect(state.generation_preferences).toBe('')
  })
})

// ─── Case 2: partial identity → partial formState ────────────────────────────

describe('case 2 — partial identity → formState with only those fields set', () => {
  it('maps partial identity correctly', () => {
    const identity: ProjectIdentity = {
      schema_version: 1,
      foundation: { purpose: 'Propósito do projeto' },
    }
    const state = identityToFormState(identity)
    expect(state.purpose).toBe('Propósito do projeto')
    expect(state.audience).toBe('')
    expect(state.visual_identity).toBe('')
    expect(state.voice).toBe('')
    expect(state.principles).toBe('')
    expect(state.restrictions).toBe('')
    expect(state.generation_preferences).toBe('')
  })
})

// ─── Case 3: full identity → all fields set ──────────────────────────────────

describe('case 3 — full identity → all fields set', () => {
  it('maps a complete identity to all form fields', () => {
    const identity: ProjectIdentity = {
      schema_version: 1,
      foundation: { purpose: 'Propósito' },
      relationship: { audience: 'Criadores visuais' },
      expression: { visual_identity: 'Dark aesthetic', voice: 'Tom direto' },
      governance: { principles: ['Autenticidade', 'Qualidade'], restrictions: ['Sem logos'] },
      practice: { generation_preferences: ['Luz natural', 'Foco central'] },
    }
    const state = identityToFormState(identity)
    expect(state.purpose).toBe('Propósito')
    expect(state.audience).toBe('Criadores visuais')
    expect(state.visual_identity).toBe('Dark aesthetic')
    expect(state.voice).toBe('Tom direto')
    expect(state.principles).toBe('Autenticidade\nQualidade')
    expect(state.restrictions).toBe('Sem logos')
    expect(state.generation_preferences).toBe('Luz natural\nFoco central')
  })
})

// ─── Case 4: identityToFormState preserves values (no mutation) ──────────────

describe('case 4 — identityToFormState does not mutate the input', () => {
  it('returns a new object without modifying the original identity', () => {
    const identity: ProjectIdentity = {
      schema_version: 1,
      foundation: { purpose: 'Propósito original' },
      governance: { principles: ['P1', 'P2'] },
    }
    const original = JSON.parse(JSON.stringify(identity))
    identityToFormState(identity)
    expect(identity).toEqual(original)
  })
})

// ─── Case 5: single field → only that zone in output ─────────────────────────

describe('case 5 — saving single field → formStateToIdentityInput has only that zone', () => {
  it('produces only foundation zone when only purpose is set', () => {
    const state = { ...emptyFormState(), purpose: 'Só o propósito' }
    const input = formStateToIdentityInput(state)
    expect(input.schema_version).toBe(1)
    expect(input.foundation).toEqual({ purpose: 'Só o propósito' })
    expect(input.relationship).toBeUndefined()
    expect(input.expression).toBeUndefined()
    expect(input.governance).toBeUndefined()
    expect(input.practice).toBeUndefined()
  })
})

// ─── Case 6: multiple zones → all present in output ──────────────────────────

describe('case 6 — saving multiple zones → all zones present in input', () => {
  it('includes all zones when all fields are set', () => {
    const state = {
      ...emptyFormState(),
      purpose: 'Propósito',
      audience: 'Público',
      visual_identity: 'Estética escura',
      voice: 'Tom direto',
      principles: 'Princípio A\\nPrincípio B',
      restrictions: 'Restrição X',
      generation_preferences: 'Luz natural',
    }
    const input = formStateToIdentityInput(state)
    expect(input.foundation).toBeDefined()
    expect(input.relationship).toBeDefined()
    expect(input.expression).toBeDefined()
    expect(input.governance).toBeDefined()
    expect(input.practice).toBeDefined()
  })
})

// ─── Case 7: editing preserves non-modified zones (round-trip) ───────────────

describe('case 7 — editing one field preserves other zones', () => {
  it('round-trip: identity → formState, modify voice, → result keeps original zones', () => {
    const identity: ProjectIdentity = {
      schema_version: 1,
      foundation: { purpose: 'Original purpose' },
      expression: { visual_identity: 'Dark aesthetic' },
    }
    const formState = identityToFormState(identity)
    const modified = { ...formState, voice: 'New voice tone' }
    const input = formStateToIdentityInput(modified)
    const result = normalizeProjectIdentity(input)
    expect(result?.foundation?.purpose).toBe('Original purpose')
    expect(result?.expression?.visual_identity).toBe('Dark aesthetic')
    expect(result?.expression?.voice).toBe('New voice tone')
  })
})

// ─── Case 8: removing one field, keeping others → zone present without it ────

describe('case 8 — removing one field keeps the zone with remaining fields', () => {
  it('expression zone keeps visual_identity if voice is cleared', () => {
    const state = {
      ...emptyFormState(),
      visual_identity: 'Dark aesthetic',
      voice: '', // cleared
    }
    const input = formStateToIdentityInput(state)
    expect(input.expression).toEqual({ visual_identity: 'Dark aesthetic' })
    expect((input.expression as Record<string, unknown>).voice).toBeUndefined()
  })

  it('removes governance zone entirely when both arrays become empty', () => {
    const state = {
      ...emptyFormState(),
      principles: '', // cleared
      restrictions: '', // cleared
    }
    const input = formStateToIdentityInput(state)
    expect(input.governance).toBeUndefined()
  })
})

// ─── Case 9: all fields empty → schema_version 1 only → normalize returns null

describe('case 9 — all fields empty → normalizeProjectIdentity returns null', () => {
  it('produces { schema_version: 1 } and normalizer returns null', () => {
    const state = emptyFormState()
    const input = formStateToIdentityInput(state)
    expect(input).toEqual({ schema_version: 1 })
    const result = normalizeProjectIdentity(input)
    expect(result).toBeNull()
  })
})

// ─── Case 10: arrays with spaces and duplicates ───────────────────────────────

describe('case 10 — arrays with whitespace and duplicates get normalized', () => {
  it('trims and deduplicates via normalizeProjectIdentity', () => {
    const state = emptyFormState()
    state.principles = '  Princípio A  \nPrincípio B\nPrincípio A'
    const input = formStateToIdentityInput(state)
    const result = normalizeProjectIdentity(input)
    // Zod deduplication via Set removes the duplicate
    expect(result?.governance?.principles).toEqual(['Princípio A', 'Princípio B'])
  })
})

// ─── Case 11: structural error → normalizeProjectIdentity throws ──────────────

describe('case 11 — invalid data → normalizeProjectIdentity throws ProjectIdentityParseError', () => {
  it('throws on unknown top-level key (strict schema)', () => {
    const invalid = {
      schema_version: 1,
      foundation: { purpose: 'OK' },
      unknownKey: 'bad', // strict rejects this
    }
    expect(() => normalizeProjectIdentity(invalid)).toThrow(ProjectIdentityParseError)
  })

  it('throws on wrong schema_version', () => {
    expect(() => normalizeProjectIdentity({ schema_version: 2 })).toThrow(ProjectIdentityParseError)
  })

  it('throws on non-object input', () => {
    expect(() => normalizeProjectIdentity('not an object')).toThrow(ProjectIdentityParseError)
  })
})

// ─── Case 13: formStateToIdentityInput output can be normalized successfully ──

describe('case 13 — formStateToIdentityInput output is always normalizable', () => {
  it('a fully filled state produces a valid normalizable output', () => {
    const state = {
      ...emptyFormState(),
      purpose: 'Propósito claro',
      audience: 'Fotógrafos profissionais',
      visual_identity: 'Minimalista e clean',
      voice: 'Técnico e preciso',
      principles: 'Qualidade acima de tudo\\nAutenticidade',
      restrictions: 'Sem filtros excessivos',
      generation_preferences: 'Luz natural\\nAngulo baixo',
    }
    const input = formStateToIdentityInput(state)
    expect(() => normalizeProjectIdentity(input)).not.toThrow()
    const result = normalizeProjectIdentity(input)
    expect(result).not.toBeNull()
    expect(result?.schema_version).toBe(1)
  })

  it('an empty state produces { schema_version: 1 } that normalizes to null without throwing', () => {
    const state = emptyFormState()
    const input = formStateToIdentityInput(state)
    expect(() => normalizeProjectIdentity(input)).not.toThrow()
    expect(normalizeProjectIdentity(input)).toBeNull()
  })
})

// ─── Case 14: identityToFormState does not mutate input ──────────────────────

describe('case 14 — identityToFormState does not mutate input identity', () => {
  it('identity object is unchanged after calling identityToFormState', () => {
    const identity: ProjectIdentity = {
      schema_version: 1,
      foundation: { purpose: 'Imutável' },
      governance: { principles: ['A', 'B'] },
    }
    const snapshot = JSON.parse(JSON.stringify(identity))
    const state = identityToFormState(identity)
    // Mutate the returned state
    state.purpose = 'Modificado'
    state.principles = 'Modificado'
    // Original identity must be unchanged
    expect(identity).toEqual(snapshot)
  })
})

// ─── Case 15: formStateToIdentityInput does not include forbidden keys ────────

describe('case 15 — formStateToIdentityInput output has no forbidden keys', () => {
  it('does not include context, style_profile, or evaluation_mode', () => {
    const state = {
      ...emptyFormState(),
      purpose: 'Propósito',
      audience: 'Público',
      visual_identity: 'Estilo',
      voice: 'Tom',
      principles: 'P1',
      restrictions: 'R1',
      generation_preferences: 'G1',
    }
    const input = formStateToIdentityInput(state)
    expect('context' in input).toBe(false)
    expect('style_profile' in input).toBe(false)
    expect('evaluation_mode' in input).toBe(false)
  })
})

// ─── Helpers unit tests ───────────────────────────────────────────────────────

describe('lineStringToArray', () => {
  it('splits by newline and trims', () => {
    expect(lineStringToArray('  A  \nB\n  C  ')).toEqual(['A', 'B', 'C'])
  })
  it('filters empty lines', () => {
    expect(lineStringToArray('A\n\n\nB')).toEqual(['A', 'B'])
  })
  it('returns empty array for empty string', () => {
    expect(lineStringToArray('')).toEqual([])
  })
})

describe('arrayToLineString', () => {
  it('joins with newline', () => {
    expect(arrayToLineString(['A', 'B', 'C'])).toBe('A\nB\nC')
  })
  it('returns empty string for empty array', () => {
    expect(arrayToLineString([])).toBe('')
  })
  it('returns empty string for undefined', () => {
    expect(arrayToLineString(undefined)).toBe('')
  })
})

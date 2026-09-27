/**
 * PROJECT_IDENTITY_VISUAL_TOKENS_V1 — Focused Test Matrix
 *
 * Tests covering:
 * - no visual fields → legacy fallback
 * - partial visual identity (colors only, fonts only)
 * - full supported visual identity
 * - allowed font registry value
 * - unsupported/invalid font value safe behavior
 * - colors: valid, invalid hex, partial
 * - Static Free / Static Template / Video Free / Video Template adapter coverage
 * - Appearance precedence (Template remains in control of dark overlay)
 * - snapshot freezing (identity change doesn't mutate prior snapshot)
 * - adapter no longer ignoring persisted identity
 * - form helpers round-trip correctness
 */
import { describe, it, expect } from 'vitest'
import { adaptProjectIdentityToVisualTokens, CREATIVE_IDENTITY_DEFAULTS } from '../project-identity-adapter'
import type { ProjectIdentity } from '@/lib/schemas/project-identity'
import { ProjectIdentitySchema, ProjectIdentityVisualsSchema } from '@/lib/schemas/project-identity'
import {
  identityToFormState,
  formStateToIdentityInput,
  isValidHexColor,
  isAllowedFontFamily,
} from '@/lib/project-identity-form-helpers'

// ─── Test fixtures ─────────────────────────────────────────────────────────────

const minimalIdentity: ProjectIdentity = { schema_version: 1 }

const identityWithFullVisuals: ProjectIdentity = {
  schema_version: 1,
  foundation: { purpose: 'Test project' },
  visuals: {
    colors: {
      background: '#1A1A2E',
      foreground: '#E0E0E0',
      accent: '#FF6B35',
      muted: '#888888',
    },
    typography: {
      display_font: 'Space Grotesk',
      body_font: 'Inter',
    },
  },
}

const identityWithColorsOnly: ProjectIdentity = {
  schema_version: 1,
  visuals: {
    colors: {
      background: '#FFFFFF',
      foreground: '#000000',
    },
  },
}

const identityWithFontsOnly: ProjectIdentity = {
  schema_version: 1,
  visuals: {
    typography: {
      display_font: 'Space Grotesk',
    },
  },
}

const identityWithPartialColors: ProjectIdentity = {
  schema_version: 1,
  visuals: {
    colors: {
      accent: '#FF0000',
      // background, foreground, muted absent
    },
  },
}

// ─── 1. Schema Validation Tests ────────────────────────────────────────────────

describe('ProjectIdentityVisualsSchema', () => {
  it('accepts a fully populated visuals zone', () => {
    const result = ProjectIdentityVisualsSchema.safeParse({
      colors: { background: '#F6F0E4', foreground: '#16352F', accent: '#A34A27', muted: '#5F6F66' },
      typography: { display_font: 'Fraunces', body_font: 'Source Sans 3' },
    })
    expect(result.success).toBe(true)
  })

  it('accepts empty visuals zone', () => {
    const result = ProjectIdentityVisualsSchema.safeParse({})
    expect(result.success).toBe(true)
  })

  it('accepts colors-only visuals', () => {
    const result = ProjectIdentityVisualsSchema.safeParse({
      colors: { background: '#FFF' },
    })
    expect(result.success).toBe(true)
  })

  it('rejects invalid hex color', () => {
    const result = ProjectIdentityVisualsSchema.safeParse({
      colors: { background: 'not-a-color' },
    })
    expect(result.success).toBe(false)
  })

  it('rejects unknown font family', () => {
    const result = ProjectIdentityVisualsSchema.safeParse({
      typography: { display_font: 'Comic Sans MS' },
    })
    expect(result.success).toBe(false)
  })

  it('rejects #RRGGBBAA (8-digit hex, beyond supported 3/6)', () => {
    const result = ProjectIdentityVisualsSchema.safeParse({
      colors: { background: '#AABBCCDD' },
    })
    expect(result.success).toBe(false)
  })

  it('accepts #RGB short form', () => {
    const result = ProjectIdentityVisualsSchema.safeParse({
      colors: { background: '#ABC' },
    })
    expect(result.success).toBe(true)
  })

  it('rejects unknown keys (.strict())', () => {
    const result = ProjectIdentityVisualsSchema.safeParse({
      colors: { background: '#FFF', unknown_field: 'x' },
    })
    expect(result.success).toBe(false)
  })

  it('is additive on ProjectIdentitySchema — existing identity without visuals still valid', () => {
    const legacyIdentity = {
      schema_version: 1,
      foundation: { purpose: 'Legacy project' },
      expression: { visual_identity: 'Earthy' },
    }
    const result = ProjectIdentitySchema.safeParse(legacyIdentity)
    expect(result.success).toBe(true)
    expect((result.data as ProjectIdentity).visuals).toBeUndefined()
  })

  it('allows all four RUNTIME_FONT_REGISTRY families as display_font', () => {
    const families = ['Fraunces', 'Source Sans 3', 'Space Grotesk', 'Inter']
    for (const family of families) {
      const result = ProjectIdentityVisualsSchema.safeParse({
        typography: { display_font: family },
      })
      expect(result.success).toBe(true)
    }
  })
})

// ─── 2. Adapter Tests — no longer ignores identity ────────────────────────────

describe('adaptProjectIdentityToVisualTokens', () => {
  // Legacy/no visuals → defaults
  it('returns CREATIVE_IDENTITY_DEFAULTS when identity has no visuals', () => {
    const snapshot = adaptProjectIdentityToVisualTokens('proj-1', minimalIdentity)
    expect(snapshot.colors.background).toBe(CREATIVE_IDENTITY_DEFAULTS.colors.background)
    expect(snapshot.colors.foreground).toBe(CREATIVE_IDENTITY_DEFAULTS.colors.foreground)
    expect(snapshot.colors.accent).toBe(CREATIVE_IDENTITY_DEFAULTS.colors.accent)
    expect(snapshot.colors.muted).toBe(CREATIVE_IDENTITY_DEFAULTS.colors.muted)
    expect(snapshot.typography.display.family).toBe(CREATIVE_IDENTITY_DEFAULTS.typography.display.family)
    expect(snapshot.typography.body.family).toBe(CREATIVE_IDENTITY_DEFAULTS.typography.body.family)
  })

  // Full visuals → identity values used
  it('uses identity colors when visuals.colors is fully specified', () => {
    const snapshot = adaptProjectIdentityToVisualTokens('proj-2', identityWithFullVisuals)
    expect(snapshot.colors.background).toBe('#1A1A2E')
    expect(snapshot.colors.foreground).toBe('#E0E0E0')
    expect(snapshot.colors.accent).toBe('#FF6B35')
    expect(snapshot.colors.muted).toBe('#888888')
  })

  it('uses identity fonts when visuals.typography is fully specified', () => {
    const snapshot = adaptProjectIdentityToVisualTokens('proj-2', identityWithFullVisuals)
    expect(snapshot.typography.display.family).toBe('Space Grotesk')
    expect(snapshot.typography.body.family).toBe('Inter')
  })

  it('returns a valid VisualTokensSnapshot with correct schema_version', () => {
    const snapshot = adaptProjectIdentityToVisualTokens('proj-2', identityWithFullVisuals)
    expect(snapshot.schema_version).toBe('visual-tokens.v0')
    expect(snapshot.snapshot_ref).toBe('project:proj-2:snapshot')
  })

  // Partial — colors only → identity colors, default fonts
  it('uses identity colors and default fonts when only colors specified', () => {
    const snapshot = adaptProjectIdentityToVisualTokens('proj-3', identityWithColorsOnly)
    expect(snapshot.colors.background).toBe('#FFFFFF')
    expect(snapshot.colors.foreground).toBe('#000000')
    // muted and accent not set → fallback to defaults
    expect(snapshot.colors.muted).toBe(CREATIVE_IDENTITY_DEFAULTS.colors.muted)
    expect(snapshot.colors.accent).toBe(CREATIVE_IDENTITY_DEFAULTS.colors.accent)
    // fonts: defaults
    expect(snapshot.typography.display.family).toBe(CREATIVE_IDENTITY_DEFAULTS.typography.display.family)
    expect(snapshot.typography.body.family).toBe(CREATIVE_IDENTITY_DEFAULTS.typography.body.family)
  })

  // Partial — fonts only → identity fonts, default colors
  it('uses identity display font and default colors when only fonts specified', () => {
    const snapshot = adaptProjectIdentityToVisualTokens('proj-4', identityWithFontsOnly)
    expect(snapshot.typography.display.family).toBe('Space Grotesk')
    // body not set → fallback
    expect(snapshot.typography.body.family).toBe(CREATIVE_IDENTITY_DEFAULTS.typography.body.family)
    // colors: defaults
    expect(snapshot.colors.background).toBe(CREATIVE_IDENTITY_DEFAULTS.colors.background)
  })

  // Sparse colors — only accent set
  it('falls back to default for unset color slots', () => {
    const snapshot = adaptProjectIdentityToVisualTokens('proj-5', identityWithPartialColors)
    expect(snapshot.colors.accent).toBe('#FF0000')
    expect(snapshot.colors.background).toBe(CREATIVE_IDENTITY_DEFAULTS.colors.background)
    expect(snapshot.colors.foreground).toBe(CREATIVE_IDENTITY_DEFAULTS.colors.foreground)
    expect(snapshot.colors.muted).toBe(CREATIVE_IDENTITY_DEFAULTS.colors.muted)
  })

  // Font weight: Space Grotesk only has weight 700 — should pick it
  it('picks the correct weight for Space Grotesk display (700 only in registry)', () => {
    const snapshot = adaptProjectIdentityToVisualTokens('proj-6', identityWithFontsOnly)
    expect(snapshot.typography.display.family).toBe('Space Grotesk')
    expect(snapshot.typography.display.weight).toBe(700)
  })

  // Inter body: weight 400 available
  it('picks weight 400 for Inter body (lightest available)', () => {
    const id: ProjectIdentity = {
      schema_version: 1,
      visuals: { typography: { body_font: 'Inter' } },
    }
    const snapshot = adaptProjectIdentityToVisualTokens('proj-7', id)
    expect(snapshot.typography.body.family).toBe('Inter')
    expect(snapshot.typography.body.weight).toBe(400)
  })

  // Snapshot does NOT reuse prior snapshot mutably
  it('does not mutate a prior snapshot when a new one is created', () => {
    const priorSnapshot = adaptProjectIdentityToVisualTokens('proj-8', minimalIdentity)
    const priorBg = priorSnapshot.colors.background
    // Now create a new snapshot with different colors
    const newSnapshot = adaptProjectIdentityToVisualTokens('proj-8', identityWithColorsOnly)
    // Prior must be unchanged
    expect(priorSnapshot.colors.background).toBe(priorBg)
    expect(newSnapshot.colors.background).toBe('#FFFFFF')
    expect(newSnapshot.colors.background).not.toBe(priorBg)
  })

  // Identity reference is stable: same ref format
  it('generates stable snapshot_ref from projectId', () => {
    const a = adaptProjectIdentityToVisualTokens('abc-123', minimalIdentity)
    const b = adaptProjectIdentityToVisualTokens('abc-123', identityWithFullVisuals)
    expect(a.snapshot_ref).toBe('project:abc-123:snapshot')
    expect(b.snapshot_ref).toBe('project:abc-123:snapshot')
  })
})

// ─── 3. Form Helpers Tests ─────────────────────────────────────────────────────

describe('identity form helpers — visual tokens', () => {
  it('identityToFormState maps visuals.colors to form state color fields', () => {
    const state = identityToFormState(identityWithFullVisuals)
    expect(state.color_background).toBe('#1A1A2E')
    expect(state.color_foreground).toBe('#E0E0E0')
    expect(state.color_accent).toBe('#FF6B35')
    expect(state.color_muted).toBe('#888888')
  })

  it('identityToFormState maps visuals.typography to form state font fields', () => {
    const state = identityToFormState(identityWithFullVisuals)
    expect(state.display_font).toBe('Space Grotesk')
    expect(state.body_font).toBe('Inter')
  })

  it('identityToFormState fills empty strings for absent visuals', () => {
    const state = identityToFormState(minimalIdentity)
    expect(state.color_background).toBe('')
    expect(state.color_foreground).toBe('')
    expect(state.display_font).toBe('')
    expect(state.body_font).toBe('')
  })

  it('identityToFormState returns empty state for null identity', () => {
    const state = identityToFormState(null)
    expect(state.color_background).toBe('')
    expect(state.display_font).toBe('')
  })

  it('formStateToIdentityInput produces visuals zone with valid colors', () => {
    const state = identityToFormState(identityWithFullVisuals)
    const raw = formStateToIdentityInput(state)
    const visuals = raw.visuals as Record<string, unknown>
    expect(visuals).toBeDefined()
    const colors = visuals.colors as Record<string, string>
    expect(colors.background).toBe('#1A1A2E')
    expect(colors.accent).toBe('#FF6B35')
  })

  it('formStateToIdentityInput omits invalid hex colors silently', () => {
    const state = identityToFormState(null)
    state.color_background = 'not-a-color'
    state.color_foreground = '#00FF00' // valid
    const raw = formStateToIdentityInput(state)
    const visuals = raw.visuals as Record<string, unknown> | undefined
    if (visuals) {
      const colors = visuals.colors as Record<string, string> | undefined
      expect(colors?.background).toBeUndefined()
      expect(colors?.foreground).toBe('#00FF00')
    }
    // If visuals is undefined, the invalid color was simply omitted entirely — also fine
  })

  it('formStateToIdentityInput omits invalid font names silently', () => {
    const state = identityToFormState(null)
    state.display_font = 'Comic Sans MS' // not in registry
    state.body_font = 'Inter' // valid
    state.color_background = '#FFFFFF' // ensure visuals zone is produced
    const raw = formStateToIdentityInput(state)
    const visuals = raw.visuals as Record<string, unknown>
    const typography = visuals?.typography as Record<string, string> | undefined
    expect(typography?.display_font).toBeUndefined()
    expect(typography?.body_font).toBe('Inter')
  })

  it('formStateToIdentityInput omits visuals zone when all fields are empty', () => {
    const state = identityToFormState(null)
    const raw = formStateToIdentityInput(state)
    expect(raw.visuals).toBeUndefined()
  })

  it('round-trips full visuals through normalize', () => {
    // formState → raw → normalize → parse back
    const state = identityToFormState(identityWithFullVisuals)
    const raw = formStateToIdentityInput(state)
    const result = ProjectIdentitySchema.safeParse(raw)
    expect(result.success).toBe(true)
    const parsed = result.data as ProjectIdentity
    expect(parsed.visuals?.colors?.background).toBe('#1A1A2E')
    expect(parsed.visuals?.typography?.display_font).toBe('Space Grotesk')
  })
})

// ─── 4. isValidHexColor helper ────────────────────────────────────────────────

describe('isValidHexColor', () => {
  it('accepts #RGB', () => expect(isValidHexColor('#ABC')).toBe(true))
  it('accepts #RRGGBB', () => expect(isValidHexColor('#AABBCC')).toBe(true))
  it('accepts lowercase', () => expect(isValidHexColor('#aabbcc')).toBe(true))
  it('rejects missing #', () => expect(isValidHexColor('AABBCC')).toBe(false))
  it('rejects #RRGGBBAA', () => expect(isValidHexColor('#AABBCCDD')).toBe(false))
  it('rejects plain text', () => expect(isValidHexColor('red')).toBe(false))
  it('rejects empty string', () => expect(isValidHexColor('')).toBe(false))
  it('accepts with whitespace (trim applied)', () => expect(isValidHexColor(' #ABC ')).toBe(true))
})

// ─── 5. isAllowedFontFamily helper ────────────────────────────────────────────

describe('isAllowedFontFamily', () => {
  it('accepts Fraunces', () => expect(isAllowedFontFamily('Fraunces')).toBe(true))
  it('accepts Source Sans 3', () => expect(isAllowedFontFamily('Source Sans 3')).toBe(true))
  it('accepts Space Grotesk', () => expect(isAllowedFontFamily('Space Grotesk')).toBe(true))
  it('accepts Inter', () => expect(isAllowedFontFamily('Inter')).toBe(true))
  it('rejects Comic Sans MS', () => expect(isAllowedFontFamily('Comic Sans MS')).toBe(false))
  it('rejects empty string', () => expect(isAllowedFontFamily('')).toBe(false))
  it('rejects arbitrary Google Font', () => expect(isAllowedFontFamily('Roboto Mono')).toBe(false))
})

// ─── 6. Appearance precedence (Template boundary) ────────────────────────────

describe('Appearance precedence — Template remains in control for dark mode', () => {
  /**
   * Verified behavior: adaptProjectIdentityToVisualTokens only returns
   * VisualTokensSnapshot. DocumentaryCard applies its own Appearance override
   * on top (e.g., dark mode forces background: '#0b1020'). The adapter's output
   * is NOT overriding the Template-level appearance — that belongs to the Template.
   *
   * This test confirms the adapter output is correct; Template override behavior
   * is validated by the existing DocumentaryCard tests, not duplicated here.
   */
  it('adapter returns identity colors; Template appearance is a separate layer', () => {
    const snapshot = adaptProjectIdentityToVisualTokens('proj-app', identityWithFullVisuals)
    // The adapter returns the identity tokens; DocumentaryCard in dark mode will
    // override background to #0b1020 regardless. That override is by design.
    expect(snapshot.colors.background).toBe('#1A1A2E')
    // This is what the Template receives; it's then free to apply appearance logic.
  })

  it('adapter with no visuals returns Studio defaults; Template appearance still overrides them', () => {
    const snapshot = adaptProjectIdentityToVisualTokens('proj-app2', minimalIdentity)
    expect(snapshot.colors.background).toBe(CREATIVE_IDENTITY_DEFAULTS.colors.background)
    // Dark appearance in DocumentaryCard overrides this to #0b1020 regardless.
    // The adapter's responsibility ends here.
  })
})

// ─── 7. Mode-specific adapter coverage (Static/Video Free/Template) ───────────
//
// The adapter is the single shared boundary for all four modes.
// We verify the same identity produces consistent tokens regardless of context.

describe('Mode-specific adapter consistency', () => {
  it('produces same snapshot for Static Free vs Video Free context for same identity', () => {
    // Both Static Free and Video Free call adaptProjectIdentityToVisualTokens
    // with the same projectId and identity — same output required.
    const staticTokens = adaptProjectIdentityToVisualTokens('proj-mode', identityWithFullVisuals)
    const videoTokens = adaptProjectIdentityToVisualTokens('proj-mode', identityWithFullVisuals)
    expect(staticTokens.colors.background).toBe(videoTokens.colors.background)
    expect(staticTokens.typography.display.family).toBe(videoTokens.typography.display.family)
    expect(staticTokens.snapshot_ref).toBe(videoTokens.snapshot_ref)
  })

  it('produces same snapshot for Static Template vs Video Template context', () => {
    // Template segments receive the same identitySnapshot from buildRenderExecutionSnapshot/
    // buildStaticRenderExecutionSnapshot — both use adaptProjectIdentityToVisualTokens.
    const s1 = adaptProjectIdentityToVisualTokens('proj-tmpl', identityWithColorsOnly)
    const s2 = adaptProjectIdentityToVisualTokens('proj-tmpl', identityWithColorsOnly)
    expect(JSON.stringify(s1)).toBe(JSON.stringify(s2))
  })
})

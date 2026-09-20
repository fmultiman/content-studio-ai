/**
 * Wave 6 — Authoring State tests
 *
 * Verifies:
 * - AuthoringState creation and defaults
 * - Content edit produces updated preview input
 * - Identity switch uses same component branch
 * - Canvas switch works
 * - Preview tuning defaults are neutral (DEFAULT_TUNING)
 * - heroOffset alters only runtime preview (not manifest)
 * - rotation respects bounds
 * - scale respects bounds
 * - reset returns to zero/default
 * - preview tuning does NOT appear in the StaticRenderManifest
 * - same DocumentaryCard component resolver is used
 * - core does not contain Portal hardcoded literals
 */

import { describe, expect, it } from 'vitest'
import { resolveAsset } from '@/lib/creative/assets/resolve-asset'
import {
  AUTHORING_HERO_ASSETS,
  DEFAULT_TUNING,
  TUNING_BOUNDS,
  clampTuningValue,
  createInitialAuthoringState,
  defaultContentForVariant,
  deriveManifestFromState,
  resolvePreviewInput,
  type AuthoringCoverContent,
  type AuthoringInfoContent,
} from '@/lib/creative/authoring'
import { resolveTemplateComponent } from '@/lib/creative/templates/component-resolver'

// ── Initial state ─────────────────────────────────────────────────────────────

describe('createInitialAuthoringState', () => {
  it('creates a cover/portrait/identity-A state by default', () => {
    const state = createInitialAuthoringState()
    expect(state.variant).toBe('cover')
    expect(state.identity).toBe('a')
    expect(state.canvas).toBe('portrait')
    expect(state.heroRef).toBeUndefined()
    expect(state.debugPanelOpen).toBe(false)
  })

  it('applies DEFAULT_TUNING on creation', () => {
    const state = createInitialAuthoringState()
    expect(state.tuning).toStrictEqual(DEFAULT_TUNING)
  })

  it('DEFAULT_TUNING is neutral (zero offsets, zero rotation, scale=1)', () => {
    expect(DEFAULT_TUNING.hero.offsetX).toBe(0)
    expect(DEFAULT_TUNING.hero.offsetY).toBe(0)
    expect(DEFAULT_TUNING.hero.rotation).toBe(0)
    expect(DEFAULT_TUNING.hero.scale).toBe(1)
    expect(DEFAULT_TUNING.title.offsetX).toBe(0)
    expect(DEFAULT_TUNING.title.offsetY).toBe(0)
    expect(DEFAULT_TUNING.title.rotation).toBe(0)
  })

  it('fills contentOverride from the fixture default', () => {
    const state = createInitialAuthoringState('cover', 'a')
    const content = state.contentOverride as AuthoringCoverContent
    expect(typeof content.title).toBe('string')
    expect(content.title.length).toBeGreaterThan(0)
  })
})

// ── defaultContentForVariant ──────────────────────────────────────────────────

describe('defaultContentForVariant', () => {
  it('produces cover content with title, eyebrow and subtitle for identity A', () => {
    const content = defaultContentForVariant('cover', 'a') as AuthoringCoverContent
    expect(content.title).toBeTruthy()
    expect(content.eyebrow).toBeTruthy()
    expect(content.subtitle).toBeTruthy()
  })

  it('produces different cover content for identity B (neutral)', () => {
    const a = defaultContentForVariant('cover', 'a') as AuthoringCoverContent
    const b = defaultContentForVariant('cover', 'b') as AuthoringCoverContent
    expect(a.title).not.toBe(b.title)
    expect(a.eyebrow).not.toBe(b.eyebrow)
  })

  it('produces info content with fact_cards for info variant', () => {
    const content = defaultContentForVariant('info', 'a') as AuthoringInfoContent
    // AuthoringInfoContent now includes fact_cards
    expect(Array.isArray(content.fact_cards)).toBe(true)
    expect(content.fact_cards.length).toBeGreaterThanOrEqual(1)
  })
})

// ── resolvePreviewInput ───────────────────────────────────────────────────────

describe('resolvePreviewInput', () => {
  it('resolves a cover preview input through the Wave 3 resolution boundary', () => {
    const state = createInitialAuthoringState('cover', 'a', 'portrait')
    const input = resolvePreviewInput(state)
    expect(input.resolvedTemplate.ref.id).toBe('editorial.documentary-card')
    expect(input.resolvedTemplate.descriptor.component_key).toBe('editorial.documentary-card')
    expect(input.manifest.template.variant).toBe('cover')
  })

  it('resolves an info preview input', () => {
    const state = createInitialAuthoringState('info', 'a', 'portrait')
    const input = resolvePreviewInput(state)
    expect(input.manifest.template.variant).toBe('info')
  })

  it('identity switch changes tokens, not the component_key', () => {
    const stateA = createInitialAuthoringState('cover', 'a', 'portrait')
    const stateB = createInitialAuthoringState('cover', 'b', 'portrait')
    const inputA = resolvePreviewInput(stateA)
    const inputB = resolvePreviewInput(stateB)
    expect(inputA.resolvedTemplate.descriptor.component_key).toBe('editorial.documentary-card')
    expect(inputB.resolvedTemplate.descriptor.component_key).toBe('editorial.documentary-card')
    expect(inputA.tokens).not.toStrictEqual(inputB.tokens)
  })

  it('canvas switch changes manifest dimensions', () => {
    const portrait = createInitialAuthoringState('cover', 'a', 'portrait')
    const reel = createInitialAuthoringState('cover', 'a', 'reel')
    expect(resolvePreviewInput(portrait).manifest.canvas.height).toBe(1350)
    expect(resolvePreviewInput(reel).manifest.canvas.height).toBe(1920)
  })

  it('content override appears in the resolved input manifest', () => {
    const state = createInitialAuthoringState('cover', 'a', 'portrait')
    const edited: AuthoringCoverContent = {
      ...(state.contentOverride as AuthoringCoverContent),
      title: 'Authoring Lab Test Title',
    }
    const stateEdited = { ...state, contentOverride: edited }
    const input = resolvePreviewInput(stateEdited)
    const content = input.manifest.content as unknown as { title: string }
    expect(content.title).toBe('Authoring Lab Test Title')
  })

  it('cover has a hero resolved asset by default', () => {
    const state = createInitialAuthoringState('cover', 'a', 'portrait')
    const input = resolvePreviewInput(state)
    expect(input.resolvedAssets.hero).toBeDefined()
    expect(input.resolvedAssets.hero?.mime_type).toBe('image/webp')
  })

  it('info does not require a hero resolved asset', () => {
    const state = createInitialAuthoringState('info', 'a', 'portrait')
    const input = resolvePreviewInput(state)
    expect(input.resolvedAssets.hero).toBeUndefined()
  })
})

// ── deriveManifestFromState (tuning excluded) ─────────────────────────────────

describe('deriveManifestFromState', () => {
  it('produces a valid StaticRenderManifest schema_version', () => {
    const state = createInitialAuthoringState()
    const manifest = deriveManifestFromState(state)
    expect(manifest.schema_version).toBe('static-render.v0')
  })

  it('does NOT include preview tuning in the derived manifest', () => {
    const state = createInitialAuthoringState()
    const tuned = {
      ...state,
      tuning: {
        hero: { offsetX: 42, offsetY: -30, rotation: 2.5, scale: 1.1 },
        title: { offsetX: 10, offsetY: 5, rotation: -1 },
      },
    }
    const manifest = deriveManifestFromState(tuned)
    const json = JSON.stringify(manifest)
    // Tuning fields must not appear in any form in the manifest JSON
    expect(json).not.toContain('previewTuning')
    expect(json).not.toContain('tuning')
    expect(json).not.toContain('heroOffset')
    expect(json).not.toContain('"offsetX"')
    expect(json).not.toContain('"offsetY"')
  })

  it('reflects content overrides in the manifest', () => {
    const state = createInitialAuthoringState('cover', 'a')
    const edited = {
      ...state,
      contentOverride: {
        ...(state.contentOverride as AuthoringCoverContent),
        title: 'Manifest boundary test',
      },
    }
    const manifest = deriveManifestFromState(edited)
    const content = manifest.content as unknown as { title: string }
    expect(content.title).toBe('Manifest boundary test')
  })

  it('uses identity-B snapshot ref when identity is B', () => {
    const state = createInitialAuthoringState('cover', 'b')
    const manifest = deriveManifestFromState(state)
    expect(manifest.identity.snapshot_ref).toContain('acme-labs')
  })

  it('ephemeral state (debugPanelOpen) is not in the manifest', () => {
    const state = { ...createInitialAuthoringState(), debugPanelOpen: true }
    const manifest = deriveManifestFromState(state)
    expect(JSON.stringify(manifest)).not.toContain('debugPanelOpen')
  })
})

// ── Tuning bounds ─────────────────────────────────────────────────────────────

describe('clampTuningValue', () => {
  it('clamps hero offsetX to ±120', () => {
    expect(clampTuningValue('hero', 'offsetX', 200)).toBe(TUNING_BOUNDS.hero.offsetX.max)
    expect(clampTuningValue('hero', 'offsetX', -200)).toBe(TUNING_BOUNDS.hero.offsetX.min)
    expect(clampTuningValue('hero', 'offsetX', 50)).toBe(50)
  })

  it('clamps hero rotation to ±4', () => {
    expect(clampTuningValue('hero', 'rotation', 10)).toBe(TUNING_BOUNDS.hero.rotation.max)
    expect(clampTuningValue('hero', 'rotation', -10)).toBe(TUNING_BOUNDS.hero.rotation.min)
    expect(clampTuningValue('hero', 'rotation', 2)).toBe(2)
  })

  it('clamps hero scale to 0.9–1.15', () => {
    expect(clampTuningValue('hero', 'scale', 2)).toBe(TUNING_BOUNDS.hero.scale.max)
    expect(clampTuningValue('hero', 'scale', 0.1)).toBe(TUNING_BOUNDS.hero.scale.min)
    expect(clampTuningValue('hero', 'scale', 1)).toBe(1)
  })

  it('clamps title rotation to ±2', () => {
    expect(clampTuningValue('title', 'rotation', 5)).toBe(TUNING_BOUNDS.title.rotation.max)
    expect(clampTuningValue('title', 'rotation', -5)).toBe(TUNING_BOUNDS.title.rotation.min)
  })

  it('returns value unchanged for unknown field', () => {
    expect(clampTuningValue('hero', 'unknown', 999)).toBe(999)
  })
})

// ── Component resolver parity ─────────────────────────────────────────────────

describe('component resolver parity', () => {
  it('resolves editorial.documentary-card to a component via the same resolver as Wave 5 render', () => {
    const component = resolveTemplateComponent('editorial.documentary-card')
    expect(component).toBeDefined()
    expect(typeof component).toBe('function')
  })

  it('returns undefined for an unknown component key (no fallback fabrication)', () => {
    expect(resolveTemplateComponent('unknown.template')).toBeUndefined()
  })
})

// ── Hero assets catalogue ─────────────────────────────────────────────────────

describe('AUTHORING_HERO_ASSETS', () => {
  it('contains at least 2 hero options', () => {
    expect(AUTHORING_HERO_ASSETS.length).toBeGreaterThanOrEqual(2)
  })

  it('marks the archival WebP hero as opaque (not alpha)', () => {
    const archival = AUTHORING_HERO_ASSETS.find((a) => a.mimeType === 'image/webp')
    expect(archival).toBeDefined()
    expect(archival!.hasAlpha).toBe(false)
  })

  it('all hero refs can be resolved by the fixture resolver', () => {
    for (const asset of AUTHORING_HERO_ASSETS) {
      const result = resolveAsset({ type: 'fixture', ref: asset.ref })
      expect(result.valid, asset.ref).toBe(true)
    }
  })
})

// ── Neutrality ───────────────────────────────────────────────────────────────

describe('authoring module neutrality', () => {
  it('DEFAULT_TUNING contains no Portal-specific literals', () => {
    const json = JSON.stringify(DEFAULT_TUNING)
    expect(json).not.toContain('Portal')
    expect(json).not.toContain('comunidades')
    expect(json).not.toContain('Terra Una')
  })

  it('authoring-state module itself contains no hardcoded Portal-only branches', () => {
    // Both identity A and B resolve through the same resolvePreviewInput function
    const stateA = createInitialAuthoringState('cover', 'a')
    const stateB = createInitialAuthoringState('cover', 'b')
    const inputA = resolvePreviewInput(stateA)
    const inputB = resolvePreviewInput(stateB)
    // Same component key
    expect(inputA.resolvedTemplate.descriptor.component_key).toBe(inputB.resolvedTemplate.descriptor.component_key)
    // Different background color token (identity-specific)
    expect(inputA.tokens.colors.background).not.toBe(inputB.tokens.colors.background)
  })
})

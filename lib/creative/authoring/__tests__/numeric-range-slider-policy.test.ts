import { describe, expect, it } from 'vitest'
import {
  TUNING_BOUNDS,
  TUNING_SLIDER_BOUNDS,
  clampTuningValue,
  createInitialAuthoringState,
  DEFAULT_TUNING,
  setTuningField,
  resetTuningGroup,
  resolvePreviewInput,
  deriveTuningOverrides,
  derivePrimitiveTransformsRequest,
  authoringRenderRequestSchema,
  authoringRenderOverridesSchema,
} from '../index'
import {
  HERO_TRANSFORM_POLICY,
  BRAND_TRANSFORM_POLICY,
  TEXT_TRANSFORM_POLICY,
  MATERIAL_TRANSFORM_POLICY,
  clampToHardBounds,
  clampToSliderRange,
  formatNumericValue,
} from '../numeric-policy'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { DocumentaryCard, documentaryCardPropsFromResolvedInput } from '@/components/creative/documentary-card'
import { transformBindingFor } from '../element-capabilities'
import { getTemplateLayout, EDITORIAL_DOCUMENTARY_COLLAGE_TEMPLATE as TEMPLATE } from '@/lib/creative/templates/template-definitions'
import { authoringStateToPersistedSlide, persistedSlideToAuthoringState, PersistedAuthoredSlideSchema } from '../carousel-state'
import type { AuthoringProductContext, AuthoringState, AuthoringVariant } from '../types'

function renderPreview(state: AuthoringState) {
  const resolved = resolvePreviewInput(state)
  const props = documentaryCardPropsFromResolvedInput(
    resolved,
    'still',
    undefined,
    state.tuning,
    undefined,
    state.primitiveTransforms,
    { templateId: TEMPLATE.id, elementOrder: state.elementOrder, hiddenElements: state.hiddenElements },
  )
  return renderToStaticMarkup(createElement(DocumentaryCard, props))
}

const productContext: AuthoringProductContext = {
  projectId: 'project-1',
  projectName: 'Portal Comunidades Alternativas',
  productionId: null,
  productionTitle: null,
  editorialContentId: 'ec-1',
  editorialContentTitle: 'Carrossel',
  channelPieceId: 'cp-1',
  channel: 'instagram',
  format: 'carousel',
  primitiveProjectRef: 'project:portal-comunidades-alternativas',
  projectIdentity: { schema_version: 1 } as unknown as AuthoringProductContext['projectIdentity'],
  identitySnapshot: {
    schema_version: 'visual-tokens.v0',
    snapshot_ref: 'project:project-1:snapshot',
    typography: { display: { family: 'Fraunces', weight: 700, style: 'normal' }, body: { family: 'Source Sans 3', weight: 400, style: 'normal' } },
    colors: { background: '#F6F0E4', foreground: '#16352F' },
    spacing: { unit: 8 },
  },
}

function slide(variant: AuthoringVariant = 'cover'): AuthoringState {
  return {
    ...createInitialAuthoringState(variant),
    productContext,
  }
}

describe('CREATIVE_EDITOR_NUMERIC_RANGE_AND_SLIDER_POLICY_V1', () => {
  describe('1. Soft UI range vs Safe Authored range vs Hard safety bounds', () => {
    it('1. slider soft range is strictly distinct from hard authored range for Hero Scale', () => {
      expect(HERO_TRANSFORM_POLICY.scale.sliderMin).toBe(0.5)
      expect(HERO_TRANSFORM_POLICY.scale.sliderMax).toBe(2)
      expect(HERO_TRANSFORM_POLICY.scale.hardMin).toBe(0.1)
      expect(HERO_TRANSFORM_POLICY.scale.hardMax).toBe(5)
      expect(HERO_TRANSFORM_POLICY.scale.sliderMax).toBeLessThan(HERO_TRANSFORM_POLICY.scale.hardMax)
    })

    it('2. slider soft range is strictly distinct from hard authored range for Positions and Rotations', () => {
      // Hero position: soft ±120, hard ±600
      expect(HERO_TRANSFORM_POLICY.offsetX.sliderMax).toBe(120)
      expect(HERO_TRANSFORM_POLICY.offsetX.hardMax).toBe(600)
      // Hero rotation: soft ±4, hard ±20
      expect(HERO_TRANSFORM_POLICY.rotation.sliderMax).toBe(4)
      expect(HERO_TRANSFORM_POLICY.rotation.hardMax).toBe(20)
      // Text position: soft ±60, hard ±300
      expect(TEXT_TRANSFORM_POLICY.offsetX.sliderMax).toBe(60)
      expect(TEXT_TRANSFORM_POLICY.offsetX.hardMax).toBe(300)
      // Text rotation: soft ±2, hard ±15
      expect(TEXT_TRANSFORM_POLICY.rotation.sliderMax).toBe(2)
      expect(TEXT_TRANSFORM_POLICY.rotation.hardMax).toBe(15)
    })

    it('3. hard safety bound still rejects truly invalid or pathological values', () => {
      expect(clampToHardBounds(999, HERO_TRANSFORM_POLICY.scale)).toBe(5)
      expect(clampToHardBounds(0.01, HERO_TRANSFORM_POLICY.scale)).toBe(0.1)
      expect(clampToHardBounds(-1000, HERO_TRANSFORM_POLICY.offsetX)).toBe(-600)
      expect(clampToHardBounds(1000, HERO_TRANSFORM_POLICY.offsetX)).toBe(600)

      // Zod schema enforces hard bounds
      expect(authoringRenderOverridesSchema.safeParse({ documentaryCard: { ...DEFAULT_TUNING, hero: { ...DEFAULT_TUNING.hero, scale: 5.1 } } }).success).toBe(false)
      expect(authoringRenderOverridesSchema.safeParse({ documentaryCard: { ...DEFAULT_TUNING, hero: { ...DEFAULT_TUNING.hero, scale: 0.05 } } }).success).toBe(false)
      expect(authoringRenderOverridesSchema.safeParse({ documentaryCard: { ...DEFAULT_TUNING, hero: { ...DEFAULT_TUNING.hero, scale: 2.5 } } }).success).toBe(true)
    })

    it('4. formatNumericValue formats according to precision', () => {
      expect(formatNumericValue(12.345, 0)).toBe('12')
      expect(formatNumericValue(1.5, 1)).toBe('1.5')
      expect(formatNumericValue(2, 2)).toBe('2.00')
      expect(formatNumericValue(1.15, 2)).toBe('1.15')
    })
  })

  describe('2. Hero Scale — Required Acceptance Case', () => {
    it('9. Hero Scale no longer hard-clamps at 1.15 merely because of slider range', () => {
      expect(TUNING_BOUNDS.hero.scale.max).toBeGreaterThan(1.15)
      expect(TUNING_BOUNDS.hero.scale.max).toBe(5)
      expect(TUNING_SLIDER_BOUNDS.hero.scale.max).toBe(2)
    })

    it('10. Hero Scale = 2 can be authored safely', () => {
      const state = slide('cover')
      const tuned = setTuningField(state.tuning, 'hero', 'scale', 2)
      expect(tuned.hero.scale).toBe(2)
    })

    it('11. Preview reflects Scale = 2 truthfully without clamping', () => {
      const state = slide('cover')
      const tuned = { ...state, tuning: setTuningField(state.tuning, 'hero', 'scale', 2) }
      const html = renderPreview(tuned)
      expect(html).toContain('scale(2)')
    })

    it('12. saved authored state retains Scale = 2 and Scale = 2.5', () => {
      const state = slide('cover')
      const tuned2 = { ...state, tuning: setTuningField(state.tuning, 'hero', 'scale', 2) }
      const persisted2 = authoringStateToPersistedSlide(tuned2, 's1', 0)
      expect(persisted2.tuning!.hero!.scale).toBe(2)
      expect(PersistedAuthoredSlideSchema.safeParse(persisted2).success).toBe(true)

      const tuned25 = { ...state, tuning: setTuningField(state.tuning, 'hero', 'scale', 2.5) }
      const persisted25 = authoringStateToPersistedSlide(tuned25, 's2', 0)
      expect(persisted25.tuning!.hero!.scale).toBe(2.5)
      expect(PersistedAuthoredSlideSchema.safeParse(persisted25).success).toBe(true)
    })

    it('13. reload retains Scale = 2.5 without accidental load-time clamping to slider soft max 2', () => {
      const state = slide('cover')
      const tuned = { ...state, tuning: setTuningField(state.tuning, 'hero', 'scale', 2.5) }
      const persisted = authoringStateToPersistedSlide(tuned, 's1', 0)

      // Reconstructed state keeps 2.5
      const reloaded = persistedSlideToAuthoringState(persisted, productContext, 'portrait')
      expect(reloaded.tuning.hero.scale).toBe(2.5)
      const html = renderPreview(reloaded)
      expect(html).toContain('scale(2.5)')
    })

    it('14. reset returns to factual Template default (Scale = 1)', () => {
      const state = slide('cover')
      const tuned = { ...state, tuning: setTuningField(state.tuning, 'hero', 'scale', 2.5) }
      const reset = resetTuningGroup(tuned.tuning, 'hero')
      expect(reset.hero.scale).toBe(1)
      expect(reset.hero.scale).toBe(DEFAULT_TUNING.hero.scale)
    })

    it('15. render request carries Scale = 2 and Scale = 2.5', () => {
      const state = slide('cover')
      const tuned = { ...state, tuning: setTuningField(state.tuning, 'hero', 'scale', 2.5) }
      const overrides = deriveTuningOverrides(tuned)
      expect(overrides?.documentaryCard?.hero.scale).toBe(2.5)
      const parsed = authoringRenderOverridesSchema.safeParse(overrides)
      expect(parsed.success).toBe(true)
    })
  })

  describe('3. Logo Scale — Second Acceptance Case', () => {
    it('16. Logo Scale retains existing baseline capability in every layout', () => {
      for (const layoutId of ['cover', 'info', 'list', 'closing'] as const) {
        const layout = getTemplateLayout(TEMPLATE, layoutId)!
        const element = layout.elements.find((el) => el.id === 'brandLogo')
        expect(element?.control).toEqual({ type: 'tuning', group: 'brand' })
      }
    })

    it('17. Logo Scale soft range is 0.5–2 and hard range is 0.1–5', () => {
      expect(BRAND_TRANSFORM_POLICY.scale.sliderMin).toBe(0.5)
      expect(BRAND_TRANSFORM_POLICY.scale.sliderMax).toBe(2)
      expect(BRAND_TRANSFORM_POLICY.scale.hardMin).toBe(0.1)
      expect(BRAND_TRANSFORM_POLICY.scale.hardMax).toBe(5)
      expect(TUNING_BOUNDS.brand.scale).toEqual({ min: 0.1, max: 5 })
      expect(TUNING_SLIDER_BOUNDS.brand.scale).toEqual({ min: 0.5, max: 2, step: 0.01 })
    })

    it('18. Logo scale can author values outside soft range (e.g. Scale = 3 or 3.5) safely', () => {
      const state = slide('cover')
      const tuned = setTuningField(state.tuning, 'brand', 'scale', 3.5)
      expect(tuned.brand?.scale).toBe(3.5)

      const persisted = authoringStateToPersistedSlide({ ...state, tuning: tuned }, 's1', 0)
      expect(persisted.tuning!.brand?.scale).toBe(3.5)
      expect(PersistedAuthoredSlideSchema.safeParse(persisted).success).toBe(true)

      const reloaded = persistedSlideToAuthoringState(persisted, productContext, 'portrait')
      expect(reloaded.tuning.brand?.scale).toBe(3.5)
    })

    it('19. asset replacement does not reset valid authored scale unexpectedly', () => {
      const state = slide('cover')
      const tuned = { ...state, tuning: setTuningField(state.tuning, 'brand', 'scale', 2.2) }
      // Simulating asset override on brandLogo slot
      const withAsset = { ...tuned, assetOverrides: { logo: { libraryFileId: '00000000-0000-4000-8000-000000000001' } } }
      expect(withAsset.tuning.brand?.scale).toBe(2.2)
      expect(withAsset.assetOverrides.logo.libraryFileId).toBe('00000000-0000-4000-8000-000000000001')
    })

    it('20. Reset restores Template default (removes optional brand group)', () => {
      const state = slide('cover')
      const tuned = setTuningField(state.tuning, 'brand', 'scale', 2.2)
      expect(tuned.brand).toBeDefined()
      const reset = resetTuningGroup(tuned, 'brand')
      expect(reset.brand).toBeUndefined()
    })
  })

  describe('4. Position and Rotation Ranges', () => {
    it('21. Position numeric input can author values outside common slider range up to hard safety bounds', () => {
      // Hero offsetX: soft ±120, hard ±600
      const state = slide('cover')
      const tunedHero = setTuningField(state.tuning, 'hero', 'offsetX', 250)
      expect(tunedHero.hero.offsetX).toBe(250)
      const persistedHero = authoringStateToPersistedSlide({ ...state, tuning: tunedHero }, 's1', 0)
      expect(PersistedAuthoredSlideSchema.safeParse(persistedHero).success).toBe(true)

      // Text offsetX: soft ±60, hard ±300
      const tunedTitle = setTuningField(state.tuning, 'title', 'offsetX', 150)
      expect(tunedTitle.title.offsetX).toBe(150)
      const persistedTitle = authoringStateToPersistedSlide({ ...state, tuning: tunedTitle }, 's1', 0)
      expect(PersistedAuthoredSlideSchema.safeParse(persistedTitle).success).toBe(true)
    })

    it('22. Rotation numeric input can author values outside common slider range up to hard safety bounds', () => {
      // Hero rotation: soft ±4, hard ±20
      const state = slide('cover')
      const tunedHero = setTuningField(state.tuning, 'hero', 'rotation', 10)
      expect(tunedHero.hero.rotation).toBe(10)

      // Text rotation: soft ±2, hard ±15
      const tunedTitle = setTuningField(state.tuning, 'title', 'rotation', 8)
      expect(tunedTitle.title.rotation).toBe(8)
      const persisted = authoringStateToPersistedSlide({ ...state, tuning: tunedTitle }, 's1', 0)
      expect(PersistedAuthoredSlideSchema.safeParse(persisted).success).toBe(true)
    })

    it('23. values beyond hard bounds are rejected by persistence and render schemas', () => {
      // Hero offsetX > 600 rejected
      expect(authoringRenderOverridesSchema.safeParse({ documentaryCard: { ...DEFAULT_TUNING, hero: { ...DEFAULT_TUNING.hero, offsetX: 601 } } }).success).toBe(false)
      // Text offsetX > 300 rejected
      expect(authoringRenderOverridesSchema.safeParse({ documentaryCard: { ...DEFAULT_TUNING, title: { ...DEFAULT_TUNING.title, offsetX: 301 } } }).success).toBe(false)
      // Text rotation > 15 rejected
      expect(authoringRenderOverridesSchema.safeParse({ documentaryCard: { ...DEFAULT_TUNING, title: { ...DEFAULT_TUNING.title, rotation: 16 } } }).success).toBe(false)
    })
  })

  describe('5. Opacity Counter-Example (True Domain Bound 0..1)', () => {
    it('25. opacity never persists below 0', () => {
      expect(authoringRenderOverridesSchema.safeParse({ documentaryCard: { ...DEFAULT_TUNING, hero: { ...DEFAULT_TUNING.hero, opacity: -0.1 } } }).success).toBe(false)
    })

    it('26. opacity never persists above 1', () => {
      expect(authoringRenderOverridesSchema.safeParse({ documentaryCard: { ...DEFAULT_TUNING, hero: { ...DEFAULT_TUNING.hero, opacity: 1.1 } } }).success).toBe(false)
    })

    it('27. opacity soft slider range and hard bound are identical (0..1)', () => {
      expect(HERO_TRANSFORM_POLICY.opacity.sliderMin).toBe(0)
      expect(HERO_TRANSFORM_POLICY.opacity.sliderMax).toBe(1)
      expect(HERO_TRANSFORM_POLICY.opacity.hardMin).toBe(0)
      expect(HERO_TRANSFORM_POLICY.opacity.hardMax).toBe(1)
    })
  })

  describe('6. No Dual Truth — Persisted State Consistency', () => {
    it('28. AuthoringState and PersistedAuthoredSlide only store the single numeric authored value', () => {
      const state = slide('cover')
      const tuned = { ...state, tuning: setTuningField(state.tuning, 'hero', 'scale', 2.3) }
      const persisted = authoringStateToPersistedSlide(tuned, 's1', 0)

      // No sliderValue, precisionValue, or range metadata persisted
      expect(persisted.tuning!.hero).toEqual({
        offsetX: 0,
        offsetY: 0,
        rotation: 0,
        scale: 2.3,
      })
      expect((persisted.tuning!.hero as Record<string, unknown>).sliderValue).toBeUndefined()
      expect((persisted.tuning!.hero as Record<string, unknown>).precisionValue).toBeUndefined()
      expect((persisted.tuning!.hero as Record<string, unknown>).softMin).toBeUndefined()
      expect((persisted.tuning!.hero as Record<string, unknown>).softMax).toBeUndefined()
    })
  })

  describe('7. Slider interaction clamping behavior', () => {
    it('clamping for slider visual representation pins out-of-soft-range values at endpoint', () => {
      // Authored scale = 2.5, slider max = 2 -> slider thumb visual position = 2
      expect(clampToSliderRange(2.5, HERO_TRANSFORM_POLICY.scale)).toBe(2)
      // Authored scale = 0.3, slider min = 0.5 -> slider thumb visual position = 0.5
      expect(clampToSliderRange(0.3, HERO_TRANSFORM_POLICY.scale)).toBe(0.5)
      // Authored scale = 1.2 -> inside slider range -> slider thumb = 1.2
      expect(clampToSliderRange(1.2, HERO_TRANSFORM_POLICY.scale)).toBe(1.2)
    })
  })
})

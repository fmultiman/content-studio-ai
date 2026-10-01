/**
 * CREATIVE_EDITOR_CONTEXTUAL_STYLES_AND_TYPOGRAPHY_V1 — the names of the supported runtime font families.
 *
 * ONE list, in the neutral schema layer so the schemas (free text `font_family`, render-request overrides) can
 * validate against it without importing the renderer-side registry. `RUNTIME_FONT_REGISTRY`
 * (lib/creative/typography/resolve-typography.ts) is typed `Record<RuntimeFontFamily, …>` from these names, so
 * the compiler rejects a registry that drifts from this list (a missing or an extra family).
 */
export const RUNTIME_FONT_FAMILY_NAMES = ['Fraunces', 'Source Sans 3', 'Space Grotesk', 'Inter'] as const

export type RuntimeFontFamilyName = (typeof RUNTIME_FONT_FAMILY_NAMES)[number]

/** Safe authored range of a local font size, in px on the 1080px reference canvas. */
export const FONT_SIZE_PX_BOUNDS = { min: 8, max: 400 } as const

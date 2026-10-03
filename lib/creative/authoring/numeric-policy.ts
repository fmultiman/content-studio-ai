/**
 * CREATIVE_EDITOR_NUMERIC_RANGE_AND_SLIDER_POLICY_V1
 *
 * Core architectural principle:
 *   SOFT UI RANGE != SAFE AUTHORED VALUE RANGE != TRUE TECHNICAL / DOMAIN SAFETY BOUND
 *
 * - A slider exists for fast, comfortable, common manipulation (sliderMin, sliderMax).
 *   Its maximum MUST NOT automatically mean "this Element cannot be authored beyond this value."
 * - A numeric input exists for precise values and legitimate values outside the common slider range.
 * - The hard bound (hardMin, hardMax) exists only for real safety, renderer stability,
 *   schema validity, or meaningful domain constraints (e.g., Opacity 0..1).
 *
 * ONE AUTHORED VALUE: Slider and numeric input are two interaction surfaces over the SAME
 * authored value. UI metadata is derived configuration and never persisted as a separate truth.
 */

import type { TransformField } from './element-capabilities'
import type { TuningGroup } from './authoring-state'

export type NumericRangePolicy = {
  /** Soft slider minimum for common, comfortable UI manipulation. */
  readonly sliderMin: number
  /** Soft slider maximum for common, comfortable UI manipulation. */
  readonly sliderMax: number
  /** Hard safety minimum: rejects invalid values, protects renderer/schema stability. */
  readonly hardMin: number
  /** Hard safety maximum: protects renderer/schema stability, layout bounds. */
  readonly hardMax: number
  /** Slider increment step. */
  readonly step: number
  /** Number of decimal places for numeric display and input (0 = integer, 1, 2). */
  readonly precision: number
}

// ── Control-Type & Element-Class Policies ───────────────────────────────────

/**
 * Hero image (contentImage):
 * - Position: soft ±120px, hard ±600px
 * - Rotation: soft ±4°, hard ±20°
 * - Scale: soft 0.5–2 (1.0 default centered, common adjustments up to 2x),
 *          hard 0.1–5 (allows legitimate large photo crops/scaling such as 2.0 or 2.5)
 * - Opacity: soft 0–1, hard 0–1 (meaningful semantic domain)
 */
export const HERO_TRANSFORM_POLICY: Readonly<Record<TransformField, NumericRangePolicy>> = {
  offsetX: { sliderMin: -120, sliderMax: 120, hardMin: -600, hardMax: 600, step: 1, precision: 0 },
  offsetY: { sliderMin: -120, sliderMax: 120, hardMin: -600, hardMax: 600, step: 1, precision: 0 },
  rotation: { sliderMin: -4, sliderMax: 4, hardMin: -20, hardMax: 20, step: 0.1, precision: 1 },
  scale: { sliderMin: 0.5, sliderMax: 2, hardMin: 0.1, hardMax: 5, step: 0.01, precision: 2 },
  opacity: { sliderMin: 0, sliderMax: 1, hardMin: 0, hardMax: 1, step: 0.01, precision: 2 },
}

/**
 * Brand logo (brandAsset):
 * - Position: soft ±60px, hard ±300px
 * - Rotation: soft ±2°, hard ±15°
 * - Scale: soft 0.5–2, hard 0.1–5 (shared scale policy with hero/materials)
 * - Opacity: soft 0–1, hard 0–1
 */
export const BRAND_TRANSFORM_POLICY: Readonly<Record<TransformField, NumericRangePolicy>> = {
  offsetX: { sliderMin: -60, sliderMax: 60, hardMin: -300, hardMax: 300, step: 1, precision: 0 },
  offsetY: { sliderMin: -60, sliderMax: 60, hardMin: -300, hardMax: 300, step: 1, precision: 0 },
  rotation: { sliderMin: -2, sliderMax: 2, hardMin: -15, hardMax: 15, step: 0.1, precision: 1 },
  scale: { sliderMin: 0.5, sliderMax: 2, hardMin: 0.1, hardMax: 5, step: 0.01, precision: 2 },
  opacity: { sliderMin: 0, sliderMax: 1, hardMin: 0, hardMax: 1, step: 0.01, precision: 2 },
}

/**
 * Text Elements (title, source, kicker, intro, body, annotation, items, legend, bullets, tagline):
 * - Position: soft ±60px, hard ±300px
 * - Rotation: soft ±2°, hard ±15° (subtle editorial tilt soft range, wider safe hard range)
 */
export const TEXT_TRANSFORM_POLICY: Readonly<Record<'offsetX' | 'offsetY' | 'rotation', NumericRangePolicy>> = {
  offsetX: { sliderMin: -60, sliderMax: 60, hardMin: -300, hardMax: 300, step: 1, precision: 0 },
  offsetY: { sliderMin: -60, sliderMax: 60, hardMin: -300, hardMax: 300, step: 1, precision: 0 },
  rotation: { sliderMin: -2, sliderMax: 2, hardMin: -15, hardMax: 15, step: 0.1, precision: 1 },
}

/**
 * Material transform channels (decorativeAsset, proceduralVisual):
 * - Position: soft ±120px, hard ±600px
 * - Rotation: soft ±15°, hard ±45°
 * - Scale: soft 0.5–2, hard 0.1–5
 * - Opacity: soft 0–1, hard 0–1
 */
export const MATERIAL_TRANSFORM_POLICY: Readonly<Record<TransformField, NumericRangePolicy>> = {
  offsetX: { sliderMin: -120, sliderMax: 120, hardMin: -600, hardMax: 600, step: 1, precision: 0 },
  offsetY: { sliderMin: -120, sliderMax: 120, hardMin: -600, hardMax: 600, step: 1, precision: 0 },
  rotation: { sliderMin: -15, sliderMax: 15, hardMin: -45, hardMax: 45, step: 0.5, precision: 1 },
  scale: { sliderMin: 0.5, sliderMax: 2, hardMin: 0.1, hardMax: 5, step: 0.01, precision: 2 },
  opacity: { sliderMin: 0, sliderMax: 1, hardMin: 0, hardMax: 1, step: 0.01, precision: 2 },
}

// ── Helpers ─────────────────────────────────────────────────────────────────

/** Resolves the range policy for a tuning group and field. */
export function policyForTuningField(group: TuningGroup, field: string): NumericRangePolicy | null {
  if (group === 'hero') return HERO_TRANSFORM_POLICY[field as TransformField] ?? null
  if (group === 'brand') return BRAND_TRANSFORM_POLICY[field as TransformField] ?? null
  return TEXT_TRANSFORM_POLICY[field as 'offsetX' | 'offsetY' | 'rotation'] ?? null
}

/** Resolves the range policy for a material transform channel field. */
export function policyForTransformChannelField(field: TransformField): NumericRangePolicy {
  return MATERIAL_TRANSFORM_POLICY[field]
}

/** Clamps a value strictly to the hard safety bounds of a policy. */
export function clampToHardBounds(value: number, policy: NumericRangePolicy): number {
  return Math.min(policy.hardMax, Math.max(policy.hardMin, value))
}

/** Clamps a value visually to the soft slider range of a policy. */
export function clampToSliderRange(value: number, policy: NumericRangePolicy): number {
  return Math.min(policy.sliderMax, Math.max(policy.sliderMin, value))
}

/** Formats a numeric value for display according to its precision. */
export function formatNumericValue(value: number, precision: number): string {
  if (precision === 0) return String(Math.round(value))
  return value.toFixed(precision)
}

import type { ProjectIdentity } from '@/lib/schemas/project-identity'
import {
  type VisualTokensSnapshot,
  VisualTokensSnapshotSchema,
} from '@/lib/schemas/creative/primitives'
import { RUNTIME_FONT_REGISTRY, type RuntimeFontFamily } from '@/lib/creative/typography/resolve-typography'

/**
 * DEFAULTS
 *
 * Studio-level fallback visual tokens. Used whenever a Project Identity has no
 * structured visual fields (identity.visuals is absent or partially populated).
 *
 * PROJECT_IDENTITY_VISUAL_TOKENS_V1: These remain the canonical defaults;
 * Project Identity visuals override them per-role when explicitly authored.
 */
export const CREATIVE_IDENTITY_DEFAULTS = {
  typography: {
    display: { family: 'Fraunces', weight: 700, style: 'normal' as const },
    body: { family: 'Source Sans 3', weight: 400, style: 'normal' as const },
    label: {
      family: 'Source Sans 3',
      weight: 600,
      style: 'normal' as const,
      text_transform: 'uppercase' as const,
    },
  },
  colors: {
    background: '#F6F0E4',
    foreground: '#16352F',
    muted: '#5F6F66',
    accent: '#A34A27',
  },
  spacing: {
    unit: 8,
    default_gap: 16,
    safe_area: { top: 72, right: 64, bottom: 72, left: 64, unit: 'px' as const },
  },
} as const

// ─── Font weight selection helpers ────────────────────────────────────────────

/**
 * Returns the first weight available for a family in RUNTIME_FONT_REGISTRY.
 * Used when identity selects a font family — we choose the most appropriate
 * weight from the registered set.
 */
function primaryWeightForFamily(family: RuntimeFontFamily, preferBold: boolean): number {
  const reg = RUNTIME_FONT_REGISTRY[family]
  const weights = Object.keys(reg.files).map(Number).sort((a, b) => a - b)
  if (preferBold) {
    // Prefer heaviest available (display role)
    return weights[weights.length - 1] ?? 400
  }
  // Prefer lightest available (body role)
  return weights[0] ?? 400
}

// ─── Product Integration Adapter ──────────────────────────────────────────────

/**
 * Adapts the canonical ProjectIdentity V1 into the VisualTokensSnapshot
 * required by the Creative Rendering layer.
 *
 * PROJECT_IDENTITY_VISUAL_TOKENS_V1: This adapter now actually inspects
 * `identity.visuals` (the new optional structured visual tokens zone) and
 * applies those values instead of silently ignoring them.
 *
 * Precedence (per discovery):
 *   1. identity.visuals.* — explicit structured token from the project
 *   2. CREATIVE_IDENTITY_DEFAULTS — Studio fallback
 *
 * Partial identity.visuals is safe: each token is resolved independently.
 * Template Appearance overrides (e.g., DocumentaryCard dark mode) remain
 * in the Template layer and are NOT affected by this adapter.
 *
 * @param projectId Used to generate a stable, traceable snapshot_ref.
 * @param identity  The ProjectIdentity V1 canonical object.
 */
export function adaptProjectIdentityToVisualTokens(
  projectId: string,
  identity: ProjectIdentity
): VisualTokensSnapshot {
  const visuals = identity.visuals

  // ── Typography resolution ──────────────────────────────────────────────────
  // Each font role is resolved independently: if the project specifies a font,
  // derive an appropriate weight from what the registry actually offers for
  // that family. Fall back to CREATIVE_IDENTITY_DEFAULTS otherwise.

  const displayFontFamily = visuals?.typography?.display_font as RuntimeFontFamily | undefined
  const bodyFontFamily = visuals?.typography?.body_font as RuntimeFontFamily | undefined

  const resolvedDisplay = displayFontFamily && RUNTIME_FONT_REGISTRY[displayFontFamily]
    ? { family: displayFontFamily, weight: primaryWeightForFamily(displayFontFamily, true), style: 'normal' as const }
    : CREATIVE_IDENTITY_DEFAULTS.typography.display

  const resolvedBody = bodyFontFamily && RUNTIME_FONT_REGISTRY[bodyFontFamily]
    ? { family: bodyFontFamily, weight: primaryWeightForFamily(bodyFontFamily, false), style: 'normal' as const }
    : CREATIVE_IDENTITY_DEFAULTS.typography.body

  // Label inherits body font family (same selection) at weight 600 when available,
  // otherwise uses the body registration's heaviest weight.
  const labelFamilyForResolution = bodyFontFamily && RUNTIME_FONT_REGISTRY[bodyFontFamily]
    ? bodyFontFamily
    : (CREATIVE_IDENTITY_DEFAULTS.typography.label.family as RuntimeFontFamily)
  const labelReg = RUNTIME_FONT_REGISTRY[labelFamilyForResolution]
  const labelWeights = Object.keys(labelReg.files).map(Number).sort((a, b) => a - b)
  const labelWeight = labelWeights.includes(600)
    ? 600
    : (labelWeights[labelWeights.length - 1] ?? 400)

  const resolvedLabel = {
    family: labelFamilyForResolution,
    weight: labelWeight,
    style: 'normal' as const,
    text_transform: 'uppercase' as const,
  }

  // ── Color resolution ───────────────────────────────────────────────────────
  // Each color slot resolved independently. Absent identity value → default.
  const identityColors = visuals?.colors

  const resolvedColors = {
    background: identityColors?.background ?? CREATIVE_IDENTITY_DEFAULTS.colors.background,
    foreground: identityColors?.foreground ?? CREATIVE_IDENTITY_DEFAULTS.colors.foreground,
    muted: identityColors?.muted ?? CREATIVE_IDENTITY_DEFAULTS.colors.muted,
    accent: identityColors?.accent ?? CREATIVE_IDENTITY_DEFAULTS.colors.accent,
  }

  // ── Assemble snapshot ──────────────────────────────────────────────────────
  const rawPayload = {
    schema_version: 'visual-tokens.v0',
    snapshot_ref: `project:${projectId}:snapshot`,
    typography: {
      display: resolvedDisplay,
      body: resolvedBody,
      label: resolvedLabel,
    },
    colors: resolvedColors,
    spacing: CREATIVE_IDENTITY_DEFAULTS.spacing,
  }

  return VisualTokensSnapshotSchema.parse(rawPayload)
}

import type { ProjectIdentity } from '@/lib/schemas/project-identity'
import {
  type VisualTokensSnapshot,
  VisualTokensSnapshotSchema,
} from '@/lib/schemas/creative/primitives'

/**
 * DEFAULTS
 * 
 * Since Project Identity V1 does not yet store discrete visual tokens
 * (colors, typography, spacing) in the database, we provide safe fallback
 * defaults. These are currently modeled after the 'comunidades-alternativas'
 * visual language. They ensure the renderer can proceed deterministically
 * without inventing fake data in the database.
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

/**
 * Product Integration Adapter
 * 
 * Adapts the canonical ProjectIdentity V1 (which contains primarily textual
 * expression data) into the VisualTokensSnapshot required by the Shared
 * Creative Rendering layer.
 * 
 * @param projectId Used to generate a stable, traceable snapshot_ref.
 * @param identity The ProjectIdentity V1 canonical object.
 */
export function adaptProjectIdentityToVisualTokens(
  projectId: string,
  _identity: ProjectIdentity
): VisualTokensSnapshot {
  // In the future, this function will inspect `identity.expression` or a
  // newly added `identity.visuals` schema and override these defaults.
  // For Phase 1A, since Project Identity V1 lacks structured visual fields,
  // we apply the defaults explicitly.
  
  const rawPayload = {
    schema_version: 'visual-tokens.v0',
    snapshot_ref: `project:${projectId}:snapshot`,
    typography: CREATIVE_IDENTITY_DEFAULTS.typography,
    colors: CREATIVE_IDENTITY_DEFAULTS.colors,
    spacing: CREATIVE_IDENTITY_DEFAULTS.spacing,
    // Brand logos would be mapped here if available in ProjectIdentity
  }

  // Ensure the output rigidly conforms to the creative primitives schema
  // before entering the rendering boundary.
  return VisualTokensSnapshotSchema.parse(rawPayload)
}

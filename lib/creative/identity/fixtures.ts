import { VisualTokensSnapshotSchema, type VisualTokensSnapshot } from '@/lib/schemas/creative/primitives'

const identityFixtures = [
  {
    schema_version: 'visual-tokens.v0',
    snapshot_ref: 'fixture:identity:comunidades-alternativas:v1',
    typography: {
      display: { family: 'Fraunces', weight: 700 },
      body: { family: 'Source Sans 3', weight: 400 },
      label: { family: 'Source Sans 3', weight: 600, text_transform: 'uppercase' },
    },
    colors: { background: '#F6F0E4', foreground: '#16352F', muted: '#5F6F66', accent: '#A34A27' },
    spacing: { unit: 8, default_gap: 16, safe_area: { top: 72, right: 64, bottom: 72, left: 64, unit: 'px' } },
    brand: { logo_asset_ref: 'fixture:asset:comunidades-alternativas:logo-v1' },
  },
  {
    schema_version: 'visual-tokens.v0',
    snapshot_ref: 'fixture:identity:acme-labs:v1',
    typography: {
      display: { family: 'Space Grotesk', weight: 700 },
      body: { family: 'Inter', weight: 400 },
      label: { family: 'Inter', weight: 600, text_transform: 'uppercase' },
    },
    colors: { background: '#0B1020', foreground: '#EEF4FF', muted: '#9AA8C7', accent: '#7CE7D3' },
    spacing: { unit: 6, default_gap: 18, safe_area: { top: 64, right: 56, bottom: 64, left: 56, unit: 'px' } },
  },
] as const

export const IDENTITY_FIXTURES: readonly VisualTokensSnapshot[] = identityFixtures.map((fixture) =>
  VisualTokensSnapshotSchema.parse(fixture),
)

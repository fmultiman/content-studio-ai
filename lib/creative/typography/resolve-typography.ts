import type { VisualTokensSnapshot, TypographyRole } from '@/lib/schemas/creative/primitives'

export type TypographyDiagnosticCode = 'font_not_found' | 'font_load_failed' | 'weight_not_available' | 'style_not_available'

export type TypographyDiagnostic = {
  kind: 'typography_error'
  code: TypographyDiagnosticCode
  message: string
  path?: string
}

export type ResolvedFontRole = {
  requested_family: string
  family: 'Inter Tight'
  source: 'project_local'
  url: '/creative-fonts/inter-tight-latin.woff2'
  weights: readonly [100, 200, 300, 400, 500, 600, 700, 800, 900]
  styles: readonly ['normal']
  weight: number
  style: 'normal'
}

export type ResolvedTypography = {
  display: ResolvedFontRole
  body: ResolvedFontRole
  label?: ResolvedFontRole
  cssText: string
}

export type TypographyResolutionResult =
  | { valid: true; value: ResolvedTypography }
  | { valid: false; errors: TypographyDiagnostic[] }

const LOCAL_FONT_FAMILY = 'Inter Tight'
const LOCAL_FONT_URL = '/creative-fonts/inter-tight-latin.woff2'
const AVAILABLE_WEIGHTS = [100, 200, 300, 400, 500, 600, 700, 800, 900] as const
const AVAILABLE_STYLES = ['normal'] as const
const CONTROLLED_FAMILY_ALIASES = new Set(['Fraunces', 'Source Sans 3', 'Space Grotesk', 'Inter', 'Inter Tight'])

function roleResult(role: TypographyRole, path: string): TypographyDiagnostic | ResolvedFontRole {
  if (!CONTROLLED_FAMILY_ALIASES.has(role.family)) {
    return { kind: 'typography_error', code: 'font_not_found', message: `No project-local font fixture is registered for "${role.family}"`, path }
  }
  if (!AVAILABLE_WEIGHTS.includes(role.weight as typeof AVAILABLE_WEIGHTS[number])) {
    return { kind: 'typography_error', code: 'weight_not_available', message: `Weight ${role.weight} is not available for the project-local Inter Tight fixture`, path: `${path}.weight` }
  }
  if (role.style !== 'normal') {
    return { kind: 'typography_error', code: 'style_not_available', message: `Style "${role.style}" is not available for the project-local Inter Tight fixture`, path: `${path}.style` }
  }
  return {
    requested_family: role.family,
    family: LOCAL_FONT_FAMILY,
    source: 'project_local',
    url: LOCAL_FONT_URL,
    weights: AVAILABLE_WEIGHTS,
    styles: AVAILABLE_STYLES,
    weight: role.weight,
    style: role.style,
  }
}

function cssText(): string {
  return `@font-face{font-family:"${LOCAL_FONT_FAMILY}";font-style:normal;font-weight:100 900;font-display:block;src:url(/public${LOCAL_FONT_URL}) format("woff2"),url(${LOCAL_FONT_URL}) format("woff2");}`
}

export function resolveTypography(tokens: VisualTokensSnapshot): TypographyResolutionResult {
  const roles: Array<[keyof Pick<VisualTokensSnapshot['typography'], 'display' | 'body' | 'label'>, TypographyRole | undefined]> = [
    ['display', tokens.typography.display],
    ['body', tokens.typography.body],
    ['label', tokens.typography.label],
  ]
  const errors: TypographyDiagnostic[] = []
  const resolved: Partial<Record<'display' | 'body' | 'label', ResolvedFontRole>> = {}
  for (const [name, role] of roles) {
    if (!role) continue
    const value = roleResult(role, `typography.${name}`)
    if ('kind' in value) errors.push(value)
    else resolved[name] = value
  }
  if (errors.length > 0 || !resolved.display || !resolved.body) return { valid: false, errors }
  return { valid: true, value: { display: resolved.display, body: resolved.body, label: resolved.label, cssText: cssText() } }
}

export function tokensWithResolvedTypography(tokens: VisualTokensSnapshot, typography: ResolvedTypography): VisualTokensSnapshot {
  return {
    ...tokens,
    typography: {
      ...tokens.typography,
      display: { ...tokens.typography.display, family: typography.display.family },
      body: { ...tokens.typography.body, family: typography.body.family },
      label: tokens.typography.label && typography.label ? { ...tokens.typography.label, family: typography.label.family } : tokens.typography.label,
    },
  }
}

export async function awaitTypographyReady(typography: ResolvedTypography): Promise<TypographyDiagnostic[]> {
  if (typeof document === 'undefined' || !document.fonts) return []
  try {
    const roles = [typography.display, typography.body, ...(typography.label ? [typography.label] : [])]
    await Promise.all(roles.map((font) => document.fonts.load(`${font.weight} 16px "${font.family}"`)))
    await document.fonts.ready
    const missing = roles.filter((font) => !document.fonts.check(`${font.weight} 16px "${font.family}"`))
    return missing.map((font) => ({ kind: 'typography_error' as const, code: 'font_load_failed' as const, message: `Font "${font.family}" did not become ready in the render document` }))
  } catch (error) {
    return [{ kind: 'typography_error', code: 'font_load_failed', message: error instanceof Error ? error.message : 'Font loading failed' }]
  }
}

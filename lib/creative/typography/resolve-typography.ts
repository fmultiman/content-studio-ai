import type { VisualTokensSnapshot, TypographyRole } from '@/lib/schemas/creative/primitives'

export type TypographyDiagnosticCode = 'font_not_found' | 'font_load_failed' | 'weight_not_available' | 'style_not_available'

export type TypographyDiagnostic = {
  kind: 'typography_error'
  code: TypographyDiagnosticCode
  message: string
  path?: string
}

export type RuntimeFontFamily = 'Fraunces' | 'Source Sans 3' | 'Space Grotesk' | 'Inter'

type RuntimeFontRegistration = {
  family: RuntimeFontFamily
  source: 'project_local'
  styles: readonly ['normal']
  files: Readonly<Record<number, string>>
}

/** Small versioned runtime capability, not a user-facing font catalog. */
export const RUNTIME_FONT_REGISTRY: Readonly<Record<RuntimeFontFamily, RuntimeFontRegistration>> = {
  Fraunces: { family: 'Fraunces', source: 'project_local', styles: ['normal'], files: { 700: '/creative-fonts/fraunces-700.woff2' } },
  'Source Sans 3': { family: 'Source Sans 3', source: 'project_local', styles: ['normal'], files: { 400: '/creative-fonts/source-sans-3-400.woff2', 600: '/creative-fonts/source-sans-3-600.woff2' } },
  'Space Grotesk': { family: 'Space Grotesk', source: 'project_local', styles: ['normal'], files: { 700: '/creative-fonts/space-grotesk-700.woff2' } },
  Inter: { family: 'Inter', source: 'project_local', styles: ['normal'], files: { 400: '/creative-fonts/inter-400.woff2', 600: '/creative-fonts/inter-600.woff2' } },
}

export type ResolvedFontRole = {
  requested_family: string
  family: RuntimeFontFamily
  source: 'project_local'
  url: string
  weights: readonly number[]
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

function isRuntimeFontFamily(family: string): family is RuntimeFontFamily {
  return Object.hasOwn(RUNTIME_FONT_REGISTRY, family)
}

function roleResult(role: TypographyRole, path: string): TypographyDiagnostic | ResolvedFontRole {
  if (!isRuntimeFontFamily(role.family)) {
    return { kind: 'typography_error', code: 'font_not_found', message: `No project-local font is registered for "${role.family}"`, path }
  }
  const registration = RUNTIME_FONT_REGISTRY[role.family]
  if (!Object.hasOwn(registration.files, role.weight)) {
    return { kind: 'typography_error', code: 'weight_not_available', message: `Weight ${role.weight} is not available for project-local ${role.family}`, path: `${path}.weight` }
  }
  if (role.style !== 'normal') {
    return { kind: 'typography_error', code: 'style_not_available', message: `Style "${role.style}" is not available for project-local ${role.family}`, path: `${path}.style` }
  }
  return {
    requested_family: role.family,
    family: registration.family,
    source: registration.source,
    url: registration.files[role.weight],
    weights: Object.keys(registration.files).map(Number).sort((a, b) => a - b),
    styles: registration.styles,
    weight: role.weight,
    style: role.style,
  }
}

function cssText(roles: ResolvedFontRole[]): string {
  const unique = new Map(roles.map((role) => [`${role.family}:${role.weight}:${role.style}`, role]))
  return [...unique.values()]
    .map((role) => `@font-face{font-family:"${role.family}";font-style:${role.style};font-weight:${role.weight};font-display:block;src:url(/public${role.url}) format("woff2"),url(${role.url}) format("woff2");}`)
    .join('')
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
  const resolvedRoles = [resolved.display, resolved.body, ...(resolved.label ? [resolved.label] : [])]
  return { valid: true, value: { display: resolved.display, body: resolved.body, label: resolved.label, cssText: cssText(resolvedRoles) } }
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
    const testString = 'AaBbCcÇç0123456789'
    const roles = [typography.display, typography.body, ...(typography.label ? [typography.label] : [])]
    const loaded = await Promise.all(roles.map((font) => document.fonts.load(`${font.weight} 16px "${font.family}"`, testString)))
    await document.fonts.ready
    // Query check() too, but do not let an installed/system fallback satisfy readiness:
    // document.fonts.load() must return the exact registered FontFace.
    roles.forEach((font) => document.fonts.check(`${font.weight} 16px "${font.family}"`, testString))
    const missing = roles.filter((_font, index) => (loaded[index] ?? []).length === 0)
    return missing.map((font) => ({ kind: 'typography_error' as const, code: 'font_load_failed' as const, message: `Font "${font.family}" weight ${font.weight} did not become ready in the render document` }))
  } catch (error) {
    return [{ kind: 'typography_error', code: 'font_load_failed', message: error instanceof Error ? error.message : 'Font loading failed' }]
  }
}

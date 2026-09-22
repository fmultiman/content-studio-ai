import { access } from 'node:fs/promises'
import path from 'node:path'
import type { VisualTokensSnapshot } from '@/lib/schemas/creative/primitives'
import { resolveTypography, type ResolvedTypography, type TypographyDiagnostic } from './resolve-typography'

export type PreparedTypography = {
  typography: ResolvedTypography
  preparation_ms: number
}

export async function prepareTypography(tokens: VisualTokensSnapshot): Promise<
  | { valid: true; value: PreparedTypography }
  | { valid: false; errors: TypographyDiagnostic[] }
> {
  const started = Date.now()
  const resolved = resolveTypography(tokens)
  if (!resolved.valid) return resolved
  const roles = [resolved.value.display, resolved.value.body, ...(resolved.value.label ? [resolved.value.label] : [])]
  const urls = [...new Set(roles.map((role) => role.url))]
  for (const url of urls) {
    try {
      await access(path.join(process.cwd(), 'public', url.replace(/^\//, '')))
    } catch {
      return { valid: false, errors: [{ kind: 'typography_error', code: 'font_not_found', message: `Local font file is missing: ${url}` }] }
    }
  }
  return { valid: true, value: { typography: resolved.value, preparation_ms: Date.now() - started } }
}

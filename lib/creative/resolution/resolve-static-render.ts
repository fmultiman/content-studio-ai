import type { AssetRef, VisualTokensSnapshot } from '@/lib/schemas/creative/primitives'
import { StaticRenderManifestSchema, type StaticRenderManifest } from '@/lib/schemas/creative/static-render'
import { resolveAsset, type ResolvedAsset } from '@/lib/creative/assets/resolve-asset'
import { resolveIdentitySnapshot } from '@/lib/creative/identity/resolve-identity-snapshot'
import {
  resolveTemplate,
  validateTemplateAssetBindings,
  validateTemplateCanvas,
  validateTemplateContent,
  validateTemplateMode,
  type ResolvedTemplate,
} from '@/lib/creative/templates/registry'
import { resolutionResult, schemaDiagnostics, type ResolutionResult, type RuntimeDiagnostic } from './diagnostics'
import { resolveTypography, tokensWithResolvedTypography, type ResolvedTypography } from '@/lib/creative/typography/resolve-typography'

export type ResolvedStaticRenderInput = {
  manifest: StaticRenderManifest
  resolvedTemplate: ResolvedTemplate
  tokens: VisualTokensSnapshot
  typography: ResolvedTypography
  resolvedAssets: Record<string, ResolvedAsset>
  diagnostics: RuntimeDiagnostic[]
}

function templateDiagnostic(error: { code: string; message: string; path?: string; issues?: RuntimeDiagnostic['issues'] }): RuntimeDiagnostic {
  return { kind: 'template_error', ...error }
}

function bindingDiagnostic(error: { code: string; message: string; path?: string; issues?: RuntimeDiagnostic['issues'] }): RuntimeDiagnostic {
  return { kind: 'binding_error', ...error }
}

export function resolveStaticRenderManifest(
  input: unknown,
  options?: { identitySnapshot?: VisualTokensSnapshot },
): ResolutionResult<ResolvedStaticRenderInput> {
  const parsed = StaticRenderManifestSchema.safeParse(input)
  if (!parsed.success) return resolutionResult(schemaDiagnostics(parsed.error))

  const manifest = parsed.data
  const errors: RuntimeDiagnostic[] = []
  const template = resolveTemplate(manifest.template)
  if (!template.valid) errors.push(templateDiagnostic(template.error))

  const identity = options?.identitySnapshot
    ? { valid: true as const, value: options.identitySnapshot }
    : resolveIdentitySnapshot(manifest.identity)
  if (!identity.valid) {
    errors.push({ kind: 'identity_error', ...identity.error })
  }

  if (!template.valid || !identity.valid) return resolutionResult(errors)

  const typography = resolveTypography(identity.value)
  if (!typography.valid) errors.push(...typography.errors)
  if (!typography.valid) return resolutionResult(errors)

  const mode = validateTemplateMode(template.value, 'still')
  if (!mode.valid) errors.push(templateDiagnostic(mode.error))

  const canvas = validateTemplateCanvas(template.value, manifest.canvas)
  if (!canvas.valid) errors.push(templateDiagnostic(canvas.error))

  const content = validateTemplateContent(template.value, manifest.content)
  if (!content.valid) errors.push(bindingDiagnostic(content.error))

  const bindings = validateTemplateAssetBindings(template.value, manifest.assets)
  if (!bindings.valid) errors.push(bindingDiagnostic(bindings.error))

  const resolvedAssets: Record<string, ResolvedAsset> = {}
  if (bindings.valid) {
    for (const [slot, asset] of Object.entries(bindings.value as Record<string, AssetRef>)) {
      const result = resolveAsset(asset)
      if (!result.valid) {
        errors.push({ kind: 'asset_error', ...result.error, path: `assets.${slot}` })
      } else {
        resolvedAssets[slot] = result.value
      }
    }
  }

  if (errors.length > 0) return resolutionResult(errors)

  const value: ResolvedStaticRenderInput = {
    manifest,
    resolvedTemplate: template.value,
    tokens: tokensWithResolvedTypography(identity.value, typography.value),
    typography: typography.value,
    resolvedAssets,
    diagnostics: [],
  }
  return resolutionResult([], value)
}

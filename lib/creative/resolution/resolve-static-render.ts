import type { AssetRef, VisualTokensSnapshot } from '@/lib/schemas/creative/primitives'
import { StaticFreeRenderManifestSchema, StaticRenderManifestSchema, type StaticFreeRenderManifest, type StaticRenderManifest } from '@/lib/schemas/creative/static-render'
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

  const bindings = validateTemplateAssetBindings(template.value, Object.fromEntries(
    // STATIC_TEMPLATE_CUSTOM_ELEMENTS_V1: custom element image assets use the
    // 'library_file:' prefix convention and are NOT template slot bindings.
    // Filter them out before schema validation so the existing strict
    // per-variant asset schemas are not broken by custom element asset keys.
    Object.entries(manifest.assets).filter(([key]) => !key.startsWith('library_file:')),
  ))
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

// ─── CREATIVE_EDITOR_FREE_DEFAULT_AND_TEMPLATE_ENTRY_V1 — free still ────────

/**
 * A free (Template-less) still, resolved. There is no `resolvedTemplate`: the
 * renderer is chosen by `kind`, never by a component key. `resolvedAssets` is
 * empty here — free images are `library_file` refs whose runtime URLs are
 * presigned at claim time only (resolve-static-runtime-input.ts).
 */
export type ResolvedStaticFreeInput = {
  kind: 'free'
  manifest: StaticFreeRenderManifest
  tokens: VisualTokensSnapshot
  typography: ResolvedTypography
  resolvedAssets: Record<string, ResolvedAsset>
  diagnostics: RuntimeDiagnostic[]
}

export type AnyResolvedStaticInput = ResolvedStaticRenderInput | ResolvedStaticFreeInput

export function isResolvedStaticFreeInput(input: AnyResolvedStaticInput): input is ResolvedStaticFreeInput {
  return (input as ResolvedStaticFreeInput).kind === 'free'
}

export function resolveStaticFreeRenderManifest(
  input: unknown,
  options: { identitySnapshot: VisualTokensSnapshot },
): ResolutionResult<ResolvedStaticFreeInput> {
  const parsed = StaticFreeRenderManifestSchema.safeParse(input)
  if (!parsed.success) return resolutionResult(schemaDiagnostics(parsed.error))
  const manifest = parsed.data
  const errors: RuntimeDiagnostic[] = []

  const ids = new Set<string>()
  manifest.composition.elements.forEach((element, index) => {
    if (ids.has(element.element_id)) errors.push(bindingDiagnostic({ code: 'duplicate_free_element_id', message: `Free element id "${element.element_id}" is repeated.`, path: `composition.elements.${index}` }))
    ids.add(element.element_id)
    if (element.kind === 'image') {
      const asset = manifest.assets[element.asset_ref]
      if (!asset || asset.type !== 'library_file') errors.push(bindingDiagnostic({ code: 'free_asset_not_found', message: `Free image "${element.element_id}" names no library_file asset.`, path: `composition.elements.${index}.asset_ref` }))
    }
  })
  if (Object.values(manifest.assets).some((asset) => asset.type !== 'library_file')) {
    errors.push(bindingDiagnostic({ code: 'free_asset_type', message: 'A free still binds Library images only.', path: 'assets' }))
  }

  const typography = resolveTypography(options.identitySnapshot)
  if (!typography.valid) errors.push(...typography.errors)
  if (!typography.valid || errors.length > 0) return resolutionResult(errors)

  return resolutionResult([], {
    kind: 'free' as const,
    manifest,
    tokens: tokensWithResolvedTypography(options.identitySnapshot, typography.value),
    typography: typography.value,
    resolvedAssets: {},
    diagnostics: [],
  })
}

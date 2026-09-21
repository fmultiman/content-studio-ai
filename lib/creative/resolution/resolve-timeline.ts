import type { AssetRef, VisualTokensSnapshot } from '@/lib/schemas/creative/primitives'
import { TimelineManifestSchema, type TemplateSegmentSchema, type TimelineManifest } from '@/lib/schemas/creative/timeline'
import { validateTimelineSemantics } from '@/lib/schemas/creative/validation'
import { resolveAsset, type ResolvedAsset } from '@/lib/creative/assets/resolve-asset'
import { resolveIdentitySnapshot } from '@/lib/creative/identity/resolve-identity-snapshot'
import {
  resolveTemplate,
  validateTemplateAssetBindings,
  validateTemplateCanvas,
  validateTemplateContent,
  validateTemplateMode,
  validateTemplateMotion,
  type ResolvedTemplate,
} from '@/lib/creative/templates/registry'
import { resolutionResult, schemaDiagnostics, type ResolutionResult, type RuntimeDiagnostic } from './diagnostics'
import { resolveTypography, tokensWithResolvedTypography, type ResolvedTypography } from '@/lib/creative/typography/resolve-typography'

type TemplateSegment = typeof TemplateSegmentSchema['_output']

export type ResolvedTimelineTemplateSegment = {
  segment: TemplateSegment
  resolvedTemplate: ResolvedTemplate
  resolvedAssets: Record<string, ResolvedAsset>
}

export type ResolvedTimelineInput = {
  manifest: TimelineManifest
  tokens: VisualTokensSnapshot
  typography: ResolvedTypography
  resolvedAssets: Record<string, ResolvedAsset>
  resolvedTemplateSegments: ResolvedTimelineTemplateSegment[]
  diagnostics: RuntimeDiagnostic[]
}

function templateDiagnostic(error: { code: string; message: string; path?: string; issues?: RuntimeDiagnostic['issues'] }): RuntimeDiagnostic {
  return { kind: 'template_error', ...error }
}

function bindingDiagnostic(error: { code: string; message: string; path?: string; issues?: RuntimeDiagnostic['issues'] }): RuntimeDiagnostic {
  return { kind: 'binding_error', ...error }
}

function resolveAssetSlots(
  assets: Record<string, AssetRef>,
  prefix: string,
  errors: RuntimeDiagnostic[],
): Record<string, ResolvedAsset> {
  const resolvedAssets: Record<string, ResolvedAsset> = {}
  for (const [slot, asset] of Object.entries(assets)) {
    const result = resolveAsset(asset)
    if (!result.valid) {
      errors.push({ kind: 'asset_error', ...result.error, path: `${prefix}.${slot}` })
    } else {
      resolvedAssets[slot] = result.value
    }
  }
  return resolvedAssets
}

export function resolveTimelineManifest(
  input: unknown,
): ResolutionResult<ResolvedTimelineInput> {
  const parsed = TimelineManifestSchema.safeParse(input)
  if (!parsed.success) return resolutionResult(schemaDiagnostics(parsed.error))

  const manifest = parsed.data
  const semantic = validateTimelineSemantics(manifest)
  if (!semantic.valid) {
    return resolutionResult(
      semantic.issues
        .filter((issue) => issue.severity === 'error')
        .map((issue) => ({ kind: 'schema_error', code: issue.code, message: issue.message, path: issue.path })),
    )
  }

  const errors: RuntimeDiagnostic[] = []
  const identity = resolveIdentitySnapshot(manifest.identity)
  if (!identity.valid) errors.push({ kind: 'identity_error', ...identity.error })

  const typography = identity.valid ? resolveTypography(identity.value) : { valid: false as const, errors: [] }
  if (!typography.valid) errors.push(...typography.errors)

  const resolvedAssets = resolveAssetSlots(manifest.assets, 'assets', errors)
  const resolvedTemplateSegments: ResolvedTimelineTemplateSegment[] = []

  for (const segment of manifest.segments) {
    if (segment.kind !== 'template') continue

    const template = resolveTemplate(segment.payload.template)
    if (!template.valid) {
      errors.push({ ...templateDiagnostic(template.error), path: `segments.${segment.id}.${template.error.path ?? 'template'}` })
      continue
    }

    const mode = validateTemplateMode(template.value, 'video')
    if (!mode.valid) errors.push(templateDiagnostic(mode.error))

    const canvas = validateTemplateCanvas(template.value, {
      width: manifest.specification.width,
      height: manifest.specification.height,
      unit: 'px',
    })
    if (!canvas.valid) errors.push(templateDiagnostic(canvas.error))

    const content = validateTemplateContent(template.value, segment.payload.content)
    if (!content.valid) errors.push(bindingDiagnostic(content.error))

    const bindings = validateTemplateAssetBindings(template.value, segment.payload.assets)
    if (!bindings.valid) errors.push(bindingDiagnostic(bindings.error))

    const motion = validateTemplateMotion(template.value, segment.payload.motion)
    if (!motion.valid) errors.push(templateDiagnostic(motion.error))

    if (content.valid && bindings.valid && mode.valid && canvas.valid && motion.valid) {
      const segmentAssets = resolveAssetSlots(bindings.value as Record<string, AssetRef>, `segments.${segment.id}.assets`, errors)
      resolvedTemplateSegments.push({ segment, resolvedTemplate: template.value, resolvedAssets: segmentAssets })
    }
  }

  if (!identity.valid || !typography.valid || errors.length > 0) return resolutionResult(errors)

  const value: ResolvedTimelineInput = {
    manifest,
    tokens: tokensWithResolvedTypography(identity.value, typography.value),
    typography: typography.value,
    resolvedAssets,
    resolvedTemplateSegments,
    diagnostics: [],
  }
  return resolutionResult([], value)
}

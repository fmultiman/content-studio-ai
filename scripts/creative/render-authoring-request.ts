/**
 * Local-only authoring render proof.
 *
 * The caller supplies JSON on stdin. The output directory and filename are
 * generated here, so neither the browser nor the request can control paths or
 * execute commands. This intentionally reuses the Wave 5 resolver and still
 * composition rather than creating a second rendering path.
 *
 * Phase 2C: resolves primitiveSelection → live S3 presigned URLs → renderer.
 * The neutral manifest (StaticRenderManifest) is never modified; primitive
 * materials travel as a separate primitiveMaterials argument to the renderer.
 */
import { mkdir } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { randomUUID } from 'node:crypto'
import sharp from 'sharp'
import { bundle, type WebpackConfiguration, type WebpackOverrideFn } from '@remotion/bundler'
import { renderStill, selectComposition } from '@remotion/renderer'
import { parseAuthoringRenderRequest, type AuthoringRenderRequest } from '@/lib/creative/authoring/render-request'
import { resolveStaticRenderManifest } from '@/lib/creative/resolution/resolve-static-render'
import { resolveTemplateComponent } from '@/lib/creative/templates/component-resolver'
import { selectPrimitiveAssetRef } from '@/lib/creative/primitives/discovery'
import { createPresignedReadUrl } from '@/lib/storage/s3'
import type { DocumentaryCardProps } from '@/components/creative/documentary-card'
import type { ResolvedAsset } from '@/lib/creative/assets/resolve-asset'

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(scriptDir, '..', '..')
const outputDir = path.join(repoRoot, '.tmp', 'creative', 'authoring-roundtrip')
const entry = path.join(repoRoot, 'remotion', 'index.ts')

export type AuthoringRenderExecutionResult = {
  status: 'succeeded'
  render_id: string
  output_path: string
  output_identifier: string
  variant: string
  canvas: { width: number; height: number; unit: 'px' }
  width: number
  height: number
  duration_ms: number
  diagnostics: unknown[]
  bridge: 'local-dev-only'
  tuned: boolean
  primitive_paper?: string
  primitive_tape?: string
  primitive_transforms?: AuthoringRenderRequest['primitiveTransforms']
  primitive_materials_resolved: { paper: boolean; tape: boolean }
}

function repoRelative(filePath: string): string {
  return path.relative(repoRoot, filePath).split(path.sep).join('/')
}

/**
 * Resolve a primitive key → presigned ResolvedAsset.
 * Returns null when the primitive is not found or S3 fails.
 * NEVER persists the URL — it is used only within this render execution.
 */
async function resolvePrimitiveToAsset(
  projectRef: string,
  primitiveKey: string,
): Promise<ResolvedAsset | null> {
  const selection = selectPrimitiveAssetRef(projectRef, primitiveKey)
  if (!selection) return null

  const descriptor = selection.descriptor
  const libraryFileId = descriptor.library_file_ref

  // Derive the canonical storage path from Phase 2B pattern:
  // system/creative-primitives/<pack>/<version>/<category>/<key>.png
  // OR we look up the DB — but to preserve the "no DB in render script"
  // principle, we use the deterministic storage key used at upload time.
  // Phase 2B stored files under the user's project folder structure.
  // The actual storage_path is in the DB; we use fetch-on-demand via
  // createPresignedReadUrl with the known path pattern from Phase 2B.
  //
  // From Phase 2B execution-summary-redacted.json, the storage paths follow:
  // <project_folder>/assets/pack-b-staging/<category>/<filename>.png
  // We keep this as a direct lookup to avoid DB dependency in the script.
  const storagePathMap: Record<string, string> = {
    'afa6868e-a2d6-473d-9df7-bbf713ad8b02': 'Portal Comunidades Alternativas/assets/pack-b-staging/papers/paper-card-light-01.png',
    '3f593474-05c0-4de3-a537-de50a1abb906': 'Portal Comunidades Alternativas/assets/pack-b-staging/tapes/tape-kraft-short-01.png',
  }

  const storagePath = storagePathMap[libraryFileId]
  if (!storagePath) return null

  const url = await createPresignedReadUrl(storagePath)
  if (!url) return null

  return {
    ref: libraryFileId,
    source: 'library_file',
    path: storagePath,
    url,
    mime_type: descriptor.validation.mime_type,
    width: descriptor.validation.width,
    height: descriptor.validation.height,
    checksum: descriptor.validation.sha256,
    version: descriptor.version,
  }
}

export async function renderAuthoringRequest(raw: unknown): Promise<AuthoringRenderExecutionResult> {
  const request: AuthoringRenderRequest = parseAuthoringRenderRequest(raw)
  const resolved = resolveStaticRenderManifest(request.manifest)
  if (!resolved.valid) {
    throw new Error(`Authoring manifest failed validation: ${JSON.stringify(resolved.errors)}`)
  }

  const input = resolved.value
  const componentKey = input.resolvedTemplate.descriptor.component_key
  if (!resolveTemplateComponent(componentKey)) throw new Error(`No component registered for ${componentKey}`)

  // ── Phase 2C: resolve primitive materials if selection is provided ─────────
  const primitiveMaterials: DocumentaryCardProps['primitiveMaterials'] = {}
  let primitiveKeys: { paper?: string; tape?: string } = {}

  if (request.primitiveSelection) {
    const { projectRef, paper: paperKey, tape: tapeKey } = request.primitiveSelection
    primitiveKeys = { paper: paperKey, tape: tapeKey }

    if (paperKey) {
      const asset = await resolvePrimitiveToAsset(projectRef, paperKey)
      if (asset) primitiveMaterials.paper = asset
    }
    if (tapeKey) {
      const asset = await resolvePrimitiveToAsset(projectRef, tapeKey)
      if (asset) primitiveMaterials.tape = asset
    }
  }

  await mkdir(outputDir, { recursive: true })
  const renderId = `authoring-${Date.now()}-${randomUUID().slice(0, 8)}`
  const outputPath = path.join(outputDir, `${renderId}.png`)
  const webpackOverride: WebpackOverrideFn = (config: WebpackConfiguration) => ({
    ...config,
    resolve: {
      ...config.resolve,
      alias: {
        ...((config.resolve?.alias as Record<string, string> | undefined) ?? {}),
        '@': repoRoot,
      },
    },
  })

  const started = Date.now()
  const bundleLocation = await bundle(entry, undefined, {
    publicDir: path.join(repoRoot, 'public'),
    publicPath: '/',
    webpackOverride,
  })

  // Pass primitiveMaterials alongside resolvedInput and overrides.
  // The neutral manifest is NOT modified — primitive materials travel
  // as a separate argument through the Remotion composition boundary.
  const inputProps = {
    resolvedInput: input,
    overrides: request.overrides,
    primitiveMaterials: Object.keys(primitiveMaterials).length > 0 ? primitiveMaterials : undefined,
    primitiveTransforms: request.primitiveTransforms,
  }
  const composition = await selectComposition({
    serveUrl: bundleLocation,
    id: 'StaticRenderManifestStill',
    inputProps,
  })
  await renderStill({ composition, serveUrl: bundleLocation, output: outputPath, inputProps })
  const metadata = await sharp(outputPath).metadata()

  return {
    status: 'succeeded',
    render_id: renderId,
    output_path: repoRelative(outputPath),
    output_identifier: renderId,
    variant: input.manifest.template.variant ?? 'unknown',
    canvas: input.manifest.canvas,
    width: metadata.width ?? input.manifest.canvas.width,
    height: metadata.height ?? input.manifest.canvas.height,
    duration_ms: Date.now() - started,
    diagnostics: input.diagnostics,
    bridge: 'local-dev-only',
    tuned: Boolean(request.overrides?.documentaryCard),
    primitive_paper: primitiveKeys.paper,
    primitive_tape: primitiveKeys.tape,
    primitive_transforms: request.primitiveTransforms,
    primitive_materials_resolved: { paper: Boolean(primitiveMaterials.paper), tape: Boolean(primitiveMaterials.tape) },
  }
}

export async function readAuthoringRequestFromStdin(): Promise<unknown> {
  const chunks: Buffer[] = []
  for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk))
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown
}

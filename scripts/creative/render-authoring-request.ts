/**
 * Local-only authoring render proof.
 *
 * The caller supplies JSON on stdin. The output directory and filename are
 * generated here, so neither the browser nor the request can control paths or
 * execute commands. This intentionally reuses the Wave 5 resolver and still
 * composition rather than creating a second rendering path.
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
}

function repoRelative(filePath: string): string {
  return path.relative(repoRoot, filePath).split(path.sep).join('/')
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
  const inputProps = { resolvedInput: input, overrides: request.overrides }
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
  }
}

export async function readAuthoringRequestFromStdin(): Promise<unknown> {
  const chunks: Buffer[] = []
  for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk))
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown
}

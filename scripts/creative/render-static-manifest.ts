import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'
import { bundle, type WebpackConfiguration, type WebpackOverrideFn } from '@remotion/bundler'
import { renderStill, selectComposition } from '@remotion/renderer'
import { resolveAsset } from '@/lib/creative/assets/resolve-asset'
import { resolveStaticRenderManifest } from '@/lib/creative/resolution/resolve-static-render'
import { resolveTemplateComponent } from '@/lib/creative/templates/component-resolver'
import { prepareTypography } from '@/lib/creative/typography/prepare-typography'

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(scriptDir, '..', '..')
const manifestDir = path.join(scriptDir, 'fixtures', 'static-render-manifests')
const outputDir = path.join(repoRoot, '.tmp', 'creative', 'static-manifest')
const entry = path.join(repoRoot, 'remotion', 'index.ts')

type AlphaAssetResult = {
  ref: string
  path: string
  mime_type: string
  has_alpha: boolean | null
  status: 'verified' | 'not_applicable' | 'missing' | 'metadata_error'
}

export type StaticRenderExecutionResult = {
  status: 'succeeded' | 'failed'
  template_key: string
  component_key?: string
  variant?: string
  canvas?: { width: number; height: number; unit: 'px' }
  output_path?: string
  width?: number
  height?: number
  started_at: string
  finished_at: string
  duration_ms: number
  diagnostics: Array<{ kind: string; code?: string; message: string; path?: string }>
  typography_preparation_ms?: number
  alpha_assets?: AlphaAssetResult[]
  source_manifest_fixture: string
}

function repoRelative(filePath: string): string {
  return path.relative(repoRoot, filePath).split(path.sep).join('/')
}

function fixtureOutputName(manifestPath: string): string {
  return `${path.basename(manifestPath, path.extname(manifestPath))}.png`
}

function fixtureExecutionName(manifestPath: string): string {
  return `${path.basename(manifestPath, path.extname(manifestPath))}.execution.json`
}

async function inspectAlphaAssets(): Promise<AlphaAssetResult[]> {
  const refs = [
    resolveAsset({ type: 'fixture', ref: 'fixture:asset:documentary-card:torn-paper-cream-01' }),
    resolveAsset({ type: 'fixture', ref: 'fixture:asset:documentary-card:tape-kraft-01' }),
    resolveAsset({ type: 'fixture', ref: 'fixture:asset:documentary-card:hero-archival-01' }),
  ]

  return Promise.all(refs.map(async (result) => {
    if (!result.valid) {
      return {
        ref: 'unknown',
        path: '',
        mime_type: '',
        has_alpha: null,
        status: 'missing' as const,
      }
    }

    const asset = result.value
    const absolutePath = path.join(repoRoot, asset.path)
    if (!asset.mime_type.startsWith('image/')) {
      return { ref: asset.ref, path: repoRelative(absolutePath), mime_type: asset.mime_type, has_alpha: null, status: 'not_applicable' as const }
    }

    try {
      const metadata = await sharp(absolutePath).metadata()
      return {
        ref: asset.ref,
        path: repoRelative(absolutePath),
        mime_type: asset.mime_type,
        has_alpha: metadata.hasAlpha ?? false,
        status: 'verified' as const,
      }
    } catch {
      return {
        ref: asset.ref,
        path: repoRelative(absolutePath),
        mime_type: asset.mime_type,
        has_alpha: null,
        status: 'metadata_error' as const,
      }
    }
  }))
}

async function manifestPaths(): Promise<string[]> {
  const requested = process.argv.slice(2)
  if (requested.length > 0) {
    return requested.map((value) => path.resolve(process.cwd(), value))
  }

  const { readdir } = await import('node:fs/promises')
  const files = await readdir(manifestDir)
  return files.filter((file) => file.endsWith('.json')).sort().map((file) => path.join(manifestDir, file))
}

async function main(): Promise<void> {
  const paths = await manifestPaths()
  if (paths.length === 0) throw new Error(`No static render manifests found in ${manifestDir}`)

  await mkdir(outputDir, { recursive: true })
  const alphaAssets = await inspectAlphaAssets()
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
  const bundleLocation = await bundle(entry, undefined, {
    publicDir: path.join(repoRoot, 'public'),
    publicPath: '/',
    webpackOverride,
  })
  const results: StaticRenderExecutionResult[] = []

  for (const manifestPath of paths) {
    const started = new Date()
    const startedAt = started.toISOString()
    const sourceManifestFixture = repoRelative(manifestPath)
    const raw = JSON.parse(await readFile(manifestPath, 'utf8')) as unknown
    const resolved = resolveStaticRenderManifest(raw)

    if (!resolved.valid) {
      const finished = new Date()
      const result: StaticRenderExecutionResult = {
        status: 'failed',
        template_key: 'unknown',
        started_at: startedAt,
        finished_at: finished.toISOString(),
        duration_ms: finished.getTime() - started.getTime(),
        diagnostics: resolved.errors.map((error) => ({ kind: error.kind, code: error.code, message: error.message, path: error.path })),
        source_manifest_fixture: sourceManifestFixture,
      }
      results.push(result)
      throw new Error(`Static render manifest failed validation: ${JSON.stringify(result, null, 2)}`)
    }

    const input = resolved.value
    const typography = await prepareTypography(input.tokens)
    if (!typography.valid) throw new Error(`Typography preparation failed: ${JSON.stringify(typography.errors)}`)
    const templateKey = `${input.resolvedTemplate.ref.id}@${input.resolvedTemplate.ref.version}`
    const componentKey = input.resolvedTemplate.descriptor.component_key
    if (!resolveTemplateComponent(componentKey)) throw new Error(`No component registered for ${componentKey}`)

    const outputPath = path.join(outputDir, fixtureOutputName(manifestPath))
    const inputProps = { resolvedInput: input }
    const composition = await selectComposition({
      serveUrl: bundleLocation,
      id: 'StaticRenderManifestStill',
      inputProps,
    })
    await renderStill({
      composition,
      serveUrl: bundleLocation,
      output: outputPath,
      inputProps,
    })
    const outputMetadata = await sharp(outputPath).metadata()
    const finished = new Date()
    const result: StaticRenderExecutionResult = {
      status: 'succeeded',
      template_key: templateKey,
      component_key: componentKey,
      variant: input.manifest.template.variant,
      canvas: input.manifest.canvas,
      output_path: repoRelative(outputPath),
      width: outputMetadata.width,
      height: outputMetadata.height,
      started_at: startedAt,
      finished_at: finished.toISOString(),
      duration_ms: finished.getTime() - started.getTime(),
      diagnostics: input.diagnostics,
      typography_preparation_ms: typography.value.preparation_ms,
      alpha_assets: alphaAssets,
      source_manifest_fixture: sourceManifestFixture,
    }
    await writeFile(path.join(outputDir, fixtureExecutionName(manifestPath)), `${JSON.stringify(result, null, 2)}\n`, 'utf8')
    results.push(result)
    console.log(JSON.stringify(result, null, 2))
  }

  await writeFile(path.join(outputDir, 'summary.json'), `${JSON.stringify({ status: 'succeeded', renders: results }, null, 2)}\n`, 'utf8')
}

main().catch((error) => {
  console.error('[render-static-manifest] failed:', error)
  process.exitCode = 1
})

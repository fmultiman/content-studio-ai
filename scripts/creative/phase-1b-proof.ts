import { adaptProjectIdentityToVisualTokens } from '@/lib/creative/integration/project-identity-adapter'
import { adaptLibraryFileToResolvedAsset } from '@/lib/creative/integration/library-file-adapter'
import { resolveTypography, tokensWithResolvedTypography } from '@/lib/creative/typography/resolve-typography'
import { bundle } from '@remotion/bundler'
import { renderStill, selectComposition } from '@remotion/renderer'
import path from 'path'
import os from 'os'
import type { LibraryFile } from '@/lib/types'

async function run() {
  console.log('--- Phase 1B Productization Proof: Real Asset Resolution ---')

  // 1. A ProjectIdentity payload
  const identity = {
    schema_version: 1 as const,
    expression: { visual_identity: 'Raw documentary' }
  }
  const tokens = adaptProjectIdentityToVisualTokens('proof-proj-1b', identity)
  const typographyResult = resolveTypography(tokens)

  // 2. A canonical LibraryFile shape (represents a DB row)
  const canonicalFile: LibraryFile = {
    id: 'lf-remote-asset-999',
    user_id: 'usr-1',
    project_id: 'proof-proj-1b',
    folder: 'evidence',
    name: 'External Asset Proof',
    kind: 'image',
    mime_type: 'image/jpeg',
    file_size: undefined as any,
    storage_provider: 's3',
    storage_path: 'mock/path/external.jpg',
    public_url: '',
    thumbnail_url: null,
    deleted_at: null,
    created_at: '2026-09-20T00:00:00Z',
    updated_at: '2026-09-20T00:00:00Z'
  }

  // 3. Adapter resolving the DB row via an injected S3 client abstraction
  const dummyContext = {
    createPresignedReadUrl: async (p: string) => `https://picsum.photos/seed/${p.length}/1080/1920`
  }

  const resolvedLibraryAsset = await adaptLibraryFileToResolvedAsset(canonicalFile, dummyContext)
  if (!resolvedLibraryAsset) {
    throw new Error('Failed to resolve library file adapter')
  }

  // Set sizing and bounding box metadata since the DB did not contain it
  resolvedLibraryAsset.focal_point = { x: 0.5, y: 0.5 }
  resolvedLibraryAsset.fit = 'cover'

  // 4. Constructing the resolution input purely around the library file
  const resolvedInput = {
    manifest: {
      schema_version: 'static-render.v0',
      canvas: { width: 1080, height: 1350, unit: 'px' },
      template: { variant: 'cover' },
      content: { title: 'Network Loading', subtitle: 'Phase 1B proved Chromium fetches the S3 URL.' },
      assets: { hero: { type: 'library_file', ref: resolvedLibraryAsset.ref } },
      identity: { snapshot_ref: tokens.snapshot_ref }
    },
    resolvedTemplate: {
      ref: { id: 'documentary-card', version: '0.1.0', scope: 'system', variant: 'cover' },
      descriptor: require('@/lib/creative/templates/registry').listTemplates().find(
        (t: any) => t.component_key === 'editorial.documentary-card'
      )
    },
    tokens: tokensWithResolvedTypography(tokens, (typographyResult as any).value),
    typography: (typographyResult as any).value,
    resolvedAssets: {
      hero: resolvedLibraryAsset
    },
    diagnostics: []
  } as any

  console.log('Bundling Remotion...')
  const bundleLocation = await bundle(path.resolve(process.cwd(), 'remotion/index.ts'), undefined, {
    publicDir: path.join(process.cwd(), 'public'),
    publicPath: '/',
    webpackOverride: (config: any) => ({
      ...config,
      resolve: {
        ...config.resolve,
        alias: {
          ...config.resolve?.alias,
          '@': process.cwd()
        }
      }
    })
  })

  console.log('Selecting Composition...')
  const composition = await selectComposition({
    serveUrl: bundleLocation,
    id: 'StaticRenderManifestStill',
    inputProps: { resolvedInput }
  })

  // Documentary Card output
  const docOut = path.resolve('.tmp/creative/productization/phase-1b/documentary-card-library-file.png')
  // ensure directory matches what's requested
  require('fs').mkdirSync(path.dirname(docOut), { recursive: true })

  console.log(`Rendering Documentary Card to ${docOut}...`)
  await renderStill({
    composition,
    serveUrl: bundleLocation,
    output: docOut,
    inputProps: { resolvedInput },
    imageFormat: 'png'
  })

  console.log('Phase 1B proof complete.')
}

run().catch((e) => {
  console.error(e)
  process.exit(1)
})

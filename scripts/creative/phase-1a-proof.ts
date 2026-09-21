import { adaptProjectIdentityToVisualTokens } from '@/lib/creative/integration/project-identity-adapter'
import { resolveStaticRenderManifest } from '@/lib/creative/resolution/resolve-static-render'
import { StaticRenderManifestSchema } from '@/lib/schemas/creative/static-render'
import { bundle } from '@remotion/bundler'
import { renderStill, selectComposition } from '@remotion/renderer'
import path from 'path'
import os from 'os'

async function run() {
  console.log('--- Phase 1A Productization Proof ---')

  // 1. A ProjectIdentity payload
  const identity = {
    schema_version: 1 as const,
    expression: { visual_identity: 'Raw documentary' }
  }

  // 2. The new adapter creates the visual tokens
  const tokens = adaptProjectIdentityToVisualTokens('proof-proj-1a', identity)
  
  // Create an ad-hoc registry so resolveStaticRenderManifest can succeed?
  // Wait, resolveStaticRenderManifest reaches out to IDENTITY_FIXTURES directly.
  // Ah! `resolveIdentitySnapshot` is hardcoded to `IDENTITY_FIXTURES`.
  // To use our adapter tokens, we either have to:
  // a) push the tokens into `IDENTITY_FIXTURES` array before resolving, OR
  // b) skip `resolveStaticRenderManifest` and construct the `ResolvedStaticRenderInput` manually.

  // Let's manually construct it, since the adapter replaces the fixture logic for the overarching app.
  // Actually, modifying `IDENTITY_FIXTURES` temporarily is easiest to use the full path:
  const { IDENTITY_FIXTURES } = require('@/lib/creative/identity/fixtures')
  // We can't easily push since it's `as const`. But we can mock or construct ResolvedStaticRenderInput.

  const { resolveTypography, tokensWithResolvedTypography } = require('@/lib/creative/typography/resolve-typography')
  const typographyResult = resolveTypography(tokens)

  const resolvedInput = {
    manifest: {
      schema_version: 'static-render.v0',
      canvas: { width: 1080, height: 1350, unit: 'px' },
      template: { variant: 'cover' },
      content: { title: 'Productization', subtitle: 'Phase 1A' },
      assets: { hero: { type: 'fixture', ref: 'fixture:asset:documentary-card:hero-archival-01' } },
      identity: { snapshot_ref: tokens.snapshot_ref }
    },
    resolvedTemplate: {
      ref: { id: 'documentary-card', version: '0.1.0', scope: 'system', variant: 'cover' },
      descriptor: require('@/lib/creative/templates/registry').listTemplates().find(
        (t: any) => t.component_key === 'editorial.documentary-card'
      )
    },
    tokens: tokensWithResolvedTypography(tokens, typographyResult.value),
    typography: typographyResult.value,
    resolvedAssets: {
      hero: require('@/lib/creative/assets/resolve-asset').resolveAsset({
        type: 'fixture',
        ref: 'fixture:asset:documentary-card:hero-archival-01'
      }).value
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
  const docOut = path.resolve('.tmp/creative/productization/phase-1a/documentary-card-1a.png')
  console.log(`Rendering Documentary Card to ${docOut}...`)
  await renderStill({
    composition,
    serveUrl: bundleLocation,
    output: docOut,
    inputProps: { resolvedInput }
  })

  // 3. Quote Card output
  const quoteInput = {
    ...resolvedInput,
    manifest: {
      ...resolvedInput.manifest,
      template: { variant: 'default' },
      content: { quote: 'Productization has begun.', attribution: 'Phase 1A' },
      assets: {}
    },
    resolvedTemplate: {
      ...resolvedInput.resolvedTemplate,
      ref: { ...resolvedInput.resolvedTemplate.ref, id: 'quote-card', variant: 'default' },
      descriptor: require('@/lib/creative/templates/registry').listTemplates().find(
        (t: any) => t.component_key === 'editorial.quote-card'
      )
    },
    resolvedAssets: {}
  }

  const quoteOut = path.resolve('.tmp/creative/productization/phase-1a/quote-card-1a.png')
  console.log(`Rendering Quote Card to ${quoteOut}...`)
  await renderStill({
    composition,
    serveUrl: bundleLocation,
    output: quoteOut,
    inputProps: { resolvedInput: quoteInput }
  })

  console.log('Phase 1A proof complete.')
}

run().catch((e) => {
  console.error(e)
  process.exit(1)
})

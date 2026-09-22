#!/usr/bin/env node
/**
 * Phase 2I-A1 — deterministic export of the isolated Content Studio Remotion
 * render-worker payload.
 *
 * This script is the anti-duplication seam required by this phase: it does
 * NOT hand-maintain a second copy of the renderer. It copies the exact,
 * named set of existing repo source files (unmodified) into
 * `infra/render-worker-runtime/dist/content-studio/`, preserving their
 * original relative paths, plus the two worker-only files that genuinely
 * are new (`remotion-entry.tsx`, `server.mjs`) and the static assets the
 * render path depends on (fonts + the two unconditional DocumentaryCard
 * material textures). Re-run this script any time the source files change;
 * `dist/` is gitignored and always disposable/regeneratable.
 *
 * Usage: node infra/render-worker-runtime/export.mjs
 */
import { mkdir, copyFile, rm } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(here, '..', '..')
const distRoot = path.join(here, 'dist', 'content-studio')

/**
 * Every file here is a value-import dependency (directly or transitively)
 * of `remotion-entry.tsx` -> TimelineComposition -> TemplateSegment for a
 * REAL render (ResolvedTimelineInput already resolved, so
 * resolve-timeline.ts / registry.ts / zod schema validation are never
 * reached at runtime — see PHASE_2I_A1 dependency map in README.md).
 * Files that are ONLY ever imported with `import type` elsewhere in this
 * list are deliberately NOT copied — TypeScript/babel elide type-only
 * imports before webpack ever tries to resolve the module, so the physical
 * file is not required. This is verified empirically by the local proof
 * (README.md "Validation"), not merely assumed.
 */
const REQUIRED_WORKER_SOURCE = [
  'remotion/timeline/TimelineComposition.tsx',
  'remotion/timeline/TemplateSegment.tsx',
  'remotion/timeline/frame-model.ts',
  'remotion/DocumentaryCardComposition.tsx',
  'remotion/TypographyReadyBoundary.tsx',
  'lib/creative/templates/component-resolver.ts',
  'lib/creative/typography/resolve-typography.ts',
  'lib/creative/assets/resolve-asset.ts',
  'components/creative/documentary-card/DocumentaryCard.tsx',
  'components/creative/documentary-card/CoverVariant.tsx',
  'components/creative/documentary-card/InfoVariant.tsx',
  'components/creative/documentary-card/primitives.tsx',
  'components/creative/documentary-card/types.ts',
  'components/creative/documentary-card/index.ts',
  'components/creative/quote-card/QuoteCard.tsx',
  'components/creative/quote-card/index.ts',
]

/** Static assets the render path fetches from Remotion's bundled publicDir. */
const REQUIRED_STATIC_ASSETS = [
  'public/creative-fonts/fraunces-700.woff2',
  'public/creative-fonts/source-sans-3-400.woff2',
  'public/creative-fonts/source-sans-3-600.woff2',
  'public/creative-fonts/space-grotesk-700.woff2',
  'public/creative-fonts/inter-400.woff2',
  'public/creative-fonts/inter-600.woff2',
  // Unconditional DocumentaryCard material textures (documentaryCardPropsFromRuntimeInput
  // always falls back to these two fixture assets when no primitiveMaterials
  // is supplied — true for every real render this worker performs, since the
  // worker boundary starts from ResolvedTimelineInput and never receives
  // primitiveMaterials/primitiveTransforms).
  'public/creative-fixtures/torn-paper-cream-01.png',
  'public/creative-fixtures/tape-kraft-01.png',
]

/** Worker-only files that are genuinely new source, not copies of app code. */
const WORKER_OWN_FILES = [
  { from: path.join(here, 'remotion-entry.tsx'), to: 'remotion-entry.tsx' },
  { from: path.join(here, 'server.mjs'), to: 'server.mjs' },
]

async function copyOne(relativePath) {
  const from = path.join(repoRoot, relativePath)
  const to = path.join(distRoot, relativePath)
  await mkdir(path.dirname(to), { recursive: true })
  await copyFile(from, to)
}

async function main() {
  await rm(distRoot, { recursive: true, force: true })
  await mkdir(distRoot, { recursive: true })

  for (const relativePath of REQUIRED_WORKER_SOURCE) await copyOne(relativePath)
  for (const relativePath of REQUIRED_STATIC_ASSETS) await copyOne(relativePath)
  for (const { from, to } of WORKER_OWN_FILES) {
    const target = path.join(distRoot, to)
    await mkdir(path.dirname(target), { recursive: true })
    await copyFile(from, target)
  }

  // Canonical proof fixture: generated separately by generate-fixture.mjs
  // (it re-derives from the real repo pipeline, not hand-authored), then
  // copied here if present.
  const fixtureSrc = path.join(here, 'fixtures', 'canonical-input.json')
  try {
    await mkdir(path.join(distRoot, 'fixtures'), { recursive: true })
    await copyFile(fixtureSrc, path.join(distRoot, 'fixtures', 'canonical-input.json'))
  } catch {
    console.warn('[export] fixtures/canonical-input.json not found yet — run generate-fixture.mjs first.')
  }

  const totalFiles = REQUIRED_WORKER_SOURCE.length + REQUIRED_STATIC_ASSETS.length + WORKER_OWN_FILES.length
  console.log(`[export] Copied ${totalFiles} files into ${distRoot}`)
  console.log('[export] Done. Copy this directory to /opt/content-studio/render-worker on the VPS.')
}

await main()

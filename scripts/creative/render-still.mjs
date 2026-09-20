// Wave 1 — Remotion Isolation Spike.
// Node-only script. Never imported from app/api/** (Vercel Functions cannot
// bundle @remotion/renderer's headless Chromium dependency — see
// docs/discovery/creative-rendering/RENDER_ARCHITECTURE_V0.md and the
// official Remotion docs on Vercel Functions).
//
// Usage: node scripts/creative/render-still.mjs

import { mkdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { bundle } from '@remotion/bundler'
import { renderStill, selectComposition } from '@remotion/renderer'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.join(__dirname, '..', '..')
const entry = path.join(repoRoot, 'remotion', 'index.ts')
const outDir = path.join(repoRoot, '.tmp', 'creative')
const outputPath = path.join(outDir, 'spike-still.png')

async function main() {
  mkdirSync(outDir, { recursive: true })

  const t0 = Date.now()
  const bundleLocation = await bundle({ entryPoint: entry })
  const t1 = Date.now()

  const composition = await selectComposition({
    serveUrl: bundleLocation,
    id: 'SpikeStill',
    inputProps: {},
  })
  const t2 = Date.now()

  await renderStill({
    composition,
    serveUrl: bundleLocation,
    output: outputPath,
    inputProps: {},
  })
  const t3 = Date.now()

  console.log(
    JSON.stringify(
      {
        outputPath,
        width: composition.width,
        height: composition.height,
        timingsMs: {
          bundle: t1 - t0,
          selectComposition: t2 - t1,
          render: t3 - t2,
          total: t3 - t0,
        },
      },
      null,
      2,
    ),
  )
}

main().catch((err) => {
  console.error('[render-still] failed:', err)
  process.exitCode = 1
})

// Wave 4 visual evidence. Node-only adapter proof; outputs stay in .tmp.
// No domain/database/storage access is performed by this script.

import { mkdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { bundle } from '@remotion/bundler'
import { renderStill, selectComposition } from '@remotion/renderer'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.join(__dirname, '..', '..')
const entry = path.join(repoRoot, 'remotion', 'index.ts')
const outDir = path.join(repoRoot, '.tmp', 'creative')

const webpackOverride = (config) => ({
  ...config,
  resolve: {
    ...config.resolve,
    alias: { ...(config.resolve?.alias ?? {}), '@': repoRoot },
  },
})

const outputs = [
  ['DocumentaryCardCoverStill', 'documentary-card-cover-1080x1350-a.png'],
  ['DocumentaryCardInfoStill', 'documentary-card-info-1080x1350-a.png'],
  ['DocumentaryCardCoverVideo', 'documentary-card-cover-1080x1920-a.png'],
  ['DocumentaryCardCoverNeutralStill', 'documentary-card-cover-1080x1350-b.png'],
]

async function main() {
  mkdirSync(outDir, { recursive: true })
  const bundleLocation = await bundle({ entryPoint: entry, publicDir: path.join(repoRoot, 'public'), publicPath: '/', webpackOverride })
  const rendered = []

  for (const [id, filename] of outputs) {
    const output = path.join(outDir, filename)
    const composition = await selectComposition({ serveUrl: bundleLocation, id })
    await renderStill({ composition, serveUrl: bundleLocation, output })
    rendered.push({ output, width: composition.width, height: composition.height })
  }

  console.log(JSON.stringify({ rendered }, null, 2))
}

main().catch((error) => {
  console.error('[render-documentary-card] failed:', error)
  process.exitCode = 1
})

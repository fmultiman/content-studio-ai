import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createJiti } from 'jiti'

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(scriptDir, '..', '..')
const jiti = createJiti(import.meta.url, {
  alias: { '@': repoRoot },
  jsx: true,
})

await jiti.import('./render-static-manifest.ts', { default: false })

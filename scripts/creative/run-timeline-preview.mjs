import { createJiti } from 'jiti'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(scriptDir, '..', '..')
const jiti = createJiti(import.meta.url, { alias: { '@': repoRoot }, jsx: true })
const runner = await jiti.import('./render-timeline-preview.ts', { default: false })
const summary = await runner.renderTimelinePreview()
process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`)

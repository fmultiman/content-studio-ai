import { createJiti } from 'jiti'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(scriptDir, '..', '..')
const jiti = createJiti(import.meta.url, { alias: { '@': repoRoot }, jsx: true })
const runner = await jiti.import('./render-timeline-manifest.ts', { default: false })
const fixturePath = process.argv[2]

try {
  const result = await runner.renderOfficialTimelineManifest(fixturePath)
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
} catch (error) {
  const failure = {
    status: 'failed',
    execution_kind: 'video',
    diagnostics: error?.diagnostics ?? [{ code: 'render_failed', message: error instanceof Error ? error.message : String(error) }],
  }
  process.stderr.write(`${JSON.stringify(failure, null, 2)}\n`)
  process.exitCode = 1
}

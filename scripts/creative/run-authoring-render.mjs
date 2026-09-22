import { createJiti } from 'jiti'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(scriptDir, '..', '..')
const jiti = createJiti(import.meta.url, { alias: { '@': repoRoot }, jsx: true })
const renderer = await jiti.import('./render-authoring-request.ts', { default: false })
const raw = await renderer.readAuthoringRequestFromStdin()
const result = await renderer.renderAuthoringRequest(raw)
process.stdout.write(`${JSON.stringify(result)}\n`)

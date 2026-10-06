import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(process.cwd())
const read = (file: string) => readFileSync(resolve(root, file), 'utf8')

describe('Image generation route convergence contract', () => {
  it('freezes an Attempt before either canonical provider dispatch', () => {
    const openai = read('app/api/openai/generate-image/route.ts')
    const nano = read('app/api/nanobanana/generate/route.ts')
    expect(openai).toContain('freezeAndClaimImageAttempt')
    expect(nano).toContain('freezeAndClaimImageAttempt')
    expect(openai.indexOf('freezeAndClaimImageAttempt')).toBeLessThan(openai.indexOf('fetch(OPENAI_IMAGES_URL'))
    expect(nano.indexOf('freezeAndClaimImageAttempt')).toBeLessThan(nano.indexOf('fetch(apiUrl'))
  })

  it('keeps provider retries idempotent and links canonical output to the Attempt', () => {
    const execution = read('lib/image-generation/execution.ts')
    const page = read('app/(dashboard)/imagens/page.tsx')
    expect(execution).toContain("eq('client_request_id', input.clientRequestId)")
    expect(execution).toContain('request_fingerprint')
    expect(execution).toContain('result_image_id: image.id')
    expect(page).toContain("/api/image-generation-attempts?sessionId=${canonicalSessionId}")
    expect(page).toContain('canonicalSessionId ? crypto.randomUUID() : undefined')
  })

  it('routes resume through the canonical workspace and leaves the old URL as a redirect', () => {
    const workspace = read('app/(dashboard)/imagens/geracoes/[sessionId]/page.tsx')
    const compatibility = read('app/(dashboard)/imagens/rascunhos/page.tsx')
    expect(workspace).toContain('canonicalSessionId')
    expect(workspace).toContain('ImagesPageShell')
    expect(compatibility).toContain("redirect('/imagens')")
  })
})

// IMAGE_GENERATION_WORKSPACE_REGRESSION_RECOVERY_V1: source-text assertions above passed while the canonical
// route was broken in Production (Next.js 16 `params` is a Promise). Guard the whole App Router tree.
describe('Next.js 16 async params contract', () => {
  const { readdirSync, statSync } = require('node:fs') as typeof import('node:fs')
  const walk = (dir: string, out: string[] = []): string[] => {
    for (const entry of readdirSync(dir)) {
      const full = resolve(dir, entry)
      if (statSync(full).isDirectory()) walk(full, out)
      else if (/^(page|layout|route)\.tsx?$/.test(entry)) out.push(full)
    }
    return out
  }

  it('no page, layout or route types `params` as a synchronous object', () => {
    const offenders = walk(resolve(root, 'app'))
      .filter((file) => /params\s*:\s*\{(?!\s*\})/.test(readFileSync(file, 'utf8')))
      .map((file) => file.slice(root.length + 1))
    expect(offenders).toEqual([])
  })

  it('the canonical Image Session page reads the id through useParams, not the params prop', () => {
    const page = read('app/(dashboard)/imagens/geracoes/[sessionId]/page.tsx')
    expect(page).toContain('useParams')
    // The component takes no props, so nothing can read the Promise-typed `params` prop.
    expect(page).toMatch(/export default function \w+\(\)/)
  })
})

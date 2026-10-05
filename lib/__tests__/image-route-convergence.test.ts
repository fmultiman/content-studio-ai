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

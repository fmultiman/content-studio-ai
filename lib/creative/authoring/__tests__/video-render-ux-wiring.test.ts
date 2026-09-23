import { describe, expect, it } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'

describe('Videos Page Render UX', () => {
  const pageSource = readFileSync(
    join(process.cwd(), 'app', '(dashboard)', 'videos', 'page.tsx'),
    'utf-8'
  )

  it('removed the mocked timeout behavior and calls real POST /render', () => {
    expect(pageSource).not.toMatch(/setTimeout\(\s*resolve,\s*3000\s*\)/)
    expect(pageSource).toMatch(/fetch\(`\/api\/video-drafts\/\$\{draft\.id\}\/render`/)
    expect(pageSource).toMatch(/method:\s*'POST'/)
  })

  it('implements duplicate-click protection via isGenerating/status disables', () => {
    expect(pageSource).toMatch(/disabled=\{isGenerating \|\| renderExecution\?.status === 'queued' \|\| renderExecution\?.status === 'claimed'/)
  })

  it('generates a new clientId (crypto.randomUUID) on first use and retry (idempotency)', () => {
    expect(pageSource).toMatch(/useState<string>\(\(\) => crypto\.randomUUID\(\)\)/)
    expect(pageSource).toMatch(/setRenderIdempotencyKey\(crypto\.randomUUID\(\)\)/)
    expect(pageSource).toMatch(/JSON.stringify\(\{ idempotencyKey: renderIdempotencyKey \}\)/)
  })

  it('stops polling at terminal states (completed/failed) and emits exactly one toast', () => {
    expect(pageSource).toMatch(/if \(pendingNotification\.current\)/)
    expect(pageSource).toMatch(/pendingNotification\.current = false/)
    // Phase 2I: the terminal-state guard now lives in its own effect (see
    // c2-gallery-videos-product.test.ts for the reachability fix) as an
    // early-return — De Morgan's equivalent of the old `=== || ===` guard,
    // written this way specifically so it fires unconditionally rather than
    // only from inside the poll-scheduling branch.
    expect(pageSource).toMatch(/renderExecution\.status !== 'completed' && renderExecution\.status !== 'failed'/)
  })

  it('displays the inline result area', () => {
    expect(pageSource).toMatch(/Resultado/)
  })

  it('supports reload restoration via GET /api/render-executions?videoDraftId=[id]', () => {
    expect(pageSource).toMatch(/fetch\([^)]*\/api\/render-executions\?videoDraftId=/)
  })

  it('provides persistent completed state area (Último render concluído)', () => {
    expect(pageSource).toMatch(/Último render concluído/)
  })

  it('provides persistent failed state area and UI mapping', () => {
    expect(pageSource).toMatch(/A renderização falhou/)
  })
})

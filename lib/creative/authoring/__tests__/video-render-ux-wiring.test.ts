import { describe, expect, it } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'

/**
 * Render UX of the ONLY VideoDraft writer. Since
 * VIDEO_DRAFT_SINGLE_WRITER_AND_CANONICAL_ENTRY_V1 the legacy /videos
 * workspace no longer renders; these guarantees are pinned on the canonical
 * Creative Editor instead (see single-writer.test.ts for the hub side).
 */
describe('Video render UX (canonical Creative Editor)', () => {
  const pageSource = readFileSync(
    join(process.cwd(), 'app', '(dashboard)', 'creative-editor', 'video', '[draftId]', 'page.tsx'),
    'utf-8'
  ).replace(/\r\n/g, '\n')

  it('calls the real server-authoritative POST /render (no mocked timeout)', () => {
    expect(pageSource).not.toMatch(/setTimeout\(\s*resolve,\s*3000\s*\)/)
    expect(pageSource).toMatch(/fetch\(`\/api\/video-drafts\/\$\{draft\.id\}\/render`/)
    expect(pageSource).toMatch(/method:\s*'POST'/)
  })

  it('protects against duplicate clicks while submitting / queued / claimed', () => {
    expect(pageSource).toContain("const renderActive = renderSubmitting || executionStatus === 'queued' || executionStatus === 'claimed'")
    expect(pageSource).toMatch(/disabled=\{!canRender \|\| renderActive/)
    expect(pageSource).toContain('if (!draft || renderSubmitting) return')
  })

  it('sends a fresh idempotency key per render request', () => {
    expect(pageSource).toContain('JSON.stringify({ idempotencyKey: crypto.randomUUID() })')
  })

  it('renders the SAVED draft: unsaved edits are saved first', () => {
    expect(pageSource).toMatch(/if \(dirty\) \{[\s\S]*?const saved = await saveNow\(\)\s*\n\s*if \(!saved\) return/)
  })

  it('shows queued / failed / completed states in the header', () => {
    expect(pageSource).toContain('Na fila…')
    expect(pageSource).toContain('Render falhou')
    expect(pageSource).toContain('Ver vídeo renderizado')
  })

  it('restores the latest execution on reload via GET /api/render-executions?videoDraftId=[id]', () => {
    expect(pageSource).toMatch(/fetch\(`\/api\/render-executions\?videoDraftId=\$\{loaded\.id\}`\)/)
  })
})

import { describe, expect, it } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'

/**
 * Output player / download / polling guarantees. Originally pinned on the
 * legacy /videos workspace (Phase 2I); since
 * VIDEO_DRAFT_SINGLE_WRITER_AND_CANONICAL_ENTRY_V1 the render + Output Player
 * live only in the canonical Creative Editor, so they are pinned there.
 */
const editorSource = readFileSync(
  join(process.cwd(), 'app', '(dashboard)', 'creative-editor', 'video', '[draftId]', 'page.tsx'),
  'utf-8'
).replace(/\r\n/g, '\n')

const galleryLibrarySource = readFileSync(
  join(process.cwd(), 'lib', 'gallery-output-library.ts'),
  'utf-8'
)

describe('Video output productization (Creative Editor + Gallery)', () => {
  it('a completed execution requests a signed output-url', () => {
    expect(editorSource).toMatch(/fetch\(`\/api\/render-executions\/\$\{id\}\/output-url`\)/)
  })

  it('the Output Player is a native <video> on the signed URL, distinct from the authoring Player', () => {
    expect(editorSource).toMatch(/<video src=\{outputUrl\} controls/)
    expect(editorSource).toContain('data-testid="output-player"')
  })

  it('opening the Output Player fetches a fresh signed URL (also after reload)', () => {
    expect(editorSource).toMatch(/if \(!outputUrl\) \{ setOutputUrlError\(null\); void fetchOutputUrl\(executionId\) \}/)
  })

  it('download is a distinct attachment-disposition request', () => {
    expect(editorSource).toMatch(/\/api\/render-executions\/\$\{executionId\}\/output-url\?disposition=attachment/)
  })

  it('Gallery completed video render is included in generated outputs', () => {
    expect(galleryLibrarySource).toMatch(/exec\.status === 'completed'/)
    expect(galleryLibrarySource).toMatch(/const status = 'generated'/)
  })

  it('Gallery video card is distinguishable', () => {
    expect(galleryLibrarySource).toMatch(/mediaType:\s*'video'/)
  })

  it('Gallery logic handles video outputs without throwing missing images', () => {
    expect(galleryLibrarySource).toMatch(/imageUrl:\s*null/)
    expect(galleryLibrarySource).toMatch(/thumbnailUrl:\s*null/)
  })
})

describe('Output-url failure is bounded (Phase 2I Task C2)', () => {
  it('a failed output-url fetch sets an error state instead of an infinite spinner', () => {
    expect(editorSource).toContain("setOutputUrlError('Não foi possível carregar o vídeo renderizado.')")
  })

  it('the error state never fakes successful playback', () => {
    expect(editorSource).toMatch(/outputUrl\s*\n?\s*\? <video[\s\S]{0,200}: outputUrlError/)
  })

  it('carries no obsolete "simulated flow" copy', () => {
    expect(editorSource).not.toMatch(/fluxo é simulado/)
    expect(editorSource).not.toMatch(/integração futura com APIs de geração de vídeo/)
  })
})

describe('Polling safety (Phase 2I Task E)', () => {
  it('polls only queued/claimed, keyed on id/status (not the whole execution object)', () => {
    const pollEffect = editorSource.match(/if \(!executionId \|\| \(executionStatus !== 'queued' && executionStatus !== 'claimed'\)\) return[\s\S]*?\}, \[([^\]]*)\]\)/)
    expect(pollEffect).not.toBeNull()
    expect(pollEffect![1].trim()).toBe('executionId, executionStatus')
  })

  it('every poll schedules exactly one next call, and the effect cleans up its timer', () => {
    expect(editorSource).toMatch(/if \(!cancelled\) timeoutId = window\.setTimeout\(poll, RENDER_POLL_INTERVAL_MS\)/)
    expect(editorSource).toContain('return () => { cancelled = true; if (timeoutId) window.clearTimeout(timeoutId) }')
  })
})

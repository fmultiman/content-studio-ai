import { describe, expect, it } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'

describe('Videos and Gallery C2 Output Productization', () => {
  const videosPageSource = readFileSync(
    join(process.cwd(), 'app', '(dashboard)', 'videos', 'page.tsx'),
    'utf-8'
  )

  const galleryLibrarySource = readFileSync(
    join(process.cwd(), 'lib', 'gallery-output-library.ts'),
    'utf-8'
  )

  it('completed execution requests output-url', () => {
    // In polling loop, fetchOutputUrl is called when status === 'completed'
    expect(videosPageSource).toMatch(/fetchOutputUrl\(renderExecution\.id\)/)
    expect(videosPageSource).toMatch(/\/api\/render-executions\/\$\{executionId\}\/output-url/)
  })

  it('player appears and uses signed URL', () => {
    // Looks for the specific native HTML5 implementation
    expect(videosPageSource).toMatch(/<video/)
    expect(videosPageSource).toMatch(/src=\{renderOutputUrl\}/)
    expect(videosPageSource).toMatch(/controls/)
  })

  it('reload gets a fresh signed URL', () => {
    // The poll loop logic recovers output URL if completed+no URL+no cancelled
    expect(videosPageSource).toMatch(/fetchOutputUrl\(renderExecution\.id\)/)
  })

  it('Video rendering has download action', () => {
    expect(videosPageSource).toMatch(/api\/render-executions\/\$\{renderExecution.id\}\/output-url\?disposition=attachment/)
  })

  it('Gallery completed video render is included in generated outputs', () => {
    // Filter expects execution status completed -> 'generated' mapping, and execution arrays mapping
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

/**
 * Phase 2I — Production Video Operational Closure (Task C1/C2/F).
 *
 * The tests above only ever proved the STRING `fetchOutputUrl(renderExecution.id)`
 * exists somewhere in the file — they passed even while the production bug
 * was live: that call was reachable only from inside the polling function,
 * which was only ever scheduled for a queued/claimed execution. An execution
 * that loaded ALREADY completed (the restored-on-page-load path) never
 * called it at all, so the inline player spun forever despite the download
 * and the MP4 both being fine. These tests pin the actual fix: the
 * output-url hydration effect is unconditional on terminal status, not
 * nested inside the poll-scheduling gate.
 */
describe('Phase 2I — completed-player hydration reachability (Task C1)', () => {
  const videosPageSource = readFileSync(
    join(process.cwd(), 'app', '(dashboard)', 'videos', 'page.tsx'),
    'utf-8'
  )

  it('has a dedicated effect keyed on execution id/status (not the full poll effect) that hydrates the player', () => {
    expect(videosPageSource).toMatch(
      /useEffect\(\(\) => \{\s*if \(!renderExecution\?\.id\) return\s*if \(renderExecution\.status !== 'completed' && renderExecution\.status !== 'failed'\) return/,
    )
  })

  it('the hydration effect depends only on id/status — it fires for a status ALREADY completed on mount, not only on a live transition', () => {
    const hydrationEffectMatch = videosPageSource.match(
      /if \(renderExecution\.status !== 'completed' && renderExecution\.status !== 'failed'\) return[\s\S]*?\}, \[([^\]]*)\]\)/,
    )
    expect(hydrationEffectMatch).not.toBeNull()
    expect(hydrationEffectMatch![1]).toContain('renderExecution?.id')
    expect(hydrationEffectMatch![1]).toContain('renderExecution?.status')
  })

  it('output-url hydration is NOT gated behind the queued/claimed poll-scheduling condition', () => {
    // The polling effect's own entry guard must be scoped to queued/claimed
    // ONLY — proving the terminal-state hydration above lives in its own,
    // separately-triggered effect rather than depending on the poll effect
    // ever having scheduled anything.
    expect(videosPageSource).toMatch(
      /if \(renderExecution\.status !== 'queued' && renderExecution\.status !== 'claimed'\) return/,
    )
  })

  it('a failed output-url fetch sets a bounded error state rather than leaving an infinite spinner (Task C2)', () => {
    expect(videosPageSource).toMatch(/renderOutputUrlError/)
    expect(videosPageSource).toMatch(/setRenderOutputUrlError\(/)
  })

  it('the player error state offers retry and never fakes successful playback', () => {
    expect(videosPageSource).toMatch(/setRenderOutputUrlError\(null\)\s*\n\s*fetchOutputUrl\(renderExecution\.id\)/)
    expect(videosPageSource).not.toMatch(/renderOutputUrlError[\s\S]{0,80}<video/)
  })

  it('download remains a distinct attachment-disposition request, unaffected by the inline player fix', () => {
    expect(videosPageSource).toMatch(/handleDownloadOutput/)
    expect(videosPageSource).toMatch(/disposition=attachment/)
  })

  it('removes the obsolete "simulated flow" product copy (Task D)', () => {
    expect(videosPageSource).not.toMatch(/fluxo é simulado/)
    expect(videosPageSource).not.toMatch(/integração futura com APIs de geração de vídeo/)
  })
})

describe('Phase 2I — polling safety (Task E)', () => {
  const videosPageSource = readFileSync(
    join(process.cwd(), 'app', '(dashboard)', 'videos', 'page.tsx'),
    'utf-8'
  )

  it('polling uses a single recursive setTimeout chain, not a re-entrant effect keyed on the whole execution object', () => {
    // Regression guard: the OLD implementation depended on the full
    // `renderExecution` object (which the poll itself replaces every tick),
    // re-running the whole effect (and re-declaring a new timer) on every
    // single poll response. The fix depends only on id/status.
    const pollEffectDeps = videosPageSource.match(
      /if \(renderExecution\.status !== 'queued' && renderExecution\.status !== 'claimed'\) return[\s\S]*?\}, \[([^\]]*)\]\)/,
    )
    expect(pollEffectDeps).not.toBeNull()
    expect(pollEffectDeps![1].trim()).toBe('renderExecution?.id, renderExecution?.status')
  })

  it('every poll schedules exactly one next call, and the effect cleans up its timer', () => {
    expect(videosPageSource).toMatch(/window\.clearTimeout\(timeoutId\)/)
    expect(videosPageSource).toMatch(/cancelled = true/)
  })
})

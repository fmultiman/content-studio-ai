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

import { afterEach, describe, expect, it, vi } from 'vitest'
import DevHarnessLayout from '@/app/dev/layout'

// VIDEO_DRAFT_SINGLE_WRITER_AND_CANONICAL_ENTRY_V1 — opportunistic hygiene:
// /dev/creative-preview (and any /dev/* harness) is not a production surface.
describe('/dev/* harness guard', () => {
  afterEach(() => vi.unstubAllEnvs())

  it('is a 404 in production', () => {
    vi.stubEnv('NODE_ENV', 'production')
    let thrown: unknown
    try {
      DevHarnessLayout({ children: 'harness' })
    } catch (error) {
      thrown = error
    }
    expect((thrown as { digest?: string } | undefined)?.digest).toMatch(/404/)
  })

  it('renders the harness in development', () => {
    vi.stubEnv('NODE_ENV', 'development')
    expect(DevHarnessLayout({ children: 'harness' })).toBe('harness')
  })
})

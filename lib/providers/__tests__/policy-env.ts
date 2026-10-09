// FUTURE-050 — make a test run under a chosen execution environment WITHOUT the mocked-providers harness, so the
// real policy decides. Always pair with restoreEnvironment() in afterEach.
import { vi } from 'vitest'
import { __setMockedProvidersHarnessForTests } from '@/lib/providers/execution-policy'

export type SimulatedEnvironment = 'production' | 'preview' | 'local' | 'unknown' | 'test'

export function simulateEnvironment(kind: SimulatedEnvironment, extra: Record<string, string> = {}): void {
  __setMockedProvidersHarnessForTests(false) // must run while VITEST is still set
  if (kind === 'test') return
  vi.stubEnv('VITEST', '')
  const vercel = { VERCEL_URL: 'content-studio-abc.vercel.app', VERCEL_DEPLOYMENT_ID: 'dpl_test' }
  const env: Record<string, string> = {
    production: { NODE_ENV: 'production', VERCEL_ENV: 'production', VERCEL_TARGET_ENV: 'production', ...vercel },
    preview: { NODE_ENV: 'production', VERCEL_ENV: 'preview', VERCEL_TARGET_ENV: 'preview', ...vercel },
    local: { NODE_ENV: 'development', VERCEL_ENV: '', VERCEL_URL: '', VERCEL_DEPLOYMENT_ID: '' },
    unknown: { NODE_ENV: 'production', VERCEL_ENV: '', VERCEL_URL: '', VERCEL_DEPLOYMENT_ID: '' },
  }[kind]
  for (const [key, value] of Object.entries({ ...env, ...extra })) vi.stubEnv(key, value)
}

export function restoreEnvironment(): void {
  vi.unstubAllEnvs() // VITEST is back
  __setMockedProvidersHarnessForTests(true)
}

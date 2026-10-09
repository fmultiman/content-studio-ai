import { afterEach, describe, expect, it } from 'vitest'
import {
  LOCAL_PAID_OPT_IN_ENV,
  LOCAL_PAID_OPT_IN_VALUE,
  PROVIDER_EXECUTION_DISABLED_CODE,
  ProviderExecutionDisabledError,
  __setMockedProvidersHarnessForTests,
  assertProviderExecutionAllowed,
  classifyExecutionEnvironment,
  decideProviderExecution,
  describeProviderExecutionPolicy,
} from '../execution-policy'

// FUTURE-050 — the policy is a pure function of the environment object it is given.

const REQ = { provider: 'gemini', operation: 'video_review' }
const VERCEL = { VERCEL_URL: 'content-studio-abc.vercel.app', VERCEL_DEPLOYMENT_ID: 'dpl_abc' }
const PRODUCTION = { NODE_ENV: 'production', VERCEL_ENV: 'production', VERCEL_TARGET_ENV: 'production', ...VERCEL }
const PREVIEW = { NODE_ENV: 'production', VERCEL_ENV: 'preview', VERCEL_TARGET_ENV: 'preview', ...VERCEL }
// What `vercel env pull` writes into a developer's .env.local: Vercel-looking variables, but no real runtime.
const PULLED_FILE = { VERCEL: '1', VERCEL_ENV: 'production', VERCEL_TARGET_ENV: 'production', VERCEL_URL: '', VERCEL_GIT_COMMIT_SHA: '' }

afterEach(() => __setMockedProvidersHarnessForTests(true))

describe('environment classification', () => {
  it('1. a real Vercel Production runtime is production', () => {
    expect(classifyExecutionEnvironment(PRODUCTION)).toBe('production')
  })

  it('2. a real Vercel Preview runtime is preview (a production BUILD is not enough to be Production)', () => {
    expect(classifyExecutionEnvironment(PREVIEW)).toBe('preview')
    expect(classifyExecutionEnvironment({ ...PREVIEW, NODE_ENV: 'production' })).not.toBe('production')
  })

  it('3. vitest is test, even when Vercel-looking variables are present', () => {
    expect(classifyExecutionEnvironment({ VITEST: 'true', ...PRODUCTION })).toBe('test')
    expect(classifyExecutionEnvironment({ NODE_ENV: 'test' })).toBe('test')
  })

  it('4. next dev with no Vercel runtime is local', () => {
    expect(classifyExecutionEnvironment({ NODE_ENV: 'development' })).toBe('local')
    expect(classifyExecutionEnvironment({ NODE_ENV: 'development', VERCEL_ENV: 'development', ...VERCEL })).toBe('local')
  })

  it('a pulled production env file on a laptop is NOT production (empty VERCEL_URL, no deployment id)', () => {
    expect(classifyExecutionEnvironment({ NODE_ENV: 'development', ...PULLED_FILE })).toBe('local')
    expect(classifyExecutionEnvironment({ NODE_ENV: 'production', ...PULLED_FILE })).toBe('unknown') // e.g. local `next start`
  })

  it('any one runtime-only Vercel variable proves a real runtime (robust to a missing VERCEL_URL)', () => {
    const bare = { NODE_ENV: 'production', VERCEL_ENV: 'production', VERCEL_TARGET_ENV: 'production' }
    expect(classifyExecutionEnvironment({ ...bare, VERCEL_REGION: 'iad1' })).toBe('production')
    expect(classifyExecutionEnvironment({ ...bare, VERCEL_DEPLOYMENT_ID: 'dpl_x' })).toBe('production')
    expect(classifyExecutionEnvironment({ ...bare, VERCEL_URL: 'x.vercel.app' })).toBe('production')
    expect(classifyExecutionEnvironment(bare)).toBe('unknown')
  })

  it('5. missing, ambiguous or contradictory signals are unknown (fail closed)', () => {
    expect(classifyExecutionEnvironment({})).toBe('unknown')
    expect(classifyExecutionEnvironment({ NODE_ENV: 'production' })).toBe('unknown')
    expect(classifyExecutionEnvironment({ ...VERCEL })).toBe('unknown')
    expect(classifyExecutionEnvironment({ ...VERCEL, VERCEL_ENV: 'staging' })).toBe('unknown')
    expect(classifyExecutionEnvironment({ ...PRODUCTION, VERCEL_TARGET_ENV: 'staging' })).toBe('unknown')
    expect(classifyExecutionEnvironment({ VERCEL_ENV: 'production' })).toBe('unknown')
  })
})

describe('provider execution decision', () => {
  it('6. Production allows paid execution', () => {
    expect(decideProviderExecution(REQ, PRODUCTION)).toMatchObject({ allowed: true, environment: 'production' })
    expect(() => assertProviderExecutionAllowed(REQ, PRODUCTION)).not.toThrow()
  })

  it('7. Preview denies', () => {
    expect(decideProviderExecution(REQ, PREVIEW)).toMatchObject({ allowed: false, environment: 'preview', reason: 'preview' })
    expect(() => assertProviderExecutionAllowed(REQ, PREVIEW)).toThrow(ProviderExecutionDisabledError)
  })

  it('8. test denies real execution (the harness seam only applies to the live process env, never to an explicit env)', () => {
    __setMockedProvidersHarnessForTests(true)
    expect(decideProviderExecution(REQ, { VITEST: 'true' })).toMatchObject({ allowed: false, environment: 'test' })
    expect(decideProviderExecution(REQ, { NODE_ENV: 'test' })).toMatchObject({ allowed: false, environment: 'test' })
  })

  it('the mocked-providers harness is the single, vitest-only exception for the live process env', () => {
    __setMockedProvidersHarnessForTests(false)
    expect(decideProviderExecution(REQ)).toMatchObject({ allowed: false, environment: 'test' })
    __setMockedProvidersHarnessForTests(true)
    expect(decideProviderExecution(REQ)).toMatchObject({ allowed: true, reason: 'mocked_providers_harness' })
  })

  it('9. local denies without the opt-in', () => {
    expect(decideProviderExecution(REQ, { NODE_ENV: 'development' })).toMatchObject({ allowed: false, reason: 'local_without_opt_in' })
  })

  it('10. local with the exact acknowledgement allows; boolean-ish values do not', () => {
    const local = { NODE_ENV: 'development' }
    expect(decideProviderExecution(REQ, { ...local, [LOCAL_PAID_OPT_IN_ENV]: LOCAL_PAID_OPT_IN_VALUE })).toMatchObject({ allowed: true, reason: 'local_opt_in' })
    for (const value of ['1', 'true', 'yes', 'I-ACCEPT-REAL-PROVIDER-COSTS', '']) {
      expect(decideProviderExecution(REQ, { ...local, [LOCAL_PAID_OPT_IN_ENV]: value }).allowed).toBe(false)
    }
  })

  it('11. Preview (and test, and unknown) cannot use the local override', () => {
    const optIn = { [LOCAL_PAID_OPT_IN_ENV]: LOCAL_PAID_OPT_IN_VALUE }
    expect(decideProviderExecution(REQ, { ...PREVIEW, ...optIn }).allowed).toBe(false)
    expect(decideProviderExecution(REQ, { VITEST: 'true', ...optIn }).allowed).toBe(false)
    expect(decideProviderExecution(REQ, { NODE_ENV: 'production', ...optIn }).allowed).toBe(false)
    // A laptop holding the pulled production file plus the opt-in is `local` only under `next dev`; under next start it is unknown.
    expect(decideProviderExecution(REQ, { NODE_ENV: 'production', ...PULLED_FILE, ...optIn }).allowed).toBe(false)
  })

  it('12. a missing environment denies', () => {
    expect(decideProviderExecution(REQ, {})).toMatchObject({ allowed: false, environment: 'unknown', reason: 'unknown_environment' })
  })

  it('status reads (polling an already-submitted task) never spend and are not gated', () => {
    expect(decideProviderExecution({ ...REQ, purpose: 'status_read' }, PREVIEW).allowed).toBe(true)
    expect(decideProviderExecution({ ...REQ, purpose: 'status_read' }, {}).allowed).toBe(true)
  })
})

describe('error contract', () => {
  it('is typed, browser-safe and names no secret, variable, URL or project', () => {
    let caught: unknown
    try { assertProviderExecutionAllowed(REQ, PREVIEW) } catch (error) { caught = error }
    expect(caught).toBeInstanceOf(ProviderExecutionDisabledError)
    const error = caught as ProviderExecutionDisabledError
    expect(error).toMatchObject({ code: PROVIDER_EXECUTION_DISABLED_CODE, status: 403, environment: 'preview', provider: 'gemini' })
    expect(error.message).toMatch(/desativada neste ambiente \(preview\)/)
    expect(error.message).not.toMatch(/VERCEL|KEY|http|supabase|\.com/i)
  })

  it('describeProviderExecutionPolicy exposes only the class and allowed/blocked', () => {
    expect(describeProviderExecutionPolicy(PRODUCTION)).toEqual({ environment: 'production', paidExecution: 'allowed' })
    expect(describeProviderExecutionPolicy(PREVIEW)).toEqual({ environment: 'preview', paidExecution: 'blocked' })
  })
})

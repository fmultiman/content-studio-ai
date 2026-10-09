// ENVIRONMENT_ISOLATION_AND_PROVIDER_CALL_GUARDS_V1 (FUTURE-050) — SERVER ONLY.
//
// One fail-closed answer to "may THIS runtime spend money at an external AI provider?".
//
// Why it exists: Preview deployments and developer machines share the Production Supabase project and can hold
// real provider credentials, so a "read-only" click on Review/Generate in Preview executed real Gemini calls
// (FUTURE-048). `NODE_ENV === 'production'` cannot tell Preview from Production (both are production builds),
// and a `vercel env pull` file even carries `VERCEL_ENV="production"` onto a laptop, so the signals below are
// combined and anything ambiguous is DENIED.
//
// Environment classification (first match wins):
//   test        VITEST is set or NODE_ENV === 'test'.
//   production  a REAL Vercel runtime (VERCEL_URL, VERCEL_DEPLOYMENT_ID or VERCEL_REGION is non-empty — a pulled
//               .env file leaves the first empty and never contains the others) AND VERCEL_ENV === 'production' AND VERCEL_TARGET_ENV is absent or 'production'.
//   preview     a real Vercel runtime AND VERCEL_ENV === 'preview'.
//   local       NOT a real Vercel runtime AND NODE_ENV === 'development' (`next dev`), or `vercel dev`.
//   unknown     everything else (self-hosted `next start`, plain node scripts, missing/odd variables, a pulled
//               production env file under `next start`).
//
// Paid-execution decision:
//   production  allowed.
//   preview     DENIED. No override exists; the local opt-in below is ignored.
//   test        DENIED (real execution). The shared vitest setup installs one documented seam so MOCKED provider
//               flows can run, and blocks real network egress to provider hosts (see vitest.setup.ts).
//   local       DENIED unless the explicit opt-in below is present.
//   unknown     DENIED.
//
// Local live validation needs TWO independent facts: the runtime classifies as `local` (not something a variable
// can fake: it needs a real `next dev`) AND CONTENT_STUDIO_ALLOW_LOCAL_PAID_PROVIDER_CALLS has the exact
// acknowledgement string. A boolean-ish value ("1", "true") is rejected on purpose.
//
// `purpose: 'status_read'` (polling an already-submitted task, reading a callback) never spends and is not gated.

export type ExecutionEnvironment = 'production' | 'preview' | 'local' | 'test' | 'unknown'

export type PolicyEnv = Record<string, string | undefined>

export const LOCAL_PAID_OPT_IN_ENV = 'CONTENT_STUDIO_ALLOW_LOCAL_PAID_PROVIDER_CALLS'
export const LOCAL_PAID_OPT_IN_VALUE = 'i-accept-real-provider-costs'

export const PROVIDER_EXECUTION_DISABLED_CODE = 'PROVIDER_EXECUTION_DISABLED_IN_ENVIRONMENT'

export type ProviderExecutionPurpose = 'execute' | 'status_read'

export type ProviderExecutionRequest = {
  /** Provider id, e.g. `openai`, `gemini`, `kling`, `nano_banana`. Informational. */
  provider: string
  /** What is being executed, e.g. `video_review`, `image_generation`. Informational. */
  operation: string
  purpose?: ProviderExecutionPurpose
}

export type ProviderExecutionDecision =
  | { allowed: true; environment: ExecutionEnvironment; reason: 'production' | 'local_opt_in' | 'status_read' | 'mocked_providers_harness' }
  | { allowed: false; environment: ExecutionEnvironment; reason: 'preview' | 'test' | 'local_without_opt_in' | 'unknown_environment' }

const filled = (value: string | undefined) => typeof value === 'string' && value.trim().length > 0

// Held on globalThis (not module state) because suites call vi.resetModules(), which would otherwise re-import this
// module with the harness off in the middle of a test file.
const HARNESS_KEY = Symbol.for('content-studio.providerExecution.mockedHarness')
const harnessOn = () => (globalThis as Record<symbol, unknown>)[HARNESS_KEY] === true

/**
 * Test-only seam. The shared vitest setup turns it on so suites that exercise provider flows against fakes keep
 * running; policy tests turn it off. It refuses to do anything outside a vitest process, so it cannot loosen a
 * deployed runtime.
 */
export function __setMockedProvidersHarnessForTests(enabled: boolean): void {
  if (!process.env.VITEST) throw new Error('The mocked-providers harness exists for vitest only.')
  ;(globalThis as Record<symbol, unknown>)[HARNESS_KEY] = enabled
}

export function classifyExecutionEnvironment(env: PolicyEnv = process.env): ExecutionEnvironment {
  if (filled(env.VITEST) || env.NODE_ENV === 'test') return 'test'

  const vercelRuntime = filled(env.VERCEL_URL) || filled(env.VERCEL_DEPLOYMENT_ID) || filled(env.VERCEL_REGION)
  if (vercelRuntime) {
    const target = env.VERCEL_TARGET_ENV
    if (env.VERCEL_ENV === 'production') return !filled(target) || target === 'production' ? 'production' : 'unknown'
    if (env.VERCEL_ENV === 'preview') return 'preview'
    if (env.VERCEL_ENV === 'development') return 'local'
    return 'unknown'
  }
  return env.NODE_ENV === 'development' ? 'local' : 'unknown'
}

export function decideProviderExecution(request: ProviderExecutionRequest, env: PolicyEnv = process.env): ProviderExecutionDecision {
  const environment = classifyExecutionEnvironment(env)
  if (request.purpose === 'status_read') return { allowed: true, environment, reason: 'status_read' }
  switch (environment) {
    case 'production':
      return { allowed: true, environment, reason: 'production' }
    case 'preview':
      return { allowed: false, environment, reason: 'preview' }
    case 'local':
      return env[LOCAL_PAID_OPT_IN_ENV] === LOCAL_PAID_OPT_IN_VALUE
        ? { allowed: true, environment, reason: 'local_opt_in' }
        : { allowed: false, environment, reason: 'local_without_opt_in' }
    case 'test':
      return harnessOn() && env === process.env
        ? { allowed: true, environment, reason: 'mocked_providers_harness' }
        : { allowed: false, environment, reason: 'test' }
    default:
      return { allowed: false, environment, reason: 'unknown_environment' }
  }
}

export class ProviderExecutionDisabledError extends Error {
  readonly code = PROVIDER_EXECUTION_DISABLED_CODE
  readonly status = 403
  readonly environment: ExecutionEnvironment
  readonly provider: string
  readonly operation: string

  constructor(request: ProviderExecutionRequest, environment: ExecutionEnvironment) {
    // Browser-safe: names the environment class only — never a variable, key, URL or project.
    super(`A execução de provedores externos está desativada neste ambiente (${environment}).`)
    this.name = 'ProviderExecutionDisabledError'
    this.environment = environment
    this.provider = request.provider
    this.operation = request.operation
  }
}

export function isProviderExecutionDisabledError(error: unknown): error is ProviderExecutionDisabledError {
  return error instanceof ProviderExecutionDisabledError
}

/** Throws `ProviderExecutionDisabledError` unless this runtime may spend at the provider. Call BEFORE any durable state. */
export function assertProviderExecutionAllowed(request: ProviderExecutionRequest, env: PolicyEnv = process.env): void {
  const decision = decideProviderExecution(request, env)
  if (!decision.allowed) throw new ProviderExecutionDisabledError(request, decision.environment)
}

/** Browser-safe summary for diagnostics (Settings): environment class and whether paid execution is allowed. */
export function describeProviderExecutionPolicy(env: PolicyEnv = process.env) {
  const decision = decideProviderExecution({ provider: 'any', operation: 'any' }, env)
  return { environment: decision.environment, paidExecution: decision.allowed ? ('allowed' as const) : ('blocked' as const) }
}

// FUTURE-050 — HTTP face of the provider execution policy. SERVER ONLY.
import { NextResponse } from 'next/server'
import {
  PROVIDER_EXECUTION_DISABLED_CODE,
  decideProviderExecution,
  isProviderExecutionDisabledError,
  type ProviderExecutionRequest,
} from './execution-policy'

function body(error: { message: string; environment: string; provider: string }) {
  return { error: error.message, code: PROVIDER_EXECUTION_DISABLED_CODE, environment: error.environment, provider: error.provider }
}

/**
 * Early route guard. Returns a controlled 403 when this runtime may not spend at the provider, otherwise `null`.
 * Place it right after authentication and BEFORE any durable execution state (Attempt, queued generation, Review,
 * artifact), so a blocked environment leaves nothing behind.
 */
export function providerExecutionBlockedResponse(request: ProviderExecutionRequest): NextResponse | null {
  const decision = decideProviderExecution(request)
  if (decision.allowed) return null
  return NextResponse.json(
    body({
      message: `A execução de provedores externos está desativada neste ambiente (${decision.environment}).`,
      environment: decision.environment,
      provider: request.provider,
    }),
    { status: 403 },
  )
}

/** Maps a thrown `ProviderExecutionDisabledError` (the fail-closed backstop) to the same controlled 403. */
export function providerExecutionDisabledResponse(error: unknown): NextResponse | null {
  if (!isProviderExecutionDisabledError(error)) return null
  return NextResponse.json(body(error), { status: error.status })
}

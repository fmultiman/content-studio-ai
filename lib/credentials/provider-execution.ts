// AI_PROVIDER_CREDENTIALS_EXECUTION_MODES_V1
//
// Explicit execution boundary for AI provider calls. Three independent
// concepts, deliberately not collapsed:
//
//   ExecutionMode     WHO PAYS
//     user_byok               the user's own provider account (ACTIVE, DEFAULT)
//     content_studio_credits  Content Studio's provider account, charged
//                             against a future Content Studio balance
//                             (boundary prepared, NOT enabled)
//
//   CredentialSource  WHOSE CREDENTIAL is used ('user' | 'platform')
//
//   Transport         HOW Content Studio reaches the provider (REST today;
//                     see provider-metadata.ts). Not modelled here.
//
// The two modes are NOT fallbacks. `user_byok` with no saved user credential
// resolves to PROVIDER_NOT_CONFIGURED — it never becomes a platform
// credential. `content_studio_credits` is a separate path that fails closed
// until a real entitlement system exists.
//
// The mode is decided by SERVER code. No route accepts it from the client,
// and a client-supplied string must never be able to authorize platform
// spend. Billing/entitlement lives above this layer; provider adapters never
// need to know a user's plan.
//
// Nothing here logs, persists, or serializes a secret. `secret` exists only
// on a `ready` result and must be used immediately, server-side.

import type { SupabaseClient } from '@supabase/supabase-js'
import { resolveProviderCredential, type AiProvider } from './provider-credentials'
import { resolvePlatformCredential } from './platform-credentials'

export type ProviderExecutionMode = 'user_byok' | 'content_studio_credits'

export type CredentialSource = 'user' | 'platform'

export const DEFAULT_PROVIDER_EXECUTION_MODE: ProviderExecutionMode = 'user_byok'

export function isProviderExecutionMode(value: unknown): value is ProviderExecutionMode {
  return value === 'user_byok' || value === 'content_studio_credits'
}

export const PROVIDER_NOT_CONFIGURED = 'PROVIDER_NOT_CONFIGURED'
export const CONTENT_STUDIO_CREDITS_NOT_ENABLED = 'CONTENT_STUDIO_CREDITS_NOT_ENABLED'
export const PLATFORM_CREDENTIAL_UNAVAILABLE = 'PLATFORM_CREDENTIAL_UNAVAILABLE'

export type ProviderExecutionResult =
  | {
      status: 'ready'
      provider: AiProvider
      executionMode: ProviderExecutionMode
      credentialSource: CredentialSource
      secret: string
    }
  | {
      status: 'provider_not_configured'
      code: typeof PROVIDER_NOT_CONFIGURED
      provider: AiProvider
      executionMode: 'user_byok'
    }
  | {
      status: 'not_enabled'
      code: typeof CONTENT_STUDIO_CREDITS_NOT_ENABLED
      provider: AiProvider
      executionMode: 'content_studio_credits'
    }
  | {
      status: 'platform_credential_unavailable'
      code: typeof PLATFORM_CREDENTIAL_UNAVAILABLE
      provider: AiProvider
      executionMode: 'content_studio_credits'
    }

export interface ContentStudioCreditsEntitlement {
  allowed: boolean
}

/**
 * Future entitlement seam for `content_studio_credits`. There is no wallet,
 * balance, plan, or ledger yet, so this denies everyone. A future billing
 * system replaces this — it must never be widened to "allow" as a shortcut.
 */
export async function checkContentStudioCreditsEntitlement(_params: {
  userId: string
  provider: AiProvider
}): Promise<ContentStudioCreditsEntitlement> {
  return { allowed: false }
}

export interface ProviderExecutionDependencies {
  checkEntitlement?: typeof checkContentStudioCreditsEntitlement
}

export async function resolveProviderExecution(
  supabase: SupabaseClient,
  params: { userId: string; provider: AiProvider; mode?: ProviderExecutionMode },
  dependencies: ProviderExecutionDependencies = {},
): Promise<ProviderExecutionResult> {
  const { userId, provider } = params
  const mode = params.mode ?? DEFAULT_PROVIDER_EXECUTION_MODE

  if (mode === 'user_byok') {
    const credential = await resolveProviderCredential(supabase, { userId, provider })
    if (credential.status === 'configured') {
      return {
        status: 'ready',
        provider,
        executionMode: 'user_byok',
        credentialSource: 'user',
        secret: credential.secret,
      }
    }
    return {
      status: 'provider_not_configured',
      code: PROVIDER_NOT_CONFIGURED,
      provider,
      executionMode: 'user_byok',
    }
  }

  const checkEntitlement = dependencies.checkEntitlement ?? checkContentStudioCreditsEntitlement
  const entitlement = await checkEntitlement({ userId, provider })
  if (!entitlement.allowed) {
    // Fail closed: the platform credential is not even read.
    return {
      status: 'not_enabled',
      code: CONTENT_STUDIO_CREDITS_NOT_ENABLED,
      provider,
      executionMode: 'content_studio_credits',
    }
  }

  const platformCredential = resolvePlatformCredential(provider)
  if (platformCredential.status === 'available') {
    return {
      status: 'ready',
      provider,
      executionMode: 'content_studio_credits',
      credentialSource: 'platform',
      secret: platformCredential.secret,
    }
  }
  return {
    status: 'platform_credential_unavailable',
    code: PLATFORM_CREDENTIAL_UNAVAILABLE,
    provider,
    executionMode: 'content_studio_credits',
  }
}

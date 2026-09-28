// AI_PROVIDER_CREDENTIALS_EXECUTION_MODES_V1
//
// PLATFORM credential boundary. This is the ONLY module in the codebase that
// may read a platform-owned provider credential from the environment
// (OPENAI_API_KEY, KLING_API_KEY, ...). A source-scan test enforces that.
//
// Platform credentials belong exclusively to the future, explicit
// `content_studio_credits` execution mode. Their mere presence in the
// environment does NOT authorize any user-funded execution, and they are
// NEVER a fallback for a missing user (BYOK) credential.
//
// Nothing outside `provider-execution.ts` imports this module, and
// `provider-execution.ts` only calls it AFTER an entitlement check allows
// platform-funded execution — a check that currently denies everyone.
//
// Server-only: never import this from client code, never return the value.

import type { AiProvider } from './provider-credentials'

const PLATFORM_CREDENTIAL_ENV: Partial<Record<AiProvider, string>> = {
  openai: 'OPENAI_API_KEY',
  kling: 'KLING_API_KEY',
}

export type PlatformCredentialResult =
  | { status: 'available'; secret: string }
  | { status: 'unavailable' }

export function resolvePlatformCredential(provider: AiProvider): PlatformCredentialResult {
  const envName = PLATFORM_CREDENTIAL_ENV[provider]
  const value = envName ? process.env[envName] : undefined

  if (typeof value === 'string' && value.trim().length > 0) {
    return { status: 'available', secret: value }
  }
  return { status: 'unavailable' }
}

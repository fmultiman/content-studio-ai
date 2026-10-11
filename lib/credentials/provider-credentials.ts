// AI_PROVIDER_CREDENTIALS_BYOK_V1
//
// Single shared credential-resolution contract for AI provider execution
// (OpenAI, NanoBanana, Kling, Replicate). Every server route that needs a
// user-owned provider credential goes through this module instead of
// querying `user_settings` directly for a secret column.
//
// Ownership model: USER-OWNED. There is no workspace/project sharing in
// this V1 — a credential belongs to exactly one authenticated user, and
// resolution is always scoped to `userId`. FUTURE_059 Slice 1: the
// secret column is read only by `api-credential-store.ts` (server-side
// privileged client). Ownership is proven first through the caller's own
// client (the `user_settings` own-row RLS policy) and the read is an explicit
// `.eq('user_id', userId)` single-column query.
//
// This module is the USER credential source only. It never consults an
// environment/platform credential — platform-funded execution lives behind
// the separate, gated `content_studio_credits` boundary in
// `provider-execution.ts` / `platform-credentials.ts`.
//
// This module never logs, returns, or otherwise surfaces the secret value
// itself — only `resolveProviderCredential` returns the plaintext secret,
// and it must be called server-side only (normally via
// `resolveProviderExecution`), immediately before the outbound provider call.

import type { SupabaseClient } from '@supabase/supabase-js'
import {
  isProviderCredentialUnavailableError,
  readStoredApiCredential,
  readStoredApiCredentialStatuses,
} from './api-credential-store'

export type AiProvider = 'openai' | 'nano_banana' | 'kling' | 'replicate' | 'gemini'

export const AI_PROVIDERS: readonly AiProvider[] = ['openai', 'nano_banana', 'kling', 'replicate', 'gemini']

export function isAiProvider(value: string): value is AiProvider {
  return (AI_PROVIDERS as readonly string[]).includes(value)
}

export type ProviderCredentialResult =
  | { status: 'configured'; secret: string }
  | { status: 'missing' }

/**
 * Resolves the authenticated user's own provider credential. Never falls
 * back to a platform/env-level secret — a missing user credential is
 * reported as `{ status: 'missing' }`, not silently substituted.
 *
 * FUTURE_059 Slice 1: the secret is read by `api-credential-store.ts` with a
 * server-side privileged client after an ownership proof through `supabase`
 * (the caller's client). A store/database failure THROWS
 * `ProviderCredentialUnavailableError`; it is never reported as `missing`.
 */
export async function resolveProviderCredential(
  supabase: SupabaseClient,
  params: { userId: string; provider: AiProvider },
): Promise<ProviderCredentialResult> {
  return readStoredApiCredential(supabase, params)
}

export type ProviderConfigurationStatusMap = Record<AiProvider, 'configured' | 'missing' | 'unavailable'>

/**
 * Status-only view for Settings/UI consumption — never includes the
 * secret value itself, only whether each provider is configured. A store
 * failure is `unavailable`, not `missing`.
 */
export async function getProviderConfigurationStatuses(
  supabase: SupabaseClient,
  userId: string,
): Promise<ProviderConfigurationStatusMap> {
  return readStoredApiCredentialStatuses(supabase, userId)
}

export type ProviderConfigurationState = 'configured' | 'missing' | 'unavailable'

/**
 * Status of ONE provider credential that tells "the store could not be read"
 * apart from "no credential": a database error is `unavailable`, never
 * `missing`. Never returns the secret and never throws for an unreadable store.
 */
export async function getProviderConfigurationState(
  supabase: SupabaseClient,
  params: { userId: string; provider: AiProvider },
): Promise<ProviderConfigurationState> {
  try {
    const result = await readStoredApiCredential(supabase, params)
    return result.status
  } catch (error) {
    if (isProviderCredentialUnavailableError(error)) return 'unavailable'
    throw error
  }
}

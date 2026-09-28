// AI_PROVIDER_CREDENTIALS_BYOK_V1
//
// Single shared credential-resolution contract for AI provider execution
// (OpenAI, NanoBanana, Kling, Replicate). Every server route that needs a
// user-owned provider credential goes through this module instead of
// querying `user_settings` directly for a secret column.
//
// Ownership model: USER-OWNED. There is no workspace/project sharing in
// this V1 — a credential belongs to exactly one authenticated user, and
// resolution is always scoped to `userId` (enforced twice: the Postgres
// RLS policy on `user_settings`, and the explicit `.eq('user_id', userId)`
// filter below).
//
// This module never logs, returns, or otherwise surfaces the secret value
// itself — only `resolveProviderCredential` returns the plaintext secret,
// and it must be called server-side only, immediately before the outbound
// provider call.

import type { SupabaseClient } from '@supabase/supabase-js'

export type AiProvider = 'openai' | 'nano_banana' | 'kling' | 'replicate'

export const AI_PROVIDERS: readonly AiProvider[] = ['openai', 'nano_banana', 'kling', 'replicate']

export function isAiProvider(value: string): value is AiProvider {
  return (AI_PROVIDERS as readonly string[]).includes(value)
}

const PROVIDER_SECRET_COLUMN: Record<AiProvider, string> = {
  openai: 'openai_api_key',
  nano_banana: 'nanobanana_api_key',
  kling: 'kling_api_key',
  replicate: 'replicate_api_key',
}

export type ProviderCredentialResult =
  | { status: 'configured'; secret: string }
  | { status: 'missing' }

/**
 * Resolves the authenticated user's own provider credential. Never falls
 * back to a platform/env-level secret — a missing user credential is
 * reported as `{ status: 'missing' }`, not silently substituted.
 */
export async function resolveProviderCredential(
  supabase: SupabaseClient,
  params: { userId: string; provider: AiProvider },
): Promise<ProviderCredentialResult> {
  const column = PROVIDER_SECRET_COLUMN[params.provider]
  const { data } = await supabase
    .from('user_settings')
    .select(column)
    .eq('user_id', params.userId)
    .maybeSingle()

  const secret = (data as Record<string, unknown> | null)?.[column]
  if (typeof secret === 'string' && secret.trim().length > 0) {
    return { status: 'configured', secret }
  }
  return { status: 'missing' }
}

export type ProviderConfigurationStatusMap = Record<AiProvider, 'configured' | 'missing'>

/**
 * Status-only view for Settings/UI consumption — never includes the
 * secret value itself, only whether each provider is configured.
 */
export async function getProviderConfigurationStatuses(
  supabase: SupabaseClient,
  userId: string,
): Promise<ProviderConfigurationStatusMap> {
  const { data } = await supabase
    .from('user_settings')
    .select('openai_api_key, nanobanana_api_key, kling_api_key, replicate_api_key')
    .eq('user_id', userId)
    .maybeSingle()

  const row = data as Record<string, unknown> | null
  const isConfigured = (value: unknown) => typeof value === 'string' && value.trim().length > 0

  return {
    openai: isConfigured(row?.openai_api_key) ? 'configured' : 'missing',
    nano_banana: isConfigured(row?.nanobanana_api_key) ? 'configured' : 'missing',
    kling: isConfigured(row?.kling_api_key) ? 'configured' : 'missing',
    replicate: isConfigured(row?.replicate_api_key) ? 'configured' : 'missing',
  }
}

export function providerSecretColumn(provider: AiProvider): string {
  return PROVIDER_SECRET_COLUMN[provider]
}

/**
 * OpenAI-only, explicitly-named legacy exception.
 *
 * Every existing OpenAI-consuming route already fell back to
 * `process.env.OPENAI_API_KEY` in every environment (including
 * Production) whenever the user had no personal key saved. As of this
 * audit `user_settings` has zero rows in Production — every current
 * OpenAI call in the live app depends on this fallback today. Removing
 * it here would break "Do not break image generation" for all current
 * users with no mitigation, so it is preserved, but centralized in this
 * single function instead of being duplicated ad hoc across seven
 * routes.
 *
 * This is a deliberate, temporary exception to the BYOK-strict contract
 * (see docs/architecture/AI_PROVIDER_CREDENTIALS_ARCHITECTURE_V1.md and
 * FUTURE-027). Kling has no such legacy dependency and does NOT get an
 * equivalent — `resolveProviderCredential(..., { provider: 'kling' })`
 * never falls back to `process.env.KLING_API_KEY` for user-triggered
 * Production generation.
 */
export async function resolveOpenAiCredentialWithLegacyPlatformFallback(
  supabase: SupabaseClient,
  userId: string,
): Promise<ProviderCredentialResult> {
  const userCredential = await resolveProviderCredential(supabase, { userId, provider: 'openai' })
  if (userCredential.status === 'configured') {
    return userCredential
  }

  const platformKey = process.env.OPENAI_API_KEY
  if (platformKey && platformKey.trim().length > 0) {
    return { status: 'configured', secret: platformKey }
  }

  return { status: 'missing' }
}

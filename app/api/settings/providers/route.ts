import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { AI_PROVIDERS, getProviderConfigurationStatuses } from '@/lib/credentials/provider-credentials'
import { primaryConnectionMethod } from '@/lib/credentials/provider-metadata'
import { describeProviderExecutionPolicy } from '@/lib/providers/execution-policy'
import { describeCredentialStorage } from '@/lib/credentials/credential-storage-mode'
import { describeAdminCredential } from '@/lib/supabase/admin-credential'
import { describePublicCredential } from '@/lib/supabase/public-credential'
import { describeGeminiImageAvailability } from '@/lib/providers/gemini/image-feature'

// AI_PROVIDER_CREDENTIALS_BYOK_V1
// Returns configuration status only — never a secret value — for every
// AI provider credential this user may have configured.
export async function GET() {
  try {
    const supabase = await createClient()
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser()

    if (authError || !user) {
      return NextResponse.json({ error: 'Nao autorizado' }, { status: 401 })
    }

    const statuses = await getProviderConfigurationStatuses(supabase, user.id)

    const { data: settings } = await supabase
      .from('user_settings')
      .select('nanobanana_base_url, automation_enabled')
      .eq('user_id', user.id)
      .maybeSingle()

    return NextResponse.json({
      providers: Object.fromEntries(
        AI_PROVIDERS.map((provider) => [
          provider,
          { status: statuses[provider], connectionMethod: primaryConnectionMethod(provider) },
        ]),
      ),
      automationEnabled: settings?.automation_enabled === true,
      nanobananaBaseUrl: settings?.nanobanana_base_url ?? null,
      // FUTURE-050: browser-safe diagnostic (class + allowed/blocked only) so a smoke can prove the guard without a paid call.
      executionPolicy: describeProviderExecutionPolicy(),
      // FUTURE-064 Slice B: whether official Gemini image generation can run in THIS deployment (release switch + execution
      // policy), as a class only ({ available, reason }) — never the variable name or value. Independent of the credential
      // status above: a configured key does not mean the capability is on, and an off capability is not a missing key.
      imageGeneration: { gemini: describeGeminiImageAvailability() },
      // FUTURE-052: which admin-credential variable/shape this runtime uses (names and shape class only, never a value),
      // so a credential replacement can be verified without reading any secret.
      adminCredential: describeAdminCredential(),
      // FUTURE-052B: same idea for the browser/SSR/middleware key — which NEXT_PUBLIC_* variable and shape class this build
      // selected (names only, never a value; the publishable key is not a secret but is still not echoed).
      publicCredential: describePublicCredential(),
      // FUTURE_059 Slice 3A: which credential store mode this runtime uses and whether the separate BYOK master key is usable
      // (state classes only — never a key, id or value), so an activation can be verified without reading any secret.
      credentialStorage: describeCredentialStorage(),
    })
  } catch (error) {
    console.error('[Settings Providers] Error:', error)
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 })
  }
}

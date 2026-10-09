import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { AI_PROVIDERS, getProviderConfigurationStatuses } from '@/lib/credentials/provider-credentials'
import { primaryConnectionMethod } from '@/lib/credentials/provider-metadata'
import { describeProviderExecutionPolicy } from '@/lib/providers/execution-policy'
import { describeAdminCredential } from '@/lib/supabase/admin-credential'
import { describePublicCredential } from '@/lib/supabase/public-credential'

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
      .select('nanobanana_base_url')
      .eq('user_id', user.id)
      .maybeSingle()

    return NextResponse.json({
      providers: Object.fromEntries(
        AI_PROVIDERS.map((provider) => [
          provider,
          { status: statuses[provider], connectionMethod: primaryConnectionMethod(provider) },
        ]),
      ),
      nanobananaBaseUrl: settings?.nanobanana_base_url ?? null,
      // FUTURE-050: browser-safe diagnostic (class + allowed/blocked only) so a smoke can prove the guard without a paid call.
      executionPolicy: describeProviderExecutionPolicy(),
      // FUTURE-052: which admin-credential variable/shape this runtime uses (names and shape class only, never a value),
      // so a credential replacement can be verified without reading any secret.
      adminCredential: describeAdminCredential(),
      // FUTURE-052B: same idea for the browser/SSR/middleware key — which NEXT_PUBLIC_* variable and shape class this build
      // selected (names only, never a value; the publishable key is not a secret but is still not echoed).
      publicCredential: describePublicCredential(),
    })
  } catch (error) {
    console.error('[Settings Providers] Error:', error)
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 })
  }
}

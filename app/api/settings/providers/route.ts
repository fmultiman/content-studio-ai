import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getProviderConfigurationStatuses } from '@/lib/credentials/provider-credentials'

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
      providers: {
        openai: { status: statuses.openai },
        nano_banana: { status: statuses.nano_banana },
        kling: { status: statuses.kling },
        replicate: { status: statuses.replicate },
      },
      nanobananaBaseUrl: settings?.nanobanana_base_url ?? null,
    })
  } catch (error) {
    console.error('[Settings Providers] Error:', error)
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 })
  }
}

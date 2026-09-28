import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { isAiProvider, providerSecretColumn } from '@/lib/credentials/provider-credentials'

// AI_PROVIDER_CREDENTIALS_BYOK_V1
//
// Save/replace and remove a single user-owned AI provider credential.
// Hard contract for this route: the full secret is NEVER returned in the
// response body, in either PUT or DELETE — only `{ provider, status }`.

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ provider: string }> },
) {
  try {
    const { provider } = await params
    if (!isAiProvider(provider)) {
      return NextResponse.json({ error: 'Provider invalido' }, { status: 400 })
    }

    const supabase = await createClient()
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser()

    if (authError || !user) {
      return NextResponse.json({ error: 'Nao autorizado' }, { status: 401 })
    }

    const body = await request.json().catch(() => ({}))
    const apiKey = typeof body?.apiKey === 'string' ? body.apiKey.trim() : ''
    const baseUrl = typeof body?.baseUrl === 'string' ? body.baseUrl.trim() : undefined

    if (!apiKey) {
      return NextResponse.json({ error: 'API key obrigatoria' }, { status: 400 })
    }

    const column = providerSecretColumn(provider)
    const updatePayload: Record<string, unknown> = { user_id: user.id, [column]: apiKey }
    if (provider === 'nano_banana' && baseUrl) {
      updatePayload.nanobanana_base_url = baseUrl
    }

    const { error: upsertError } = await supabase
      .from('user_settings')
      .upsert(updatePayload, { onConflict: 'user_id' })

    if (upsertError) {
      console.error('[Settings Providers] Save error:', upsertError.message)
      return NextResponse.json({ error: 'Nao foi possivel salvar a credencial' }, { status: 500 })
    }

    return NextResponse.json({ provider, status: 'configured' })
  } catch (error) {
    console.error('[Settings Providers] Save error:', error)
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 })
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ provider: string }> },
) {
  try {
    const { provider } = await params
    if (!isAiProvider(provider)) {
      return NextResponse.json({ error: 'Provider invalido' }, { status: 400 })
    }

    const supabase = await createClient()
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser()

    if (authError || !user) {
      return NextResponse.json({ error: 'Nao autorizado' }, { status: 401 })
    }

    const column = providerSecretColumn(provider)
    const { error: updateError } = await supabase
      .from('user_settings')
      .update({ [column]: null })
      .eq('user_id', user.id)

    if (updateError) {
      console.error('[Settings Providers] Remove error:', updateError.message)
      return NextResponse.json({ error: 'Nao foi possivel remover a credencial' }, { status: 500 })
    }

    return NextResponse.json({ provider, status: 'missing' })
  } catch (error) {
    console.error('[Settings Providers] Remove error:', error)
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 })
  }
}

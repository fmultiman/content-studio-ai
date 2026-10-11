import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { isAiProvider } from '@/lib/credentials/provider-credentials'
import { removeStoredApiCredential, writeStoredApiCredential } from '@/lib/credentials/api-credential-store'

// AI_PROVIDER_CREDENTIALS_BYOK_V1
//
// Save/replace and remove a single user-owned AI provider credential.
// Hard contract for this route: the full secret is NEVER returned in the
// response body, in either PUT or DELETE — only `{ provider, status }`.
//
// FUTURE_059 Slice 1: the owner is the server-verified session user
// (`supabase.auth.getUser()`); the secret column is written by
// `api-credential-store.ts` with a server-side privileged client, not by the
// browser-session client. The request never names the owner.

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

    try {
      await writeStoredApiCredential(supabase, {
        userId: user.id,
        provider,
        secret: apiKey,
        nanobananaBaseUrl: provider === 'nano_banana' ? baseUrl : undefined,
      })
    } catch {
      // The store logs a code-only line; nothing from the error (or the key) reaches the log or the response.
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

    try {
      await removeStoredApiCredential(supabase, { userId: user.id, provider })
    } catch {
      return NextResponse.json({ error: 'Nao foi possivel remover a credencial' }, { status: 500 })
    }

    return NextResponse.json({ provider, status: 'missing' })
  } catch (error) {
    console.error('[Settings Providers] Remove error:', error)
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 })
  }
}

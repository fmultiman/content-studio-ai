import { NextResponse } from 'next/server'
import { providerExecutionBlockedResponse } from '@/lib/providers/execution-policy-http'
import { createClient } from '@/lib/supabase/server'
import { resolveProviderExecution } from '@/lib/credentials/provider-execution'

const OPENAI_CHAT_URL = 'https://api.openai.com/v1/chat/completions'
const TRANSLATION_MODEL = 'gpt-4o-mini'

export async function POST(request: Request) {
  try {
    const supabase = await createClient()
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser()

    if (authError || !user) {
      return NextResponse.json({ error: 'Nao autorizado' }, { status: 401 })
    }

    // FUTURE-050: paid provider execution is denied outside Production (and unopted local) — before any input is processed or credential read.
    const blocked = providerExecutionBlockedResponse({ provider: 'openai', operation: 'text_generation' })
    if (blocked) return blocked

    const { prompt } = await request.json()

    if (!prompt?.trim()) {
      return NextResponse.json(
        { error: 'Prompt obrigatorio', code: 'PROMPT_REQUIRED' },
        { status: 400 },
      )
    }

    const execution = await resolveProviderExecution(supabase, { userId: user.id, provider: 'openai' })

    if (execution.status !== 'ready') {
      return NextResponse.json(
        {
          error: 'Tradução indisponível sem provedor configurado.',
          code: 'PROMPT_PROVIDER_NOT_CONFIGURED',
          providerCode: execution.code,
          provider: 'openai',
        },
        { status: 400 },
      )
    }
    const apiKey = execution.secret

    const response = await fetch(OPENAI_CHAT_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: TRANSLATION_MODEL,
        messages: [
          {
            role: 'system',
            content:
              'Traduza prompts visuais de IA para portugues brasileiro claro. Preserve termos tecnicos de fotografia/cinema quando forem importantes, mas explique naturalmente. Responda apenas com a versao em portugues, sem markdown.',
          },
          {
            role: 'user',
            content: prompt.trim(),
          },
        ],
        temperature: 0.2,
        max_tokens: 700,
      }),
    })

    const data = await response.json()

    if (!response.ok) {
      console.error('[Translate Prompt] OpenAI API error:', response.status)
      return NextResponse.json(
        {
          error: data.error?.message || `Erro na OpenAI: ${response.status}`,
          code: 'PROMPT_PROVIDER_FAILED',
          details: data,
        },
        { status: response.status },
      )
    }

    const translatedPrompt = data.choices?.[0]?.message?.content?.trim()

    if (!translatedPrompt) {
      return NextResponse.json(
        {
          error: 'A OpenAI nao retornou uma traducao',
          code: 'PROMPT_PROVIDER_INVALID_RESPONSE',
        },
        { status: 502 },
      )
    }

    return NextResponse.json({
      translatedPrompt,
      model: TRANSLATION_MODEL,
    })
  } catch (error) {
    console.error('[Translate Prompt] Error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Erro interno' },
      { status: 500 },
    )
  }
}

import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

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

    const { prompt } = await request.json()

    if (!prompt?.trim()) {
      return NextResponse.json(
        { error: 'Prompt obrigatorio' },
        { status: 400 },
      )
    }

    const { data: settings } = await supabase
      .from('user_settings')
      .select('openai_api_key')
      .eq('user_id', user.id)
      .single()

    const apiKey = settings?.openai_api_key || process.env.OPENAI_API_KEY

    if (!apiKey) {
      return NextResponse.json(
        { error: 'API Key da OpenAI nao configurada' },
        { status: 400 },
      )
    }

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
      return NextResponse.json(
        {
          error: data.error?.message || `Erro na OpenAI: ${response.status}`,
          details: data,
        },
        { status: response.status },
      )
    }

    const translatedPrompt = data.choices?.[0]?.message?.content?.trim()

    if (!translatedPrompt) {
      return NextResponse.json(
        { error: 'A OpenAI nao retornou uma traducao' },
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

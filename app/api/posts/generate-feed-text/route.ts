import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { resolveOpenAiCredentialWithLegacyPlatformFallback } from '@/lib/credentials/provider-credentials'

const OPENAI_CHAT_URL = 'https://api.openai.com/v1/chat/completions'
const DEFAULT_MODEL = 'gpt-4o-mini'

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

    const { name, channel, description, aiContext, projectId } = await request.json()

    if (!description?.trim()) {
      return NextResponse.json({ error: 'Descricao obrigatoria' }, { status: 400 })
    }

    const credential = await resolveOpenAiCredentialWithLegacyPlatformFallback(supabase, user.id)
    const apiKey = credential.status === 'configured' ? credential.secret : null

    if (!apiKey) {
      return NextResponse.json(
        { error: 'API Key da OpenAI nao configurada' },
        { status: 400 },
      )
    }

    let projectContext = ''

    if (projectId) {
      const { data: project } = await supabase
        .from('projects')
        .select('name, description, context')
        .eq('id', projectId)
        .eq('user_id', user.id)
        .single()

      if (project) {
        projectContext = [
          `Projeto: ${project.name}`,
          project.description ? `Descricao do projeto: ${project.description}` : '',
          project.context ? `Contexto para IA do projeto: ${project.context}` : '',
        ].filter(Boolean).join('\n')
      }
    }

    const publicationContext = {
      instagram_post: {
        label: 'Instagram Post',
        instruction: 'Formato: legenda de Instagram com abertura forte, corpo escaneavel, CTA e 5 a 10 hashtags.',
      },
      instagram_story: {
        label: 'Instagram Story',
        instruction: 'Formato: roteiro curto para story vertical, com texto principal, CTA e sugestao visual. Seja direto.',
      },
      youtube_post: {
        label: 'YouTube Post',
        instruction: 'Formato: texto para aba Comunidade do YouTube, com gancho, corpo curto, CTA e hashtags opcionais.',
      },
      youtube_shorts: {
        label: 'YouTube Shorts',
        instruction: 'Formato: titulo curto, descricao curta para Shorts, CTA e 5 a 8 hashtags.',
      },
      youtube_video: {
        label: 'YouTube Video',
        instruction: 'Formato: titulo, descricao completa para YouTube, CTA, hashtags/tags e sugestao de capa.',
      },
    }[channel as string] || {
      label: 'Instagram Post',
      instruction: 'Formato: legenda de Instagram com abertura forte, corpo escaneavel, CTA e 5 a 10 hashtags.',
    }

    const response = await fetch(OPENAI_CHAT_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: DEFAULT_MODEL,
        temperature: 0.7,
        messages: [
          {
            role: 'system',
            content:
              'Voce e um estrategista de conteudo social. Escreva em portugues do Brasil, com clareza, voz natural e formato pronto para publicar.',
          },
          {
            role: 'user',
            content: [
              `Crie a publicacao para ${publicationContext.label}.`,
              name ? `Nome do post: ${name}` : '',
              projectContext,
              aiContext ? `Contexto especifico do post: ${aiContext}` : '',
              `Descricao do que o post precisa comunicar: ${description}`,
              publicationContext.instruction,
            ].filter(Boolean).join('\n\n'),
          },
        ],
      }),
    })

    const responseText = await response.text()
    let data: {
      choices?: Array<{ message?: { content?: string } }>
      error?: { message?: string }
    }

    try {
      data = JSON.parse(responseText)
    } catch {
      return NextResponse.json(
        { error: 'Resposta invalida da OpenAI', details: responseText },
        { status: 502 },
      )
    }

    if (!response.ok) {
      return NextResponse.json(
        { error: data.error?.message || `Erro na OpenAI: ${response.status}`, details: data },
        { status: response.status },
      )
    }

    const feedText = data.choices?.[0]?.message?.content?.trim()

    if (!feedText) {
      return NextResponse.json({ error: 'A OpenAI nao retornou texto', details: data }, { status: 502 })
    }

    return NextResponse.json({ feedText, model: DEFAULT_MODEL })
  } catch (error) {
    console.error('[Generate Feed Text] Error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Erro interno' },
      { status: 500 },
    )
  }
}

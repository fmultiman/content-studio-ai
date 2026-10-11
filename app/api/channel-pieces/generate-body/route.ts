import { NextResponse } from 'next/server'
import { providerExecutionBlockedResponse } from '@/lib/providers/execution-policy-http'
import { createClient } from '@/lib/supabase/server'
import { isValidChannel, isValidFormat, isValidChannelFormat } from '@/lib/publication-channels'
import { resolveProviderExecution } from '@/lib/credentials/provider-execution'
import { providerCredentialUnavailableResponse } from '@/lib/credentials/provider-credential-http'

const OPENAI_CHAT_URL = 'https://api.openai.com/v1/chat/completions'
const DEFAULT_MODEL = 'gpt-4o-mini'
const MAX_EC_BODY_CHARS = 8000
const MAX_AI_CONTEXT_CHARS = 2000

const ALLOWED_POST_KEYS = new Set([
  'editorialContentId', 'channel', 'format', 'currentBody', 'instructions',
])

const CHANNEL_FORMAT_CONTEXT: Record<string, { label: string; instruction: string }> = {
  'instagram:feed': {
    label: 'Instagram Feed',
    instruction: 'Escreva uma legenda de Instagram. Abertura forte (gancho), corpo escaneável com saltos de linha, CTA direto no final. Inclua de 5 a 10 hashtags relevantes.',
  },
  'instagram:story': {
    label: 'Instagram Story',
    instruction: 'Escreva roteiro para Story vertical. Seja conciso e impactante. Texto principal em 1-3 telas, com CTA claro. Sugira elementos visuais se necessário.',
  },
  'instagram:reel': {
    label: 'Instagram Reel',
    instruction: 'Escreva roteiro para Reel. Gancho nos primeiros 3 segundos, narração fluida, CTA no final. 15 a 60 segundos. Inclua indicação de texto em tela.',
  },
  'instagram:carousel': {
    label: 'Instagram Carrossel',
    instruction: 'Escreva roteiro para Carrossel. Slide 1: capa com promessa impactante. Slides 2-7: desenvolvimento (1 ideia por slide). Slide final: CTA + hashtags.',
  },
  'youtube:video_description': {
    label: 'Descrição de Vídeo YouTube',
    instruction: 'Escreva a descrição do vídeo para YouTube. Parágrafo inicial resumindo o vídeo (aparece antes de "ver mais"), índice de capítulos se aplicável, links e hashtags ao final.',
  },
  'youtube:short': {
    label: 'YouTube Short',
    instruction: 'Escreva título e descrição para YouTube Short. Título: palavra-chave + gancho (máx 60 caracteres). Descrição: curta, com CTA e 3-5 hashtags.',
  },
  'youtube:post': {
    label: 'YouTube Post (Comunidade)',
    instruction: 'Escreva post para aba Comunidade do YouTube. Texto envolvente (1-3 parágrafos), gancho inicial, CTA para engajamento. Hashtags opcionais.',
  },
  'whatsapp:story': {
    label: 'WhatsApp Status',
    instruction: 'Escreva status de WhatsApp. Ultrabreve e impactante (máx 139 caracteres). Use emoji com parcimônia.',
  },
  'whatsapp:channel_message': {
    label: 'Mensagem de Canal WhatsApp',
    instruction: 'Escreva mensagem para Canal do WhatsApp. Tom conversacional, formatação com *negrito* e listas. CTA claro. Máx 2-3 parágrafos.',
  },
  'linkedin:feed': {
    label: 'LinkedIn Feed',
    instruction: 'Escreva post de feed LinkedIn. Primeira linha como gancho (aparece antes de "ver mais"). 3-5 parágrafos com insights profissionais. CTA. Máx 3 hashtags.',
  },
  'linkedin:post': {
    label: 'LinkedIn Post',
    instruction: 'Escreva post autoral para LinkedIn. Tom profissional e pessoal. 150-300 palavras. Insights de valor, conclusão com reflexão. Até 3 hashtags.',
  },
  'linkedin:carousel': {
    label: 'LinkedIn Carrossel',
    instruction: 'Escreva roteiro para Carrossel LinkedIn. Slide de capa com promessa clara, 5-10 slides (1 insight cada), slide final com CTA e convite para seguir.',
  },
  'linkedin:article': {
    label: 'Artigo LinkedIn',
    instruction: 'Escreva artigo completo para LinkedIn. Título SEO-friendly, introdução com contexto, desenvolvimento em seções com subtítulos, conclusão com aprendizados. 600-1500 palavras.',
  },
  'x:post': {
    label: 'X (Twitter)',
    instruction: 'Escreva tweet/post para X. Máximo 280 caracteres, mensagem direta e incisiva. Se fio (thread), indique com 1/N. Até 2 hashtags.',
  },
  'tiktok:reel': {
    label: 'TikTok',
    instruction: 'Escreva roteiro para TikTok. Gancho nos 3 primeiros segundos, desenvolvimento ágil, CTA no final. 15-60 segundos. 3-5 hashtags de nicho.',
  },
}

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

    let body: Record<string, unknown>
    try {
      body = await request.json()
    } catch {
      return NextResponse.json({ error: 'Body invalido: JSON esperado' }, { status: 400 })
    }

    if (Array.isArray(body) || typeof body !== 'object' || body === null) {
      return NextResponse.json({ error: 'Body invalido: objeto esperado' }, { status: 400 })
    }

    const unknownKeys = Object.keys(body).filter((k) => !ALLOWED_POST_KEYS.has(k))
    if (unknownKeys.length > 0) {
      return NextResponse.json(
        { error: `Campos nao permitidos: ${unknownKeys.join(', ')}` },
        { status: 400 },
      )
    }

    const { editorialContentId, channel, format, instructions } = body as Record<string, string | undefined>

    if (!editorialContentId) {
      return NextResponse.json({ error: 'editorialContentId obrigatorio' }, { status: 400 })
    }
    if (!channel || !isValidChannel(channel)) {
      return NextResponse.json({ error: 'channel invalido ou obrigatorio' }, { status: 400 })
    }
    if (!format || !isValidFormat(format)) {
      return NextResponse.json({ error: 'format invalido ou obrigatorio' }, { status: 400 })
    }
    if (!isValidChannelFormat(channel, format)) {
      return NextResponse.json(
        { error: `Combinacao channel+format invalida: ${channel}+${format}` },
        { status: 400 },
      )
    }

    // Validate EC ownership (defense in depth beyond RLS)
    const { data: ec, error: ecError } = await supabase
      .from('editorial_contents')
      .select('title, body, ai_context, project_id, production_id')
      .eq('id', editorialContentId)
      .eq('user_id', user.id)
      .single()

    if (ecError || !ec) {
      return NextResponse.json(
        { error: 'EditorialContent nao encontrado ou nao autorizado' },
        { status: 400 },
      )
    }

    // Load project context
    const { data: project } = await supabase
      .from('projects')
      .select('name, description, context')
      .eq('id', ec.project_id)
      .eq('user_id', user.id)
      .single()

    // Load production context if linked
    let productionContext = ''
    if (ec.production_id) {
      const { data: production } = await supabase
        .from('productions')
        .select('title, intention, type')
        .eq('id', ec.production_id)
        .eq('user_id', user.id)
        .single()
      if (production) {
        productionContext = [
          `Produção: ${production.title}`,
          production.intention ? `Intenção da produção: ${production.intention}` : '',
        ]
          .filter(Boolean)
          .join('\n')
      }
    }

    // Get OpenAI API key
    const execution = await resolveProviderExecution(supabase, { userId: user.id, provider: 'openai' })
    if (execution.status !== 'ready') {
      return NextResponse.json(
        { error: 'API Key da OpenAI nao configurada', code: execution.code, provider: 'openai' },
        { status: 400 },
      )
    }
    const apiKey = execution.secret

    const ctx = CHANNEL_FORMAT_CONTEXT[`${channel}:${format}`] || {
      label: `${channel} / ${format}`,
      instruction: 'Adapte o conteúdo editorial para este canal e formato.',
    }

    const projectParts = project
      ? [
          `Projeto: ${project.name}`,
          project.description ? `Descrição do projeto: ${project.description}` : '',
          project.context ? `Contexto de IA do projeto: ${project.context}` : '',
        ]
          .filter(Boolean)
          .join('\n')
      : ''

    const ecBodyTruncated = ec.body ? (ec.body as string).slice(0, MAX_EC_BODY_CHARS) : ''
    const ecAiContextTruncated = ec.ai_context
      ? (ec.ai_context as string).slice(0, MAX_AI_CONTEXT_CHARS)
      : ''

    const userMessage = [
      `Adapte o conteúdo editorial abaixo para ${ctx.label}.`,
      ec.title ? `Título do conteúdo editorial: ${ec.title}` : '',
      projectParts,
      productionContext,
      ecAiContextTruncated ? `Contexto de IA: ${ecAiContextTruncated}` : '',
      ecBodyTruncated ? `Conteúdo editorial base:\n${ecBodyTruncated}` : '',
      instructions ? `Instruções adicionais: ${instructions}` : '',
      '',
      ctx.instruction,
    ]
      .filter((line) => line !== undefined && line !== null)
      .join('\n\n')
      .trim()

    const openAiResponse = await fetch(OPENAI_CHAT_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: DEFAULT_MODEL,
        temperature: 0.7,
        max_tokens: 2000,
        messages: [
          {
            role: 'system',
            content:
              'Você é um estrategista de conteúdo digital especializado em redes sociais. Escreva em português do Brasil, com clareza, voz natural e formato pronto para publicar no canal indicado. Não inclua explicações, apenas o conteúdo final.',
          },
          {
            role: 'user',
            content: userMessage,
          },
        ],
      }),
      signal: AbortSignal.timeout(30000),
    })

    const responseText = await openAiResponse.text()
    let data: {
      choices?: Array<{ message?: { content?: string } }>
      error?: { message?: string }
    }

    try {
      data = JSON.parse(responseText)
    } catch {
      return NextResponse.json(
        { error: 'Resposta invalida da OpenAI', details: responseText.slice(0, 200) },
        { status: 502 },
      )
    }

    if (!openAiResponse.ok) {
      return NextResponse.json(
        { error: data.error?.message || `Erro na OpenAI: ${openAiResponse.status}` },
        { status: openAiResponse.status === 401 ? 400 : openAiResponse.status },
      )
    }

    const generatedBody = data.choices?.[0]?.message?.content?.trim()
    if (!generatedBody) {
      return NextResponse.json({ error: 'A OpenAI nao retornou texto' }, { status: 502 })
    }

    return NextResponse.json({ generatedBody, model: DEFAULT_MODEL })
  } catch (error) {
    const credentialUnavailable = providerCredentialUnavailableResponse(error)
    if (credentialUnavailable) return credentialUnavailable
    if (error instanceof Error && error.name === 'TimeoutError') {
      return NextResponse.json({ error: 'Tempo limite excedido. Tente novamente.' }, { status: 504 })
    }
    console.error('[GenerateBody] Error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Erro interno' },
      { status: 500 },
    )
  }
}

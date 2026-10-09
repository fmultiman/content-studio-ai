import { NextResponse } from 'next/server'
import { providerExecutionBlockedResponse } from '@/lib/providers/execution-policy-http'
import { createClient } from '@/lib/supabase/server'
import { resolveProviderExecution } from '@/lib/credentials/provider-execution'

const OPENAI_CHAT_URL = 'https://api.openai.com/v1/chat/completions'
const DEFAULT_PROMPT_MODEL = 'gpt-4o-mini'

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

    const {
      description,
      sceneNumber,
      duration,
      movement,
      projectId,
      videoName,
    } = await request.json()

    if (!description?.trim()) {
      return NextResponse.json(
        { error: 'Descricao da cena obrigatoria' },
        { status: 400 },
      )
    }

    const execution = await resolveProviderExecution(supabase, { userId: user.id, provider: 'openai' })

    if (execution.status !== 'ready') {
      return NextResponse.json(
        { error: 'API Key da OpenAI nao configurada', code: execution.code, provider: 'openai' },
        { status: 400 },
      )
    }
    const apiKey = execution.secret

    let projectContext: string | null = null

    if (projectId) {
      const { data: project } = await supabase
        .from('projects')
        .select('context')
        .eq('id', projectId)
        .single()

      projectContext = project?.context || null
    }

    const systemPrompt = `You are an expert prompt engineer for AI video and image generation.

Write cinematic scene prompts in English. The output must be one polished prompt paragraph, ready to paste into an AI video or image model.

Focus on:
- the visual subject and action
- camera movement and framing
- lighting, mood, color, and composition
- continuity with the project context
- professional video language, without explaining your choices

Do not include markdown, labels, JSON, or commentary.`

    const userPrompt = `Create a generation prompt for this video scene.

Video name: ${videoName || 'Untitled video'}
Scene number: ${sceneNumber}
Scene duration: ${duration || 3} seconds
Selected camera movement: ${movement || 'static'}

Scene description in Portuguese:
${description}

Project context:
${projectContext || 'Not specified'}`

    const response = await fetch(OPENAI_CHAT_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: process.env.OPENAI_PROMPT_MODEL || DEFAULT_PROMPT_MODEL,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        temperature: 0.7,
        max_tokens: 500,
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

    const prompt = data.choices?.[0]?.message?.content?.trim()

    if (!prompt) {
      return NextResponse.json(
        { error: 'A OpenAI nao retornou um prompt' },
        { status: 502 },
      )
    }

    return NextResponse.json({ prompt })
  } catch (error) {
    console.error('[Generate Scene Prompt] Error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Erro interno' },
      { status: 500 },
    )
  }
}

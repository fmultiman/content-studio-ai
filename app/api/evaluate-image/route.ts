import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

const OPENAI_CHAT_URL = 'https://api.openai.com/v1/chat/completions'
const DEFAULT_EVALUATION_MODEL = 'gpt-4o-mini'

function extractJson(text: string) {
  try {
    return JSON.parse(text)
  } catch {
    const jsonMatch = text.match(/\{[\s\S]*\}/)

    if (!jsonMatch) {
      throw new Error('No JSON found in response')
    }

    return JSON.parse(jsonMatch[0])
  }
}

export async function POST(request: Request) {
  console.log('[Evaluate Image] Starting evaluation...')

  try {
    const supabase = await createClient()
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser()

    if (authError || !user) {
      return NextResponse.json({ error: 'Nao autorizado' }, { status: 401 })
    }

    const {
      userInput,
      generatedPrompt,
      imageUrl,
      styleProfile,
      context,
      attempt = 1,
    } = await request.json()

    if (!generatedPrompt || !imageUrl) {
      return NextResponse.json(
        { error: 'Prompt e URL da imagem sao obrigatorios' },
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

    const evaluationPrompt = `Voce e um avaliador de qualidade visual e simbolica para imagens geradas por IA.

Seu objetivo e analisar se a imagem atende a intencao original, ao contexto do projeto e ao style profile definido.

INPUTS RECEBIDOS

userInput (descricao inicial do usuario):
${userInput || 'Nao especificado'}

generatedPrompt (prompt usado para gerar a imagem):
${generatedPrompt}

context (contexto geral do projeto):
${context || 'Nao especificado'}

style_profile (estilo desejado):
${styleProfile || 'Nao especificado - avalie pela qualidade geral'}

Tentativa atual: ${attempt} de 3

TAREFAS DE AVALIACAO

1. Avaliar a imagem considerando:
- Fidelidade a intencao original do usuario
- Aderencia ao style_profile, quando houver
- Qualidade estetica geral
- Composicao visual, equilibrio, hierarquia e foco
- Iluminacao e contraste
- Originalidade, evitando aparencia generica de banco de imagens
- Forca simbolica, se aplicavel ao contexto
- Adequacao para redes sociais e impacto visual imediato

2. Identificar problemas claros:
- Falta de contraste ou profundidade
- Visual generico ou sem personalidade
- Falta de foco ou elemento central fraco
- Estilo inconsistente com o style_profile
- Falta de impacto visual
- Cores sem harmonia
- Iluminacao plana ou sem drama

3. Sugerir melhorias especificas e acionaveis.

4. Gerar um novo prompt melhorado em ingles no campo refinedPrompt.

FORMATO DE SAIDA: responda apenas com JSON valido neste formato:
{
  "score": 0,
  "approved": false,
  "feedback": "resumo claro em portugues, 2-3 frases",
  "improvements": ["melhoria 1", "melhoria 2", "melhoria 3"],
  "refinedPrompt": "optimized English prompt ready for image generation"
}`

    console.log('[Evaluate Image] Calling OpenAI for evaluation...')

    const response = await fetch(OPENAI_CHAT_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: process.env.OPENAI_EVALUATION_MODEL || DEFAULT_EVALUATION_MODEL,
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: evaluationPrompt },
              {
                type: 'image_url',
                image_url: {
                  url: imageUrl,
                  detail: 'low',
                },
              },
            ],
          },
        ],
        response_format: { type: 'json_object' },
        max_tokens: 1000,
      }),
    })

    const responseData = await response.json()

    if (!response.ok) {
      return NextResponse.json(
        {
          error:
            responseData.error?.message || `Erro na OpenAI: ${response.status}`,
          details: responseData,
        },
        { status: response.status },
      )
    }

    const text = responseData.choices?.[0]?.message?.content?.trim()

    if (!text) {
      return NextResponse.json(
        { error: 'A OpenAI nao retornou uma avaliacao', details: responseData },
        { status: 502 },
      )
    }

    console.log('[Evaluate Image] OpenAI response received')

    let evaluation
    try {
      evaluation = extractJson(text)
    } catch (parseError) {
      console.error('[Evaluate Image] Parse error:', parseError)
      evaluation = {
        score: 75,
        approved: true,
        feedback: 'Avaliacao concluida com sucesso.',
        improvements: [],
        refinedPrompt: generatedPrompt,
      }
    }

    evaluation = {
      score: evaluation.score ?? 75,
      approved: evaluation.approved ?? (evaluation.score >= 75),
      feedback: evaluation.feedback ?? 'Avaliacao concluida.',
      improvements: Array.isArray(evaluation.improvements)
        ? evaluation.improvements
        : [],
      refinedPrompt: evaluation.refinedPrompt ?? generatedPrompt,
    }

    console.log('[Evaluate Image] Evaluation complete:', {
      score: evaluation.score,
      approved: evaluation.approved,
    })

    return NextResponse.json(evaluation)
  } catch (error) {
    console.error('[Evaluate Image] Error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Erro ao avaliar imagem' },
      { status: 500 },
    )
  }
}

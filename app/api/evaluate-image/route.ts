import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { normalizeProjectIdentity, ProjectIdentityParseError } from '@/lib/project-identity-normalizer'
import { buildImageEvaluationContext } from '@/lib/context-compiler'
import type { ProjectIdentity } from '@/lib/schemas/project-identity'

const OPENAI_CHAT_URL = 'https://api.openai.com/v1/chat/completions'
const DEFAULT_EVALUATION_MODEL = 'gpt-4o-mini'
const EVALUATION_MODES = ['default', 'conceptual', 'aesthetic', 'commercial', 'experimental'] as const

type EvaluationMode = (typeof EVALUATION_MODES)[number]

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

function normalizeEvaluationMode(value: unknown): EvaluationMode {
  return typeof value === 'string' && EVALUATION_MODES.includes(value as EvaluationMode)
    ? value as EvaluationMode
    : 'default'
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
      evaluation_mode,
      evaluationMode,
      attempt = 1,
      identity: rawIdentity = null,
    } = await request.json()
    const normalizedEvaluationMode = normalizeEvaluationMode(evaluation_mode || evaluationMode)

    if (!generatedPrompt || !imageUrl) {
      return NextResponse.json(
        { error: 'Prompt e URL da imagem sao obrigatorios' },
        { status: 400 },
      )
    }

    // Validate identity server-side — never trust the client alone
    let normalizedIdentity: ProjectIdentity | null = null
    if (rawIdentity !== null && rawIdentity !== undefined) {
      try {
        normalizedIdentity = normalizeProjectIdentity(rawIdentity)
      } catch (err) {
        const detail = err instanceof ProjectIdentityParseError
          ? 'estrutura incompatível com schema V1'
          : 'erro inesperado na validação'
        return NextResponse.json(
          { error: `Identity inválida: ${detail}.` },
          { status: 400 },
        )
      }
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

    const compiledEvaluationContext = buildImageEvaluationContext({
      context,
      style_profile: styleProfile,
      identity: normalizedIdentity,
    })

    const systemPrompt = `Voce e um avaliador de qualidade visual, conceitual e simbolica para imagens geradas por IA.

Seu objetivo e analisar se a imagem atende a intencao original do usuario, ao contexto do projeto e a identidade do projeto.

INPUTS:

- userInput
- generatedPrompt
- imageUrl
- project context and identity (compiled)
- evaluation_mode

PRIORIDADE BASE:

Sempre avaliar primeiro:
- alinhamento conceitual com o contexto
- coerencia da ideia
- clareza da intencao

Depois avaliar:
- aderencia a identidade visual
- composicao visual
- iluminacao e contraste
- qualidade estetica

DETECCAO DE PROBLEMAS:

Identificar e penalizar:
- imagens genericas ou cliches comuns de IA
- interpretacoes superficiais
- estetica sem significado
- falta de intencao clara

IDENTIDADE DO PROJECT:

Quando o contexto compilado incluir principios e restricoes da identidade do projeto:

Principios (direcoes positivas que a imagem deve buscar):
- Identificar se a imagem atende os principios declarados
- Um principio nao atendido deve ser refletido no score e mencionado no feedback

Restricoes (limites que a imagem nao deve violar):
- Identificar violacoes de restricoes explicando concretamente a incompatibilidade
- Refletir a gravidade no score
- Marcar approved = false quando a violacao for material
- Mencionar a correcao em improvements
- Produzir refinedPrompt que corrija a violacao

Nao aplicar reprovacao automatica para toda restricao trivial ou interpretativa.
Nao usar teto numerico universal de score.

COMPORTAMENTO POR evaluation_mode:

Se evaluation_mode = "conceptual":
- priorizar profundamente significado, narrativa e simbolismo
- penalizar fortemente cliches e superficialidade
- exigir coerencia com o contexto
- estetica e secundaria

Se evaluation_mode = "aesthetic":
- priorizar composicao, iluminacao, harmonia visual
- avaliar estetica com peso alto
- conceito ainda importa, mas nao domina

Se evaluation_mode = "commercial":
- priorizar impacto visual imediato
- clareza da mensagem
- potencial de engajamento
- legibilidade e destaque

Se evaluation_mode = "experimental":
- priorizar originalidade e criatividade
- permitir abstracao e risco
- nao penalizar tanto falta de clareza
- valorizar inovacao

Se evaluation_mode = "default":
- equilibrar conceito, estetica e clareza

REGRAS IMPORTANTES:

- Uma imagem bonita NAO deve ser bem avaliada se for conceitualmente fraca, exceto quando modo nao prioriza conceito
- Evitar feedback generico
- Ser especifico, critico e acionavel

REFINED PROMPT:

O novo prompt deve:

- corrigir os problemas identificados
- melhorar alinhamento com contexto e identidade
- reduzir cliches
- aumentar clareza e intencao
- adaptar o estilo ao evaluation_mode

SAIDA (JSON):

{
  "score": number (0-100),
  "approved": boolean,
  "feedback": string,
  "improvements": string[],
  "refinedPrompt": string
}`
    const evaluationInput = `INPUTS RECEBIDOS

userInput:
${userInput || 'Nao especificado'}

generatedPrompt:
${generatedPrompt}

imageUrl:
${imageUrl}

PROJECT CONTEXT AND IDENTITY:
${compiledEvaluationContext || 'Nao especificado'}

evaluation_mode:
${normalizedEvaluationMode}

Tentativa atual: ${attempt} de 3

Responda apenas com JSON valido no formato solicitado. O feedback e as melhorias devem estar em portugues. O refinedPrompt deve estar em ingles e pronto para nova geracao de imagem.`

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
            role: 'system',
            content: systemPrompt,
          },
          {
            role: 'user',
            content: [
              { type: 'text', text: evaluationInput },
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

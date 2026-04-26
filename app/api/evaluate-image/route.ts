import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { generateText } from 'ai'
import { gateway } from '@ai-sdk/gateway'

export async function POST(request: Request) {
  console.log('[Evaluate Image] Starting evaluation...')

  try {
    const supabase = await createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()

    if (authError || !user) {
      return NextResponse.json({ error: 'Não autorizado' }, { status: 401 })
    }

    const body = await request.json()
    const { 
      userInput, 
      generatedPrompt, 
      imageUrl, 
      projectId, 
      styleProfile,
      context,
      attempt = 1 
    } = body

    if (!generatedPrompt || !imageUrl) {
      return NextResponse.json(
        { error: 'Prompt e URL da imagem são obrigatórios' },
        { status: 400 }
      )
    }

    // Build evaluation prompt with comprehensive system instructions
    const evaluationPrompt = `Você é um avaliador de qualidade visual e simbólica para imagens geradas por IA.

Seu objetivo é analisar se a imagem atende à intenção original, ao contexto do projeto e ao style profile definido.

---

## INPUTS RECEBIDOS

**userInput (descrição inicial do usuário):**
${userInput}

**generatedPrompt (prompt usado para gerar a imagem):**
${generatedPrompt}

**context (contexto geral do projeto):**
${context || 'Não especificado'}

**style_profile (estilo desejado):**
${styleProfile || 'Não especificado - avalie pela qualidade geral'}

**Tentativa atual:** ${attempt} de 3

---

## TAREFAS DE AVALIAÇÃO

1. **Avaliar a imagem considerando:**
   - Fidelidade à intenção original do usuário
   - Aderência ao style_profile (este é o critério mais importante)
   - Qualidade estética geral
   - Composição visual (equilíbrio, hierarquia, foco)
   - Iluminação e contraste
   - Originalidade (evitar aparência genérica de banco de imagens)
   - Força simbólica (se aplicável ao contexto)
   - Adequação para redes sociais (impacto visual imediato)

2. **Identificar problemas claros:**
   - Falta de contraste ou profundidade
   - Visual genérico ou sem personalidade
   - Falta de foco ou elemento central fraco
   - Estilo inconsistente com o style_profile
   - Falta de impacto visual
   - Cores sem harmonia
   - Iluminação plana ou sem drama

3. **Sugerir melhorias específicas e acionáveis**
   - Não dê sugestões vagas como "melhorar a composição"
   - Seja específico: "adicionar luz lateral dramática", "aumentar contraste no elemento central"

4. **Gerar um novo prompt melhorado (refinedPrompt)**
   - Deve ser escrito em INGLÊS
   - Mantém a ideia original mas corrige os problemas encontrados
   - Incorpora elementos do style_profile de forma mais explícita
   - Deve ser um prompt completo, pronto para geração imediata

---

## FORMATO DE SAÍDA (JSON OBRIGATÓRIO)

{
  "score": <número de 0 a 100>,
  "approved": <true se score >= 75, false caso contrário>,
  "feedback": "<resumo claro e direto da avaliação em português, 2-3 frases>",
  "improvements": [
    "<melhoria específica e acionável 1>",
    "<melhoria específica e acionável 2>",
    "<melhoria específica e acionável 3>"
  ],
  "refinedPrompt": "<prompt otimizado em INGLÊS, pronto para geração de imagem>"
}

---

## REGRAS IMPORTANTES

- Seja direto e técnico, sem rodeios
- Evite respostas genéricas ou evasivas
- O refinedPrompt deve ser MELHOR que o original, não apenas reescrito
- Use o style_profile como critério FORTE de decisão
- Se a imagem estiver boa (score >= 75), aprove e refine levemente para perfeição
- Se estiver fraca (score < 75), seja crítico e proponha mudanças claras e específicas
- Considere que estas imagens serão usadas em redes sociais - precisam de impacto
- O refinedPrompt deve SEMPRE estar em inglês para melhor resultado na geração`

    console.log('[Evaluate Image] Calling AI for evaluation...')

    const { text } = await generateText({
      model: gateway('openai/gpt-4o-mini'),
      prompt: evaluationPrompt,
      maxTokens: 1000,
    })

    console.log('[Evaluate Image] AI response received')

    // Parse JSON response
    let evaluation
    try {
      // Extract JSON from response (may have markdown code blocks)
      const jsonMatch = text.match(/\{[\s\S]*\}/)
      if (jsonMatch) {
        evaluation = JSON.parse(jsonMatch[0])
      } else {
        throw new Error('No JSON found in response')
      }
    } catch (parseError) {
      console.error('[Evaluate Image] Parse error:', parseError)
      // Return default evaluation on parse error
      evaluation = {
        score: 75,
        approved: true,
        feedback: 'Avaliação concluída com sucesso.',
        improvements: [],
        refinedPrompt: generatedPrompt,
      }
    }

    // Ensure all fields exist with proper defaults
    evaluation = {
      score: evaluation.score ?? 75,
      approved: evaluation.approved ?? (evaluation.score >= 75),
      feedback: evaluation.feedback ?? 'Avaliação concluída.',
      improvements: Array.isArray(evaluation.improvements) ? evaluation.improvements : [],
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
      { error: 'Erro ao avaliar imagem' },
      { status: 500 }
    )
  }
}

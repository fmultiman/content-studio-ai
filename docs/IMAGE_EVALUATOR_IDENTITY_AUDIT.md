# Auditoria de Identidade no Image Evaluator

**Data:** 2026-06-25
**Objetivo:** Reconstruir o fluxo de avaliação de imagens e analisar como ele consome o contexto de Project Identity.

## 1. Resumo Executivo
A auditoria revelou que o **Image Evaluator é verdadeiramente multimodal** e atua ativamente sobre o contexto e estilo do projeto para gerar notas de 0 a 100. O fluxo, no entanto, é majoritariamente **manual** na interface atual; não existe um loop autônomo (Auto Mode) de sucessivas avaliações e regenerações automáticas operando ininterruptamente sem ação do usuário.

## 2. Fluxo Real (Ativo)
O caminho feliz da avaliação de imagem é o seguinte:
1. **UI:** O usuário ou a geração invoca `<ImageResult onEvaluate={handleEvaluateImage} />` em `app/(dashboard)/imagens/page.tsx`.
2. **Action/Client:** `handleEvaluateImage` coleta o contexto atual (`userInput`, `generatedPrompt`, `imageUrl`, `projectContext`, `styleProfile`, `evaluation_mode`, `attempt`).
3. **API:** Faz POST para `app/api/evaluate-image/route.ts`.
4. **Provider:** A API formata um system prompt complexo e envia os metadados + a **imagem (via URL em baixa resolução)** para a OpenAI (`gpt-4o-mini`).
5. **Parser:** O JSON é parseado para extrair `{ score, approved, feedback, improvements, refinedPrompt }`.
6. **UI de Retorno:** Exibe o score e o feedback. Se o usuário clicar no botão associado, o `refinedPrompt` substitui o prompt atual, o `attempt` sobe +1 e o usuário gera a nova imagem.

**Nota sobre `ai-simulator.ts`:**
O `lib/ai-simulator.ts` é usado no projeto ativamente para `generateImagePrompt` e `regeneratePrompt` via endpoints, mas a avaliação da imagem não transita por ele, e sim diretamente pelo route handler `evaluate-image`.

## 3. Caminhos Ativos e Simulados
- **Ativo:** Geração (OpenAI via `/api/openai` ou NanoBanana via `/api/nanobanana`) e Avaliação multimodal via `/api/evaluate-image`.
- **Inativo/Inexistente:** Loop de *auto evaluation retry*. O Auto Mode hoje gera a primeira imagem imediatamente após gerar o prompt de texto, mas não entra em loop autônomo de melhoria contínua após falha na nota.

## 4. Inputs Reais do Avaliador
Rastreamento do que a OpenAI recebe em `app/api/evaluate-image/route.ts`:
- **imagem gerada (URL em low detail):** RECEBE
- **prompt inicial do usuário (userInput):** RECEBE
- **prompt final enviado ao gerador (generatedPrompt):** RECEBE
- **Project name:** NÃO RECEBE
- **Project description:** NÃO RECEBE
- **Project context:** RECEBE
- **style_profile:** RECEBE
- **evaluation_mode:** RECEBE
- **Production id / context:** NÃO RECEBE (A UI possui Production Id no state, mas a requisição pega o contexto do Projeto selecionado).
- **número da tentativa (attempt):** RECEBE

## 5. Acesso Visual
O avaliador é **Multimodal Híbrido**.
* **Provider:** OpenAI
* **Modelo:** `gpt-4o-mini` (ou `OPENAI_EVALUATION_MODEL`)
* **Mensagem:** `type: "image_url"` configurado em `detail: 'low'`. Analisa ativamente a imagem e as instruções.

## 6. Score e Estrutura da Avaliação
- A nota é um **score único (0-100)** gerado pelo JSON do modelo.
- Calculado via IA (não é cálculo algorítmico baseado em regras rígidas).
- Threshold de aprovação: `>= 75` (a API preenche `approved = true` se >= 75 caso o modelo omita).
- Não existem campos numéricos ou pontuações separadas para os subcritérios (tudo é misturado na mesma nota).

## 7. Subcritérios Avaliados
Mesmo sendo uma nota única, o System Prompt exige a análise das seguintes dimensões (classificadas em ordem de prioridade):
1. Aderência conceitual (coerência com `context` e intenção).
2. Aderência ao Project (`style_profile`).
3. Qualidade técnica/estética (composição, contraste, genericidade).

## 8. Feedback e Revised Prompt
- Fornece feedback verbal textual curto em PT-BR.
- Fornece array de melhorias (ex: `["Melhorar iluminação", "Remover robô genérico"]`).
- **Produz DIRETAMENTE um novo prompt:** O modelo não corrige o generator; ele mesmo se torna o revisor e entrega um `refinedPrompt` em inglês.

## 9. Auto Mode e Retry
- **Loop:** Não foi encontrado um loop autônomo de auto-recuperação (o sistema não faz retry sozinho se a imagem recebe score < 75 na página). O "Auto Mode" no frontend serve primariamente para pular a aprovação do primeiro prompt e ir direto para a geração da primeira tentativa de imagem.
- **Retry Count:** Controlado como `currentAttempt`. Incrementado a cada substituição manual do prompt na UI.
- O histórico guarda as imagens junto com seus evaluations em `generationAttempts`.

## 10. Uso Atual de Identidade
* `context`: Usado estritamente como **Critério de Avaliação** e **Contexto de Correção** (a IA compara a imagem com o que o contexto exige e usa o contexto para deduzir onde o prompt falhou).
* `style_profile`: Usado para verificar a aderência estética (governança visual).
* `evaluation_mode`: Manipula o peso da avaliação (ex: se "conceptual", estética é ignorada e profundidade é valorizada).

## 11. Impacto nas Cinco Zonas (Project Identity v1)
Como o avaliador consome dados textuais na íntegra, a V1 precisará compilar as cinco zonas antes de entregar ao avaliador.
- **Foundation (Propósito) e Relationship (Público):** Indispensáveis para que o avaliador meça a aderência de significado (especialmente em `evaluation_mode=conceptual`).
- **Expression:** Muito necessário para o avaliador punir a imagem que não siga o Visual Identity.
- **Governance:** Indispensável (o avaliador atua como moderador se souber as restrições).

## 12. Posição do Evaluation Mode
A auditoria revelou que `evaluation_mode` muda o peso da avaliação no System Prompt (ex: `conceptual` ignora qualidade e foca em sentido; `commercial` foca em clareza).
- **Opção recomendada:** **B (Default no Project + Override na Production)**. Como o Project define a "régua de marca", ele é o default. Mas uma campanha específica (Production) pode temporariamente querer uma régua experimental ou conceitual.

## 13. Impacto na Opção JSONB da Recomendação
**CONFIRMAR OPÇÃO B (JSONB) COM AJUSTES:**
- O avaliador precisa receber os valores em um bloco de texto legível. Enviar o raw stringified JSONB diretamente pode desperdiçar tokens ou introduzir jargão técnico.
- A aplicação (como `Effective Context Compiler`) precisará ler o `identity JSONB` da tabela de projetos e renderizar uma "Bula Textual" para injetar no evaluationInput (`context: "Propósito: X \n Restrições: Y"`).

## 14. Conclusão
O Avaliador funciona e enxerga pixels, mas baseia-se pesadamente no string misturado do `context`. Desmembrar a identidade em V1 via JSONB beneficiará profundamente o revisor multimodal da OpenAI.

**Status:** IMAGE EVALUATOR AUDIT APROVADA — READY FOR PRODUCT DECISIONS

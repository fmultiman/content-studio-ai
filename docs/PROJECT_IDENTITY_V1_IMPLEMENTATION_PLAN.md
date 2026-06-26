# PROJECT_IDENTITY_V1_IMPLEMENTATION_PLAN.md
**Data: 2026-06-25**  
**Revisado: 2026-06-25 — decisões de produto finalizadas**

> Plano de implementação de Project Identity V1.
> Produzido a partir do discovery técnico completo documentado em
> `PROJECT_IDENTITY_V1_IMPLEMENTATION_DISCOVERY.md`.
> Nenhuma implementação foi realizada aqui.

---

## Pré-condições

Antes de iniciar M11-A, as seguintes condições devem ser verdadeiras:

| Condição | Status |
|----------|--------|
| Branch `main` com M10-C merged e deployado | VERDADEIRO (commit `7dd5395`) |
| `tsc --noEmit`: 0 erros | VERDADEIRO (baseline M10-C) |
| `eslint`: 0 erros, 50 warnings | VERDADEIRO (baseline M10-C) |
| `pnpm build`: PASS | VERDADEIRO (baseline M10-C) |
| Documentos de discovery lidos e aprovados | VERDADEIRO (esta branch) |
| D-BLOCKER-1 respondido (shape do JSONB aprovado) | **PENDENTE — decisão humana** |
| D-BLOCKER-2 respondido (comportamento UI pós-identity) | **PENDENTE — decisão humana** |

---

## Marcos

### M11-A — Contrato Executável

**Objetivo:** Criar o schema Zod, a função de normalização e os formatters de contexto para os agentes. Shape e policy já estão aprovados (ver DISCOVERY seção 14–16). Nenhum código de produção alterado neste marco.

**Arquivos criados (não modificados, sem consumidores ainda):**

| Arquivo | Conteúdo |
|---------|---------|
| `lib/schemas/project-identity.ts` | `ProjectIdentitySchema` (Zod) + `ProjectIdentity` type inferido |
| `lib/project-identity-normalizer.ts` | `normalizeProjectIdentity(input): ProjectIdentity \| null` |
| `lib/context-compiler.ts` | `buildImageGenerationContext(project)`, `buildImageEvaluationContext(project)` |

**Funções de M11-A:**

```typescript
// lib/project-identity-normalizer.ts
normalizeProjectIdentity(input: unknown): ProjectIdentity | null
// valida via Zod, aplica trim/dedup, retorna null se sem conteúdo além de schema_version

// lib/context-compiler.ts
buildImageGenerationContext(project: Project): string
// inclui: context geral, foundation.purpose, expression.visual_identity,
//         expression.voice, governance.principles, governance.restrictions,
//         practice.generation_preferences
// NUNCA usa || entre context e purpose — inclui ambos quando disponíveis

buildImageEvaluationContext(project: Project): string
// inclui: context geral, foundation.purpose, audience, governance.principles,
//         governance.restrictions como bloco separado de peso máximo
```

**Não criar um compiler universal para todos os domínios.** Os dois formatters acima são explícitos e pequenos. EditorialContent e ChannelPiece terão seus próprios formatters quando necessário (V2).

**Migration SQL:** Nenhuma.

**APIs afetadas:** Nenhuma.

**UI afetada:** Nenhuma.

**Compatibilidade e rollback:** Total. Arquivos novos sem consumidores. Rollback = deletar os arquivos.

**Testes necessários:**
- Unit tests para `normalizeProjectIdentity()`: identity null → null; identity com só schema_version → null; identity parcial → retorna; campos extras → rejeita (strict); string vazia após trim → rejeitada; array com duplicatas → deduplicado
- Unit tests para `buildImageGenerationContext()`: project sem identity → inclui apenas context/style_profile; project com identity parcial → inclui os campos disponíveis; project com context E purpose → inclui ambos separadamente (não usa ||); project com restrictions → restrições em bloco próprio
- Unit tests para `buildImageEvaluationContext()`: idem, com ênfase em governance

**Critério de aceite:**
- `ProjectIdentitySchema` valida e normaliza corretamente
- `ProjectIdentity` type inferido do Zod — sem interfaces duplicadas
- `normalizeProjectIdentity({schema_version: 1})` retorna `null`
- `buildImageGenerationContext` inclui `context` e `purpose` separadamente quando ambos existem
- Todos os unit tests passam
- `tsc --noEmit`: 0 erros
- D-M11A-1 (limites de caracteres) confirmado durante a implementação

**Pontos de parada obrigatória:**
- STOP: aprovação dos testes unitários antes de avançar para M11-B

**Dependências:** Nenhuma (D-BLOCKER-1 já resolvido)

---

### M11-B — Schema, Types e Validação

**Objetivo:** Adicionar a coluna `identity JSONB` na tabela `projects`. Atualizar o tipo `Project` em `lib/types.ts`. Garantir que nenhum código existente quebre.

**Arquivos modificados:**
- `lib/types.ts` — adicionar `ProjectIdentity`, `ProjectIdentityFoundation`, `ProjectIdentityRelationship`, `ProjectIdentityExpression`, `ProjectIdentityGovernance` interfaces; adicionar campo `identity?: ProjectIdentity | null` ao `Project`
- `lib/schemas/project-identity.ts` — (criado em M11-A, pode sofrer ajuste)

**Migration SQL:**

```sql
-- migration 020_add_project_identity.sql
ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS identity JSONB DEFAULT NULL;

-- Nenhum NOT NULL, nenhum CHECK constraint
-- Projetos existentes ficam com identity = NULL (comportamento correto)
-- RLS existente cobre automaticamente a nova coluna
```

**APIs afetadas:**
- Nenhuma rota de API é alterada. O Supabase client já serializa JSONB automaticamente.
- Verificar que o `select('*')` existente em `projetos/[id]/page.tsx` passa a incluir `identity` automaticamente.

**UI afetada:** Nenhuma (a nova coluna é invisível até M11-C).

**Compatibilidade e rollback:**
- A migration é reversível: `ALTER TABLE projects DROP COLUMN IF EXISTS identity`
- Nenhum código existente referencia `identity` ainda — zero risco de quebra
- TypeScript: o campo é opcional (`identity?: ProjectIdentity | null`) — nenhum consumidor existente quebra

**Testes necessários:**
- Verificar que `select('*')` retorna `identity: null` para projetos existentes
- Verificar que um PATCH `{ identity: { foundation: { purpose: "teste" } } }` persiste corretamente
- Verificar que a migration roda sem erros no ambiente de desenvolvimento

**Critério de aceite:**
- Migration aplicada com sucesso
- `lib/types.ts` tipado com `ProjectIdentity`
- `tsc --noEmit`: 0 erros
- `pnpm build`: PASS
- SELECT em projetos existentes retorna `identity: null` (não undefined)

**Pontos de parada obrigatória:**
- STOP: validação do SELECT em produção antes de iniciar M11-C

**Dependências:** M11-A concluído e aprovado

---

### M11-C — UI Progressiva de Project Identity

**Objetivo:** Exibir e permitir edição da Project Identity na página do Projeto. Nenhuma mudança nos agentes ainda.

**Arquivos modificados:**
- `app/(dashboard)/projetos/[id]/page.tsx` — adicionar seção "Identidade do Projeto" com campos progressivos
- `components/projects/project-form.tsx` — adicionar campos de identity ao formulário de edição (ou criar modal separado)

**Novos componentes (se necessário):**
- `components/projects/project-identity-form.tsx` — formulário de edição de identity com campos individuais por dimensão
- `components/projects/project-identity-display.tsx` — exibição read-only da identity com estado de preenchimento

**Comportamento da UI:**

Estado sem identity (null):
```
IDENTIDADE DO PROJETO
  Propósito         [Não definido]   [+ Adicionar]
  Público           [Não definido]   [+ Adicionar]
  Direção Visual    [Não definido]   [+ Adicionar]
  Voz e Linguagem   [Não definido]   [+ Adicionar]
  Restrições        [Não definidas]  [+ Adicionar]
```

Estado com identity parcial:
```
IDENTIDADE DO PROJETO
  Propósito         [texto preenchido]  [Editar]
  Público           [Não definido]      [+ Adicionar]
  Direção Visual    [texto preenchido]  [Editar]
  ...
```

**Comportamento de edição:**
- Clique em [+ Adicionar] ou [Editar] abre um textarea inline ou modal simples
- Salvar faz PATCH `{ identity: { ...existente, [zona]: { [campo]: valor } } }` via Supabase client
- A função `mergeIdentity(existing, patch)` garante que campos não editados não sejam perdidos

**Campos legados (context / style_profile):**
- Continuam exibidos no card atual
- Sem mudança de comportamento — a UI de identity é ADICIONAL, não substitutiva
- Resolução de D-BLOCKER-2 determina se eles são colapsados ou mantidos visíveis

**Migration SQL:** Nenhuma (M11-B já aplicou a coluna).

**APIs afetadas:** Nenhuma nova rota. O PATCH vai diretamente para Supabase client.

**Compatibilidade e rollback:**
- Rollback: reverter a seção de UI no page.tsx e o formulário
- Nenhum dado é perdido no rollback (a coluna `identity` permanece no banco)

**Testes necessários:**
- Criar Project sem identity: seção exibe "Não definido" em todos os campos
- Preencher um campo de identity: exibido corretamente após salvar
- Preencher múltiplos campos: sem perda de dados entre edições
- Projects com `context` e `style_profile` existentes: campos legados não são afetados
- Responsividade da nova seção
- `tsc --noEmit`: 0 erros, `pnpm build`: PASS

**Critério de aceite:**
- Seção "Identidade do Projeto" exibida na página de todos os projetos
- Preenchimento e edição funcionam sem erros
- Dados persistem corretamente no banco
- Campos legados (context, style_profile) continuam funcionando
- Typecheck e build passam

**Pontos de parada obrigatória:**
- STOP: smoke test manual no ambiente de produção antes de M11-D

**Dependências:** M11-B concluído

---

### M11-D — Consumo na Geração de Imagem

**Objetivo:** Os agentes de geração (Prompt Generator) e avaliação (Image Evaluator) passam a consumir `identity` quando disponível, com fallback para os campos legados.

**Arquivos modificados:**
- `lib/ai-simulator.ts` — função `generateImagePrompt` e `generateWithOpenAI` recebem `identity?: ProjectIdentity | null` e usam `buildIdentityContext()` para montar o contexto
- `app/api/evaluate-image/route.ts` — recebe `identity` no body e usa `buildEvaluatorContext()` para montar o system prompt com restrições locked
- `app/(dashboard)/imagens/page.tsx` — inclui `project.identity` nas chamadas para os dois agentes

**Mudanças no contrato de `generateImagePrompt`:**

```typescript
// Antes:
generateImagePrompt(
  userInput: string,
  projectContext: string | null,
  styleProfile: string | null,
  previousAttempts: GenerationAttempt[],
  evaluationMode: EvaluationMode
)

// Depois:
generateImagePrompt(
  userInput: string,
  projectContext: string | null,     // mantido (fallback)
  styleProfile: string | null,       // mantido (fallback)
  previousAttempts: GenerationAttempt[],
  evaluationMode: EvaluationMode,
  identity?: ProjectIdentity | null  // NOVO — preferido quando disponível
)
```

**Lógica de compilação (usando `buildIdentityContext()` de M11-A):**
```typescript
const compiledContext = buildIdentityContext({
  context: projectContext,
  style_profile: styleProfile,
  identity: identity
})
// compiledContext substitui a concatenação manual atual de projectContext + styleProfile
```

**Mudanças no contrato de `/api/evaluate-image`:**

```typescript
// Novo campo no body:
{
  // ... campos existentes ...
  identity?: ProjectIdentity | null  // NOVO
}
// No handler: buildEvaluatorContext() monta o system prompt incluindo restrictions como
// prompts negativos rígidos quando identity.governance.restrictions está presente
```

**Migration SQL:** Nenhuma.

**APIs afetadas:**
- `POST /api/evaluate-image` — aceita `identity` opcionalmente (backward compatible)
- Função `generateImagePrompt` em `lib/ai-simulator.ts` — novo parâmetro opcional (backward compatible)

**UI afetada:**
- `app/(dashboard)/imagens/page.tsx` — passa `project.identity` nas chamadas existentes

**Compatibilidade:**
- Todos os parâmetros novos são opcionais
- Sem identity: comportamento idêntico ao atual (fallback para context/style_profile)
- Com identity: comportamento aprimorado (contexto mais estruturado)
- Nenhuma mudança no contrato de resposta dos agentes

**Rollback:** Remover passagem de `identity` nas chamadas — o agente usa apenas os campos legados.

**Testes necessários:**
- Geração com projeto sem identity: comportamento idêntico ao atual
- Geração com projeto com identity parcial: campos disponíveis são usados; ausentes usam fallback
- Geração com projeto com identity completa incluindo restrictions: avaliador penaliza violações
- Avaliação com restrictions preenchidas: score menor para imagens que violam restrições
- Verificar que o context compilado não excede limites de tokens (estimativa: context completo < 800 tokens)
- `tsc --noEmit`: 0 erros, `pnpm build`: PASS

**Critério de aceite:**
- Prompt Generator usa identity quando disponível
- Image Evaluator usa restrictions como critério rígido
- Projetos sem identity têm comportamento idêntico ao pré-V1
- Projetos com identity têm contexto mais estruturado enviado ao LLM

**Pontos de parada obrigatória:**
- STOP: teste manual de geração com Alquimia Cibernética após identidade migrada (requer M11-F)
- Não é necessário esperar M11-F para mergear M11-D — o comportamento de fallback cobre isso

**Dependências:** M11-C (identity disponível na UI para ser editada); M11-A (compilador existe)

---

### M11-E — Consumo no Image Evaluator

**Objetivo:** Garantir que `identity.governance` (principles e restrictions) seja incorporado adequadamente ao Image Evaluator. O avaliador deve identificar violações de restrições, explicar a incompatibilidade, considerar a violação no score e produzir um `refinedPrompt` corrigido.

**Nota:** M11-D já integra o evaluator com identity via `buildImageEvaluationContext()`. M11-E é o refinamento específico do tratamento de governance.

**Arquivos modificados:**
- `app/api/evaluate-image/route.ts` — ajuste no system prompt para tratar `restrictions[]` como bloco de peso diferenciado

**Mudança no system prompt do evaluator:**

```
[PRINCÍPIOS DO PROJETO]
${principles.map(p => `- ${p}`).join('\n')}

[RESTRIÇÕES DO PROJETO — identificar violações e refletir no score e no refinedPrompt]
${restrictions.map(r => `- ${r}`).join('\n')}

Quando uma restrição for violada:
- Identifique qual restrição foi violada
- Explique a incompatibilidade no campo 'feedback'
- Reflita a violação no score de forma proporcional à gravidade
- Produza um 'refinedPrompt' que corrija a violação
- Reprove (approved: false) quando a violação for material
```

**Sem teto numérico universal.** Não definir `score máximo de 40` para qualquer violação sem severidade estruturada e validação empírica. O avaliador pondera a violação proporcionalmente — uma violação leve pode resultar em score 65 com sugestão de melhoria; uma violação central pode resultar em score 20 com reprovação.

**Migration SQL:** Nenhuma.

**APIs afetadas:** `POST /api/evaluate-image` — mudança interna de system prompt, sem mudança de contrato externo.

**UI afetada:** Nenhuma.

**Compatibilidade:** Total. Projects sem governance não têm mudança de comportamento.

**Rollback:** Reverter a mudança no system prompt do evaluator.

**Testes necessários:**
- Project sem governance: comportamento idêntico ao atual (M11-D)
- Project com restrictions: verificar que feedback menciona a restrição quando violada
- Project com restrictions: verificar que `refinedPrompt` corrige a violação
- Project com principles: verificar que principles aparecem no contexto do avaliador
- Smoke real com Alquimia Cibernética (executado em M11-F)

**Critério de aceite:**
- Violação de restriction detectada: mencionada em `feedback` e `improvements[]`
- `refinedPrompt` não repete a violação
- Projects sem governance: comportamento inalterado
- `tsc --noEmit`: 0 erros, `pnpm build`: PASS

**Pontos de parada obrigatória:**
- STOP antes de M11-F: smoke real com Alquimia antes de declarar M11-E completo

**Dependências:** M11-D (infrastructure de integração do evaluator com identity)

---

### M11-F — Migração dos Projects e Validação Comparativa

**Objetivo:** Migrar manualmente os 3 Projects existentes para o campo `identity`, via UI (M11-C). Validar que os agentes de geração e avaliação funcionam com a nova estrutura. A aprovação do usuário neste marco autoriza M11-G.

**Arquivos modificados:**
- Nenhum arquivo de código
- Dados migrados via UI (usuário preenche os campos de identity manualmente na página de cada Projeto)

**Conteúdo proposto para o Project Alquimia Cibernética:**

```json
{
  "schema_version": 1,
  "foundation": {
    "purpose": "A Alquimia Cibernética é uma plataforma de curadoria técnica e inteligência cultural. Realiza engenharia reversa de tradições ancestrais e sistemas simbólicos, tratando espiritualidade e cultura como tecnologias de governança da consciência."
  },
  "relationship": {
    "audience": "Criadores, pensadores e indivíduos que buscam síntese entre tecnologia, simbolismo e tradições culturais. Jovens adultos intelectualmente curiosos e insatisfeitos com conteúdo raso ou genérico."
  },
  "expression": {
    "visual_identity": "Fusão entre sistemas antigos (rituais, símbolos, mitologia) e estruturas modernas (tecnologia, interface, comportamento). Iluminação dramática, alto contraste, estética cinematográfica, atmosfera densa, visual simbólico, composição forte e centralizada, sensação de mistério e profundidade.",
    "voice": "Técnico mas acessível. Usa metáforas de engenharia e tecnologia para falar de espiritualidade. Abordagem estruturada com três eixos: Eixo A (O Código), Eixo B (A UX da Vida), Híbrido (O Debug)."
  },
  "governance": {
    "principles": [
      "Profundidade simbólica e conceitual em toda execução",
      "Síntese entre tecnologia e espiritualidade como perspectiva central",
      "Arqueologia cognitiva: passado como código-fonte do presente"
    ],
    "restrictions": [
      "Evitar representações literais simples ou óbvias",
      "Nunca usar aparência genérica ou estilo clean/corporativo",
      "Nunca linguagem de auto-ajuda superficial ou misticismo vago",
      "Evitar clichês visuais de espiritualidade sem contexto simbólico"
    ]
  },
  "practice": {
    "generation_preferences": [
      "Composição forte e centralizada",
      "Atmosfera densa e cinematográfica",
      "Iluminação com alto contraste"
    ]
  }
}
```

O usuário preenche a identity dos outros 2 Projects (Content Agent, Projeto teste) de forma análoga, com conteúdo próprio.

**Validação após migração:**
1. Gerar uma imagem com o Projeto Alquimia usando identity preenchida
2. Avaliar a imagem gerada — verificar que restrictions aparecem no feedback quando violadas
3. Comparar com uma geração anterior usando apenas context/style_profile
4. Validar que a qualidade de contexto é equivalente ou superior
5. Usuário aprova o resultado comparativo e autoriza M11-G

**Dados legados preservados:** `context` e `style_profile` permanecem intactos no banco após M11-F. A remoção só ocorre em M11-G (lógica) e M11-H (coluna).

**Migration SQL:** Nenhuma (dados editados via UI).

**Rollback:** Limpar o campo `identity` via UI (JSONB volta a null).

**Critério de aceite:**
- identity dos 3 Projects preenchida e salva com sucesso
- Geração de imagem com nova identity funciona corretamente
- Avaliador identifica violação de restriction quando presente
- Usuário aprova a qualidade do resultado comparativo

**Pontos de parada obrigatória:**
- STOP: aprovação humana da qualidade comparativa antes de autorizar M11-G

**Dependências:** M11-D e M11-E concluídos

---

### M11-G — Remoção Lógica de style_profile

**Objetivo:** Remover `style_profile` da UI (formulário e detalhe do Projeto), dos consumidores de IA (Prompt Generator, Image Evaluator, Feed Generator) e dos tipos operacionais (`CreateProjectForm`). A coluna permanece no banco e no tipo `Project` — a remoção física é M11-H.

**Pré-condição:** M11-F concluído e aprovado (identity dos 3 Projects preenchida e validada).

**Arquivos modificados:**

| Arquivo | Mudança |
|---------|---------|
| `components/projects/project-form.tsx` | Remover campo `style_profile` (TagInput) — formulário de criação/edição |
| `app/(dashboard)/projetos/[id]/page.tsx` | Remover caixa "Perfil de Estilo" da exibição |
| `lib/types.ts` | Remover `style_profile` de `CreateProjectForm` (mas manter em `Project` por enquanto) |
| `lib/ai-simulator.ts` | Remover passagem de `styleProfile` para o system prompt; usar apenas `buildImageGenerationContext()` |
| `app/api/evaluate-image/route.ts` | Remover leitura de `styleProfile` no body; usar apenas `buildImageEvaluationContext()` |
| `app/api/posts/generate-feed-text/route.ts` | Remover concatenação de `style_profile` no prompt |
| `app/(dashboard)/imagens/page.tsx` | Remover passagem de `project.style_profile` para os agentes |

**Migration SQL:** Nenhuma (coluna permanece).

**APIs afetadas:**
- `POST /api/evaluate-image` — remover campo `styleProfile` do contrato (breaking change interno, sem clientes externos)
- `app/(dashboard)/imagens/page.tsx` — remove passagem de `style_profile`

**UI afetada:**
- `ProjectForm` — sem campo `style_profile`
- `ProjectDetailPage` — sem caixa "Perfil de Estilo"

**Compatibilidade:** Projects existentes mantêm `style_profile` no banco (coluna não removida). A remoção da UI e dos consumidores é irreversível após deploy — dados no banco permanecem disponíveis para auditoria.

**Rollback:** Reverter os arquivos modificados; dados no banco intactos.

**Testes necessários:**
- Formulário de Project sem campo style_profile: criar e editar sem erro
- Geração de imagem com Alquimia: funciona apenas com identity
- Avaliação de imagem: funciona apenas com identity e context
- Feed Generator: prompt não menciona style_profile
- `tsc --noEmit`: 0 erros, `pnpm build`: PASS

**Critério de aceite:**
- Nenhum consumidor de IA referencia `style_profile` diretamente
- UI não exibe nem permite edição de `style_profile`
- `CreateProjectForm` não inclui `style_profile`
- Geração e avaliação funcionam corretamente apenas com identity

**Pontos de parada obrigatória:**
- STOP: auditoria final de dados antes de M11-H (confirmar que `style_profile` pode ser dropado)

**Dependências:** M11-F concluído e aprovado

---

### M11-H — DROP COLUMN style_profile

**Objetivo:** Remover a coluna `style_profile` do banco de dados e do tipo `Project`.

**Pré-condição:** M11-G concluído e em produção. Auditoria confirma zero usos ativos de `style_profile`.

**Arquivos modificados:**

| Arquivo | Mudança |
|---------|---------|
| `lib/types.ts` | Remover campo `style_profile: string \| null` do `Project` interface |
| Migration SQL | `ALTER TABLE projects DROP COLUMN style_profile` |

**Migration SQL:**

```sql
-- migration 021_drop_project_style_profile.sql
ALTER TABLE projects DROP COLUMN IF EXISTS style_profile;
```

**Auditoria pré-migration:**
```sql
-- Confirmar que todos os Projects têm identity preenchida (ou que style_profile é null para todos que serão afetados)
SELECT id, name, style_profile, identity IS NOT NULL as has_identity
FROM projects
WHERE user_id = '35428fd4-4784-4934-9af9-82a606aad77e';
```

**APIs afetadas:** Nenhuma — M11-G já removeu os consumidores.

**UI afetada:** Nenhuma — M11-G já removeu a UI.

**Compatibilidade:** Operação irreversível. Migration aplicada apenas após validação completa de M11-G.

**Rollback:** Não há rollback para DROP COLUMN. Se necessário, recriar a coluna e repopular manualmente. Por isso M11-G é separado — garante período de validação antes da operação irreversível.

**Critério de aceite:**
- Coluna `style_profile` removida do banco
- `Project` type sem `style_profile`
- `tsc --noEmit`: 0 erros, `pnpm build`: PASS
- SELECT em `projects` não retorna `style_profile`

**Pontos de parada obrigatória:**
- STOP antes da migration: confirmação explícita do usuário após auditoria

**Dependências:** M11-G concluído, em produção, validado

---

## Sequência Recomendada

```
M11-A  ←  Contrato executável: Zod + normalizer + formatters + testes unitários
   ↓
M11-B  ←  Migration identity JSONB + integração ao Project type
   ↓
M11-C  ←  UI progressiva de Project Identity na página do Projeto
   ↓
M11-D  ←  Consumo na geração (Prompt Generator + Image Evaluator)
   ↓
M11-E  ←  Consumo de governance no Image Evaluator
   ↓
M11-F  ←  Migração dos Projects existentes + validação comparativa
   ↓       (STOP: aprovação humana obrigatória)
M11-G  ←  Remoção lógica de style_profile (UI + consumidores + tipos)
   ↓       (STOP: auditoria de dados obrigatória)
M11-H  ←  DROP COLUMN style_profile após auditoria final
```

**M11-D e M11-E podem ser implementados no mesmo PR** — M11-E é um refinamento de M11-D. Devem ter checkpoints independentes.

**M11-F é o marco de validação humana** — só acontece quando M11-D e M11-E estão funcionando em produção.

**M11-G e M11-H são separados intencionalmente** — M11-H é irreversível e exige período de confirmação após M11-G.

---

## Definição de Pronto para a V1 Completa

A V1 de Project Identity estará completa após M11-H:

| # | Critério |
|---|---------|
| 1 | **Schema:** coluna `identity JSONB DEFAULT NULL` existe na tabela `projects` em produção |
| 2 | **Types:** `ProjectIdentity` inferido do Zod em `lib/schemas/project-identity.ts` |
| 3 | **Normalização:** `normalizeProjectIdentity()` garante que `{}` nunca é persistido |
| 4 | **Formatters:** `buildImageGenerationContext()` e `buildImageEvaluationContext()` em `lib/context-compiler.ts` |
| 5 | **UI:** seção "Identidade do Projeto" editável na página de qualquer Project |
| 6 | **Agentes:** Prompt Generator e Image Evaluator usam identity quando disponível, com fallback correto |
| 7 | **Governance:** `restrictions[]` identificado e refletido no score e `refinedPrompt` pelo avaliador |
| 8 | **Migração:** 3 Projects existentes têm identity preenchida e validada (M11-F) |
| 9 | **Remoção lógica:** `style_profile` removido de UI, consumidores e tipos operacionais (M11-G) |
| 10 | **DROP COLUMN:** `style_profile` removido do banco e do tipo `Project` (M11-H) |
| 11 | **context preservado:** campo `context` intacto — permanece como narrativa geral livre |
| 12 | **Qualidade:** `tsc --noEmit` 0 erros, `eslint` 0 erros / baseline de warnings mantido, `pnpm build` PASS |
| 13 | **Rollback documentado:** cada marco tem rollback identificado |

---

## Recomendação Final

**Status: PROJECT IDENTITY V1 DECISIONS FINALIZED — READY FOR M11-A**

Todas as decisões bloqueantes foram resolvidas:
- **D-BLOCKER-1:** shape aprovado com alterações — 5 zonas, 7 campos + `schema_version: 1`
- **D-BLOCKER-2:** campos legados permanecem visíveis até M11-G; sem comportamento condicional em M11-C

O risco técnico global da V1 é BAIXO:
- Nenhum código de produção existente é quebrado em M11-A, M11-B ou M11-C
- Todos os novos campos são opcionais
- Os agentes têm fallback completo para o comportamento atual (M11-D/E)
- A migration de adição é simples e reversível
- A migração de dados é manual e controlada pelo usuário (M11-F)
- M11-G e M11-H são separados — DROP COLUMN só acontece após validação humana explícita

A V1 entrega Project Identity estruturada, governa `style_profile` até sua remoção limpa,
e preserva `context` como narrativa geral permanente. A única operação irreversível (M11-H)
está isolada no último marco, com checkpoint obrigatório.

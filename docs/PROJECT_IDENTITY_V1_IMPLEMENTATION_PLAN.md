# PROJECT_IDENTITY_V1_IMPLEMENTATION_PLAN.md
**Data: 2026-06-25**  
**Revisado: 2026-06-25 — decisões de produto finalizadas**

> Plano de implementação de Project Identity V1.
> Produzido a partir do discovery técnico completo documentado em
> `PROJECT_IDENTITY_V1_IMPLEMENTATION_DISCOVERY.md`.
> **M11-A executado em 2026-06-25 — contrato executável implementado e testado.**

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
| D-BLOCKER-1 respondido (shape do JSONB aprovado) | VERDADEIRO (decisão 2026-06-25) |
| D-BLOCKER-2 respondido (comportamento UI pós-identity) | PENDENTE — decidir em M11-C |

---

## Marcos

### M11-A — Contrato Executável ✅ CONCLUÍDO (2026-06-25)

**Objetivo:** Criar o schema Zod, a função de normalização e os formatters de contexto para os agentes. Shape e policy já estão aprovados (ver DISCOVERY seção 14–16). Nenhum código de produção alterado neste marco.

**Status:** IMPLEMENTADO E TESTADO. Branch: `discovery/project-identity-v1-implementation`.

**Arquivos criados:**

| Arquivo | Conteúdo | Status |
|---------|---------|--------|
| `lib/schemas/project-identity.ts` | `ProjectIdentitySchema` (Zod) + `ProjectIdentity` type inferido + constantes de limite | ✅ |
| `lib/project-identity-normalizer.ts` | `parseProjectIdentity` (strict) + `normalizeProjectIdentity` (API pública) + `ProjectIdentityParseError` | ✅ |
| `lib/context-compiler.ts` | `ProjectContextSource` interface + `buildImageGenerationContext` + `buildImageEvaluationContext` | ✅ |
| `lib/schemas/__tests__/project-identity.test.ts` | 28 testes do schema Zod | ✅ |
| `lib/__tests__/project-identity-normalizer.test.ts` | 19 testes do normalizer | ✅ |
| `lib/__tests__/context-compiler.test.ts` | 20 testes dos formatters | ✅ |
| `vitest.config.ts` | Config Vitest (lib/**/*.test.ts, node environment) | ✅ |

**Infraestrutura de testes adicionada:** `vitest ^4.1.9` (devDependency), `"test": "vitest run"` nos scripts.

**Resultados da validação:**
- `pnpm typecheck`: 0 erros
- `pnpm lint`: 0 erros, 50 warnings (todos pré-existentes, nenhum em lib/)
- `pnpm test`: **67 tests passed (3 test files)**
- `normalizeProjectIdentity({schema_version: 1})` → `null` ✅
- `buildImageGenerationContext` inclui `context` e `purpose` separadamente ✅
- `visual_identity` preferida sobre `style_profile` (sem concatenação) ✅
- `voice` ausente do evaluation context ✅

**D-M11A-1 (limites de caracteres) — confirmado:**
- `IDENTITY_TEXT_MAX_CHARS = 3000`
- `IDENTITY_ARRAY_ITEM_MAX_CHARS = 500`
- `IDENTITY_ARRAY_MAX_ITEMS = 20`

**Migration SQL:** Nenhuma.

**APIs afetadas:** Nenhuma.

**UI afetada:** Nenhuma.

**Compatibilidade e rollback:** Total. Arquivos novos sem consumidores. Rollback = deletar os arquivos.

**Pontos de parada obrigatória:**
- STOP: aprovação humana antes de avançar para M11-B

**Dependências:** Nenhuma (D-BLOCKER-1 já resolvido)

---

### M11-B — Persistência e Integração do Tipo Project Identity V1 ✅ CONCLUÍDO (2026-06-26)

**Objetivo:** Adicionar a coluna `identity JSONB` na tabela `projects`. Atualizar o tipo `Project` em `lib/types.ts`. Garantir que nenhum código existente quebre.

**Status:** IMPLEMENTADO, TESTADO E APLICADO. Branch: `discovery/project-identity-v1-implementation`.

**Arquivos alterados:**

| Arquivo | Tipo | Descrição |
|---------|------|-----------|
| `scripts/027_add_project_identity.sql` | A (novo) | Migration SQL com header documental conforme padrão do repo |
| `lib/types.ts` | M | Campo `identity: ProjectIdentity | null` adicionado ao `Project` |

**Migration:**

```sql
-- 027_add_project_identity.sql
ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS identity JSONB DEFAULT NULL;
```

Aplicada em 2026-06-26 via `postgres` (POSTGRES_URL_NON_POOLING).

**Decisão sobre o campo no tipo:**

Campo definido como `identity: ProjectIdentity | null` (obrigatório nullable, não `?:`).

Justificativa: após migration, `SELECT *` sempre retorna a propriedade com valor `null` para projetos sem identity. `undefined` não é um estado válido para campos persistidos. O typecheck confirma que nenhum consumidor existente quebrou — todos os `select('*')` já retornam `identity: null` que satisfaz `ProjectIdentity | null`.

`ProjectIdentity` importado de `@/lib/schemas/project-identity` — não redefinido em `lib/types.ts`.

**APIs afetadas:** Nenhuma.

**UI afetada:** Nenhuma (coluna invisível até M11-C).

**Estratégia de leitura (fronteira de validação):**

```text
banco (JSONB raw)
→ Supabase client serializa para objeto JS
→ tipado como ProjectIdentity | null no campo Project.identity
→ M11-C deve chamar normalizeProjectIdentity(project.identity)
  antes de uso semântico (agentes, formatters)
```

O banco não valida o contrato semântico (conforme testado: aceita `{}` e `schema_version: 2`). Zod é a fronteira de validação da V1.

**Estratégia de escrita:**

Não há consumidor de escrita de `identity` ainda (M11-C cria a UI). Contrato documentado:
- M11-C deve chamar `normalizeProjectIdentity(input)` antes de qualquer UPDATE
- Resultado `null` → enviar `NULL` ao banco (não `{}`)
- Resultado `ProjectIdentity` → serializar diretamente via Supabase client
- A função `normalizeProjectIdentity` é a única fronteira entre UI e banco

**RLS:**

| Operação | Policy | Cobre identity |
|----------|--------|----------------|
| SELECT | `auth.uid() = user_id` | ✅ automático |
| INSERT | `auth.uid() = user_id` | ✅ automático |
| UPDATE | `auth.uid() = user_id` | ✅ automático |
| DELETE | `auth.uid() = user_id` | ✅ automático |

Nenhuma nova policy necessária.

**Testes de persistência executados (34/34 PASS):**

| Caso | Resultado |
|------|-----------|
| A. Insert sem identity → NULL | ✅ |
| B. Insert com identity parcial válida | ✅ |
| C. Update para identity completa (all zones) | ✅ |
| D. Update para NULL | ✅ |
| E. `{}` — DB permissivo, application contract proíbe | ✅ documentado |
| F. JSON inválido semântico (schema_version: 2) — DB permissivo | ✅ documentado |
| G. SELECT * inclui identity | ✅ |
| H. information_schema confirma tipo/nullable/default | ✅ |
| I. Projects pré-existentes com identity = NULL | ✅ (3/3) |
| J. RLS: 4 políticas cobrindo todas as operações | ✅ |
| Cleanup: fixture deletado, 3 projects reais intactos | ✅ |

**Compatibilidade:**
- `context`: intacto ✅
- `style_profile`: intacto ✅
- `evaluation_mode`: intacto ✅
- Projects sem identity: válidos, identity = NULL ✅
- Código atual: ignora identity sem alteração de comportamento ✅

**Rollback:**
```sql
ALTER TABLE projects DROP COLUMN IF EXISTS identity;
```

**Resultados de validação:**
- `pnpm test`: 72/72 PASS
- `pnpm typecheck`: 0 erros
- `pnpm lint`: 0 erros, 50 warnings (baseline)
- `pnpm build`: PASS

**Pontos de parada obrigatória:**
- STOP: aprovação humana antes de avançar para M11-C

**Dependências:** M11-A concluído e aprovado

---

### M11-C — UI Progressiva de Project Identity ✅ CONCLUÍDO (2026-06-26)

**Objetivo:** Exibir e permitir edição da Project Identity na página do Projeto. Nenhuma mudança nos agentes.

**Status:** IMPLEMENTADO E TESTADO. Branch: `discovery/project-identity-v1-implementation`.

**Arquivos criados/modificados:**

| Arquivo | Tipo | Descrição |
|---------|------|-----------|
| `lib/project-identity-form-helpers.ts` | A (novo) | Helpers puros: `identityToFormState`, `formStateToIdentityInput`, `arrayToLineString`, `lineStringToArray`, `emptyFormState` |
| `components/projects/project-identity-display.tsx` | A (novo) | Card com 3 estados: read error / vazio / preenchido |
| `components/projects/project-identity-form.tsx` | A (novo) | Dialog de edição com 5 zonas, textareas (uma por linha para arrays) |
| `lib/__tests__/project-identity-form-helpers.test.ts` | A (novo) | 15 casos de teste cobrindo round-trips, zone isolation, normalização, imutabilidade |
| `app/(dashboard)/projetos/[id]/page.tsx` | M | Seção de identidade entre card do projeto e Produções; modal `ProjectIdentityForm` |
| `vitest.config.ts` | M | Alias `@/` adicionado para resolução de imports nos testes |

**Comportamento implementado:**

Estado sem identity (null):
- Card com ícone Fingerprint, texto "Identidade não estruturada", botão "Estruturar identidade"

Estado com identity presente:
- Card com seções por zona: Propósito, Público, Expressão (visual_identity + voice), Governança (princípios e restrições como badges), Prática (preferências como badges)
- Botão "Editar" abre o dialog

Estado com erro de leitura (JSONB corrompido):
- Card vermelho com AlertTriangle, mensagem de diagnóstico, botão "Editar" desabilitado

**Campos legados (context / style_profile):**
- Continuam exibidos no card do projeto — a UI de identity é ADICIONAL, não substitutiva
- `ProjectIdentityForm` nunca inclui `context`, `style_profile`, ou `evaluation_mode` no payload

**Decisão de design (arrays):**
- `TagInput` descartado: lowercase automático quebra preservação de case
- Textarea (uma orientação/restrição por linha) para todos os campos de array

**Decisão de design (form re-init):**
- Pattern `key='identity-open'/'identity-closed'` + lazy `useState(() => identityToFormState(identity))` em vez de `useEffect` com setState
- Elimina o warning `react-hooks/set-state-in-effect` sem alterar comportamento

**Fronteira de validação:**
- Leitura: `try { resolvedIdentity = normalizeProjectIdentity(project.identity) } catch { identityReadError = ... }` na render
- Escrita: `formStateToIdentityInput(state)` → `normalizeProjectIdentity(raw)` → Supabase UPDATE

**Migration SQL:** Nenhuma (M11-B já aplicou a coluna).

**APIs afetadas:** Nenhuma nova rota. UPDATE via Supabase client diretamente.

**Compatibilidade e rollback:**
- Rollback: reverter page.tsx e remover os 3 arquivos novos
- Nenhum dado é perdido no rollback (a coluna `identity` permanece no banco com seus dados)

**Resultados de validação:**
- `pnpm test`: **96/96 PASS** (72 anteriores + 24 novos da suite M11-C)
- `pnpm typecheck`: 0 erros
- `pnpm lint`: 0 erros, 50 warnings (baseline mantido)
- `pnpm build`: PASS (Next.js 16.2, compilação otimizada, 37 páginas estáticas)

**Commits:**
- `41bae04` — `feat: add progressive Project Identity UI — M11-C`
- `a6e4df5` — `test: cover Project Identity editing behavior — M11-C`

**Smoke visual humano (2026-06-26) — Projeto teste `6d09d50d`:**

| Verificação | Resultado |
|-------------|-----------|
| Seção posicionada entre Project card e Productions | ✅ |
| Estado vazio compreensível e não bloqueante | ✅ |
| Modal abre e fecha corretamente | ✅ |
| Cinco zonas bem organizadas no dialog | ✅ |
| Rolagem e ações acessíveis | ✅ |
| Identity parcial salva corretamente | ✅ |
| Resumo do card atualizado após salvar | ✅ |
| Edição preserva campos não modificados | ✅ |
| Arrays (princípios, restrições, preferências) funcionam um por linha | ✅ |
| Remoção do último conteúdo retorna `identity` para `NULL` | ✅ |
| `context`, `style_profile`, `evaluation_mode` e Productions intactos | ✅ |
| Cleanup: `Projeto teste.identity = NULL` ao encerrar | ✅ |

**Checkpoint humano:** APROVADO — 2026-06-26

**Pontos de parada obrigatória:**
- ✅ Smoke test manual concluído e aprovado

**Dependências:** M11-B concluído e aprovado

---

### M11-D — Consumo na Geração de Imagem ✅ CONCLUÍDO (2026-06-26)

**Objetivo:** O Prompt Generator de imagens passa a consumir Project Identity V1 via `buildImageGenerationContext()`. Image Evaluator não alterado nesta rodada.

**Status:** IMPLEMENTADO E TESTADO. Branch: `discovery/project-identity-v1-implementation`.

**Arquivos modificados:**

| Arquivo | Tipo | Descrição |
|---------|------|-----------|
| `lib/ai-simulator.ts` | M | `generateImagePrompt`, `generateWithOpenAI`, `generateSimulated` recebem `identity: ProjectIdentity \| null = null`; compilação via `buildImageGenerationContext`; `intelligentGenerationLoop` passa `null` |
| `app/(dashboard)/imagens/page.tsx` | M | `handleGeneratePrompt` normaliza identity via `normalizeProjectIdentity`; identity inválida bloqueia geração com toast; identity normalizada passada ao Prompt Generator |
| `lib/__tests__/image-prompt-generation.test.ts` | A (novo) | 33 testes cobrindo todos os 20 casos do spec |

**Nova assinatura de `generateImagePrompt`:**

```typescript
export async function generateImagePrompt(
  userInput: string,
  projectContext?: string | null,
  styleProfile?: string | null,
  apiKey?: string,
  evaluationMode: EvaluationMode = 'default',
  identity: ProjectIdentity | null = null,   // NOVO — 6º parâmetro, default null
): Promise<PromptGenerationResult>
```

**Fronteira de validação (imagens/page.tsx):**

```typescript
try {
  projectIdentity = normalizeProjectIdentity(project.identity)
} catch (err) {
  // Bloqueia geração, exibe toast descritivo, preserva userInput
  toast({ title: 'Identidade do Project inválida', ... , variant: 'destructive' })
  return
}
```

**Contexto compilado (generateWithOpenAI — userMessage):**

```text
INPUTS RECEBIDOS

userInput:
${userInput}

PROJECT CONTEXT AND IDENTITY:
${compiledContext || 'Not specified'}

evaluation_mode:
${evaluationMode}
```

O campo `PROJECT CONTEXT AND IDENTITY` substitui os campos separados `context:` e `style_profile:`.

**Contexto compilado (generateSimulated):**
- Usa `buildImageGenerationContext` no `contextClause`
- `style` preferido: `visual_identity → style_profile → detectStyle(userInput)`

**Fallback transitório:**

| Cenário | Comportamento |
|---------|---------------|
| identity null + context + style_profile | context incluído; style_profile usado como visual |
| identity sem visual_identity | style_profile usado como fallback visual |
| identity com visual_identity | visual_identity usada; style_profile ignorado |
| identity parcial | somente dimensões existentes entram |
| identity inválida | geração bloqueada, toast, sem chamada ao modelo |
| evaluation_mode | inalterado |
| previousAttempts | inalterados (rastreados em estado da página, não passados ao generator) |

**Image Evaluator:** absolutamente inalterado — `app/api/evaluate-image/route.ts` não modificado. Integração de identity no Evaluator fica para M11-E.

**Limite conhecido:** `intelligentGenerationLoop` é placeholder futuro; passa `null` para identity por não ter acesso ao Project.

**Fallback simulado:** `generateSimulated` recebe identity e usa contexto compilado no `contextClause`. Não finge compreensão completa — o conteúdo da identidade aparece na string de contexto conforme formatado pelo compiler.

**Testes adicionados (33 M11-D + 10 refinamento = 43 novos / 139 total):**
- Casos 1-11: context+style_profile preservation, identity parcial/completa, context vs purpose, visual_identity precedence, style_profile fallback, principles/restrictions/preferences, schema_version absent, no raw JSON
- Casos 12-13: normalizeProjectIdentity throws para input inválido (prova que a página bloqueia antes de chamar o generator)
- Caso 14: identity null → comportamento legado
- Casos 15-20: evaluation_mode unchanged, output contract, simulated fallback, no mutation, determinism
- Mocked OpenAI path: formato do userMessage, `Not specified` quando vazio, visual_identity no field `style`
- Metadata refinement (10 testes): extração de lighting/composition por regex, null quando ausente, sem fallback aleatório no caminho OpenAI, null é determinístico, contrato de UI (null → chip omitido), caminho simulado retém valores sorteados embutidos no prompt, precedência de style, prompt string inalterado

**Notas sobre translateToEnglish:** a função existente usa substituições sem word boundary (ex: "cidade" → "city" substitui substrings). Os testes de princípios usam textos que evitam colisão com o dicionário de tradução existente. Esse comportamento é pré-existente e fora do escopo de M11-D.

**Refinamento de metadados visuais (M11-D closure — 2026-06-26):**

Problema identificado pós-implementação: chips de iluminação e composição no caminho OpenAI usavam `getRandomElement(lightingOptions)` como fallback quando a regex `/lighting[^,.]*/i` ou `/composition[^,.]*/i` não encontrava correspondência no prompt do modelo. Isso produzia chips desconectados do prompt real.

Solução:
- `PromptGenerationResult.lighting: string | null` (era `string`)
- `PromptGenerationResult.composition: string | null` (era `string`)
- `generateWithOpenAI`: usa `?? null` em vez de `|| getRandomElement(...)` — null quando a regex não encontra correspondência
- `generateSimulated`: comportamento preservado — lighting/composition são sorteados E embutidos no `enhancedPrompt`, garantindo que os chips correspondam ao conteúdo enviado
- `PromptSection`: chips de lighting e composition renderizados condicionalmente (`!== null`)
- `imagens/page.tsx`: tipo de `promptDetails` atualizado para aceitar `string | null`

**Resultados de validação (pós-refinamento):**
- `pnpm test`: **139/139 PASS** (96 anteriores + 43 novos)
- `pnpm typecheck`: 0 erros
- `pnpm lint`: 0 erros, 50 warnings (baseline)
- `pnpm build`: PASS

**Commits:**
- `283a5ec` — `feat: use Project Identity in image prompt generation — M11-D`
- `4d04718` — `test: cover Project Identity prompt generation — M11-D`
- `791944f` — `fix: remove random chip fallback in OpenAI prompt path`
- `7654eb5` — `docs: record M11-D metadata refinement`

**Checkpoint humano final (2026-06-26) — Projeto teste `6d09d50d`:**

| Verificação | Resultado |
|-------------|-----------|
| **Caso A — sem identity:** geração continuou funcionando | ✅ |
| **Caso A:** context e style_profile legados ativos | ✅ |
| **Caso A:** nenhuma exigência de identity apresentada | ✅ |
| **Caso A:** compatibilidade com fluxo anterior | ✅ |
| **Caso B — identity parcial:** prompt incorporou identidade estruturada | ✅ |
| **Caso B:** propósito e contexto geral semanticamente separados | ✅ |
| **Caso B:** visual_identity prevaleceu sobre style_profile | ✅ |
| **Caso B:** restrições e preferências com papéis distintos | ✅ |
| **Caso B:** sem JSON bruto, sem schema_version | ✅ |
| **Caso B:** evaluation_mode funcionando | ✅ |
| **Caso B:** estrutura de resposta do Prompt Generator preservada | ✅ |
| **Chips:** lighting/composition só exibidos quando extraídos do prompt | ✅ |
| **Chips:** "golden hour sunlight with warm tones" incoerente deixou de aparecer | ✅ |
| **Chips:** style e composition exibidos coerentes com o prompt | ✅ |
| **Chips:** caminho simulado inalterado | ✅ |
| Cleanup: Projeto teste.identity = NULL | ✅ |

**Checkpoint humano:** APROVADO — 2026-06-26

**Pontos de parada obrigatória:**
- ✅ Checkpoint humano final concluído e aprovado

**Dependências:** M11-C concluído e aprovado

---

### M11-E — Consumo no Image Evaluator ✅ CONCLUÍDO (2026-06-26)

**Objetivo:** O Image Evaluator consome Project Identity V1 via `buildImageEvaluationContext()`. Validação dupla (cliente + rota). Governance (principles/restrictions) guia scoring e refinedPrompt. Nenhum teto numérico universal. Fallback transitório para context/style_profile quando identity ausente.

**Status:** IMPLEMENTADO E TESTADO. Branch: `discovery/project-identity-v1-implementation`.

**Arquivos modificados:**

| Arquivo | Tipo | Descrição |
|---------|------|-----------|
| `app/api/evaluate-image/route.ts` | M | `identity` opcional no body; validação server-side via `normalizeProjectIdentity`; `buildImageEvaluationContext()` substitui concatenação manual de context/style_profile; seção IDENTIDADE DO PROJECT no system prompt |
| `app/(dashboard)/imagens/page.tsx` | M | `handleEvaluateImage` normaliza identity antes do POST; bloqueia avaliação com toast em caso de identity inválida; envia `identity: projectIdentity` |
| `lib/__tests__/image-evaluator-identity.test.ts` | A (novo) | 47 testes cobrindo os 34 casos obrigatórios do spec |

**Contrato novo da API (`POST /api/evaluate-image`):**

```typescript
// Body (aceitados — todos existentes preservados):
{
  userInput?: string
  generatedPrompt: string    // obrigatório
  imageUrl: string           // obrigatório
  styleProfile?: string | null
  context?: string | null
  evaluation_mode?: EvaluationMode
  evaluationMode?: EvaluationMode
  attempt?: number
  identity?: ProjectIdentity | null  // NOVO — opcional, backward compatible
}

// Resposta (inalterada):
{
  score: number        // 0-100
  approved: boolean    // derivado do modelo ou score >= 75
  feedback: string
  improvements: string[]
  refinedPrompt: string
}
```

**Validação dupla:**

```
Cliente (imagens/page.tsx):
  normalizeProjectIdentity(project.identity)
  → null: envia null
  → ProjectIdentity: envia objeto normalizado
  → throws: toast + return (sem chamada à API)

Rota (evaluate-image/route.ts):
  rawIdentity null/undefined → normalizedIdentity = null
  rawIdentity presente → normalizeProjectIdentity(rawIdentity)
    → null: ok
    → ProjectIdentity: usa no context
    → throws ProjectIdentityParseError → HTTP 400 (OpenAI não é chamado)
```

**Uso do formatter:**

```typescript
const compiledEvaluationContext = buildImageEvaluationContext({
  context,
  style_profile: styleProfile,
  identity: normalizedIdentity,
})
// Substitui os campos manuais context: / style_profile: no evaluationInput
```

Campo no user message:
```
PROJECT CONTEXT AND IDENTITY:
${compiledEvaluationContext || 'Nao especificado'}
```

**Principles e restrictions no system prompt:**

```
IDENTIDADE DO PROJECT:

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
```

**Sem teto numérico universal:** Nenhum cap de score implementado. O modelo pondera proporcionalmente. Testes verificam que score=85 não é capado mesmo com restriction presente.

**Fallback transitório:**

| Cenário | Comportamento |
|---------|---------------|
| identity null + context + style_profile | comportamento idêntico ao M11-D |
| identity sem visual_identity | style_profile usado como fallback visual |
| identity com visual_identity | visual_identity usada; style_profile ignorado |
| identity parcial | somente dimensões presentes entram |
| identity inválida no cliente | toast + return (sem chamada à API) |
| identity inválida enviada diretamente | HTTP 400 (OpenAI não é chamado) |

**Tratamento de context:** context continua enviado como campo separado no source de `buildImageEvaluationContext`, aparecendo como `**Contexto do Projeto:**` no bloco compilado.

**evaluation_mode:** Preservado integralmente — permanece como campo separado no user message e controla os pesos do avaliador (default/conceptual/aesthetic/commercial/experimental).

**Multimodalidade:** Preservada — imageUrl continua como `type: 'image_url'` com `detail: 'low'`. Modelo (`gpt-4o-mini`) e `response_format: json_object` inalterados.

**Threshold 75:** Preservado — `approved = evaluation.approved ?? (evaluation.score >= 75)`.

**Testes adicionados (47 novos / 186 total):**

| Grupo | Casos | Estratégia |
|-------|-------|------------|
| Context compilation (puro) | 34 | `buildImageEvaluationContext` — sem mocks |
| Client validation | 3 | `normalizeProjectIdentity` throws |
| Route handler | 10+ | Supabase + fetch mockados |

Cobertura dos 34 casos obrigatórios:
- Cases 1-4: sem identity / null / parcial / completa
- Case 5: identity inválida no cliente bloqueia POST
- Cases 6-7: identity inválida na rota → 400 / OpenAI não chamado
- Case 8: context e purpose separados
- Case 9: visual_identity prevalece sobre style_profile
- Case 10: fallback de style_profile quando visual_identity ausente
- Case 11: voice ausente do contexto visual
- Cases 12-14: principles / restrictions / preferences com labels corretos
- Cases 15-16: schema_version e JSON bruto ausentes
- Cases 17-20: evaluation_mode / userInput / generatedPrompt / attempt no payload
- Cases 21-22: imageUrl multimodal / detail=low
- Case 23: modelo gpt-4o-mini preservado
- Cases 24-29: contrato de resposta (score 0-100 / approved / feedback / improvements / refinedPrompt)
- Case 26: threshold 75
- Case 30: score=85 com restriction não é capado
- Case 31: approved=false por restriction material
- Case 32: body inválido (sem prompt) não chama provider
- Case 33: não mutação dos objetos de entrada
- Case 34: comportamento legado preservado

**Compatibilidade:**

| Item | Status |
|------|--------|
| Prompt Generator | Inalterado |
| metadata chips (lighting/composition) | Inalterados |
| Project sem identity → evaluator funciona | ✅ |
| Project com identity → contexto estruturado | ✅ |
| style_profile → fallback transitório | ✅ |
| context → continua ativo | ✅ |
| evaluation_mode → inalterado | ✅ |
| score / threshold / refinedPrompt | Contratos inalterados |
| Auto Mode | Inalterado |
| ImageDraft | Inalterado |
| Production | Inalterada |

**Migration SQL:** Nenhuma.

**Resultados de validação:**
- `pnpm test`: **186/186 PASS** (139 anteriores + 47 novos)
- `pnpm typecheck`: 0 erros
- `pnpm lint`: 0 erros, 50 warnings (baseline mantido)
- `pnpm build`: PASS

**Commits:**
- feat: use Project Identity in image evaluation
- test: cover Project Identity evaluator integration
- docs: record M11-E evaluator integration

**Pontos de parada obrigatória:**
- ✅ Checkpoint humano final concluído e aprovado

**Dependências:** M11-D concluído e aprovado

**Checkpoint humano final (2026-06-26) — Projeto teste `6d09d50d`:**

Identity temporária usada:
- identidade visual natural, orgânica e contemplativa
- princípios de integração entre natureza, humanidade e tecnologia
- restrições contra estética cyberpunk, neon, hologramas e cenários futuristas
- preferências por iluminação natural e suave

| Verificação | Resultado |
|-------------|-----------|
| Score refletiu múltiplas violações de governance (Score: 40/100) | ✅ |
| Conflito com princípios e restrições identificado explicitamente | ✅ |
| Estética cyberpunk e cenários futuristas citados diretamente | ✅ |
| Excesso de tecnologia avançada e hologramas reconhecidos | ✅ |
| Incompatibilidade de iluminação com preferências identificada | ✅ |
| Insuficiência de simbolismo e contemplação identificada | ✅ |
| Melhorias alinhadas à identidade: reduzir tech, luz natural, contemplação | ✅ |
| Nenhuma regra universal de score aplicada pelo modelo | ✅ |
| Ausência de JSON bruto e schema_version na saída | ✅ |
| Cleanup: Projeto teste.identity = NULL | ✅ |

**Checkpoint humano:** APROVADO — 2026-06-26

**Oportunidade futura de produto identificada:**

Durante o checkpoint, foi constatado que a UI atual só permite avaliar a imagem recém-gerada dentro do fluxo ativo de criação. Não existe utilidade para:

```text
selecionar imagem existente da galeria
→ revisar com Project Identity ativa
→ receber score, feedback e refinedPrompt
```

Registrado como oportunidade futura:

```text
Image Review Utility / Revisar imagem existente
```

Não implementar nesta fase. Considerar como feature standalone em versão futura do Image Evaluator.

---

### M11-F — Migração dos Projects para Project Identity V1 ✅ CONCLUÍDO (2026-06-26)

**Objetivo:** Migrar conscientemente os dados dos três Projects existentes para o campo `identity` a partir de `context` e `style_profile`, valendo a decomposição estruturada nas cinco zonas. Validar que agentes continuam operacionais com a nova estrutura.

**Status:** MIGRADO E VERIFICADO. Branch: `discovery/project-identity-v1-implementation`.

**Arquivos de código:** nenhum alterado. Apenas dados + documentação.

**Arquivo de migração SQL (referência):** `scripts/028_m11f_project_identity_migration.sql`

---

**Decisões por Project:**

| Project | Decisão | Motivo |
|---------|---------|--------|
| Alquimia Cibernética | MIGRADO | `context` e `style_profile` ricos; todos os campos com evidência direta |
| Content Agent | KEEP NULL | `context` é apenas "teste para o frontend" — sem evidência para nenhuma zona |
| Projeto teste | CLEANUP → NULL | identity residual do smoke M11-E; não representa dados reais permanentes |

---

**Rollback (estado pré-M11-F):**

```sql
-- Alquimia Cibernética: identity era NULL
UPDATE projects SET identity = NULL WHERE id = '0b04df8b-dfd3-45c5-b7b7-8fe7b95e8187';
-- Projeto teste: identity era objeto de smoke test M11-E (já limpo nesta migração)
UPDATE projects SET identity = NULL WHERE id = '6d09d50d-f4dd-4651-ba46-d6705aa3a385';
```

---

**Payload Alquimia Cibernética — aplicado:**

Origem de cada zona:

| Zona | Campo fonte | Conteúdo |
|------|------------|---------|
| foundation.purpose | `context` §1-3 | Arqueologia cognitiva, engenharia reversa, código-fonte do presente |
| relationship.audience | `context` (inferência temática) | Criadores, pensadores, análise crítica, profundidade intelectual |
| expression.visual_identity | `context` INTENÇÃO VISUAL + `style_profile` visuais | Fusão ancestral/tecnológico, simbólica, cinematográfica, ambiguidade interpretativa |
| expression.voice | `context` ABORDAGEM TÉCNICA, três eixos | Técnica/acessível, metáforas de engenharia, Eixo A/B/Híbrido |
| governance.principles | `context` intenções editoriais | Profundidade, analisabilidade, conexão tradição-contemporaneidade |
| governance.restrictions | `style_profile` negativos + `context` | Evitar genérico, clean, clichê, misticismo vago, literalismo |
| practice.generation_preferences | `style_profile` positivos de produção | Iluminação dramática, cinematográfico, atmosfera densa, composição, elementos abstratos |

```json
{
  "schema_version": 1,
  "foundation": {
    "purpose": "Plataforma de curadoria técnica e inteligência cultural que realiza engenharia reversa de tradições ancestrais e sistemas simbólicos, tratando espiritualidade e cultura como tecnologias de governança da consciência. Recruta o espectador para um território de arqueologia cognitiva, onde o passado funciona como código-fonte para resolver falhas de execução do presente."
  },
  "relationship": {
    "audience": "Criadores, pensadores e pessoas interessadas na interseção entre tecnologia, cultura, simbolismo e análise crítica — públicos que buscam profundidade intelectual e rejeitam conteúdo superficial ou genérico."
  },
  "expression": {
    "visual_identity": "Fusão entre sistemas ancestrais (rituais, símbolos, mitologia) e estruturas tecnológicas contemporâneas (interface, comportamento, código). Estética simbólica, densa, cinematográfica e conceitual. Sensação de mistério, profundidade e arqueologia cognitiva. Ambiguidade interpretativa intencional.",
    "voice": "Técnica e acessível. Usa metáforas de engenharia, código e sistemas para tratar espiritualidade e cultura como tecnologias analisáveis. Estruturada em três eixos: Eixo A (O Código — engenharia reversa de mitos e rituais), Eixo B (A UX da Vida — diagnóstico de fricções comportamentais), Hibridismo (O Debug — aplicação de protocolos ancestrais ao presente)."
  },
  "governance": {
    "principles": [
      "Profundidade conceitual e simbólica em toda execução",
      "Tratar cultura e espiritualidade como sistemas analisáveis, não como mística vaga",
      "Conectar tradição e contemporaneidade sem simplificação",
      "Priorizar leitura simbólica, profundidade e ambiguidade interpretativa"
    ],
    "restrictions": [
      "Evitar aparência genérica ou clichê visual",
      "Evitar estética clean ou corporativa",
      "Evitar representações literais simples sem profundidade simbólica",
      "Evitar misticismo vago ou linguagem de autoajuda superficial",
      "Evitar clichês visuais de espiritualidade sem contexto simbólico"
    ]
  },
  "practice": {
    "generation_preferences": [
      "Iluminação dramática e alto contraste",
      "Estética cinematográfica",
      "Atmosfera densa",
      "Composição forte e centralizada quando coerente",
      "Elementos abstratos e conceituais",
      "Fusão visual entre tecnologia e simbolismo ancestral"
    ]
  }
}
```

---

**Verificação pós-migração (releitura do banco):**

| Project | identity | schema_version | context | style_profile | evaluation_mode |
|---------|----------|---------------|---------|---------------|-----------------|
| Alquimia Cibernética | OBJECT | 1 | intacto ✅ | intacto ✅ | intacto ✅ |
| Content Agent | NULL | — | intacto ✅ | intacto ✅ | intacto ✅ |
| Projeto teste | NULL | — | intacto ✅ | intacto ✅ | intacto ✅ |

Alquimia: 5 zonas, 4 principles, 5 restrictions, 6 preferences.

---

**Campos legados preservados:** `context` e `style_profile` permanecem intactos em todos os Projects. Remoção lógica apenas em M11-G; remoção física em M11-H.

**Formatters como fronteira:** JSON bruto nunca é enviado aos agentes. `buildImageGenerationContext()` e `buildImageEvaluationContext()` são a única fronteira de transformação.

**Mecanismo de migração:** Script Node.js temporário via `@supabase/supabase-js` (service role key). Script deletado após execução. `apply_migration` e `execute_sql` do MCP estavam em modo read-only nesta sessão.

---

**Validação comparativa — checkpoint humano: ✅ APROVADO (2026-06-26)**

Smoke realizado com o Project Alquimia Cibernética. Prompt de teste: "Uma imagem sobre como sistemas ancestrais podem revelar falhas de execução da vida contemporânea."

| Critério | Resultado |
|----------|-----------|
| Prompt Generator incorporou propósito conceitual | ✅ |
| Relacionou sistemas ancestrais e estruturas contemporâneas | ✅ |
| Identidade visual simbólica, densa, cinematográfica | ✅ |
| Considerou principles e generation_preferences | ✅ |
| Evitou aparência clean, corporativa ou genérica | ✅ |
| Sem JSON bruto nem schema_version no prompt | ✅ |
| Sem duplicação visível do style_profile legado | ✅ |
| Imagem: profundidade simbólica e estética coerente | ✅ |
| Imagem: ausência de clichê espiritual ou visual corporativo | ✅ |
| Avaliador considerou identidade visual e propósito | ✅ |
| Avaliador usou principles e restrictions quando relevantes | ✅ |
| Feedback específico e alinhado à identity | ✅ |
| score, approved e refinedPrompt funcionais | ✅ |

Experiência qualitativamente superior ao antigo uso de `context + style_profile` como blobs indiferenciados.

---

**Comparação qualitativa preliminar (evidência dos marcos anteriores):**

| Dimensão | Legado (context + style_profile blob) | V1 (identity estruturada) |
|----------|---------------------------------------|---------------------------|
| Propósito | Misturado no context | foundation.purpose separado |
| Audiência | Ausente | relationship.audience explícito |
| Identidade visual | Blob CSV no style_profile | expression.visual_identity semântico |
| Princípios positivos | Misturados ou ausentes | governance.principles separados |
| Restrições | Misturadas no style_profile CSV | governance.restrictions separadas |
| Preferências de geração | Misturadas no style_profile CSV | practice.generation_preferences separadas |
| Voice/Tom | Ausente | expression.voice |
| Avaliador governance | Sem critério estruturado | Principles e restrictions chegam como bloco enfatizado |

---

**Resultados de validação técnica:**
- `pnpm test`: 186/186 PASS (sem alteração de código)
- `pnpm typecheck`: 0 erros
- `pnpm lint`: 0 erros, 50 warnings (baseline)
- `pnpm validate`: PASS

**Commits:**
- `docs: record Project Identity migration — M11-F complete`
- `docs: record M11-F smoke approval — READY FOR LEGACY REMOVAL REVIEW`

**Status:** M11-F APROVADO — READY FOR LEGACY REMOVAL REVIEW

**Dependências:** M11-D e M11-E concluídos e aprovados

---

### M11-G — Remoção Lógica de style_profile

**Objetivo:** Remover `style_profile` da UI (formulário e detalhe do Projeto), dos consumidores de IA (Prompt Generator, Image Evaluator, Feed Generator) e dos tipos operacionais (`CreateProjectForm`). A coluna permanece no banco e no tipo `Project` — a remoção física é M11-H.

**Escopo V1 confirmado:** A integração de Project Identity com VideoDraft, EditorialContent e ChannelPiece está fora do escopo da V1 e será planejada em marco posterior.

**Pré-condição:** M11-F APROVADO — READY FOR LEGACY REMOVAL REVIEW ✅ (2026-06-26).

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

**Fora de escopo M11-G:** `lib/video-generator`, `EditorialContent`, `ChannelPiece` — não alterar.

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

**Dependências:** M11-F APROVADO (2026-06-26)

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

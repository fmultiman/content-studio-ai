# PROJECT_IDENTITY_V1_IMPLEMENTATION_PLAN.md
**Data: 2026-06-25**

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

### M11-A — Decisão Técnica e Contrato

**Objetivo:** Aprovar o shape final do `identity` JSONB, o TypeScript interface, o schema Zod, e a função `buildIdentityContext()`. Nenhum código de produção alterado.

**Arquivos criados (não modificados):**
- `lib/schemas/project-identity.ts` — schemas Zod + inferência de tipos
- `lib/context-compiler.ts` — função `buildIdentityContext(project: Project): string`

**Arquivos modificados:**
- Nenhum ainda (apenas novos)

**Migration SQL:** Nenhuma.

**APIs afetadas:** Nenhuma.

**UI afetada:** Nenhuma.

**Compatibilidade e rollback:** Total. Arquivos novos sem consumidores. Rollback = deletar os arquivos.

**Testes necessários:**
- Unit tests para `buildIdentityContext()` cobrindo os casos: identity null, identity vazia, identity parcial, identity completa, presença de restrictions, fallback para context/style_profile legados

**Critério de aceite:**
- `lib/schemas/project-identity.ts` exporta `ProjectIdentitySchema`, `ProjectIdentity` type
- `lib/context-compiler.ts` exporta `buildIdentityContext(project)` e `buildEvaluatorContext(project)`
- Todos os unit tests passam
- `tsc --noEmit`: 0 erros
- D-BLOCKER-1 resolvido e documentado

**Pontos de parada obrigatória:**
- STOP: aprovação humana do shape final antes de avançar para M11-B

**Dependências:** D-BLOCKER-1 (shape do JSONB), D-BLOCKER-2 (comportamento UI)

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

### M11-E — Consumo no Image Evaluator (Restrições Locked)

**Objetivo:** Garantir que `identity.governance.restrictions` seja tratado como critério inviolável no Image Evaluator — não como sugestão, mas como condição de reprovação automática quando detectada violação.

**Nota:** M11-D já integra o evaluator com identity. M11-E é o refinamento específico de governance.

**Arquivos modificados:**
- `app/api/evaluate-image/route.ts` — system prompt diferenciado para restrictions: inserido como bloco separado antes dos critérios gerais, com instrução explícita de penalização automática

**Mudança no system prompt do evaluator:**

```
[RESTRIÇÕES ABSOLUTAS DO PROJETO — violação implica reprovação automática]
${restrictions.map(r => `- ${r}`).join('\n')}

Se qualquer uma dessas restrições for violada na imagem ou no prompt, atribua
score máximo de 40 independente da qualidade visual.
```

**Migration SQL:** Nenhuma.

**APIs afetadas:** `POST /api/evaluate-image` — mudança interna de system prompt, sem mudança de contrato.

**UI afetada:** Nenhuma.

**Compatibilidade:** Total. Projetos sem restrictions não têm mudança de comportamento.

**Rollback:** Reverter a mudança no system prompt do evaluator.

**Testes necessários:**
- Imagem que viola uma restriction: score <= 40
- Imagem que não viola nenhuma restriction: avaliação normal sem penalização
- Project sem governance.restrictions: comportamento idêntico ao atual
- Verificar que o feedback menciona a restrição violada quando penaliza

**Critério de aceite:**
- Violations de governance.restrictions resultam em score <= 40
- O campo `improvements[]` menciona a restrição violada
- Projetos sem restrictions: comportamento inalterado

**Pontos de parada obrigatória:** Nenhum específico — pode mergear com M11-D ou após.

**Dependências:** M11-D (infrastructure de integração do evaluator com identity)

---

### M11-F — Migração da Alquimia e Remoção de style_profile

**Objetivo:** Migrar manualmente o context e style_profile da Alquimia Cibernética para o novo campo `identity`. Validar que os agentes funcionam com a nova estrutura. Deprecar visualmente (não remover) o `style_profile` para projetos migrados.

**Arquivos modificados:**
- Nenhum arquivo de código
- Dados migrados via UI (o usuário preenche os campos de identity manualmente na página do Projeto)

**Conteúdo da migração (proposta para aprovação pelo usuário):**

```json
{
  "foundation": {
    "purpose": "A Alquimia Cibernética é uma plataforma de curadoria técnica e inteligência cultural. Realiza engenharia reversa de tradições ancestrais e sistemas simbólicos, tratando espiritualidade e cultura como tecnologias de governança da consciência. O objetivo é recrutar o espectador para arqueologia cognitiva, onde o passado funciona como código-fonte para resolver falhas de execução do presente."
  },
  "relationship": {
    "audience": "Criadores, pensadores e indivíduos que buscam síntese entre tecnologia, simbolismo e tradições culturais. Jovens adultos intelectualmente curiosos e insatisfeitos com conteúdo raso ou genérico."
  },
  "expression": {
    "visual_direction": "Fusão entre sistemas antigos (rituais, símbolos, mitologia) e estruturas modernas (tecnologia, interface, comportamento). Iluminação dramática, alto contraste, estética cinematográfica, atmosfera densa, visual simbólico, composição forte e centralizada, sensação de mistério e profundidade.",
    "voice": "Técnico mas acessível. Usa metáforas de engenharia e tecnologia para falar de espiritualidade. Abordagem estruturada com eixos: Eixo A (O Código — engenharia reversa de mitos), Eixo B (A UX da Vida — diagnóstico de fricções), Híbrido (O Debug — protocolos ancestrais na vida atual)."
  },
  "governance": {
    "restrictions": [
      "Evitar representações literais simples ou óbvias",
      "Evitar aparência genérica ou estilo clean/corporativo",
      "Nunca usar linguagem de auto-ajuda superficial ou misticismo vago",
      "Evitar clichês visuais de espiritualidade como figuras meditando sem contexto",
      "Não produzir conteúdo sem profundidade simbólica ou conceitual"
    ]
  }
}
```

**Validação após migração:**
1. Gerar uma imagem com o projeto Alquimia usando identity preenchida
2. Avaliar a imagem gerada
3. Comparar com uma geração anterior usando apenas context/style_profile
4. Validar que a qualidade de contexto é equivalente ou superior
5. Documentar resultado

**Após validação:**
- O `context` e `style_profile` existentes ficam intactos como "contexto geral livre"
- A UI pode exibir uma nota: "Este projeto possui identity estruturada. O contexto legado está disponível como referência."
- Nenhum delete de dados

**Migration SQL:** Nenhuma (dados editados via UI).

**Rollback:** Limpar o campo `identity` via UI (o JSONB volta a null).

**Critério de aceite:**
- identity do projeto Alquimia preenchida e salva com sucesso
- Geração de imagem com nova identity funciona corretamente
- Avaliação com restrictions funcionando (score penalizado para violações)
- Usuário aprova a qualidade do resultado comparativo

**Pontos de parada obrigatória:**
- STOP: aprovação humana da qualidade antes de comunicar "V1 completa"

**Dependências:** M11-D e M11-E concluídos

---

### M11-G — evaluation_mode Override na Production (Avaliar se entra na V1)

**Objetivo:** Adicionar campo `evaluation_mode` nullable à tabela `productions`. Quando preenchido, sobrescreve o `evaluation_mode` do Project na hora de chamar os agentes.

**Status:** OPCIONAL. Entra na V1 apenas se aprovado em M11-A.

**Arquivos modificados (se aprovado):**
- `lib/types.ts` — adicionar `evaluation_mode?: EvaluationMode | null` ao `Production`
- `app/api/productions/route.ts` — aceitar `evaluation_mode` no POST/PATCH
- `app/api/productions/[id]/route.ts` — aceitar `evaluation_mode` no PATCH
- `components/productions/production-form.tsx` — adicionar select de evaluation_mode (opcional)
- `app/(dashboard)/projetos/[id]/producoes/[productionId]/page.tsx` — exibir override quando ativo
- `app/(dashboard)/imagens/page.tsx` — resolver evaluation_mode: `production.evaluation_mode || project.evaluation_mode || 'default'`

**Migration SQL (se aprovado):**

```sql
-- migration 021_add_production_evaluation_mode.sql
ALTER TABLE productions
  ADD COLUMN IF NOT EXISTS evaluation_mode TEXT DEFAULT NULL;
-- Nullable sem CHECK constraint — validação na aplicação
```

**APIs afetadas:**
- `POST /api/productions` — novo campo permitido opcional
- `PATCH /api/productions/[id]` — novo campo permitido opcional
- `app/(dashboard)/imagens/page.tsx` — lógica de resolução do evaluation_mode

**UI afetada:**
- `ProductionForm` — select de evaluation_mode (opcional, padrão: herdar do Projeto)
- Página da Production — badge quando override está ativo

**Compatibilidade:** Total. Novo campo nullable. Productions existentes herdam do Project.

**Rollback:** `ALTER TABLE productions DROP COLUMN IF EXISTS evaluation_mode`

**Critério de aceite:**
- Production com `evaluation_mode = 'commercial'` dentro de Project com `evaluation_mode = 'conceptual'`: agentes usam 'commercial'
- Production sem `evaluation_mode`: agentes usam o do Project
- `tsc --noEmit`: 0 erros, `pnpm build`: PASS

**Dependências:** M11-B (migration pattern estabelecido); decisão em M11-A

---

## Sequência Recomendada

```
M11-A  ←  Decisão técnica e contrato (bloqueado por D-BLOCKER-1)
   ↓
M11-B  ←  Migration + types (depende de M11-A)
   ↓
M11-C  ←  UI progressiva (depende de M11-B)
   ↓
M11-D  ←  Consumo na geração (depende de M11-C, pode ser paralelo com M11-E)
   ↓
M11-E  ←  Restrições locked no evaluator (depende de M11-D)
   ↓
M11-F  ←  Migração Alquimia (depende de M11-D e M11-E)
   ↓
M11-G  ←  evaluation_mode override (paralelo com M11-C, decisão em M11-A)
```

**M11-D e M11-E podem ser implementados sequencialmente no mesmo PR** — M11-E é um refinamento de M11-D.

**M11-G pode ser implementado em paralelo com M11-C e M11-D** se aprovado em M11-A, pois é independente da UI de identity.

**M11-F é o marco de validação final** — só acontece quando todos os marcos anteriores estão funcionando em produção.

---

## Definição de Pronto para a V1 Completa

A V1 de Project Identity estará completa quando:

1. **Schema:** coluna `identity JSONB` existe na tabela `projects` em produção
2. **Types:** `ProjectIdentity` interface tipada em `lib/types.ts`
3. **Validação:** schema Zod em `lib/schemas/project-identity.ts`
4. **Compilador:** `buildIdentityContext()` e `buildEvaluatorContext()` em `lib/context-compiler.ts`
5. **UI:** seção "Identidade do Projeto" editável na página de qualquer Project
6. **Agentes:** Prompt Generator e Image Evaluator usam identity quando disponível, com fallback correto para campos legados
7. **Governance:** `restrictions` do identity resulta em penalização automática no avaliador
8. **Migração:** Projeto Alquimia Cibernética tem identity preenchida e validada
9. **Qualidade:** `tsc --noEmit` 0 erros, `eslint` 0 erros / baseline de warnings mantido, `pnpm build` PASS
10. **Dados legados intactos:** `context` e `style_profile` não foram alterados nem deletados
11. **Rollback documentado:** cada marco tem rollback identificado

---

## Recomendação Final

**Status: APPROVED WITH PENDING DECISIONS**

O plano está tecnicamente sólido e pode ser implementado. As decisões bloqueantes são:
- **D-BLOCKER-1** (shape do JSONB): a proposta deste documento (4 zonas, 5 campos) é a recomendação. Aguarda aprovação explícita antes de M11-B.
- **D-BLOCKER-2** (comportamento UI para campos legados): menor impacto — pode ser decidido durante M11-C.

O risco técnico global da V1 é BAIXO:
- Nenhum código de produção existente é quebrado em nenhum marco
- Todos os novos campos são opcionais
- Os agentes têm fallback completo para o comportamento atual
- A migration é simples e reversível
- A migração de dados é manual e controlada pelo usuário

A V1 entrega o valor essencial de Project Identity sem burocracia:
um projeto pode operar sem identity, enriquecer progressivamente,
e os agentes imediatamente se beneficiam das novas dimensões quando disponíveis.

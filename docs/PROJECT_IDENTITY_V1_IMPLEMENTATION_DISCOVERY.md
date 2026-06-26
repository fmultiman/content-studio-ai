# PROJECT_IDENTITY_V1_IMPLEMENTATION_DISCOVERY.md
**Data: 2026-06-25**

> Documento de discovery técnico para a implementação de Project Identity V1.
> Produzido a partir da leitura integral dos documentos de fundação, reconciliação,
> auditoria do Image Evaluator, e auditoria completa do código-fonte e banco de dados.
> Nenhuma implementação foi realizada aqui.

---

## 1. Estado do Git e Branches

| Item | Valor |
|------|-------|
| Branch de trabalho | `discovery/project-identity-v1-implementation` |
| Base | `main` (commit `7dd5395` — docs: record M10-C release) |
| Cherry-picks aplicados | `388e191` (reconciliação + recomendação) e `bd296ce` (auditoria Image Evaluator) |
| Commit foundation | `71aebfb` — docs: carry forward Project Identity foundation from discovery branch |
| Commits na branch | 4 commits à frente de main |
| Branch de discovery anterior | `discovery/project-identity-reconciliation` — aposentada, conteúdo migrado |

---

## 2. Documentos Lidos e Avaliados

| Documento | Status | Observação |
|-----------|--------|-----------|
| `docs/PROJECT_IDENTITY_FOUNDATION.md` | Lido | 1096 linhas — fundação conceitual completa com 7 arquiteturas e 5 zonas |
| `docs/PROJECT_IDENTITY_DISCOVERY.md` | Lido | Mapeamento de campos atuais, lacunas e perguntas de domínio |
| `docs/PROJECT_IDENTITY_RECONCILIATION.md` | Lido | Confronto fundação vs. discovery; 5 decisões revisadas |
| `docs/PROJECT_IDENTITY_V1_RECOMMENDATION.md` | Lido | Recomendação OPÇÃO B (JSONB) com shape mínimo |
| `docs/IMAGE_EVALUATOR_IDENTITY_AUDIT.md` | Lido | Fluxo real do avaliador; confirma JSONB com compilador textual |
| `docs/PROJECT_WORKSPACE_DISCOVERY.md` | Lido | Estado pós-M10-B: página do Projeto simplificada; Productions como via única |
| `docs/PROJECT_PRODUCTION_CONSOLIDATION_PLAN.md` | Lido | Plano M10-A/B/C — todos concluídos em 2026-06-25 |
| `docs/PRODUCTION_REQUIRED_FOR_DRAFTS.md` | Lido | M10-C: productionId obrigatório em POST image-drafts e video-drafts |
| `docs/PRODUCTION_DECISIONS.md` | Lido | D1–D7: decisões arquiteturais de Production; contexto de precedência |
| `docs/PRODUCTION_LIFECYCLE.md` | Lido | Modelo de ciclo de vida de Production |
| `docs/ARCHITECTURE.md` | Lido | Arquitetura do sistema; agentes existentes; pontos de atenção |
| `docs/DOMAIN_EVOLUTION.md` | Lido | Evolução do domínio; "Pauta" como entidade central futura |

---

## 3. Schema Atual do Project (Colunas Reais)

Fonte de verdade: `information_schema.columns` consultado via MCP Supabase (somente leitura).

| Coluna | Tipo | Nullable | Default |
|--------|------|----------|---------|
| `id` | uuid | NO | `gen_random_uuid()` |
| `user_id` | uuid | NO | — |
| `name` | text | NO | — |
| `description` | text | YES | null |
| `context` | text | YES | null |
| `status` | text | YES | `'active'` |
| `created_at` | timestamptz | YES | `now()` |
| `updated_at` | timestamptz | YES | `now()` |
| `style_profile` | text | YES | null |
| `evaluation_mode` | text | NO | `'default'` |

**Observação crítica:** Não existe coluna `identity`. Não existe nenhuma coluna JSONB na tabela. O schema é plano, com 10 colunas de texto ou uuid. A adição de `identity JSONB` requer uma migration.

**Observação sobre evaluation_mode:** Campo `NOT NULL` com default `'default'`. Sem CHECK constraint visível no information_schema — o enum é validado na camada de aplicação (conforme ARCHITECTURE.md). Migration 019 adicionou esse campo.

---

## 4. Types TypeScript Atuais

Arquivo: `lib/types.ts`

```typescript
export interface Project {
  id: string
  user_id: string
  name: string
  description: string | null
  context: string | null
  style_profile: string | null
  evaluation_mode: EvaluationMode
  status: 'active' | 'archived'
  created_at: string
  updated_at: string
}

export type EvaluationMode = 'default' | 'conceptual' | 'aesthetic' | 'commercial' | 'experimental'

export type ProductionType = 'editorial' | 'branding' | 'campaign'

export interface Production {
  id: string
  user_id: string
  project_id: string
  title: string
  intention: string
  type: ProductionType
  created_at: string
  updated_at: string
}
```

**Observação:** `Production` não possui `evaluation_mode` hoje. A decisão de adicionar override está em aberto (ver seção 20).

**Formulário de projeto** (`CreateProjectForm` em `lib/types.ts`):
```typescript
export interface CreateProjectForm {
  name: string
  description: string
  context: string
  evaluation_mode: EvaluationMode
  // style_profile NÃO está aqui — é gerenciado pelo TagInput como string diretamente
}
```

---

## 5. APIs de Project — Contratos Atuais

Não existe rota dedicada `app/api/projects/route.ts`. O acesso ao Project é feito diretamente via Supabase client no lado do navegador:

```typescript
// Leitura direta no cliente (page.tsx do projeto)
const { data: project } = await supabase
  .from('projects')
  .select('*')
  .eq('id', projectId)
  .single()

// Insert/Update via Supabase client no ProjectForm
await supabase.from('projects').insert({ ... })
await supabase.from('projects').update({ ... }).eq('id', project.id)
```

**Implicação para V1:** A adição de `identity JSONB` não requer nenhuma nova rota de API. O cliente Supabase já lida com JSONB. O formulário precisará ser atualizado para ler e escrever o campo `identity`.

**Productions API** (`app/api/productions/route.ts`):
- GET: lista por `projectId` (obrigatório)
- POST: cria com `{ projectId, title, intention, type }` — campos permitidos são validados por allowlist
- PATCH/DELETE: em `app/api/productions/[id]/route.ts`

---

## 6. Consumidores de `context`

| Consumidor | Arquivo | Como usa |
|-----------|---------|----------|
| Prompt Generator | `lib/ai-simulator.ts` | Inserido no system prompt como "context:" após o userInput; muda o comportamento do gerador |
| Image Evaluator | `app/api/evaluate-image/route.ts` | Inserido no system prompt como "context:" — base do critério de aderência conceitual |
| Feed Generator | `app/api/posts/generate-feed-text/route.ts` | Busca `name, description, context, style_profile` do projeto e concatena no prompt |
| ProjectForm | `components/projects/project-form.tsx` | Exibe como `<Textarea>` editável pelo usuário |
| ProjectDetailPage | `app/(dashboard)/projetos/[id]/page.tsx` | Exibe como caixa "Contexto para IA" com botão copiar |

**Detalhe do Feed Generator:**
```typescript
const { data: project } = await supabase
  .from('projects')
  .select('name, description, context, style_profile')
// ...concatena: "Projeto: X\nDescricao: Y\nContexto para IA: Z\nPerfil de estilo: W"
```

**Detalhe do Prompt Generator (ai-simulator.ts):**
O system prompt literal inclui:
```
context:
${projectContext || 'Not specified'}

style_profile:
${styleProfile || 'Not specified'}

evaluation_mode:
${evaluationMode}
```

---

## 7. Consumidores de `style_profile`

| Consumidor | Arquivo | Como usa |
|-----------|---------|----------|
| Prompt Generator | `lib/ai-simulator.ts` | Inserido no system prompt como "style_profile:" — direciona estética visual |
| Image Evaluator | `app/api/evaluate-image/route.ts` | Inserido como "style_profile:" — critério de aderência estética |
| Feed Generator | `app/api/posts/generate-feed-text/route.ts` | Concatenado como "Perfil de estilo: X" |
| ProjectForm | `components/projects/project-form.tsx` | TagInput — array serializado como string separada por vírgulas |
| ProjectDetailPage | `app/(dashboard)/projetos/[id]/page.tsx` | Exibe como caixa "Perfil de Estilo" com botão copiar |

**Formato atual real (Alquimia Cibernética):**
```
iluminação dramática, alto contraste, estética cinematográfica, atmosfera densa,
visual simbólico, fusão entre tecnologia e espiritualidade, elementos abstratos
e conceituais, evitar aparência genérica, evitar estilo clean ou corporativo,
composição forte e centralizada, sensação de mistério e profundidade
```

Mistura positivos ("iluminação dramática"), negativos ("evitar aparência genérica"), e meta-direções ("sensação de mistério e profundidade") num único blob de texto.

---

## 8. Consumidores de `evaluation_mode`

| Consumidor | Arquivo | Como usa |
|-----------|---------|----------|
| Prompt Generator | `lib/ai-simulator.ts` | `COMPORTAMENTO POR evaluation_mode:` — muda agressivamente o system prompt |
| Image Evaluator | `app/api/evaluate-image/route.ts` | `COMPORTAMENTO POR evaluation_mode:` — muda pesos de avaliação (conceptual vs aesthetic vs commercial) |
| ProjectForm | `components/projects/project-form.tsx` | Select com 5 opções |
| ProjectDetailPage | `app/(dashboard)/projetos/[id]/page.tsx` | Exibido no card de identidade |

**Impacto real do evaluation_mode:**
- `conceptual`: prioriza simbolismo, penaliza clichês, exige coerência com context
- `aesthetic`: prioriza composição, iluminação, harmonia; conceito ainda importa
- `commercial`: prioriza impacto visual imediato, clareza, engajamento
- `experimental`: prioriza originalidade, permite abstração e risco
- `default`: equilibra conceito, estética e clareza

**Nenhum consumidor além dos dois agentes de IA.** O campo não é consumido por Editorial Content, Channel Piece, ou Video Draft.

---

## 9. Pipeline de Geração de Imagem — Rastreamento Completo

```
Usuário → /imagens?project=P&production=X
         [gate: production obrigatória desde M10-C]
         ↓
handleGeneratePrompt()
  → lib/ai-simulator.ts:generateImagePrompt(
      userInput,
      projectContext,   ← Project.context
      styleProfile,     ← Project.style_profile
      previousAttempts,
      evaluationMode    ← Project.evaluation_mode
    )
  → OpenAI gpt-3.5-turbo com system prompt montado
  → fallback: generateSimulated() (determinístico)
  → retorna: { prompt, promptPt, details }
         ↓
handleCreateImage() / handleGenerateNanoBanana()
  → POST /api/openai/generate-image ou /api/nanobanana/generate
  → salva Image no banco (status: 'draft')
         ↓
handleEvaluateImage()
  → POST /api/evaluate-image {
      userInput, generatedPrompt, imageUrl,
      context,          ← Project.context
      styleProfile,     ← Project.style_profile
      evaluation_mode,  ← Project.evaluation_mode
      attempt
    }
  → OpenAI gpt-4o-mini (vision, detail:'low')
  → retorna: { score, approved, feedback, improvements, refinedPrompt }
         ↓
[se score < 75 e usuário aceita refinamento]
  → setGeneratedPrompt(refinedPrompt)
  → currentAttempt++
  → volta para handleCreateImage()
```

**Nota crítica sobre Production:** A UI da página `/imagens` tem `productionId` no state (obtido via `?production=` na URL), mas esse dado NÃO é enviado ao Image Evaluator. O avaliador recebe apenas o contexto do Project.

**Auto-save:** debounce 800ms → PATCH `/api/image-drafts` com todo o estado do workspace.

---

## 10. Pipeline do Image Evaluator

**Arquivo:** `app/api/evaluate-image/route.ts`

**Provider:** OpenAI `gpt-4o-mini` (ou `OPENAI_EVALUATION_MODEL` env var)  
**Modalidade:** Multimodal — recebe `imageUrl` como `{ type: "image_url", detail: "low" }`  
**Threshold de aprovação:** `score >= 75` (aplicado automaticamente se modelo omitir campo `approved`)

**Inputs que recebe:**
- `imageUrl` — imagem gerada (URL)
- `userInput` — intenção original do usuário
- `generatedPrompt` — prompt final enviado ao gerador
- `context` — `Project.context` (string livre)
- `styleProfile` — `Project.style_profile` (string de tags)
- `evaluation_mode` — `Project.evaluation_mode`
- `attempt` — número da tentativa

**Inputs que NÃO recebe:**
- `Project.name`, `Project.description`
- `Production.intention`, `Production.type`
- `Production.id`

**Outputs:**
```typescript
{
  score: number,         // 0-100
  approved: boolean,     // score >= 75
  feedback: string,      // PT-BR
  improvements: string[], // array de sugestões
  refinedPrompt: string  // novo prompt em inglês
}
```

**Subcritérios do System Prompt (por prioridade):**
1. Alinhamento conceitual com `context` e intenção
2. Aderência ao `style_profile`
3. Qualidade técnica/estética

O avaliador é o principal candidato a se beneficiar de `identity.governance.restrictions` como prompt negativo rígido (restrições que nunca devem ser violadas).

---

## 11. Outros Domínios (VideoDraft, EditorialContent, ChannelPiece)

### VideoDraft

**Acesso ao contexto:** Nenhum. O `app/api/videos/generate-scene-prompt/route.ts` recebe apenas a descrição da cena + metadados. NÃO busca `Project.context` nem `style_profile`.

```typescript
// generate-scene-prompt: recebe apenas:
{ sceneName, sceneDescription, duration, movement, videoName }
// NÃO recebe projectContext nem styleProfile
```

**Implicação para V1:** VideoDraft é atualmente cego ao Project Identity. A V1 de identity não precisa integrar com geração de cena — mas é um debt técnico documentado.

### EditorialContent / ChannelPiece

`app/api/editorial-contents/route.ts` — operações de CRUD. Não busca nem usa `Project.context`, `style_profile`, ou `evaluation_mode` em nenhum endpoint.

`app/api/channel-pieces/route.ts` — idem. Gerencia canal e formato, sem consumo de identidade.

**Implicação para V1:** EditorialContent e ChannelPiece são completamente agnósticos ao Project Identity hoje. Isso representa um gap futuro mas não é escopo da V1 de identity.

### Feed Generator (Posts)

`app/api/posts/generate-feed-text/route.ts` — **único agente além do pipeline de imagem que consome contexto do projeto.** Busca `name, description, context, style_profile` e concatena no prompt. NÃO usa `evaluation_mode`.

---

## 12. Dados Reais Auditados (Somente Leitura)

### Projetos existentes

| id (prefixo) | name | context | style_profile | evaluation_mode | productions |
|-------------|------|---------|--------------|----------------|------------|
| `0b04df8b` | Alquimia Cibernética | HAS_CONTEXT | HAS_STYLE | default | 2 |
| `d0d008c3` | Content Agent | HAS_CONTEXT | HAS_STYLE | default | 1 |
| `6d09d50d` | Projeto teste | HAS_CONTEXT | HAS_STYLE | default | 1 |

**Observação crítica:** Todos os 3 projetos têm `evaluation_mode = 'default'`. Nenhum projeto usa os modos conceptual, aesthetic, commercial ou experimental em produção real. Isso não invalida o campo — apenas indica que a configuração avançada ainda não foi explorada pelos usuários.

### Alquimia Cibernética — context real (450+ palavras)

O context da Alquimia Cibernética é um documento estruturado com seções:
- Definição da plataforma (identidade de marca)
- Abordagem técnica com Eixos A, B, Híbrido
- Intenção visual para IA

Isso confirma o diagnóstico do discovery: usuário avançado criou sua própria estrutura informal dentro do campo livre. O context mistura propósito, princípios e instrução visual num único blob.

### style_profile real (Alquimia Cibernética)

```
iluminação dramática, alto contraste, estética cinematográfica, atmosfera densa,
visual simbólico, fusão entre tecnologia e espiritualidade, elementos abstratos
e conceituais, evitar aparência genérica, evitar estilo clean ou corporativo,
composição forte e centralizada, sensação de mistério e profundidade
```

Contém:
- Direções positivas (5 itens): iluminação, contraste, estética, atmosfera, visual
- Restrições/negativos (2 itens): "evitar aparência genérica", "evitar estilo clean ou corporativo"
- Meta-direções (2 itens): "composição forte e centralizada", "sensação de mistério e profundidade"

A separação desses grupos é a principal oportunidade de melhoria para os agentes.

---

## 13. Avaliação Técnica do JSONB

**13 perguntas explícitas:**

**Q1. JSONB é a escolha certa para identidade, ou colunas separadas?**
JSONB. Justificativa: as dimensões da identidade são progressivas (podem estar ausentes, em rascunho, parcialmente preenchidas). Colunas separadas seriam nullable em sua maioria, tornando o schema rígido sem ganho real. JSONB permite evolução da estrutura sem migrations frequentes.

**Q2. Como o JSONB coexiste com context e style_profile legados?**
Os campos legados permanecem intactos. O campo `identity` é adicionado como nova coluna nullable. Durante a V1, os agentes consomem `identity` quando presente, fazendo fallback para `context`/`style_profile` quando ausente. A migração da Alquimia ocorre como etapa separada (Marco M11-F).

**Q3. O JSONB deve ter schema validation (via CHECK constraint ou pg_jsonschema)?**
Não na V1. A validação acontece na camada de aplicação (Zod). Adicionar CHECK constraint no banco cria rigidez desnecessária quando o schema ainda está em definição.

**Q4. Como diferentes zonas (Foundation, Relationship, Expression, Governance) vivem no mesmo JSONB?**
Como chaves de primeiro nível: `{ foundation, relationship, expression, governance }`. Cada zona é um objeto. Campos dentro das zonas são texto livre ou arrays de strings.

**Q5. A coluna `identity` deve ser NOT NULL?**
Não. Deve ser nullable. Um Project sem identity continua sendo válido (princípio 4.1 da Foundation).

**Q6. Qual é o default do campo?**
`NULL`. Um Project recém-criado não tem identity. O sistema exibe "Identidade não estruturada" e oferece a ação de estruturar progressivamente.

**Q7. Como o TypeScript tipará o campo?**
Interface `ProjectIdentity` com zonas opcionais. O campo em `Project` é `identity: ProjectIdentity | null`.

**Q8. Como os agentes recebem o identity sem receber JSON bruto?**
Via compilador textual (Effective Context Compiler simplificado). Uma função `buildIdentityContext(identity: ProjectIdentity): string` formata o JSONB em texto legível para injeção no system prompt. O JSON bruto nunca é enviado diretamente ao modelo.

**Q9. As políticas locked/adaptable/default devem entrar no JSONB?**
Não na V1. A política de herança (locked vs adaptable vs default) é informação de governança do sistema. Na V1, toda a identidade é tratada como `locked` para o avaliador e `adaptable` para geradores. A implementação granular de políticas é V2.

**Q10. O versionamento de identity deve começar agora?**
Não. O schema deve prever versionamento (não incluir campos que impeçam sua adição) mas não implementá-lo. Na V1, cada PATCH sobrescreve o campo `identity`. Histórico é V2.

**Q11. Quais campos dentro do JSONB são texto livre vs. arrays?**
`foundation.purpose`: texto livre. `relationship.audience`: texto livre. `expression.voice`: texto livre. `expression.visual_direction`: texto livre. `governance.restrictions`: array de strings. Todos opcionais.

**Q12. A zona Practice entra na V1?**
Não. Practice (preferências operacionais como duração, proporção, estrutura) tem baixa prioridade para os agentes existentes. `evaluation_mode` já cobre a principal preferência operacional. Practice é V2.

**Q13. Como garantir que novos campos no JSONB não quebrem o TypeScript?**
Interface tipada com `Partial<>` nas zonas. O compilador TypeScript garante que campos inesperados sejam detectados em build. O uso de `unknown` fields é explicitamente evitado.

---

## 14. Shape Recomendado da V1

```typescript
// lib/types.ts

export interface ProjectIdentityFoundation {
  purpose?: string // por que este project existe; o que o torna distinto
}

export interface ProjectIdentityRelationship {
  audience?: string // público principal; para quem o project existe
}

export interface ProjectIdentityExpression {
  visual_direction?: string // identidade visual: direção estética, referências, atmosfera
  voice?: string            // linguagem verbal: tom, registro, vocabulário, ritmo
}

export interface ProjectIdentityGovernance {
  restrictions?: string[] // o que o project nunca pode fazer; restrições locked
}

export interface ProjectIdentity {
  foundation?: ProjectIdentityFoundation
  relationship?: ProjectIdentityRelationship
  expression?: ProjectIdentityExpression
  governance?: ProjectIdentityGovernance
}

// Adicionado ao Project existente:
export interface Project {
  // ... campos existentes mantidos ...
  identity?: ProjectIdentity | null // NOVO — JSONB nullable
}
```

**Exemplo JSON de um Project com identity preenchida:**

```json
{
  "foundation": {
    "purpose": "A Alquimia Cibernética é uma plataforma de curadoria técnica e inteligência cultural. Realiza engenharia reversa de tradições ancestrais tratando espiritualidade como tecnologia de governança da consciência."
  },
  "relationship": {
    "audience": "Criadores e pensadores que buscam síntese entre tecnologia, simbolismo e cultura. Jovens adultos intelectualmente curiosos, insatisfeitos com conteúdo raso."
  },
  "expression": {
    "visual_direction": "Fusão entre sistemas antigos e estruturas modernas. Iluminação dramática, alto contraste, estética cinematográfica, atmosfera densa, visual simbólico, composição forte e centralizada, sensação de mistério e profundidade.",
    "voice": "Técnico mas acessível. Usa metáforas de engenharia e tecnologia para falar de espiritualidade. Evita linguagem de auto-ajuda e misticismo vago."
  },
  "governance": {
    "restrictions": [
      "Nunca representações literais simples ou óbvias",
      "Evitar aparência genérica ou estilo clean/corporativo",
      "Nunca linguagem de auto-ajuda superficial",
      "Evitar clichês visuais de espiritualidade (figuras meditando sem contexto)"
    ]
  }
}
```

---

## 15. Validação e Typing

**Biblioteca:** Zod (já usada no projeto conforme padrão de API routes)

```typescript
// lib/schemas/project-identity.ts (novo arquivo)
import { z } from 'zod'

export const ProjectIdentityFoundationSchema = z.object({
  purpose: z.string().optional(),
})

export const ProjectIdentityRelationshipSchema = z.object({
  audience: z.string().optional(),
})

export const ProjectIdentityExpressionSchema = z.object({
  visual_direction: z.string().optional(),
  voice: z.string().optional(),
})

export const ProjectIdentityGovernanceSchema = z.object({
  restrictions: z.array(z.string()).optional(),
})

export const ProjectIdentitySchema = z.object({
  foundation: ProjectIdentityFoundationSchema.optional(),
  relationship: ProjectIdentityRelationshipSchema.optional(),
  expression: ProjectIdentityExpressionSchema.optional(),
  governance: ProjectIdentityGovernanceSchema.optional(),
})

export type ProjectIdentity = z.infer<typeof ProjectIdentitySchema>
```

**Validação no cliente:** antes de enviar PATCH para Supabase.  
**Sem validação no banco:** não há CHECK constraint na V1.  
**Serialização:** o cliente Supabase serializa automaticamente o objeto JavaScript como JSONB.

---

## 16. Política de Ausência e Default

| Estado da identity | Comportamento dos agentes |
|-------------------|--------------------------|
| `identity = null` | Agentes usam `context` e `style_profile` (legados) — comportamento atual preservado |
| `identity = {}` | Idem — identity vazia é tratada como ausente |
| `identity` com alguns campos | Compilador usa o que existe, omite o que está ausente; fallback para legados quando relevante |
| `identity` completa | Compilador usa identity; `context` e `style_profile` continuam disponíveis como contexto geral livre |

**Regra de fallback explícita (para implementação):**

```typescript
function buildImageContext(project: Project): string {
  const parts: string[] = []

  const identity = project.identity

  // Propósito: identity.foundation.purpose > project.context
  const purpose = identity?.foundation?.purpose || project.context
  if (purpose) parts.push(`Propósito do projeto: ${purpose}`)

  // Direção visual: identity.expression.visual_direction > project.style_profile
  const visualDir = identity?.expression?.visual_direction || project.style_profile
  if (visualDir) parts.push(`Direção visual: ${visualDir}`)

  // Audiência: apenas identity (não existe fallback legado)
  const audience = identity?.relationship?.audience
  if (audience) parts.push(`Público: ${audience}`)

  // Voz: apenas identity (não existe fallback legado)
  const voice = identity?.expression?.voice
  if (voice) parts.push(`Voz e linguagem: ${voice}`)

  // Restrições: apenas identity (não existe fallback legado estruturado)
  const restrictions = identity?.governance?.restrictions
  if (restrictions?.length) {
    parts.push(`Restrições absolutas:\n${restrictions.map(r => `- ${r}`).join('\n')}`)
  }

  return parts.join('\n\n')
}
```

---

## 17. Políticas de Herança (locked, adaptable, default)

**Implementação na V1:** simplificada. Não há campos de política no JSONB.

| Zona | Campo | Política implícita V1 | Comportamento |
|------|-------|----------------------|---------------|
| Foundation | `purpose` | locked | Enviado ao avaliador como critério inviolável |
| Relationship | `audience` | adaptable | Enviado como contexto; Production pode refinar |
| Expression | `visual_direction` | adaptable | Gerador usa como base; Production pode adaptar |
| Expression | `voice` | adaptable | Feed Generator usa como base |
| Governance | `restrictions` | locked | Enviado ao avaliador como restrições rígidas; nunca ignorado |

**V2:** adicionar campo `_policy: 'locked' | 'adaptable' | 'default'` por campo da identity.

---

## 18. Plano de Migração da Alquimia (style_profile → identity)

O projeto "Alquimia Cibernética" é o único com dados ricos em `context` e `style_profile`.

**Migração proposta (manual, assistida por IA, não automatizada):**

| Campo legado | Conteúdo atual | Destino no identity |
|-------------|---------------|---------------------|
| `context` (primeira parte) | Definição da plataforma + propósito | `identity.foundation.purpose` |
| `context` (eixos A, B, Híbrido) | Abordagem técnica — princípios | Pode ir para `foundation.purpose` expandido ou ser mantido em `context` como contexto geral livre |
| `context` (INTENÇÃO VISUAL) | "Imagens devem representar a fusão..." | `identity.expression.visual_direction` (parte do conteúdo) |
| `style_profile` (positivos) | iluminação dramática, alto contraste, etc. | `identity.expression.visual_direction` (combinado com contexto visual) |
| `style_profile` (negativos) | "evitar aparência genérica", "evitar estilo clean" | `identity.governance.restrictions` |

**Procedimento:**
1. O usuário edita a página do Projeto Alquimia
2. A nova UI de identity sugere o preenchimento progressivo
3. O usuário preenche manualmente os campos ou usa assistência de IA (V2)
4. Os campos legados permanecem intactos durante o período de transição
5. Após validação, o usuário pode limpar `context` e `style_profile` (Marco M11-F)

**Não há script automatizado de migração.** O risco de interpretação incorreta do context existente é alto para automatizar.

---

## 19. Plano de Aposentadoria de style_profile

**Fase 1 (V1 — M11-D/E):** `style_profile` continua funcionando como fallback. Novos agentes preferem `identity.expression.visual_direction` quando disponível.

**Fase 2 (após validação da V1):**
- UI marca `style_profile` como "campo legado — migre para Identidade do Projeto"
- Documentação interna registra o campo como deprecated

**Fase 3 (V2+):**
- Novos Projects não exibem `style_profile` no formulário
- Projects existentes mantêm o campo para compatibilidade
- Projects migrados com `identity` preenchida têm `style_profile` ignorado pelos agentes

**Sem ALTER TABLE DROP COLUMN na V1 nem na V2 imediata.** Remoção da coluna é operação de risco e só faz sentido quando 100% dos projetos ativos tiverem `identity` preenchida.

---

## 20. Posição do evaluation_mode Override na Production

**Estado atual:** `Production` não tem campo `evaluation_mode`. O agente sempre usa o valor do Project.

**Decisão recomendada (D2 em PRODUCTION_DECISIONS.md):**
```
evaluation_mode resolvido = Production.evaluation_mode || Project.evaluation_mode || 'default'
```

**Para a V1 de Project Identity:**

A pergunta é: o `evaluation_mode` override na Production entra no M11-G (dentro do escopo) ou é deixado para uma fase posterior?

**Posição:** M11-G é **opcional e adiável**. O override de evaluation_mode na Production é independente de Project Identity. Identity define o que o projeto é; evaluation_mode define como avaliar a execução. São dimensões separadas.

**Recomendação:** Avaliar durante M11-A se o esforço de adicionar `evaluation_mode nullable` em `productions` (migration + tipo + API + UI) cabe no escopo da V1. Se sim, entra como M11-G. Se não, vai para M12.

**Impacto de adiar:** Zero breaking change. Os agentes já resolvem `evaluationMode` no momento da chamada; adicionar o override apenas acrescenta um fallback na cadeia de resolução.

---

## 21. UX Mínima da V1

**Princípio:** Nenhum campo obrigatório novo. Progressive disclosure.

**Tela de criação de Project (sem mudança):**
```
Nome
Descrição (opcional)
[Criar Project]
```

**Página do Project (expansão progressiva):**

```
┌─ ALQUIMIA CIBERNÉTICA ────────────────────────────────────────┐
│  Ativo  │  Criado 24 abr 2026                    [Editar] [⋮] │
├─ IDENTIDADE DO PROJETO ───────────────────────────────────────┤
│  ○ Propósito         [Não definido — adicionar]              │
│  ○ Público           [Não definido — adicionar]              │
│  ○ Direção Visual    [Não definido — adicionar]              │
│  ○ Voz e Linguagem   [Não definido — adicionar]              │
│  ○ Restrições        [Não definidas — adicionar]             │
│                                                               │
│  [Campos Legados (compatibilidade)]                           │
│    Contexto para IA: [texto existente]    [↗ migrar]         │
│    Perfil de Estilo: [tags existentes]    [↗ migrar]         │
├─ PRODUÇÕES ────────────────────────────────────────────────────│
│  ...lista de productions...                                   │
└───────────────────────────────────────────────────────────────┘
```

**Edição de identity:** inline ou via modal dedicado. Cada dimensão tem um campo de texto livre (textarea) ou, no caso de `restrictions`, um TagInput.

**Sem wizard na V1.** O Identity Builder conversacional é V2.

---

## 22. Estados de Identidade (necessary or premature?)

**Proposta da Foundation (seção 10):**
```
not_started | draft | in_review | approved | needs_review | archived
```

**Avaliação:** PREMATURA para a V1.

**Justificativa:**
- Adiciona complexidade de UX sem benefício imediato
- O único usuário ativo tem 3 projetos; aprovação formal é overhead desnecessário
- O campo `identity` null/empty já indica "not_started"
- Fields parcialmente preenchidos representam "draft" implicitamente
- "approved" implica um fluxo de revisão que não existe na V1

**Decisão para V1:** sem campo de status na identity. O sistema exibe "Identidade estruturada" (quando `identity` tem ao menos um campo preenchido) ou "Identidade não estruturada" (quando `identity` é null ou vazia). Estado binário, sem máquina de estados formal.

**V2:** adicionar `identity_status: 'draft' | 'approved' | 'needs_review'` como campo separado na tabela `projects` ou dentro do JSONB.

---

## 23. Riscos

| Risco | Severidade | Mitigação |
|-------|-----------|-----------|
| Compilador textual envia JSONB bruto ao LLM | ALTO | Implementar `buildIdentityContext()` antes de qualquer integração com agentes |
| Migration JSONB falha em produção | MÉDIO | Migration simples (`ADD COLUMN identity JSONB DEFAULT NULL`) — zero risco de dados existentes |
| UI de identity causa atrito na criação de Project | MÉDIO | Manter criação simples; identity aparece apenas na página de detalhe |
| Fallback para context/style_profile gera duplicidade no prompt | BAIXO | Função `buildIdentityContext()` deve checar antes de duplicar |
| style_profile legado conflita com identity.expression.visual_direction | BAIXO | Na V1, priorizar identity quando ambos existirem; não concatenar automaticamente |
| Perda de dados de context ao migrar Alquimia | MÉDIO | Migração manual; context permanece intacto como backup; nenhum DELETE automático |
| VideoScene Generator cego ao identity | BAIXO | Documentado como debt técnico; fora do escopo V1 |
| Editorial Content cego ao identity | BAIXO | Idem |
| evaluation_mode override na Production não implementado | BAIXO | Comportamento atual (usar sempre o do Project) é semanticamente correto para o escopo |

---

## 24. Decisões Humanas Restantes (Bloqueantes ou Não)

### BLOQUEANTES (necessárias antes de M11-B)

**D-BLOCKER-1: Confirmar shape do JSONB**
A interface `ProjectIdentity` proposta neste documento (4 zonas, 5 campos) está aprovada?
- Alternativa: reduzir para 3 campos simples (`purpose`, `visual_direction`, `restrictions`)
- Impacto: mudança no shape muda a migration, os tipos e a UI

**D-BLOCKER-2: `context` e `style_profile` passam a ser opcionais na UI após identity preenchida?**
Ou continuam exibidos para todos os projetos independentemente?
- Opção A: sempre exibidos (mais simples, sem mudança de comportamento de UI)
- Opção B: colapsados/ocultos quando identity está preenchida (menos poluição visual)
- Impacto: mudança de comportamento da ProjectDetailPage

### NÃO BLOQUEANTES (adiáveis para M11-C ou posterior)

**D-OPT-1: evaluation_mode override na Production (M11-G)**
Entra na V1 ou vai para M12? Não impede nenhum outro marco.

**D-OPT-2: Wizard interativo (Identity Builder conversacional)**
Confirmado como V2 pela RECONCILIATION e RECOMMENDATION. Não adiável acidentalmente.

**D-OPT-3: Estados de identity (not_started/draft/approved)**
Confirmado como PREMATURO para V1 (ver seção 22).

**D-OPT-4: Políticas granulares de herança (locked/adaptable por campo)**
Confirmado como V2.

**D-OPT-5: Versionamento de identity**
Confirmado como V2+.

---

## 25. Escopo Excluído Confirmado

Os itens abaixo NÃO estão no escopo da V1, independente de decisões:

| Item | Motivo da exclusão |
|------|-------------------|
| Identity Builder (chatbot) | V2 — complexidade de UX fora do escopo V1 |
| Effective Context Compiler avançado | V2 — na V1 o compilador é uma função de formatação simples |
| Versionamento de identity | V2+ — schema deve prever mas não implementar |
| Estados de identity (máquina de estados) | V2 — prematuro para o tamanho atual |
| Políticas granulares locked/adaptable por campo | V2 |
| Production Style Direction como entidade separada | V2 |
| Integração de identity com VideoScene Generator | V2 (debt técnico documentado) |
| Integração de identity com EditorialContent/ChannelPiece | V2 |
| Migração automatizada de context/style_profile | Fora do escopo — migração é manual |
| Remoção (DROP COLUMN) de style_profile ou context | Fora do escopo — campos legados permanecem |
| Exemplos aprovados como parte da identity | V2 |
| Channel Contract como entidade | V2 |
| "Workspace Pessoal" (Personal Workspace) | Independente da V1 de identity |
| Análise de desempenho e insights automáticos | Fase futura |

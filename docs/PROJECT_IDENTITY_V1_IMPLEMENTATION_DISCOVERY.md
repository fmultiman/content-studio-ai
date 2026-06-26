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

## 14. Shape Final Aprovado da V1

**Decisão registrada (2026-06-25 — D-BLOCKER-1 RESOLVIDO).**

### 14.1 Contrato TypeScript (inferido do Zod — ver seção 15)

```typescript
// shape aprovado — inferido de ProjectIdentitySchema em lib/schemas/project-identity.ts

interface ProjectIdentity {
  schema_version: 1           // versão do contrato JSON, não histórico de identidade

  foundation?: {
    purpose?: string          // por que este project existe; o que o torna distinto
  }

  relationship?: {
    audience?: string         // público principal; para quem o project existe
  }

  expression?: {
    visual_identity?: string  // identidade visual do Project: direção estética, referências, atmosfera
    voice?: string            // linguagem verbal: tom, registro, vocabulário, ritmo
  }

  governance?: {
    principles?: string[]     // princípios norteadores (positivos); o que o project defende
    restrictions?: string[]   // o que o project nunca pode fazer; restrições locked
  }

  practice?: {
    generation_preferences?: string[] // preferências operacionais de geração e execução
  }
}
```

**`schema_version` é obrigatório e fixo em `1`.** Representa a versão do contrato JSON, não o histórico de edições da identidade.

Todos os demais campos são opcionais.

### 14.2 Justificativas das decisões de nomenclatura

| Campo | Justificativa |
|-------|--------------|
| `visual_identity` (não `visual_direction`) | `visual_direction` fica reservado para futura adaptação contextual na Production; `visual_identity` pertence ao Project como definição permanente |
| `principles[]` separado de `restrictions[]` | Funções diferentes: `principles` são direções afirmativas (o que o project faz e defende); `restrictions` são negações locked (o que nunca pode aparecer). Confundi-los no prompt prejudica os agentes |
| `practice.generation_preferences[]` | Necessário para decompor o `style_profile` corretamente; `evaluation_mode` representa a régua de qualidade, não preferências de execução |
| `schema_version: 1` | Permite que futuras versões do contrato (V2, V3) sejam detectadas sem ambiguidade |

### 14.3 Exemplo JSON completo (Alquimia Cibernética)

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
      "Evitar estética clean ou espaço em branco excessivo"
    ]
  }
}
```

---

## 15. Validação e Typing

**Biblioteca:** Zod (já usada no projeto conforme padrão de API routes)

**Princípio:** o TypeScript type é inferido do schema Zod. Não existem interfaces duplicadas.

### 15.1 Schema Zod (proposta para M11-A)

```typescript
// lib/schemas/project-identity.ts (novo arquivo — criado em M11-A)
import { z } from 'zod'

// Helper: string opcional com .trim(), rejeição de string vazia
const optionalText = z.string().trim().min(1).optional()

// Helper: array de strings com .trim(), remoção de itens vazios, deduplicação
const optionalStringArray = z
  .array(z.string().trim().min(1))
  .transform((arr) => [...new Set(arr)])
  .optional()

export const ProjectIdentitySchema = z
  .object({
    schema_version: z.literal(1),

    foundation: z
      .object({ purpose: optionalText })
      .strict()
      .optional(),

    relationship: z
      .object({ audience: optionalText })
      .strict()
      .optional(),

    expression: z
      .object({
        visual_identity: optionalText,
        voice: optionalText,
      })
      .strict()
      .optional(),

    governance: z
      .object({
        principles: optionalStringArray,
        restrictions: optionalStringArray,
      })
      .strict()
      .optional(),

    practice: z
      .object({ generation_preferences: optionalStringArray })
      .strict()
      .optional(),
  })
  .strict()

// O TypeScript type é inferido — não há interfaces duplicadas
export type ProjectIdentity = z.infer<typeof ProjectIdentitySchema>
```

### 15.2 Comportamentos de validação

| Comportamento | Implementação |
|--------------|---------------|
| `.trim()` em strings | Strings com só espaços são tratadas como vazia (`min(1)` rejeita) |
| String vazia rejeitada | `min(1)` após trim — `""` e `"   "` falham |
| Items vazios em arrays | Cada string do array passa por `trim().min(1)` — itens vazios são rejeitados |
| Deduplicação de arrays | `transform((arr) => [...new Set(arr)])` |
| Campos desconhecidos | `.strict()` em cada objeto — chaves extras rejeitadas |
| `schema_version` diferente de 1 | `z.literal(1)` — qualquer outro valor rejeita |
| Limite de tamanho | A ser definido em M11-A: sugestão `max(2000)` para campos de texto, `max(20)` para arrays |

**Validação no cliente:** antes de enviar PATCH para Supabase (em M11-C).  
**Sem validação no banco:** não há CHECK constraint na V1.  
**Serialização:** o cliente Supabase serializa automaticamente o objeto JavaScript como JSONB.

---

## 16. Política de Ausência e Default

### 16.1 Regra de normalização

A aplicação **nunca persiste `{}`** no campo `identity`. Quando o último campo é removido, a aplicação persiste `NULL`.

```typescript
// lib/project-identity-normalizer.ts (criado em M11-A)
function normalizeProjectIdentity(input: ProjectIdentity): ProjectIdentity | null {
  // valida e limpa via Zod (trim, strict, dedup)
  const parsed = ProjectIdentitySchema.parse(input)
  // se nenhum campo além de schema_version está preenchido → NULL
  const hasContent = Object.entries(parsed).some(([k, v]) => k !== 'schema_version' && v !== undefined)
  return hasContent ? parsed : null
}
```

### 16.2 Tabela de estados e comportamento

| Estado da identity | Comportamento dos agentes |
|-------------------|--------------------------|
| `identity = null` | Agentes usam `context` e `style_profile` (transitoriamente) — comportamento M10-C preservado |
| `identity = {}` (tolerado na leitura) | Tratado como null; nunca produzido pela aplicação |
| `identity` com alguns campos | Compilador inclui os campos disponíveis; campos ausentes simplesmente não aparecem no contexto compilado |
| `identity` completa | Compilador usa identity estruturada; `context` continua disponível como contexto narrativo geral |

### 16.3 Semântica de `context` vs `foundation.purpose`

`context` e `foundation.purpose` **não são substitutos semânticos**. O formatter deve incluir ambos quando disponíveis:

```typescript
// CORRETO — ambos são incluídos separadamente
if (project.context) {
  parts.push(`Contexto geral do projeto:\n${project.context}`)
}
if (identity?.foundation?.purpose) {
  parts.push(`Propósito:\n${identity.foundation.purpose}`)
}

// ERRADO — não usar como substitutos
// const purpose = identity?.foundation?.purpose || project.context  ← NUNCA
```

**Razão:** `context` é narrativa geral livre (pode incluir histórico, eixos de trabalho, abordagem técnica). `foundation.purpose` é a declaração canônica e estruturada do propósito. O LLM se beneficia de ambos na maioria dos casos.

De forma análoga, `style_profile` e `expression.visual_identity` têm formatos e semânticas distintos — não usar como `||`.

### 16.4 Default no banco

- Coluna: `identity JSONB DEFAULT NULL`
- Projects novos: `identity = null`
- Projects existentes pós-migration: `identity = null` (sem migração automática)
```

---

## 17. Políticas de Herança (locked, adaptable, default)

**Implementação na V1:** simplificada. Não há campos de política no JSONB.

| Zona | Campo | Política implícita V1 | Comportamento |
|------|-------|----------------------|---------------|
| Foundation | `purpose` | locked | Enviado ao avaliador como critério de aderência conceitual |
| Relationship | `audience` | adaptable | Enviado como contexto; Production pode refinar com sua intention |
| Expression | `visual_identity` | adaptable | Gerador usa como base; `visual_direction` na Production (futuro) pode adaptar |
| Expression | `voice` | adaptable | Feed Generator usa como base |
| Governance | `principles[]` | adaptable | Contexto afirmativo; incluído no gerador e avaliador |
| Governance | `restrictions[]` | locked | Incluído como restrições; avaliador identifica violações e considera no score |
| Practice | `generation_preferences[]` | adaptable | Gerador de imagem usa como preferências de execução |

**V2:** adicionar campo `_policy: 'locked' | 'adaptable' | 'default'` por campo da identity.

---

## 18. Plano de Migração dos Projects (style_profile → identity)

Acontece em M11-F. O projeto "Alquimia Cibernética" é o principal caso de dados ricos. Os outros dois Projects possuem dados mais simples.

**Migração proposta (manual, via UI, não automatizada):**

| Campo legado | Conteúdo atual | Destino no identity |
|-------------|---------------|---------------------|
| `context` | Narrativa completa da plataforma — definição, eixos, intenção visual | **Permanece em `context`** como contexto narrativo geral; partes selecionadas também preenchem `foundation.purpose` |
| `style_profile` (positivos de execução) | iluminação dramática, alto contraste, composição centralizada | `expression.visual_identity` + `practice.generation_preferences` |
| `style_profile` (princípios afirmativos) | fusão entre tecnologia e espiritualidade, visual simbólico | `governance.principles[]` |
| `style_profile` (negativos / restrições) | "evitar aparência genérica", "evitar estilo clean" | `governance.restrictions[]` |

**Mapeamento detalhado do style_profile da Alquimia:**

```
→ expression.visual_identity:
    "Fusão entre sistemas antigos e estruturas modernas.
     Iluminação dramática, alto contraste, estética cinematográfica,
     atmosfera densa, composição forte e centralizada."

→ governance.principles:
    ["Visual simbólico como linguagem central",
     "Sensação de mistério e profundidade em toda execução",
     "Síntese entre tecnologia e espiritualidade"]

→ governance.restrictions:
    ["Evitar aparência genérica ou estilo clean/corporativo",
     "Evitar clichês visuais de espiritualidade sem contexto"]

→ practice.generation_preferences:
    ["Composição forte e centralizada",
     "Atmosfera densa e cinematográfica",
     "Iluminação com alto contraste"]
```

**Procedimento em M11-F:**
1. Usuário edita o Projeto Alquimia via nova UI de identity (M11-C)
2. Preenche os campos manualmente com base no mapeamento proposto acima
3. Após save, gera uma imagem e compara qualidade com geração anterior (context+style_profile)
4. Após validação comparativa e aprovação, M11-G remove `style_profile` dos consumidores

**Não há script automatizado de migração.** O risco de interpretação incorreta do context é alto para automatizar. A migração é um ato editorial do usuário.

---

## 19. Plano de Aposentadoria de style_profile

`style_profile` **não será legado permanente**. A política aprovada define uma sequência de remoção dentro da V1, terminando em DROP COLUMN.

| Fase | Marco | Ação |
|------|-------|------|
| Fallback transitório | M11-D/E | Agentes preferem campos de `identity` quando disponíveis; `style_profile` usado como fallback enquanto `identity` ainda não está preenchida |
| Migração | M11-F | Usuário preenche `identity` a partir do conteúdo atual do `style_profile`; validação comparativa de geração |
| Remoção lógica | M11-G | Remover `style_profile` da UI (ProjectForm e ProjectDetailPage), dos consumidores de IA (Prompt Generator, Image Evaluator, Feed Generator) e dos tipos operacionais (`CreateProjectForm`). O campo continua no banco e no `Project` type |
| DROP COLUMN | M11-H | `ALTER TABLE projects DROP COLUMN style_profile` após auditoria final; remover do type `Project` |

**Por que remover sem exigir "100% dos Projects ativos por período longo":**  
O banco atual possui apenas Projects iniciais/de teste. A migração pode ser concluída nesta fase com auditoria explícita — não há base de usuários legada que exija período de observação estendido.

**`context` permanece.** Diferente do `style_profile`, o `context` tem semântica própria como narrativa geral livre. Ele não é substituído pela `identity`, mas complementado por ela. Não há plano de remoção de `context` nesta fase.

**O que é decomposto de `style_profile` para `identity`:**

```
style_profile
├── direções de execução visual  →  expression.visual_identity
│                                →  practice.generation_preferences
├── princípios afirmativos       →  governance.principles[]
└── negações / restrições        →  governance.restrictions[]
```

---

## 20. Posição do evaluation_mode Override na Production

**Estado atual:** `Production` não tem campo `evaluation_mode`. O agente sempre usa o valor do Project.

**Decisão aprovada (2026-06-25):** O override de `evaluation_mode` na Production **não entra na V1**. Fica para M12 ou rodada posterior de UX.

Na V1:
```
evaluation_mode efetivo = Project.evaluation_mode || 'default'
```

O comportamento atual (sempre usar o do Project) é semanticamente correto para o escopo da V1.

**Impacto de adiar:** Zero breaking change. Quando o override for implementado (M12), a cadeia de resolução será:
```
evaluation_mode efetivo = Production.evaluation_mode || Project.evaluation_mode || 'default'
```
Essa mudança pode ser feita de forma não-destrutiva quando o momento chegar.

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

## 24. Decisões Registradas

### RESOLVIDAS (2026-06-25)

**D-BLOCKER-1: Shape do JSONB — APROVADO COM ALTERAÇÕES**
Shape final: 5 zonas, 7 campos + `schema_version: 1`.
`visual_identity` (não `visual_direction`). `principles[]` e `restrictions[]` separados. `practice.generation_preferences[]` incluído.
Ver seção 14 para o shape completo e justificativas.

**D-BLOCKER-2: Comportamento de `context` e `style_profile` na UI após identity preenchida**
Decisão: ambos permanecem visíveis na UI durante M11-C e M11-D. A remoção da UI é parte de M11-G, não M11-C. Nenhum comportamento condicional de ocultação na V1 inicial.

**D-OPT-1: evaluation_mode override na Production**
Decidido: **fora da V1**. Vai para M12 ou rodada de UX posterior. Ver seção 20.

**D-OPT-2: Wizard interativo (Identity Builder conversacional)**
Confirmado como V2.

**D-OPT-3: Estados de identity (not_started/draft/approved)**
Confirmado como PREMATURO — não implementar na V1. Ver seção 22.

**D-OPT-4: Políticas granulares de herança (locked/adaptable por campo)**
Confirmado como V2.

**D-OPT-5: Versionamento de identity**
Confirmado como V2+. `schema_version` na V1 só detecta versão do contrato, não implementa histórico.

### PENDENTES (para decidir em M11-A ou M11-C)

**D-M11A-1: Limites de caracteres nos campos de texto**
Sugestão: `max(2000)` para texto livre, `max(500)` por item de array, `max(20)` itens por array.
Confirmar durante M11-A antes de implementar o schema Zod.

**D-M11C-1: UX de edição de identity — inline ou modal?**
Opção A: campos inline expansíveis na página do Projeto.
Opção B: modal dedicado "Editar Identidade" com todos os campos.
Decidir durante M11-C.

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

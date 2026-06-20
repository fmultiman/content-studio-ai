# Content Agent Studio — Evolução do Domínio
**Fase 2 · Modelagem Conceitual · Junho 2026**

> Este documento responde às perguntas de modelagem de domínio levantadas na sessão de Fase 2.
> Cada afirmação é ancorada no código existente (`lib/types.ts`, `scripts/`, `app/`).
> Nenhuma implementação é proposta aqui — apenas os conceitos e suas relações.

---

## 1. Qual é hoje a verdadeira entidade central do domínio?

**Resposta direta:** nenhuma das entidades atuais. Existe uma entidade ausente entre `Project` e `ImageDraft`.

### O que o código revela

**`Project`** (`lib/types.ts:3`) tem semântica editorial poderosa:

```typescript
context: string | null        // instrução para a IA
style_profile: string | null  // perfil estético (tags via TagInput)
evaluation_mode: EvaluationMode // critério de qualidade
```

E quando é criado (`components/projects/project-form.tsx:128`), automaticamente gera uma `LibraryFolder` raiz. O Projeto já tem **identidade**, **poder semântico** (muda o comportamento dos agentes) e **infraestrutura**.

Mas o Projeto não tem **trabalho**. Você não cria conteúdo dentro do Projeto — você cria um `ImageDraft` referenciando o Projeto, e um `VideoDraft` referenciando o Projeto, e um `Post` referenciando o Projeto. O Projeto é **contexto, não produção**.

**`ImageDraft`** (`lib/types.ts:205`) tem **trabalho**, mas não tem **propósito editorial**:

```typescript
user_input: string                      // a intenção
generated_prompt: string | null         // o artefato técnico
generation_attempts: GenerationAttempt[] // o processo
image_status: 'draft' | 'generating' | 'approved' | 'rejected'
```

O `ImageDraft` sabe **como** gerar uma imagem mas não sabe **por quê** esta imagem existe. Não sabe se é para um post do Instagram, para uma campanha específica, para qual audiência, dentro de qual narrativa.

### A lacuna real

O modelo de dados atual é:

```
Project  ──────────────────────────────────────────────────  Asset
(contexto semântico)         [GAP]                    (resultado técnico)
```

Dentro do `[GAP]` existe uma entidade que o produto ainda não formalizou. Em editorial brasileiro, essa entidade se chama **Pauta** — ou em termos mais universais, **Brief de Produção**.

A Pauta responde à pergunta que nenhuma entidade atual responde:

> "Por que este conteúdo existe, o que precisa comunicar, e para onde vai?"

Evidência no código: o campo `Post.ai_context` (`lib/types.ts:121`) — "contexto específico do post" — é a aproximação mais próxima do que uma Pauta conteria. Mas ele está embebido no artefato final (o Post), não no processo de produção que leva até ele.

### Conclusão

**A entidade central atual é implicitamente o `ImageDraft`** — onde todo o trabalho acontece. Mas sua centralidade é acidental, não intencional. Ele veio sendo sobrecarregado de responsabilidades (`generation_attempts[]`, `current_evaluation`, `workspace_state`, `selected_model`) porque não há outra entidade para receber esse peso.

**A entidade central correta ainda não existe.** Ela deveria ser a **Pauta** (Brief Editorial / Produção), que é o container semântico de uma unidade de trabalho.

---

## 2. O conceito de Workspace deve evoluir?

**Resposta direta:** sim, mas de forma precisa. O que deve evoluir não é o `ImageDraft` — é a camada acima dele.

### O que o ImageDraft já é

O `ImageDraft` já é um workspace — um workspace de geração de imagem. Ele guarda:

- A intenção do usuário (`user_input`)
- O artefato intermediário (`generated_prompt`, `generated_prompt_pt`)
- O histórico do processo (`generation_attempts[]`)
- As avaliações (`current_evaluation`)
- O estado atual (`image_status`, `current_image_id`)
- As decisões de tooling (`selected_model`, `auto_mode`)

Isso é um workspace funcional e bem modelado para o que se propõe. O auto-save de 800ms funciona como "sessão persistente". A `imagens/page.tsx` trata esse workspace como estado mútuo entre a UI e o banco.

### O que está faltando

O `ImageDraft` não tem:

- **Intenção editorial**: por que esta imagem está sendo criada?
- **Destino**: para qual canal/post/campanha ela vai?
- **Contexto narrativo**: ela é parte de uma série? Conta uma história?
- **Relação com outros artefatos**: ela se conecta a um roteiro? A um vídeo?

Esses elementos NÃO devem entrar no `ImageDraft`. O `ImageDraft` está corretamente focado na sessão de geração de imagem.

### A evolução correta

O que deve ser criado é uma **camada acima** do `ImageDraft` — um container que:

1. Contém **múltiplos `ImageDraft`** (posso gerar várias imagens para a mesma campanha)
2. Contém **múltiplos `VideoDraft`** (um vídeo desta campanha)
3. Contém **múltiplos `Post`** (as publicações desta campanha)
4. Guarda os **artefatos editoriais** que não são assets: pesquisa, roteiro, ângulo editorial, decisões

```
Pauta (container editorial)
  ├── intent: string             // por que este conteúdo existe
  ├── editorial_angle: string    // o ângulo escolhido
  ├── audience: string           // para quem
  ├── channel: PublicationType   // onde vai
  ├── research_notes: string     // pesquisa acumulada
  ├── script: string             // roteiro (quando aplicável)
  ├── status: PipelineStatus     // onde está no pipeline
  ├── ImageDraft[]               // sessões de geração visual
  ├── VideoDraft[]               // sessões de storyboard
  └── Post[]                     // publicações derivadas
```

O `ImageDraft` existente não muda. Ele ganha apenas uma FK opcional: `pauta_id`. Tudo mais permanece intacto.

### Sobre "abstração desnecessária"

É uma abstração desnecessária agora? Depende de uma resposta de produto:

**Se o produto é** "uma ferramenta para criar uma imagem ou um post de forma rápida" → a Pauta é prematura.

**Se o produto é** "um cockpit editorial para produzir conteúdo de forma sistemática" → a Pauta é a entidade central de toda a evolução futura.

O nome do produto ("Content Agent Studio") e a presença de `evaluation_mode`, `style_profile`, e `generation_attempts[]` indicam a segunda direção.

---

## 3. Quais entidades atuais representam apenas implementação?

**Resposta direta:** `Image`, `LibraryFile`, `PostImage`, e `Video` são especializações de um conceito mais genérico que ainda não foi nomeado: **Asset**.

### Evidência no código

Comparando os campos de `Image` (`lib/types.ts:58`) e `LibraryFile` (`lib/types.ts:151`):

| Campo | Image | LibraryFile |
|-------|-------|-------------|
| `user_id` | ✓ | ✓ |
| `project_id` | ✓ | ✓ |
| `storage_provider` | ✓ | ✓ |
| `storage_path` | ✓ | ✓ |
| `thumbnail_url` | ✓ | ✓ |
| `thumbnail_path` | ✓ | ✓ |
| `file_size` | ✓ | ✓ |
| `mime_type` | ✓ | ✓ |
| `created_at` / `updated_at` | ✓ | ✓ |

A camada de storage é **idêntica**. Ambas existem como arquivos no S3 com a mesma estrutura de paths (`lib/storage/s3.ts`).

As diferenças são apenas semânticas:

| Dimensão | Image | LibraryFile |
|----------|-------|-------------|
| Origem | AI-gerada | Upload manual |
| Propósito | Resultado de geração | Material de referência |
| Ciclo de vida | `draft → approved/rejected` | `created → deleted_at` |
| Proveniência | `user_input` + `generated_prompt` + `model` | `name` + `kind` + `folder` |

`PostImage` (`lib/types.ts:136`) é uma terceira forma de representar o mesmo conceito — uma imagem com storage — mas sem entidade no banco, embedded como JSONB no Post.

### O que "Asset" representaria

```
Asset (conceito genérico)
  ├── storage: { path, provider, url, thumbnail, fileSize, mimeType }
  ├── origin: 'ai_generated' | 'user_uploaded' | 'external'
  ├── kind: 'image' | 'video' | 'audio' | 'document' | 'other'
  ├── status: AssetStatus
  ├── provenance: { prompt?, model?, source_url?, upload_name? }
  ├── project_id → Project
  └── pauta_id? → Pauta
```

`Image` seria um Asset com `origin: 'ai_generated'`, `kind: 'image'`, e `status` no ciclo `draft → approved`.

`LibraryFile` seria um Asset com `origin: 'user_uploaded'`, qualquer `kind`, e soft-delete via `deleted_at`.

### O que isso resolve

1. Uma imagem gerada pode ser "promovida" para a biblioteca sem re-upload
2. Um arquivo da biblioteca pode ser referenciado como inspiração em uma sessão de geração
3. Um Post pode referenciar por FK os Assets reais ao invés de duplicar as URLs
4. A Galeria e a Biblioteca convergem em uma visão unificada de Assets do projeto

### Importante: não é necessário migrar agora

O conceito de "Asset" não exige refatoração imediata. É possível:
1. Criar a tabela `assets` como nova entidade
2. Fazer `images` e `library_files` apontarem para ela via FK
3. Migrar gradualmente

Ou simplesmente adotar o conceito **mentalmente** e fazer as novas features usarem Assets, sem migrar as tabelas antigas.

---

## 4. Como os agentes existentes evoluem?

**Resposta direta:** os agentes existentes ficam intactos. Eles se tornam editoriais ao receberem **contexto editorial mais rico** — não ao serem substituídos.

### O que os agentes atuais sabem

Todos os agentes recebem hoje:
- `userInput` ou `description`
- `projectContext` (do `Project.context`)
- `styleProfile` (do `Project.style_profile`)
- `evaluationMode` (do `Project.evaluation_mode`)

Isso é contexto **de projeto**. O que os agentes não sabem é o contexto **de pauta**:
- Por que este conteúdo existe
- Para qual ângulo editorial
- Para qual audiência específica
- Em qual estágio da produção

### Evolução dos agentes existentes

**Agente 1 — Gerador de Prompts** (`lib/ai-simulator.ts:generateWithOpenAI`)

Hoje: `userInput + projectContext + styleProfile + evaluationMode → prompt`

Amanhã: `userInput + projectContext + styleProfile + evaluationMode + pautaContext + editorialAngle + audience → prompt`

O agent já está preparado para receber contexto adicional. O `systemPrompt` é construído com strings interpoladas — adicionar `pautaContext` e `editorialAngle` é uma extensão natural sem quebrar nada.

**Agente 2 — Avaliador de Imagens** (`app/api/evaluate-image/route.ts`)

Hoje: avalia se a imagem é boa *visualmente* para o modo de avaliação.

Amanhã: avalia se a imagem é boa *editorialmente* — considera o ângulo editorial, a audiência, e o canal de destino.

O campo `improvements[]` já existe no retorno. Adicionar dimensões editoriais ao avaliador não muda a interface, apenas enriquece o resultado.

**Agente 4 — Gerador de Feed Text** (`app/api/posts/generate-feed-text/route.ts`)

Hoje: sabe `description + channel + projectContext + aiContext → feedText`

Já é o mais próximo de um agente editorial. O `aiContext` do Post já funciona como um mini-brief. Receber o `editorialAngle` da Pauta tornaria o texto ainda mais alinhado.

### Novos agentes editoriais

Estes agentes não existem mas emergem naturalmente do domínio:

**Estrategista Editorial**

```
Input:  projectContext + topic + channel + audience + objetivo
Output: { editorial_angle, suggested_post_structure, key_messages[], tone }
```

Seria o primeiro agente a rodar em uma nova Pauta. Seu output preencheria os campos `intent`, `editorial_angle` e `audience` da Pauta. Não substitui nenhum agente existente — existe em uma etapa anterior.

**Roteirista**

```
Input:  editorial_angle + context + style_profile + format (post/video/carousel)
Output: { structure: Scene[], narrative_arc, key_visuals[] }
```

Alimenta o `VideoDraft.scenes` automaticamente, ou sugere a sequência de imagens de um carrossel. Hoje isso está implícito no `handleGenerateScenePrompt` — o Roteirista tornaria esse raciocínio explícito.

**Revisor de Conteúdo**

```
Input:  asset + feedText + editorial_angle + channel + criteria
Output: { approved, issues[], suggestions[] }
```

Extensão natural do Avaliador de Imagens para avaliar também o texto. Avalia o conteúdo como um todo (visual + copy) antes da publicação.

### Princípio de evolução

Nenhum agente existente é substituído. A evolução funciona por **enriquecimento de contexto**:

```
HOJE:    agente(userInput, projectContext) → artefato
AMANHÃ:  agente(userInput, projectContext, pautaContext) → artefato
```

A Pauta é o que torna os agentes técnicos em agentes editoriais. Eles continuam fazendo o mesmo trabalho — mas com mais consciência do propósito.

---

## 5. O frontend continua sendo um cockpit?

**Resposta direta:** sim, e a arquitetura atual já aponta nessa direção. As adaptações necessárias são organizacionais, não estruturais.

### O que o código confirma

A interação atual em `imagens/page.tsx` já é cockpit:
- O usuário define a intenção (`userInput`)
- O Agente Gerador de Prompts trabalha
- O usuário inspeciona o resultado (`PromptSection`)
- O usuário aprova ou pede refinamento
- O Agente Avaliador trabalha
- O usuário vê o score, o feedback, as melhorias sugeridas
- O usuário decide usar o `refinedPrompt` ou aprovar

Isso NÃO é edição direta de conteúdo — é **direção editorial**. O usuário está no papel de diretor, não de operador de ferramenta.

### O que ainda não existe

O cockpit atual é fragmentado por tipo de conteúdo:

```
/imagens   → cockpit de geração visual
/videos    → cockpit de storyboard
/posts     → cockpit de copywriting
/arquivos  → gerenciador de assets
```

Não existe um cockpit de **produção** — uma tela que mostra "estou produzindo este conteúdo e aqui está seu status".

### A adaptação necessária

A página de detalhe de Pauta seria o cockpit de produção:

```
/projetos/:id/pautas/:pautaId

┌─ PAUTA: "Lançamento Produto X - Instagram ─────────────────┐
│  Canal: instagram_post  │  Status: Em produção              │
│  Ângulo: foco no impacto visual imediato do produto         │
├───────────────────────────────────────────────────────────── │
│  [Pesquisa] [Roteiro] [Assets] [Copy] [Revisão]             │
│       ✓          ✓       ⚡         ○       ○               │
├───────────────────────────────────────────────────────────── │
│  3 imagens geradas │ 1 aprovada │ Copy: aguardando asset    │
└─────────────────────────────────────────────────────────────┘
```

Nenhuma tela existente muda. Uma nova tela é adicionada. As telas atuais (`/imagens`, `/videos`, `/posts`) continuam existindo como workspaces especializados — mas agora "originadas de" uma Pauta.

---

## 6. Como o Pipeline surge naturalmente

**Resposta direta:** o pipeline já existe implicitamente no código. Ele precisa ser nomeado, não construído.

### O pipeline implícito atual

Lendo `imagens/page.tsx` de ponta a ponta, o fluxo real que o código executa é:

```
1. user_input capturado
      ↓
2. Prompt Generator executa (lib/ai-simulator.ts)
      ↓
3. generated_prompt produzido → salvo no draft
      ↓
4. Imagem gerada (OpenAI ou NanoBanana)
      ↓
5. Image Evaluator executa (opcionalmente)
      ↓
6. evaluation produzida (score, feedback, refinedPrompt)
      ↓
7. Se não aprovada → volta ao passo 3 com refinedPrompt
   Se aprovada → Image.status = 'approved'
      ↓
8. Imagem entra na galeria
```

E em `posts/page.tsx`:

```
1. Canal selecionado
      ↓
2. Descrição + ai_context preenchidos
      ↓
3. Feed Generator executa → feed_text produzido
      ↓
4. Imagem associada (upload manual, sem conexão com galeria)
      ↓
5. Post salvo
```

Esses dois fluxos são **etapas de um mesmo pipeline** que hoje não têm conexão entre si.

### O pipeline que quer emergir

```
PAUTA CRIADA
    ↓
[PESQUISA] — agent: Estrategista Editorial
    notas de pesquisa, ângulo editorial, audiência
    ↓
[ROTEIRO] — agent: Roteirista (opcional, para vídeos e carrosséis)
    estrutura de cenas / sequência de imagens
    ↓
[GERAÇÃO VISUAL] — agents: Prompt Generator + Avaliador
    ImageDraft(s) → Asset(s) aprovados
    ↓
[COPY] — agent: Feed Generator
    Post com feed_text alinhado ao ângulo editorial e ao visual
    ↓
[REVISÃO] — agent: Revisor (futuro)
    aprovação final do conjunto visual + copy
    ↓
[PUBLICAÇÃO]
    status: 'published'
```

### Como isso cresce sem aumentar complexidade prematuramente

O pipeline não precisa ser um sistema de etapas rígidas. Ele emerge da **Pauta** como status derivado:

```typescript
function derivePipelineStatus(pauta: Pauta): PipelineStatus {
  if (!pauta.editorial_angle) return 'briefing'
  if (!pauta.assets.some(a => a.status === 'approved')) return 'production'
  if (!pauta.posts.some(p => p.feed_text)) return 'copywriting'
  if (!pauta.posts.some(p => p.status === 'saved')) return 'review'
  return 'ready'
}
```

O status do pipeline é sempre derivado do estado real das entidades. Não há uma máquina de estados separada para manter.

---

## 7. Roadmap Conceitual

### Princípio guia

Cada fase adiciona um conceito novo sem reescrever o que já existe. A progressão é aditiva.

---

### Fase A — Consolidação: resolver as desconexões existentes

**O que está quebrado hoje (comprovado pelo código):**
- `Post` tem `PostImage[]` embedded como JSONB, sem FK para `images` (`lib/types.ts:136`)
- `LibraryFile` e `Image` têm a mesma estrutura de storage mas são entidades separadas
- `ImageDraft` tem `generation_attempts[]` com histórico, mas não há tela que mostre isso de forma editorial
- O `style_profile` do Project é tags de texto livre — sem estrutura — e ao mesmo tempo é o conceito mais influente do sistema

**Conceitos que entram nesta fase:**

1. **Asset como conceito unificador mental**: não é necessário migrar as tabelas. É necessário decidir que `images` e `library_files` são a mesma coisa com origens diferentes, e não criar mais entidades separadas de storage.

2. **Conectar Post → Image via FK**: remover o `PostImage[]` embedded e criar uma FK real para a tabela `images`. Isso fecha o loop: gerei a imagem, ela vai para o Post.

3. **Enriquecer `style_profile`**: definir uma estrutura interna (`{ tone: string[], palette: string[], references: string[], avoid: string[] }`) mesmo que continue sendo salvo como texto/JSONB. Os agentes passariam a receber campos específicos, não um blob de texto.

**Por que primeiro:** resolve inconsistências que vão obstruir qualquer evolução futura.

---

### Fase B — A Pauta: a entidade que estava faltando

**Conceito central:** criar a entidade `Pauta` como container de produção editorial.

**O que a Pauta é:**
- Uma unidade de trabalho dentro de um Projeto
- Tem um propósito editorial (`intent`, `editorial_angle`, `audience`)
- Contém múltiplos `ImageDraft`, `VideoDraft`, `Post`, e `Asset`
- Tem um status derivado das entidades que contém

**Como coexiste com o que existe:**
- `ImageDraft` ganha uma FK opcional `pauta_id`
- `VideoDraft` ganha uma FK opcional `pauta_id`
- `Post` ganha uma FK opcional `pauta_id`
- Tudo que já existe continua funcionando — a Pauta é additive

**Nova tela:**
- `/projetos/:id` ganha uma aba "Pautas"
- `/pautas/:id` é o cockpit de produção de uma pauta específica
- As telas `/imagens`, `/videos`, `/posts` ganham um seletor de Pauta (além do seletor de Projeto)

**Por que segundo:** a Pauta dá estrutura ao pipeline sem exigir refatoração dos workspaces existentes.

---

### Fase C — Agentes Editoriais: contexto mais rico

**Conceito central:** os agentes existentes recebem o contexto da Pauta. Novos agentes aparecem.

**Agentes que evoluem:**
- Prompt Generator recebe `pautaContext` (intent + angle + audience)
- Image Evaluator recebe `channel` e avalia adequação editorial, não só qualidade visual
- Feed Generator recebe `editorialAngle` e produz texto alinhado ao visual gerado

**Novo agente:** Estrategista Editorial
- Input: Project + topic + channel + objetivo
- Output: sugere `editorial_angle`, `audience`, e estrutura de conteúdo
- Popula automaticamente os campos da Pauta quando criada

**Por que terceiro:** a Pauta precisa existir antes. Sem o container, o contexto editorial não tem onde morar.

---

### Fase D — Pipeline como produto

**Conceito central:** o pipeline editorial se torna observável e coordenável.

**O que aparece:**
- Status do pipeline derivado automaticamente da Pauta
- Dashboard de produções ativas no `/dashboard`
- Aprovação e handoff entre etapas
- Notificações quando um agente produz algo para revisar
- Histórico editorial (o que foi tentado, o que foi descartado, por quê)

**Novo agente:** Revisor de Conteúdo
- Avalia o conjunto visual + copy antes da publicação
- Verifica alinhamento com o ângulo editorial da Pauta

**Por que quarto:** só faz sentido depois que o pipeline tem etapas reais (Fase B) e agentes editoriais (Fase C) funcionando.

---

## Síntese: o modelo de domínio que quer emergir

```
User
 └── Project (identidade de marca)
       ├── context             → instrução base para IA
       ├── style_profile       → direção estética (estruturada na Fase A)
       ├── evaluation_mode     → critério de qualidade
       └── Pauta (unidade de produção) [NOVO — Fase B]
             ├── intent              → por que este conteúdo existe
             ├── editorial_angle     → o ângulo escolhido
             ├── audience            → para quem
             ├── channel             → para onde vai
             ├── research_notes      → pesquisa acumulada
             ├── script              → roteiro (opcional)
             ├── status              → derivado das entidades filhas
             ├── ImageDraft[]        → sessões de geração visual
             ├── VideoDraft[]        → sessões de storyboard
             ├── Asset[]             → arquivos aprovados
             └── Post[]              → publicações derivadas
```

### O que NÃO muda

- A stack tecnológica (Next.js + Supabase + S3)
- As telas existentes (`/imagens`, `/videos`, `/posts`, `/arquivos`, `/galeria`)
- Os agentes existentes (Prompt Generator, Image Evaluator, Feed Generator, etc.)
- O padrão de API Routes como proxy seguro para as APIs externas
- O auto-save de drafts
- O `evaluation_mode` no Project (continua sendo o critério central de qualidade)
- O RLS no Supabase

### O que muda na Fase A (imediatamente)

- `Post` → conectar por FK real com `images`
- `style_profile` → definir estrutura interna (sem mudar a tabela)
- Decisão arquitetural: novos assets sempre via a lógica do `lib/storage/s3.ts` unificada

### O que muda na Fase B (próxima evolução)

- Nova tabela: `pautas`
- Nova FK em: `image_drafts.pauta_id`, `video_drafts.pauta_id`, `posts.pauta_id`
- Nova tela: cockpit de Pauta
- Nenhuma tela existente é removida ou substituída

### O que NÃO deve aparecer prematuramente

- Sistema de estados de pipeline explícito (emerge como status derivado)
- Agente "Publicador" integrado com redes sociais (alta complexidade, baixo valor na Fase 2)
- Análise de desempenho (precisa de integração com APIs externas)
- Módulo de geração de vídeo real (até que um provider seja definido)
- Múltiplos usuários / workspaces colaborativos

---

## Questões que esta análise deixa em aberto

1. **"Pauta" ou "Produção" ou "Job"?** O nome importa culturalmente. "Pauta" é natural para criadores de conteúdo brasileiro. "Produção" é mais técnico. "Brief" é mais agência. A nomenclatura interna e na UI podem diferir.

2. **A Pauta é opcional ou obrigatória?** Forçar toda geração a ter uma Pauta pode frustrar uso casual. O FK `pauta_id` opcional (Fase B) preserva o fluxo rápido atual.

3. **Quem preenche o `editorial_angle` — o usuário ou o Estrategista Editorial?** Se sempre for o usuário, a Fase C pode vir antes. Se o agente pode sugerir, a ordem se mantém.

4. **O `evaluation_mode` deveria estar na Pauta, não no Project?** Faz sentido que conteúdo comercial e conceitual coexistam no mesmo projeto, com modos diferentes por pauta. Isso é uma mudança no modelo de dados que tem impacto real nos agentes existentes.

5. **Qual é o menor Fase A que destrava a Fase B?** Há risco de a Fase A virar uma refatoração grande. É necessário definir o escopo mínimo.

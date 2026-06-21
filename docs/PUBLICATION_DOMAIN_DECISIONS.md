# Content Agent Studio — Decisões de Domínio: Publicações
**Fase 2 · Pós-Descoberta · Junho 2026**

> Este documento converte o mapeamento exploratório de `PUBLICATION_DOMAIN_DISCOVERY.md`
> em decisões formais de domínio.
>
> **Não implementar código, migration, schema, API ou UI.**
> As decisões aqui são conceituais e servem de contrato para a próxima fase de implementação.

---

## Como ler este documento

Cada seção responde uma pergunta que, se deixada em aberto, criaria ambiguidade
na implementação. As seções 1–3 fornecem contexto. As seções 4–9 definem as entidades.
As seções 10–15 descrevem relações e fluxos. As seções 16–19 respondem às questões
em aberto da descoberta. As seções 20–21 delimitam o escopo. O Registro de Decisões
(PUB-D*) consolida ao final.

```
D1: Nomenclatura — EditorialContent
D2: Nomenclatura — ChannelPiece
D3: Modelo central em três camadas
D4: Distribution adiada
D5: EditorialContent.project_id obrigatório
D6: Vínculo com Production — não destrutivo
D7: ChannelPiece — cascade vs. set null
D8: Canal pertence ao ChannelPiece
D9: EditorialContent sem ChannelPiece é válido
D10: Aba Publicações — estrutura de exibição
D11: Aprovação manual, sem workflow formal
D12: ChannelPieceAsset — N:N futura
D13: Mapeamento de Post legado
D14: Congelamento de posts
D15: Integração com APIs externas fora do escopo
```

---

## 1. Contexto e Propósito

A entidade `Post` existe no banco, na API e na UI, mas seu domínio não foi formalmente
modelado. `PUBLICATION_DOMAIN_DISCOVERY.md` diagnosticou que o `Post` atual é uma
entidade híbrida — mistura três responsabilidades que deveriam ser separadas:

1. **Conteúdo editorial** — a mensagem que o criador quer comunicar
2. **Adaptação de canal** — a forma dessa mensagem em um canal específico
3. **Ato de distribuição** — o registro de que a mensagem foi publicada

Este documento decide como separar essas responsabilidades, como nomear as novas
entidades, e qual é o escopo da próxima fase de implementação.

**Resultado das decisões:**

```
EditorialContent  →  ChannelPiece  →  Distribution
(núcleo semântico)   (adaptação)      (ato operacional — adiado)
```

---

## 2. Documentos de Referência

Este documento pressupõe leitura prévia de:

| Documento | Papel nesta análise |
|-----------|---------------------|
| `ARCHITECTURE.md` | Estado atual do código: entidades, rotas, fluxos |
| `DOMAIN_EVOLUTION.md` | Roadmap de evolução do domínio; conceito de Asset unificado |
| `PRODUCTION_LIFECYCLE.md` | Ciclo de vida da entidade `Production` |
| `PRODUCTION_DECISIONS.md` | Decisões formais D1–D7 sobre `Production` |
| `PUBLICATION_DOMAIN_DISCOVERY.md` | Diagnóstico do `Post` híbrido; 10 cenários; 6 questões em aberto |

---

## 3. Diagnóstico — O `Post` como Entidade Híbrida

A interface `Post` em `lib/types.ts` (linhas 127–148) contém:

```typescript
interface Post {
  // Conteúdo editorial
  name: string              // título editorial
  description: string | null // corpo do conteúdo
  ai_context: string | null  // contexto para IA
  project_id: string | null  // contexto de projeto
  production_id: string | null // produção de origem

  // Adaptação de canal
  channel: PublicationType  // canal de destino
  feed_text: string | null  // texto adaptado para o canal
  image_url: string | null  // mídia (URL direta, sem FK)
  post_images?: PostImage[] // imagens adicionais (JSONB, sem FK)

  // Distribuição incompleta
  status: 'draft' | 'saved' // sem published_at, sem external_id
}
```

**Três responsabilidades num único tipo:**

| Campos | Responsabilidade |
|--------|-----------------|
| `name`, `description`, `ai_context`, `project_id`, `production_id` | Conteúdo editorial |
| `channel`, `feed_text`, `image_url`, `post_images` | Adaptação de canal |
| `status: 'saved'` sem `published_at` | Distribuição implícita e incompleta |

Esta mistura impede:
- Reutilizar o mesmo conteúdo em múltiplos canais sem duplicar dados
- Rastrear qual `Image` gerada originou o post (sem FK para `images`)
- Registrar agendamento e resultados de publicação
- Evoluir cada camada independentemente

---

## 4. O Modelo Central: `EditorialContent → ChannelPiece → Distribution`

**Decisão: o domínio de publicações é modelado em três camadas distintas.**

```
EditorialContent
│   O que o criador quer comunicar.
│   Núcleo semântico, independente de canal.
│   Existe dentro de um Projeto e opcionalmente de uma Produção.
│
└── ChannelPiece  (zero a N por EditorialContent)
    │   A adaptação do conteúdo para um canal específico.
    │   Tem feed_text próprio e assets vinculados ao canal.
    │
    └── Distribution  (zero a N por ChannelPiece — ADIADA)
        O ato de publicar a ChannelPiece em um momento específico.
        Tem scheduled_at, published_at, status de distribuição,
        external_id e external_url da plataforma de destino.
```

**Princípio de separação:** cada camada tem responsabilidade única e pode evoluir
de forma independente. A camada de `Distribution` não bloqueia a implementação
das camadas anteriores.

---

## 5. Por que `EditorialContent` e Não `ContentDraft`

**Decisão (PUB-D1): a entidade se chama `EditorialContent`.**

O nome `ContentDraft` aparece em `PUBLICATION_DOMAIN_DISCOVERY.md` (Seção 3.1)
como "entidade proposta" e é rejeitado pelas seguintes razões:

| Problema com `ContentDraft` | Justificativa |
|-----------------------------|---------------|
| `Draft` é estado, não natureza | Um conteúdo editorial não perde sua identidade quando deixa de ser rascunho. Nomear a entidade como "Draft" conflunde estado (rascunho / pronto) com tipo. |
| Conflito semântico com o padrão existente | O sistema usa `ImageDraft` e `VideoDraft` como workspaces de processo — sessões temporárias de trabalho. Um `ContentDraft` "aprovado" seria semanticamente contraditório com esse padrão. |
| Não expressa a natureza editorial | "Editorial" comunica que o conteúdo tem propósito de publicação — não é só um rascunho genérico de qualquer coisa. |

`EditorialContent` comunica:
- É conteúdo (não processo, não sessão de trabalho)
- É editorial (tem propósito de comunicação e publicação)
- Existe independentemente do seu estado de ciclo de vida

**Convenção de código:** tabela `editorial_contents`, FK `editorial_content_id`,
tipo TypeScript `EditorialContent`.

---

## 6. Por que `ChannelPiece` e Não `PostVariant`

**Decisão (PUB-D2): a entidade se chama `ChannelPiece`.**

O nome `PostVariant` aparece em `PUBLICATION_DOMAIN_DISCOVERY.md` (Seção 3.2)
como "entidade proposta" e é rejeitado:

| Problema com `PostVariant` | Justificativa |
|----------------------------|---------------|
| "Post" é ambíguo | `PostVariant` implica que é variante de um `Post` — mas `Post` é justamente o que estamos substituindo. A dependência circular de nomes cria confusão na leitura do código. |
| "Variant" sugere alternativa inferior | Uma `ChannelPiece` não é uma "variante" do conteúdo — é a expressão canônica para aquele canal. Não há hierarquia entre peças de canais diferentes. |
| Não expressa a dimensão de canal | O elemento central desta camada é o canal de destino. `ChannelPiece` comunica isso diretamente. |

`ChannelPiece` comunica:
- É uma peça (unidade completa e independente)
- Para um canal específico (não genérica)
- Não é rascunho, não é variante — é a versão canônica para aquele canal

**Convenção de código:** tabela `channel_pieces`, FK `channel_piece_id`,
tipo TypeScript `ChannelPiece`.

---

## 7. Definição de `EditorialContent` — Núcleo Semântico

`EditorialContent` é o conteúdo editorial do criador: o que ele quer comunicar,
para qual propósito, dentro do contexto de um Projeto e opcionalmente de uma Produção.

**Campos:**

| Campo | Tipo | Restrição | Descrição |
|-------|------|-----------|-----------|
| `id` | uuid | PK | Identificador único |
| `user_id` | uuid | FK → auth.users NOT NULL | Proprietário |
| `project_id` | uuid | FK → projects NOT NULL | Contexto de projeto — obrigatório |
| `production_id` | uuid | FK → productions nullable ON DELETE SET NULL | Produção de origem — opcional |
| `title` | text | NOT NULL | Título editorial |
| `body` | text | nullable | Corpo do conteúdo — rascunho editorial livre |
| `ai_context` | text | nullable | Instrução específica para agentes de IA |
| `status` | text | CHECK ('draft','ready','archived') | Estado do conteúdo editorial |
| `created_at` | timestamptz | NOT NULL | |
| `updated_at` | timestamptz | NOT NULL | |

**`project_id` é obrigatório (NOT NULL):** `EditorialContent` sempre existe dentro
de um Projeto. A mesma regra se aplica à `Production` (PD-D4 de `PRODUCTION_DECISIONS.md`).
O Projeto fornece o contexto semântico que os agentes precisam para trabalhar com coerência.

**`production_id` é nullable:** um conteúdo editorial pode nascer fora de uma Produção
formal — fluxo rápido, rascunho espontâneo, exploração inicial. A relação com a
Produção é conveniente, não obrigatória.

**ON DELETE SET NULL em `production_id` (PUB-D6):** se a Produção for excluída,
o `EditorialContent` sobrevive com `production_id = null`. O conteúdo editorial não é
sub-recurso de uma Produção. É o mesmo comportamento já implementado para
`image_drafts.production_id` e `video_drafts.production_id` (Incremento 5), cuja
correção foi confirmada em teste.

---

## 8. Definição de `ChannelPiece` — Adaptação de Canal

`ChannelPiece` é a expressão de um `EditorialContent` para um canal específico:
o texto adaptado, o formato, e o status de publicação naquele canal.

**Campos:**

| Campo | Tipo | Restrição | Descrição |
|-------|------|-----------|-----------|
| `id` | uuid | PK | Identificador único |
| `user_id` | uuid | FK → auth.users NOT NULL | Proprietário |
| `editorial_content_id` | uuid | FK → editorial_contents NOT NULL ON DELETE CASCADE | Conteúdo de origem |
| `channel` | text | NOT NULL CHECK (PublicationType) | Canal de destino |
| `feed_text` | text | nullable | Texto adaptado para o canal |
| `status` | text | CHECK ('draft','approved','published') | Estado da peça de canal |
| `created_at` | timestamptz | NOT NULL | |
| `updated_at` | timestamptz | NOT NULL | |

**ON DELETE CASCADE em `editorial_content_id` (PUB-D7):** uma `ChannelPiece` não
existe sem seu `EditorialContent`. Se o conteúdo editorial for excluído, todas as
suas peças de canal são excluídas em cascata. Uma peça de canal é semanticamente
dependente do conteúdo que adapta — não tem identidade própria desvinculada.

**Canais válidos (`PublicationType`)** conforme `lib/types.ts:119`:
```typescript
type PublicationType =
  | 'instagram_post'
  | 'instagram_story'
  | 'youtube_post'
  | 'youtube_shorts'
  | 'youtube_video'
```
Novos canais são adicionados ao tipo sem alterar a estrutura de `ChannelPiece`.

**Cardinalidade:** zero `ChannelPiece`s por `EditorialContent` é válido — um rascunho
editorial pode existir sem adaptação de canal definida (PUB-D9).

---

## 9. Definição de `Distribution` — Registro Operacional (Adiada)

`Distribution` representa o ato de publicar uma `ChannelPiece` em um canal
em um momento específico. É imutável após publicação.

**Por que a camada existe:** a separação entre "peça aprovada" e "ato de publicação"
é necessária para suportar agendamento, republicação e rastreamento de resultados externos.
Sem essa separação, uma peça "published" não tem data de publicação, URL pública,
nem histórico de tentativas.

**Por que está adiada (PUB-D4):** `Distribution` requer:
1. Integração com APIs de redes sociais (Instagram Graph API, YouTube Data API, etc.)
2. Serviço de agendamento (cron job, queue, ou plataforma de agendamento)
3. Webhooks de confirmação de publicação
4. Tratamento de falhas e reenvio

Nenhum desses pré-requisitos existe no sistema atual. Implementar `Distribution`
sem eles criaria uma entidade vazia sem valor para o usuário.

**O que substitui temporariamente:** `ChannelPiece.status = 'published'` marca que
a peça foi publicada manualmente pelo usuário. Não há registro automático. Isso é
aceitável para o MVP desta fase.

**Campos futuros de `Distribution`:**

| Campo | Tipo | Descrição |
|-------|------|-----------|
| `id` | uuid | PK |
| `channel_piece_id` | uuid | FK → channel_pieces NOT NULL |
| `scheduled_at` | timestamptz | nullable — publicação agendada |
| `published_at` | timestamptz | nullable — publicação confirmada |
| `status` | text | 'scheduled' \| 'published' \| 'failed' \| 'cancelled' |
| `external_id` | text | nullable — ID na plataforma externa |
| `external_url` | text | nullable — URL pública do post publicado |
| `error_message` | text | nullable — detalhe de falha |
| `created_at` | timestamptz | NOT NULL | |

---

## 10. Relação com `Production` — Vínculo Não Destrutivo

**Decisão (PUB-D6): `EditorialContent.production_id` é FK nullable com ON DELETE SET NULL.**

Esta decisão alinha o domínio de publicações com o comportamento estabelecido para
`image_drafts.production_id` e `video_drafts.production_id`.

**Comportamento por cenário:**

| Cenário | Comportamento |
|---------|---------------|
| Produção excluída | `EditorialContent.production_id = null` — conteúdo sobrevive |
| Conteúdo criado fora de Produção | `production_id = null` desde o início — válido |
| Conteúdo vinculado depois à Produção | PATCH com `linkOnly: true` — mesmo padrão de `image_drafts` |
| Produção arquivada | `EditorialContent` mantém `production_id` — vínculo preservado |

**O conteúdo editorial não é sub-recurso de uma Produção.** É um artefato de saída
que pode nascer dentro de uma Produção mas tem existência independente. A Produção
é contexto organizacional, não propriedade.

**Implicação para a aba Publicações:** a aba lista `EditorialContent`s pelo
`production_id`. Quando um `EditorialContent` é desvinculado da Produção (PATCH
para `production_id = null`), some da aba — mas continua existindo e acessível
diretamente. Comportamento idêntico ao de `Post` e `ImageDraft` atuais.

---

## 11. Relação com Assets — `ChannelPieceAsset` Futura

**Decisão (PUB-D12): a relação entre `ChannelPiece` e assets visuais é modelada
via tabela intermediária `ChannelPieceAsset` (N:N), a ser implementada em fase futura.**

**Por que N:N:**
- Uma `ChannelPiece` pode ter múltiplos assets (carrossel com 5 imagens, vídeo + thumbnail)
- Um asset (imagem em `images`, arquivo em `library_files`) pode ser referenciado
  por múltiplas `ChannelPiece`s sem duplicação de storage

**Campos conceituais de `ChannelPieceAsset`:**

| Campo | Tipo | Descrição |
|-------|------|-----------|
| `id` | uuid | PK |
| `channel_piece_id` | uuid | FK → channel_pieces NOT NULL |
| `asset_kind` | text | 'image' \| 'library_file' — indica qual tabela referencia |
| `asset_id` | uuid | ID na tabela indicada por `asset_kind` |
| `position` | integer | Ordem dos assets (1 = principal) |
| `role` | text | 'primary' \| 'alternate' \| 'thumbnail' |
| `created_at` | timestamptz | NOT NULL | |

**Por que está adiada:**
1. Requer que `images` e `library_files` sejam tratados como "Assets" com interface
   unificada — Fase A de `DOMAIN_EVOLUTION.md`
2. Requer que o schema de `EditorialContent` e `ChannelPiece` esteja estável
   antes de adicionar a relação intermediária
3. Enquanto não existe, `ChannelPiece` pode ter `image_url` como campo transitório
   de compatibilidade (herdado da migração de `Post`)

**O que `Post.post_images` (JSONB) representa:** é a versão rudimentar do que
`ChannelPieceAsset` formalizará. Cada item de `PostImage[]` se tornará um registro
em `ChannelPieceAsset` com FK real para `images`. Essa migração pertence à fase
de migração de dados, não a esta fase.

---

## 12. Dependência de Arquivos e Galeria

**Aba Galeria** (`/galeria`): exibe imagens com `status = 'approved'` do projeto
atual. Estas imagens são os candidatos naturais a assets primários de `ChannelPiece`.

**Aba Arquivos** (`/arquivos`): exibe `LibraryFile`s — uploads manuais do usuário.
Também são candidatos a assets de `ChannelPiece` (ex: logotipos, templates, mídias
de referência).

**Relação atual com `Post`:** `Post.image_url` aponta para URL da imagem sem FK
para a tabela `images`. `Post.post_images` (JSONB) duplica dados de storage sem
rastreabilidade. Não há vínculo formal entre `Post` e `Image` ou `LibraryFile`.

**Relação futura com `ChannelPiece`:** via `ChannelPieceAsset`, a relação será
formalizada com FK. A `ChannelPiece` saberá exatamente qual `Image` aprovada
ou qual `LibraryFile` está associada — com rastreabilidade completa e sem duplicação.

**Nenhuma mudança nas telas de Galeria ou Arquivos** é requerida nesta fase.
A integração formal via `ChannelPieceAsset` pertence à fase posterior.

**Campo transitório aceito:** `ChannelPiece` pode ter `image_url` como campo
de compatibilidade herdado da migração de `Post`. Não é o modelo final — é um
campo aceito para não bloquear a implementação do núcleo `EditorialContent + ChannelPiece`.

---

## 13. Fluxo de Publicação Rápida

**Contexto:** usuário quer criar conteúdo para publicação sem vincular a nenhuma
Produção formal — uso espontâneo, post único, exploração rápida.

**Fluxo:**

```
1. Usuário acessa /publicacoes (ou fluxo equivalente)
2. Clica em "Novo Conteúdo Editorial"
3. Seleciona Projeto (obrigatório)
   → EditorialContent nasce com project_id definido, production_id = null
4. Preenche title e body do conteúdo editorial
5. Opcionalmente usa IA para refinar (ai_context → Feed Generator)
6. EditorialContent salvo com status = 'draft'
7. Cria ChannelPiece para canal específico (ex: instagram_post)
8. Feed Generator adapta feed_text para o canal
9. Associa imagem via image_url transitório (ou ChannelPieceAsset quando disponível)
10. ChannelPiece salvo com status = 'draft'
11. Usuário revisa → muda ChannelPiece.status para 'approved'
12. Após publicação manual na plataforma → muda para 'published'
```

**O que não existe neste fluxo:** agendamento (`Distribution` adiada), integração
automática com APIs, aprovação formal por agentes.

**Compatibilidade com o fluxo atual de `Post` sem Produção:** o fluxo de criação
rápida mapeia diretamente para este fluxo — `Post` atual sem `production_id` se
torna `EditorialContent` + `ChannelPiece` com `production_id = null`.

---

## 14. Fluxo Pós-Vídeo

**Contexto:** usuário completou um `VideoDraft` dentro de uma Produção e quer criar
conteúdo editorial baseado no trabalho realizado.

**Fluxo:**

```
1. Usuário está em /videos com VideoDraft concluído
   → VideoDraft.production_id = <production_uuid>
   → VideoDraft.project_id = <project_uuid>
2. Navega para a Produção → aba Publicações
3. Clica em "Novo Conteúdo Editorial"
4. EditorialContent criado com:
   → project_id = <project_uuid>  (mesmo do VideoDraft)
   → production_id = <production_uuid>  (mesma Produção)
   → title derivado do VideoDraft.name (sugestão)
5. Cria ChannelPiece para canal de vídeo (ex: youtube_video)
6. Feed Generator gera descrição adaptada para YouTube usando
   EditorialContent.body + ai_context + Project.context
7. Associa o arquivo de vídeo (ChannelPieceAsset futuro, ou image_url transitório)
8. ChannelPiece.status → 'approved'
9. Usuário publica manualmente → status → 'published'
```

**O que não existe neste fluxo:** FK direta de `ChannelPiece` para `VideoDraft`.
A relação é implícita pelo `production_id` compartilhado entre `VideoDraft` e
`EditorialContent`. Uma FK explícita entre eles seria uma adição futura opcional.

---

## 15. Estrutura da Aba Publicações na Produção

**Contexto:** a tela `/producao/[id]` tem uma aba "Publicações". No modelo atual,
ela lista `posts` com `production_id = <id>`. No novo modelo:

**Novo layout da aba:**

```
Aba Publicações
├── EditorialContent A  [status: ready]
│   ├── ChannelPiece: instagram_post  [approved]
│   └── ChannelPiece: youtube_post    [draft]
├── EditorialContent B  [status: draft]
│   └── ChannelPiece: instagram_story [published]
├── EditorialContent C  [status: draft]
│   └── (sem ChannelPieces — rascunho editorial puro)
└── [+ Novo Conteúdo Editorial]
```

**Comportamento (PUB-D10):**
- A aba lista `EditorialContent`s com `production_id = <id>`, ordenados por `updated_at DESC`
- Cada `EditorialContent` é expansível para mostrar suas `ChannelPiece`s
- Status de cada `ChannelPiece` é visível sem expandir (indicador visual)
- `EditorialContent` com zero `ChannelPiece`s aparece como "Sem peça de canal"
- Conteúdo desvinculado da Produção (`production_id` setado para null) some da aba
  mas continua existindo e acessível fora do contexto da Produção

**Contribuição para o status da Produção:**
A aba fornece a visão de progresso editorial da Produção:
`N conteúdos editoriais, M peças aprovadas, K publicadas`.

---

## 16. Respostas Formais às Questões em Aberto

As 6 questões de `PUBLICATION_DOMAIN_DISCOVERY.md` Seção 9 recebem respostas formais:

---

**Q1: Quem decide o canal?**

**R:** O canal é definido no momento de criação da `ChannelPiece`, pelo criador de
conteúdo (PUB-D8).

O `EditorialContent` não tem canal — é independente de canal por design. O usuário
decide para qual canal adaptar o conteúdo ao criar cada `ChannelPiece`. Se quiser
publicar em Instagram e LinkedIn, cria duas `ChannelPiece`s — uma por canal.

---

**Q2: Um `EditorialContent` pode existir sem nenhuma `ChannelPiece`?**

**R:** Sim. Zero `ChannelPiece`s é um estado válido (PUB-D9).

Um `EditorialContent` com `status = 'draft'` e zero `ChannelPiece`s é um rascunho
editorial puro — o criador elabora o conteúdo antes de decidir para qual canal vai
adaptar. O sistema não força a criação imediata de uma `ChannelPiece`.

---

**Q3: A aba "Publicações" deve mostrar `EditorialContent`s ou `ChannelPiece`s?**

**R:** A aba exibe `EditorialContent`s como entidade principal, com `ChannelPiece`s
expandíveis dentro de cada um (PUB-D10).

`EditorialContent` é a unidade de trabalho editorial. A aba organiza por conteúdo,
não por canal. As `ChannelPiece`s são detalhes de cada conteúdo, visíveis ao expandir.
Isso evita proliferação de itens quando o mesmo conteúdo tem múltiplas peças de canal
(ex: Instagram + YouTube + LinkedIn seriam 3 itens soltos sem esta estrutura).

---

**Q4: Aprovação formal é necessária?**

**R:** Não nesta fase. `ChannelPiece.status = 'approved'` é aprovação manual
simples, sem workflow formal (PUB-D11).

O princípio de `PRODUCTION_DECISIONS.md` D7 se aplica: "IA aprova qualidade;
humano aprova uso." Nesta fase não há agente avaliador de conteúdo editorial. A
aprovação é uma ação manual do usuário (mudança de status). Workflow formal com
aprovadores múltiplos é escopo de fase futura (multi-usuário).

---

**Q5: Múltiplos autores?**

**R:** Fora do escopo desta fase. `user_id` permanece como único proprietário.

O modelo atual é mono-usuário. Colaboração e aprovação multi-usuário são requisitos
de uma fase futura. Esta decisão não bloqueia nenhuma implementação presente — o
campo `user_id` existe em todas as entidades e pode ser expandido para RLS de equipe
quando o produto precisar.

---

**Q6: Integração com APIs externas é no escopo do produto?**

**R:** Não nesta fase. `Distribution` é adiada. Publicação é marcação manual (PUB-D15).

`ChannelPiece.status = 'published'` é uma marcação manual pelo usuário — sem
confirmação de plataforma externa, sem `external_id`, sem `external_url`. Esses
campos existirão apenas quando `Distribution` for implementada com integração real
às APIs de redes sociais.

---

## 17. Mapeamento do Legado `Post`

A entidade `Post` em `lib/types.ts` (linha 127) mapeia para o novo modelo:

| Campo do `Post` atual | Entidade alvo | Campo alvo | Observação |
|-----------------------|---------------|------------|------------|
| `id` | — | Novo UUID em cada entidade | Não reutilizar o mesmo ID |
| `user_id` | `EditorialContent` | `user_id` | |
| `project_id` | `EditorialContent` | `project_id` | |
| `production_id` | `EditorialContent` | `production_id` | |
| `name` | `EditorialContent` | `title` | Renomeado para clareza |
| `description` | `EditorialContent` | `body` | |
| `ai_context` | `EditorialContent` | `ai_context` | |
| `channel` | `ChannelPiece` | `channel` | Migrado para a camada de canal |
| `feed_text` | `ChannelPiece` | `feed_text` | |
| `image_url` | `ChannelPiece` | `image_url` (transitório) | FK futura via `ChannelPieceAsset` |
| `thumbnail_url` | `ChannelPieceAsset` (futuro) | `role: 'thumbnail'` | |
| `storage_provider`, `storage_path`, `file_size`, `mime_type` | `ChannelPieceAsset` (futuro) | campos de asset | |
| `post_images` (JSONB) | `ChannelPieceAsset` (futuro) | N registros | Cada `PostImage` → 1 `ChannelPieceAsset` |
| `status: 'draft'` | `EditorialContent` | `status: 'draft'` | |
| `status: 'saved'` | `ChannelPiece` | `status: 'approved'` | Semântica mais precisa |

**Um `Post` atual mapeia para um par `EditorialContent` + uma `ChannelPiece`.**

Este mapeamento é a base do plano de migração — quando a migração for executada,
cada `Post` existente gerará exatamente um `EditorialContent` e uma `ChannelPiece`.
Isso preserva todos os dados existentes sem perda.

**`Post.post_images` (PostImage[]):** o campo JSONB atual duplica dados de storage
sem FK para `images`. Na migração para `ChannelPieceAsset`, cada `PostImage` se torna
um registro com FK real. Esta migração pertence a uma fase futura — não ao incremento
de criação das novas tabelas.

---

## 18. Cardinalidades

```
Project         1 ──────────── N  EditorialContent
Production      1 ──────────── N  EditorialContent  (production_id nullable)
EditorialContent 1 ──────────── N  ChannelPiece
ChannelPiece    1 ──────────── N  Distribution       (adiada)
ChannelPiece    N ──────────── N  Asset              (via ChannelPieceAsset — futuro)
```

**Mínimos válidos:**

| Situação | Válido? | Razão |
|----------|---------|-------|
| `EditorialContent` com 0 `ChannelPiece`s | Sim | Rascunho editorial puro |
| `ChannelPiece` com 0 `Distribution`s | Sim | Peça aprovada, não publicada ainda |
| `ChannelPiece` com 0 assets | Sim | Peça de texto puro, sem mídia |
| `EditorialContent` sem `production_id` | Sim | Fluxo rápido fora de Produção |

**Unicidade de canal por `EditorialContent`:** não há restrição de unicidade.
O mesmo `EditorialContent` pode ter duas `ChannelPiece`s com o mesmo canal
(ex: duas versões de texto para `instagram_post` — teste A/B). Isso é intencional.

---

## 19. Estados do Ciclo de Vida

### `EditorialContent.status`

```
draft    →  Conteúdo em elaboração. ChannelPieces podem não existir ainda.
             Criador ainda está desenvolvendo a mensagem editorial.

ready    →  Conteúdo editorial está completo. Pode ter ChannelPieces em qualquer
             estado. "Ready" significa o núcleo semântico está finalizado,
             não necessariamente as adaptações de canal.

archived →  Conteúdo encerrado pelo usuário. Não ativo, guardado como referência.
```

**Transições:**
- `draft ↔ ready` (reversível — o criador pode revisitar)
- `qualquer → archived` (irreversível por convenção; reativação exige ação explícita)

### `ChannelPiece.status`

```
draft     →  Adaptação de canal em elaboração. feed_text sendo escrito.
              Ainda não revisada pelo criador.

approved  →  A peça foi revisada e aprovada pelo criador para publicação.
              Pronta para ser publicada manualmente (nesta fase).

published →  Publicada no canal. Imutável por convenção — a publicação aconteceu.
```

**Transições:**
- `draft → approved` (criador aprova)
- `approved → draft` (criador reverte para ajuste)
- `approved → published` (criador marca como publicado após publicação manual)
- `published` não reverte — imutabilidade convencional do ato de publicação

### `Distribution.status` (adiada — referência para fase futura)

```
scheduled   →  Publicação agendada, aguardando o horário programado.
published   →  Publicação confirmada pela plataforma externa.
failed      →  Tentativa de publicação falhou (ver error_message).
cancelled   →  Agendamento cancelado antes da publicação.
```

---

## 20. Escopo da Próxima Fase de Implementação

**O que deve ser implementado no Incremento de Publicações:**

1. **Tabela `editorial_contents`** com os campos definidos na Seção 7
2. **Tabela `channel_pieces`** com os campos definidos na Seção 8
3. **RLS** seguindo o padrão `user_id = auth.uid()` das tabelas existentes
4. **API routes:**
   - `GET / POST / PATCH / DELETE /api/editorial-contents`
   - `GET / POST / PATCH / DELETE /api/channel-pieces`
5. **UI de criação de `EditorialContent`** com seleção de Projeto obrigatória
6. **UI de criação de `ChannelPiece`** dentro de um `EditorialContent`
7. **Feed Generator** integrado à `ChannelPiece` (rota existente — adaptar input)
8. **Aba Publicações na Produção** exibindo `EditorialContent`s com `ChannelPiece`s expandíveis

**Pré-condições para iniciar:**
- Schema da entidade `Production` implementado (concluído no Incremento 5)
- O código `// INTEGRAÇÃO PROVISÓRIA` em `app/api/posts/route.ts` permanece intacto
  durante todo este incremento — `posts` não é migrado nem alterado agora
- A tela de Produção existente com aba Publicações deve estar minimamente funcional
  para receber a aba de `EditorialContent`s

---

## 21. O Que Está Fora do Escopo

Estas decisões são explicitamente adiadas:

| Item | Razão do adiamento |
|------|-------------------|
| Entidade `Distribution` | Requer integração com APIs externas e serviço de agendamento |
| Tabela `ChannelPieceAsset` | Requer unificação do conceito de Asset (Fase A de `DOMAIN_EVOLUTION.md`) |
| Migração de `posts` → `editorial_contents` + `channel_pieces` | Requer rollback plan, preservação de dados e aprovação explícita |
| Workflow de aprovação formal | Requer multi-usuário (fase futura) |
| Integração com Instagram, YouTube, LinkedIn | Requer credenciais de API, OAuth, webhooks |
| Agendamento de publicações | Requer `Distribution` implementada |
| Rastreamento de resultados (impressões, cliques) | Requer integração com analytics de plataformas |
| Análise de desempenho de conteúdo | Fase D de `DOMAIN_EVOLUTION.md` |
| Republicação e múltiplas distribuições | Requer `Distribution` |
| FK de `ChannelPiece` para `VideoDraft` ou `ImageDraft` | Relação futura opcional — implícita via `production_id` compartilhado |
| Agente avaliador de conteúdo editorial | Requer Planejador de Produção implementado (Fase C) |
| Geração automática de `ChannelPiece`s por agente | Requer Planejador de Produção (Fase C) |

---

## Registro de Decisões (PUB-D*)

| Código | Decisão | Seção |
|--------|---------|-------|
| PUB-D1 | A entidade central do conteúdo editorial se chama `EditorialContent` — não `ContentDraft` (draft é estado, não natureza), não `Post` | 5 |
| PUB-D2 | A entidade de adaptação de canal se chama `ChannelPiece` — não `PostVariant` (variant implica hierarquia que não existe) | 6 |
| PUB-D3 | O modelo é em três camadas: `EditorialContent → ChannelPiece → Distribution` | 4 |
| PUB-D4 | `Distribution` é adiada — não implementar sem integração com APIs externas de redes sociais e serviço de agendamento | 9 |
| PUB-D5 | `EditorialContent.project_id` é NOT NULL — todo conteúdo editorial requer um Projeto | 7 |
| PUB-D6 | `EditorialContent.production_id` é nullable com ON DELETE SET NULL — conteúdo sobrevive à Produção | 7, 10 |
| PUB-D7 | `ChannelPiece.editorial_content_id` usa ON DELETE CASCADE — peças de canal não existem sem o conteúdo de origem | 8 |
| PUB-D8 | Canal (`channel`) é propriedade de `ChannelPiece`, não de `EditorialContent` — o núcleo é independente de canal | 8, 16 |
| PUB-D9 | `EditorialContent` com zero `ChannelPiece`s é um estado válido (rascunho editorial puro) | 8, 16, 18 |
| PUB-D10 | A aba Publicações exibe `EditorialContent`s como item principal; `ChannelPiece`s são expandíveis dentro de cada um | 15, 16 |
| PUB-D11 | Aprovação é ação manual do usuário (`ChannelPiece.status = 'approved'`); sem workflow formal nesta fase | 16 |
| PUB-D12 | `ChannelPieceAsset` (N:N) é tabela futura; esta fase usa `image_url` como campo transitório em `ChannelPiece` | 11, 12 |
| PUB-D13 | Um `Post` atual mapeia para exatamente um `EditorialContent` + uma `ChannelPiece` na migração futura | 17 |
| PUB-D14 | A tabela `posts` e a API `/api/posts` permanecem congeladas e intactas até migração formal aprovada | 17, 20 |
| PUB-D15 | Integração com APIs externas de publicação não é escopo desta fase; publicação é marcação manual pelo usuário | 16, 21 |

---

*Documento produzido na sessão de modelagem de domínio da Fase 2.*
*Próximo passo: implementar `editorial_contents` + `channel_pieces` (Incremento de Publicações)
com base nestas decisões e nas pré-condições da Seção 20.*

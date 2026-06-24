# Content Agent Studio — Decisões de Domínio: Publicações
**Fase 2 · Pós-Descoberta · Revisão 2 · Junho 2026**

> Este documento converte o mapeamento exploratório de `PUBLICATION_DOMAIN_DISCOVERY.md`
> em decisões formais de domínio e incorpora os refinamentos da segunda sessão de modelagem.
>
> **Não implementar código, migration, schema, API ou UI.**
> As decisões aqui são conceituais e servem de contrato para a fase de implementação.

---

## Como ler este documento

Cada seção responde uma pergunta que, se deixada em aberto, criaria ambiguidade
na implementação. As seções 1–3 fornecem contexto. As seções 4–9 definem as entidades.
As seções 10–15 descrevem relações e fluxos. A seção 15.1 define as rotas de UI.
As seções 16–19 respondem às questões em aberto da descoberta. As seções 20–21
delimitam o escopo. O Registro de Decisões (PUB-D*) consolida ao final.

```
D1:  Nomenclatura — EditorialContent
D2:  Nomenclatura — ChannelPiece
D3:  Modelo central em três camadas
D4:  Distribution adiada
D5:  EditorialContent.project_id obrigatório
D6:  Vínculo com Production — não destrutivo
D7:  ChannelPiece — cascade vs. set null
D8:  Canal pertence ao ChannelPiece
D9:  EditorialContent sem ChannelPiece é válido
D10: Aba Publicações — estrutura de exibição
D11: Aprovação manual, sem workflow formal
D12: ChannelPieceAsset — N:N futura
D13: Mapeamento de Post legado
D14: Congelamento de posts
D15: Integração com APIs externas fora do escopo
D16: Canal e formato são campos separados em ChannelPiece
D17: ChannelPiece.status não inclui 'published'
D18: Corpo do conteúdo do ChannelPiece se chama body
D19: image_url não entra no schema de ChannelPiece em P1
D20: Rotas de Publicações aprovadas
```

---

## 1. Contexto e Propósito

A entidade `Post` existe no banco, na API e na UI, mas seu domínio não foi formalmente
modelado. `PUBLICATION_DOMAIN_DISCOVERY.md` diagnosticou que o `Post` atual é uma
entidade híbrida — mistura três responsabilidades que deveriam ser separadas:

1. **Conteúdo editorial** — a mensagem que o criador quer comunicar
2. **Adaptação de canal** — a forma dessa mensagem em um canal e formato específicos
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
  channel: PublicationType  // canal + formato colapsados
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
    │   A adaptação do conteúdo para um canal e formato específicos.
    │   Tem body próprio, cta, hashtags e status editorial.
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
| "Variant" sugere alternativa inferior | Uma `ChannelPiece` não é uma "variante" do conteúdo — é a expressão canônica para aquele canal e formato. Não há hierarquia entre peças de canais diferentes. |
| Não expressa a dimensão de canal | O elemento central desta camada é o canal e o formato de destino. `ChannelPiece` comunica isso diretamente. |

`ChannelPiece` comunica:
- É uma peça (unidade completa e independente)
- Para um canal e formato específicos (não genérica)
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
| `user_id` | uuid | FK → auth.users NOT NULL CASCADE | Proprietário |
| `project_id` | uuid | FK → projects NOT NULL ON DELETE RESTRICT | Contexto de projeto — obrigatório |
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

**`ON DELETE RESTRICT` em `project_id`:** um `EditorialContent` não pode existir sem
Projeto. Se o usuário tentar excluir um Projeto que tem `EditorialContent`s, o banco
bloqueia a operação com erro `23503`. A UI deve orientar o usuário a excluir ou mover os
conteúdos antes de excluir o Projeto — mesmo padrão implementado para `productions`.

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

`ChannelPiece` é a expressão de um `EditorialContent` para um canal e formato
específicos: o texto adaptado, a estrutura, o call-to-action, as hashtags, e o
status editorial dessa peça.

**Campos:**

| Campo | Tipo | Restrição | Descrição |
|-------|------|-----------|-----------|
| `id` | uuid | PK | Identificador único |
| `user_id` | uuid | FK → auth.users NOT NULL CASCADE | Proprietário |
| `editorial_content_id` | uuid | FK → editorial_contents NOT NULL ON DELETE CASCADE | Conteúdo de origem |
| `channel` | text | NOT NULL CHECK (ver PUB-D16) | Canal de destino |
| `format` | text | NOT NULL CHECK (ver PUB-D16) | Formato dentro do canal |
| `title` | text | nullable | Override de título para este canal (quando difere do EC) |
| `body` | text | nullable | Texto adaptado para o canal e formato (ver PUB-D18) |
| `cta` | text | nullable | Chamada para ação específica do canal |
| `hashtags` | text | nullable | Hashtags em string livre (estruturação em array reservada para fase futura) |
| `status` | text | CHECK ('draft','ready','approved','archived') | Estado editorial da peça (ver PUB-D17) |
| `created_at` | timestamptz | NOT NULL | |
| `updated_at` | timestamptz | NOT NULL | |

**ON DELETE CASCADE em `editorial_content_id` (PUB-D7):** uma `ChannelPiece` não
existe sem seu `EditorialContent`. Se o conteúdo editorial for excluído, todas as
suas peças de canal são excluídas em cascata. Uma peça de canal é semanticamente
dependente do conteúdo que adapta — não tem identidade própria desvinculada.

**Por que `channel` e `format` são campos separados (PUB-D16):** consulte a
Seção 8.1. Em síntese, os valores anteriores de `PublicationType` colapsavam canal
e formato numa única string (ex: `instagram_post`), impedindo a extensão independente
de cada dimensão.

**Por que `body` e não `feed_text` (PUB-D18):** `feed_text` é um nome de campo
da entidade `Post` legada, específico para conteúdo de feed. Em `ChannelPiece`, o
conteúdo principal se chama `body` — mais neutro e aplicável a qualquer canal. Um
story, uma descrição de vídeo, um artigo ou uma mensagem de WhatsApp não é
um "feed text". `body` é o texto do conteúdo para aquele canal e formato.

**Por que sem `image_url` (PUB-D19):** nenhum fluxo concreto de P1 a P5 requer
`image_url` diretamente em `ChannelPiece`. Assets visuais serão modelados via
`ChannelPieceAsset` (Seção 11, fase futura). Incluir `image_url` agora seria
especulação sem caso de uso confirmado, gerando dívida técnica.

**Cardinalidade:** zero `ChannelPiece`s por `EditorialContent` é válido — um rascunho
editorial pode existir sem adaptação de canal definida (PUB-D9).

---

## 8.1 Canal e Formato — Separação Estrutural (PUB-D16)

**Decisão: `channel` e `format` são campos separados em `ChannelPiece`.
`PublicationType` não é herdado como modelo de dados de `ChannelPiece`.**

O type `PublicationType` existente (`instagram_post`, `instagram_story`, etc.)
colapsa canal e formato numa única string. Isso impossibilita adicionar formatos
novos dentro de um canal (ex: `instagram + reel`) sem alterar o enum inteiro.

### Valores de `channel` (P1)

| Valor | Canal |
|-------|-------|
| `instagram` | Instagram |
| `youtube` | YouTube |
| `whatsapp` | WhatsApp |
| `linkedin` | LinkedIn |
| `x` | X (Twitter) |
| `tiktok` | TikTok |

### Valores de `format` (P1)

| Valor | Descrição |
|-------|-----------|
| `feed` | Post no feed (Instagram, LinkedIn) |
| `story` | Story (Instagram, WhatsApp) |
| `reel` | Reel / vídeo curto (Instagram, TikTok) |
| `short` | YouTube Short |
| `video_description` | Descrição de vídeo do YouTube |
| `post` | Post padrão (LinkedIn, X) |
| `channel_message` | Mensagem de canal (WhatsApp) |
| `carousel` | Carrossel (Instagram, LinkedIn) |
| `article` | Artigo longo (LinkedIn) |

Novos canais e formatos são adicionados ao `CHECK` constraint via migration sem
alterar a estrutura da tabela ou o código de agentes.

**Validação de combinações:** a validade da combinação `channel + format`
(ex: `youtube + story` não é válida) é responsabilidade da camada de aplicação.
O banco valida cada campo individualmente. Uma tabela de combinações válidas
é mantida no código (`lib/publication-channels.ts` ou similar) e usada pela API
e pela UI.

### Mapeamento de `PublicationType` legado → `channel + format`

Este mapeamento orienta a futura migração dos dados de `posts` para
`editorial_contents + channel_pieces`. Não é executado em P1–P6.

| `PublicationType` (posts legados) | `channel` | `format` |
|----------------------------------|-----------|----------|
| `instagram_post` | `instagram` | `feed` |
| `instagram_story` | `instagram` | `story` |
| `youtube_post` | `youtube` | `post` |
| `youtube_shorts` | `youtube` | `short` |
| `youtube_video` | `youtube` | `video_description` |

O type `PublicationType` em `lib/types.ts` permanece inalterado enquanto a
tabela `posts` estiver ativa. Ele não é referenciado em `ChannelPiece`.

---

## 9. Definição de `Distribution` — Registro Operacional (Adiada)

`Distribution` representa o ato de publicar uma `ChannelPiece` em um canal
em um momento específico. É imutável após publicação.

**Por que a camada existe:** a separação entre "peça aprovada" e "ato de publicação"
é necessária para suportar agendamento, republicação e rastreamento de resultados externos.
Sem essa separação, uma peça "publicada" não tem data de publicação, URL pública,
nem histórico de tentativas.

**Por que está adiada (PUB-D4):** `Distribution` requer:
1. Integração com APIs de redes sociais (Instagram Graph API, YouTube Data API, etc.)
2. Serviço de agendamento (cron job, queue, ou plataforma de agendamento)
3. Webhooks de confirmação de publicação
4. Tratamento de falhas e reenvio

Nenhum desses pré-requisitos existe no sistema atual. Implementar `Distribution`
sem eles criaria uma entidade vazia sem valor para o usuário.

**O que substitui temporariamente:** publicação manual não está modelada como estado
no schema de P1. `ChannelPiece.status` não inclui `published` (ver PUB-D17). A
necessidade de registrar publicação manual é reconhecida como um gap de produto a
ser resolvido — por `Distribution` quando implementada ou por um campo específico
quando a necessidade for validada com usuários.

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
diretamente em `/publicacoes`. Comportamento idêntico ao de `ImageDraft` e `VideoDraft`.

---

## 11. Relação com Assets — `ChannelPieceAsset` Futura

**Decisão (PUB-D12): a relação entre `ChannelPiece` e assets visuais é modelada
via tabela intermediária `ChannelPieceAsset` (N:N), a ser implementada em fase futura.**

**Por que N:N:**
- Uma `ChannelPiece` pode ter múltiplos assets (carrossel com 5 imagens, vídeo + thumbnail)
- Um asset pode ser referenciado por múltiplas `ChannelPiece`s sem duplicação de storage

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

**Nota sobre `asset_kind + asset_id`:** este é um padrão de associação polimórfica.
O banco não consegue garantir integridade referencial via FK convencional — `asset_id`
não tem FK definida. A integridade é responsabilidade da camada de aplicação.
Quando `ChannelPieceAsset` for implementada, a decisão entre manter o padrão
polimórfico ou usar FKs separadas (`image_id nullable`, `library_file_id nullable`)
deve ser revisitada.

**Por que está adiada:**
1. Requer que `images` e `library_files` sejam tratados como "Assets" com interface
   unificada — Fase A de `DOMAIN_EVOLUTION.md`
2. Requer que o schema de `EditorialContent` e `ChannelPiece` esteja estável
   antes de adicionar a relação intermediária

---

## 12. Dependência de Arquivos e Galeria

**Aba Galeria** (`/galeria`): exibe imagens com `status = 'approved'` do projeto
atual. Estas imagens são os candidatos naturais a assets primários de `ChannelPiece`.

**Aba Arquivos** (`/arquivos`): exibe `LibraryFile`s — uploads manuais do usuário.
Também são candidatos a assets de `ChannelPiece`.

**Relação atual com `Post`:** `Post.image_url` aponta para URL da imagem sem FK
para a tabela `images`. `Post.post_images` (JSONB) duplica dados de storage sem
rastreabilidade. Não há vínculo formal entre `Post` e `Image` ou `LibraryFile`.

**Relação futura com `ChannelPiece`:** via `ChannelPieceAsset`, a relação será
formalizada com rastreabilidade real entre `ChannelPiece` e `Image` ou `LibraryFile`.

**Nenhuma mudança nas telas de Galeria ou Arquivos** é requerida em P1–P6.
A integração formal via `ChannelPieceAsset` pertence à fase posterior.

---

## 13. Fluxo de Publicação Rápida

**Contexto:** usuário quer criar conteúdo para publicação sem vincular a nenhuma
Produção formal — uso espontâneo, post único, exploração rápida.

**Fluxo:**

```
1.  Usuário acessa /publicacoes
2.  Clica em "Novo Conteúdo Editorial"
3.  Seleciona Projeto (obrigatório)
    → EditorialContent nasce com project_id definido, production_id = null
4.  Preenche title e body do conteúdo editorial
5.  Opcionalmente usa IA para refinar (ai_context → Feed Generator ou rota editorial)
6.  EditorialContent salvo com status = 'draft'
7.  Navega para detalhe: /projetos/[projectId]/conteudos/[editorialContentId]
8.  Cria ChannelPiece: seleciona channel (ex: instagram) e format (ex: feed)
9.  Geração assistida adapta body para o canal e formato
10. Preenche cta e hashtags conforme necessário
11. ChannelPiece salvo com status = 'draft'
12. Usuário revisa → muda ChannelPiece.status para 'approved'
    (publicação manual externa — não registrada no sistema nesta fase)
```

**O que não existe neste fluxo:** agendamento (`Distribution` adiada), integração
automática com APIs, registro de publicação manual, aprovação formal por agentes.

---

## 14. Fluxo Pós-Vídeo

**Contexto:** usuário completou um `VideoDraft` dentro de uma Produção e quer criar
conteúdo editorial baseado no trabalho realizado.

**Fluxo:**

```
1.  Usuário está em /videos com VideoDraft concluído
    → VideoDraft.production_id = <production_uuid>
    → VideoDraft.project_id = <project_uuid>
2.  Banner contextual: "Criar conteúdo editorial para esta Produção"
3.  Clica → abre criação de EditorialContent com:
    → project_id = <project_uuid>  (mesmo do VideoDraft)
    → production_id = <production_uuid>  (mesma Produção)
    → title sugerido a partir de VideoDraft.name
4.  Cria ChannelPiece com:
    → channel = youtube, format = video_description  (pré-selecionado)
5.  Geração assistida: body para descrição de vídeo YouTube usando
    EditorialContent.body + ai_context + Project.context
6.  Preenche cta e hashtags
7.  ChannelPiece.status → 'approved'
    (publicação manual externa — não registrada nesta fase)
```

**Rastreabilidade causal:** a relação `VideoDraft → EditorialContent` é implícita
pelo `production_id` compartilhado. Não há FK direta entre as entidades —
isso é documentado como lacuna a resolver em fase futura (FK opcional
`source_video_draft_id` em `EditorialContent`).

---

## 15. Estrutura da Aba Publicações na Produção

**Contexto:** a tela `/projetos/[projectId]/producoes/[productionId]` tem uma aba
"Publicações". No modelo atual, ela lista `posts` com `production_id = <id>`. No
novo modelo (implementado em P5):

**Novo layout da aba:**

```
Aba Publicações
├── EditorialContent A  [status: ready]
│   ├── ChannelPiece: instagram / feed  [approved]
│   └── ChannelPiece: youtube / video_description  [draft]
├── EditorialContent B  [status: draft]
│   └── ChannelPiece: instagram / story  [approved]
├── EditorialContent C  [status: draft]
│   └── (sem ChannelPieces — rascunho editorial puro)
└── [+ Novo Conteúdo Editorial]
```

**Comportamento (PUB-D10):**
- A aba lista `EditorialContent`s com `production_id = <id>`, ordenados por `updated_at DESC`
- Cada `EditorialContent` é expansível para mostrar suas `ChannelPiece`s
- Status de cada `ChannelPiece` é visível sem expandir (indicador visual)
- `EditorialContent` com zero `ChannelPiece`s aparece como "Sem peça de canal"
- Conteúdo desvinculado da Produção some da aba mas continua existindo em `/publicacoes`

**Contribuição para o status da Produção:**
`N conteúdos editoriais · M peças aprovadas`

---

## 15.1 Rotas de Publicações (PUB-D20)

**Decisão: três contextos de acesso ao domínio de publicações, com rotas distintas
e responsabilidades claras.**

### Rota global — `/publicacoes`

Entry point principal da sidebar para o domínio de publicações. Exibe:
- Lista de `EditorialContent`s do usuário (todos os projetos, filtrável)
- Botão "+ Novo Conteúdo Editorial" com seleção obrigatória de Projeto
- Filtros: por Projeto e por Production

### Rota de detalhe editorial — `/projetos/[projectId]/conteudos/[editorialContentId]`

Workspace completo de um `EditorialContent`. Esta rota:
- Exibe e permite editar `title`, `body`, `ai_context`, `status`
- Lista e permite criar e editar `ChannelPiece`s (inline, sem rota própria)
- Exibe breadcrumb: Projeto → Conteúdo Editorial
- Está acessível a partir de `/publicacoes` e da aba Publicações da Production

O `projectId` na URL não é redundante — `EditorialContent.project_id` é obrigatório
e o contexto de Projeto é necessário para o breadcrumb e para pré-preencher o
seletor de Production.

### Rota de Production — `/projetos/[projectId]/producoes/[productionId]`

A rota já existente permanece. A aba "Publicações" é expandida em P5 para exibir
`EditorialContent`s filtrados por `production_id`, com `ChannelPiece`s expandíveis.
O link de cada `EditorialContent` navega para a rota de detalhe editorial.

### ChannelPieces — sem rota própria

`ChannelPiece`s são gerenciadas exclusivamente dentro da página de detalhe do
`EditorialContent`. Não há rota `/channel-pieces/[id]` exposta na UI.

### Sidebar durante a transição

O item da sidebar "Publicações" aponta para `/publicacoes` (novo).
A rota `/posts` permanece funcional e acessível por URL direta com autenticação.
Posts legados não são mais promovidos na navegação principal — apenas disponíveis
como arquivo acessível via URL direta (M9, 2026-06-24).

---

## 16. Respostas Formais às Questões em Aberto

As 6 questões de `PUBLICATION_DOMAIN_DISCOVERY.md` Seção 9 recebem respostas formais:

---

**Q1: Quem decide o canal?**

**R:** O canal e o formato são definidos no momento de criação da `ChannelPiece`,
pelo criador de conteúdo (PUB-D8, PUB-D16).

O `EditorialContent` não tem canal — é independente de canal por design. O usuário
decide para qual canal e formato adaptar o conteúdo ao criar cada `ChannelPiece`.

---

**Q2: Um `EditorialContent` pode existir sem nenhuma `ChannelPiece`?**

**R:** Sim. Zero `ChannelPiece`s é um estado válido (PUB-D9).

Um `EditorialContent` com `status = 'draft'` e zero `ChannelPiece`s é um rascunho
editorial puro — o criador elabora o conteúdo antes de decidir para qual canal adaptar.

---

**Q3: A aba "Publicações" deve mostrar `EditorialContent`s ou `ChannelPiece`s?**

**R:** A aba exibe `EditorialContent`s como entidade principal, com `ChannelPiece`s
expandíveis dentro de cada um (PUB-D10).

---

**Q4: Aprovação formal é necessária?**

**R:** Não nesta fase. `ChannelPiece.status = 'approved'` é aprovação manual
simples, sem workflow formal (PUB-D11).

O princípio de `PRODUCTION_DECISIONS.md` D7 se aplica: "IA aprova qualidade;
humano aprova uso." Nesta fase não há agente avaliador de conteúdo editorial.

---

**Q5: Múltiplos autores?**

**R:** Fora do escopo desta fase. `user_id` permanece como único proprietário.

---

**Q6: Integração com APIs externas é no escopo do produto?**

**R:** Não nesta fase. `Distribution` é adiada. Publicação manual não está modelada
como estado no schema (PUB-D15, PUB-D17).

---

## 17. Mapeamento do Legado `Post`

A entidade `Post` em `lib/types.ts` (linha 127) mapeia para o novo modelo:

| Campo do `Post` atual | Entidade alvo | Campo alvo | Observação |
|-----------------------|---------------|------------|------------|
| `id` | — | Novo UUID em cada entidade | Não reutilizar |
| `user_id` | `EditorialContent` | `user_id` | |
| `project_id` | `EditorialContent` | `project_id` | |
| `production_id` | `EditorialContent` | `production_id` | |
| `name` | `EditorialContent` | `title` | Renomeado |
| `description` | `EditorialContent` | `body` | |
| `ai_context` | `EditorialContent` | `ai_context` | |
| `channel` (PublicationType) | `ChannelPiece` | `channel + format` | Separados (ver Seção 8.1) |
| `feed_text` | `ChannelPiece` | `body` | Renomeado (PUB-D18) |
| `image_url` | `ChannelPieceAsset` (futuro) | `asset_id` + `asset_kind = 'image'` | Sem campo transitório |
| `thumbnail_url` | `ChannelPieceAsset` (futuro) | `role: 'thumbnail'` | |
| `storage_provider`, `storage_path`, `file_size`, `mime_type` | `ChannelPieceAsset` (futuro) | campos de asset | |
| `post_images` (JSONB) | `ChannelPieceAsset` (futuro) | N registros | Cada `PostImage` → 1 `ChannelPieceAsset` |
| `status: 'draft'` | `EditorialContent` | `status: 'draft'` | |
| `status: 'saved'` | `ChannelPiece` | `status: 'approved'` | Semântica mais precisa |

**Um `Post` atual mapeia para um par `EditorialContent` + uma `ChannelPiece`.**

Esta migração está condicionada a uma auditoria dos dados legados antes de qualquer
execução. A auditoria deve verificar:

- Posts com `project_id = null` (violam `EditorialContent.project_id NOT NULL`)
- Posts com `channel` ausente ou fora dos valores de `PublicationType`
- Posts com `description` e `feed_text` ambos vazios
- Posts com `status = 'saved'` mas sem `feed_text` (aprovado sem conteúdo)
- Posts com `post_images` JSONB não-vazio (cada item → `ChannelPieceAsset` futuro)
- Posts com `image_url` sem rastreabilidade para a tabela `images`
- Posts com `production_id` vs sem `production_id` (impacto nas proporções)

**Nenhuma migration de dados entra em P1–P6.**

---

## 18. Cardinalidades

```
Project          1    ──────────── N   EditorialContent
Production       0..1 ──────────── N   EditorialContent  (production_id nullable)
EditorialContent 1    ──────────── N   ChannelPiece
ChannelPiece     1    ──────────── N   Distribution       (adiada)
ChannelPiece     N    ──────────── N   Asset              (via ChannelPieceAsset — futuro)
```

**Mínimos válidos:**

| Situação | Válido? | Razão |
|----------|---------|-------|
| `EditorialContent` com 0 `ChannelPiece`s | Sim | Rascunho editorial puro |
| `ChannelPiece` com 0 `Distribution`s | Sim | Peça aprovada, não publicada ainda |
| `ChannelPiece` com 0 assets | Sim | Peça de texto puro, sem mídia |
| `EditorialContent` sem `production_id` | Sim | Fluxo rápido fora de Produção |

**Unicidade de canal+formato por `EditorialContent`:** não há restrição de unicidade.
O mesmo `EditorialContent` pode ter duas `ChannelPiece`s com o mesmo `channel + format`
(ex: dois textos diferentes para `instagram + feed` — teste A/B). Isso é intencional.

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
- `qualquer → archived` (reversível; reativação exige ação explícita)

### `ChannelPiece.status`

```
draft     →  Adaptação de canal em elaboração. body sendo escrito.
              Ainda não revisada pelo criador.

ready     →  Peça completa e revisada pelo criador. Pronta para aprovação final.
              Pode estar aguardando revisão de um colaborador futuro.

approved  →  A peça foi aprovada pelo criador para publicação.
              "IA aprova qualidade; humano aprova uso." (D7 de PRODUCTION_DECISIONS.md)
              Nesta fase, aprovação é ação manual. Sem workflow formal.

archived  →  Peça encerrada. Não será publicada. Guardada como referência.
```

**Transições:**
- `draft → ready` (criador termina de escrever)
- `ready → draft` (criador reverte para ajuste)
- `ready → approved` (criador aprova)
- `approved → ready` (criador reverte para ajuste pós-aprovação)
- `qualquer → archived` (encerramento)
- `archived → draft` (reativação explícita)

**Por que sem `published` (PUB-D17):** o ato de publicação é responsabilidade de
`Distribution` (adiada). Usar `published` como estado de `ChannelPiece` colapsaria
uma decisão editorial ("aprovado para publicar") com um fato operacional ("foi
publicado") — as mesmas responsabilidades misturadas que levaram ao diagnóstico do
`Post` híbrido. Esta fase não registra publicações.

### `Distribution.status` (adiada — referência para fase futura)

```
scheduled   →  Publicação agendada, aguardando o horário programado.
published   →  Publicação confirmada pela plataforma externa.
failed      →  Tentativa de publicação falhou (ver error_message).
cancelled   →  Agendamento cancelado antes da publicação.
```

---

## 20. Escopo da Próxima Fase de Implementação

**O que deve ser implementado em P1–P6:**

1. **Tabela `editorial_contents`** com os campos definidos na Seção 7
2. **Tabela `channel_pieces`** com os campos definidos na Seção 8 (`channel`, `format`, `body`, `cta`, `hashtags` — sem `image_url`)
3. **RLS** seguindo o padrão `user_id = auth.uid()` das tabelas existentes
4. **API routes:**
   - `GET / POST / PATCH / DELETE /api/editorial-contents` e `/api/editorial-contents/[id]`
   - `GET / POST / PATCH / DELETE /api/channel-pieces` e `/api/channel-pieces/[id]`
5. **Rota global `/publicacoes`** listando `EditorialContent`s + acesso a Posts legados
6. **Rota de detalhe** `/projetos/[projectId]/conteudos/[editorialContentId]`
7. **UI de criação de `ChannelPiece`** (inline no detalhe do `EditorialContent`)
8. **Geração assistida de `body`** para o canal e formato (rota editorial nova — P4)
9. **Aba Publicações na Produção** exibindo `EditorialContent`s com `ChannelPiece`s (P5)

**Pré-condições confirmadas:**
- Schema da entidade `Production` implementado em `scripts/020_create_productions.sql` ✓
- APIs `/api/productions/` implementadas ✓
- Rota de detalhe da Production: `/projetos/[id]/producoes/[productionId]/page.tsx` ✓
- O banner `// INTEGRAÇÃO PROVISÓRIA` em `app/api/posts/route.ts` permanece intacto ✓
- `Feed Generator` (`app/api/posts/generate-feed-text/route.ts`) **não é alterado em P1 ou P2**

---

## 21. O Que Está Fora do Escopo

Estas decisões são explicitamente adiadas:

| Item | Razão do adiamento |
|------|-------------------|
| Entidade `Distribution` | Requer integração com APIs externas e serviço de agendamento |
| Registro de publicação manual | Não modelado como estado — gap de produto reconhecido |
| Tabela `ChannelPieceAsset` | Requer unificação do conceito de Asset (Fase A de `DOMAIN_EVOLUTION.md`) |
| Migração de `posts` → `editorial_contents + channel_pieces` | Requer auditoria de dados legados e aprovação explícita |
| Workflow de aprovação formal | Requer multi-usuário (fase futura) |
| Integração com Instagram, YouTube, LinkedIn | Requer credenciais de API, OAuth, webhooks |
| Agendamento de publicações | Requer `Distribution` implementada |
| FK direta `EditorialContent → VideoDraft` | Relação futura opcional — implícita via `production_id` compartilhado |
| Agente avaliador de conteúdo editorial | Requer Planejador de Produção (Fase C) |
| `image_url` transitório em `ChannelPiece` | Nenhum fluxo de P1–P5 requer (PUB-D19) |
| `manually_published_at` | Sem decisão de produto validada — aguarda `Distribution` |
| Atualização retrospectiva completa de `ARCHITECTURE.md` | Dívida documental — não bloqueia P1–P6 |

---

## Registro de Decisões (PUB-D*)

| Código | Decisão | Seção |
|--------|---------|-------|
| PUB-D1 | A entidade central do conteúdo editorial se chama `EditorialContent` | 5 |
| PUB-D2 | A entidade de adaptação de canal se chama `ChannelPiece` | 6 |
| PUB-D3 | O modelo é em três camadas: `EditorialContent → ChannelPiece → Distribution` | 4 |
| PUB-D4 | `Distribution` é adiada — não implementar sem integração com APIs externas | 9 |
| PUB-D5 | `EditorialContent.project_id` é NOT NULL — todo conteúdo editorial requer um Projeto | 7 |
| PUB-D6 | `EditorialContent.production_id` é nullable com ON DELETE SET NULL | 7, 10 |
| PUB-D7 | `ChannelPiece.editorial_content_id` usa ON DELETE CASCADE | 8 |
| PUB-D8 | Canal e formato são propriedade de `ChannelPiece`, não de `EditorialContent` | 8, 8.1 |
| PUB-D9 | `EditorialContent` com zero `ChannelPiece`s é um estado válido | 8, 18 |
| PUB-D10 | A aba Publicações exibe `EditorialContent`s; `ChannelPiece`s são expandíveis | 15 |
| PUB-D11 | Aprovação é ação manual (`ChannelPiece.status = 'approved'`); sem workflow formal | 16 |
| PUB-D12 | `ChannelPieceAsset` (N:N) é tabela futura; sem `image_url` em P1 | 11, 21 |
| PUB-D13 | Um `Post` atual mapeia para exatamente um `EditorialContent` + uma `ChannelPiece` | 17 |
| PUB-D14 | A tabela `posts` e a API `/api/posts` permanecem congeladas e intactas | 20 |
| PUB-D15 | Integração com APIs externas fora do escopo; publicação não é modelada nesta fase | 16, 21 |
| PUB-D16 | `channel` e `format` são campos separados em `ChannelPiece`; `PublicationType` não é herdado | 8.1 |
| PUB-D17 | `ChannelPiece.status` não inclui `published`; o ato de publicação pertence a `Distribution` | 8, 19 |
| PUB-D18 | O campo de texto adaptado em `ChannelPiece` se chama `body`, não `feed_text` | 8 |
| PUB-D19 | `image_url` não entra no schema de `ChannelPiece` em P1–P5; sem campo transitório | 8, 21 |
| PUB-D20 | Rotas: `/publicacoes` (hub global), `/projetos/[id]/conteudos/[id]` (detalhe), Production existente | 15.1 |

---

*Documento produzido na sessão de modelagem de domínio da Fase 2.*
*Revisão 2 incorpora refinamentos de canal/formato, status, rotas e campos de ChannelPiece.*
*Próximo passo: implementar as entidades com base em `PUBLICATION_IMPLEMENTATION_PLAN.md`.*

---

## Atualização M8–M9 — Estado Atual (2026-06-24)

As decisões PUB-D13 e PUB-D14 foram executadas integralmente.

### PUB-D13 aplicada — Migração completa

4/4 Posts convertidos em `EditorialContent + ChannelPiece` (M8.3A + M8.4, 2026-06-24):
- P1 com `ChannelPieceMedia` (S3 copy)
- P2, P3, P4 sem mídia
- `legacy_post_id` preenchido em todos os 4 ECs (rastreabilidade 1:1)
- `migrated_at` set em todos os 4 Posts

### PUB-D14 revisada — Posts congelados e aposentados operacionalmente

Com M9 (2026-06-24), a decisão PUB-D14 foi evoluída:

| Aspecto | Estado anterior (pré-M9) | Estado atual (pós-M9) |
|---------|--------------------------|----------------------|
| Tabela `posts` | congelada, intacta | congelada, intacta — PRESERVADA |
| API `/api/posts` | congelada | congelada — PRESERVADA. GET=200, POST=410, PATCH/DELETE migrado=409 |
| Rota `/posts` | funcional, acesso pela sidebar | funcional, acesso somente por URL direta. Sidebar removida. |
| UI de criação | "Novo Post" desabilitado | "Novo Post" desabilitado — sem mudança |
| Acesso em Conteúdos | link "Acessar Publicações legadas" | link removido — M9 |
| Aba na Production | "Posts legados" visível | aba removida — M9 |
| Identidade /posts | título "Publicações" | título "Arquivo legado de Posts" + banner âmbar — M9 |

**PUB-D21 (nova, M9):** Posts estão operacionalmente aposentados. O fluxo primário é exclusivamente via `EditorialContent + ChannelPiece`. O arquivo legado `/posts` é acessível por URL direta para auditoria, sem promoção na navegação.

### Critérios para PUB-D22 (M10 — remoção definitiva)

M10 é a decisão de remover fisicamente os Posts. Requer autorização explícita separada após:
- Período de observação de 4–8 semanas sem acessos ao fluxo legado
- Auditoria SQL confirmando zero novos posts criados após M9
- Validação de que nenhuma dependência ativa (scripts, integrações, jobs) referencia a tabela `posts`

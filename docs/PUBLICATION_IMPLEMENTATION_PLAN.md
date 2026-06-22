# Content Agent Studio — Plano de Implementação: Publicações
**Fase 2 · Publicações · P1–P6 · Junho 2026**

> **Escopo deste documento:** implementação do domínio de publicações em seis
> incrementos independentes. Cada incremento é deployável de forma isolada.
>
> **Restrições absolutas durante P1–P6:**
> - Não implementar `Distribution` (requer APIs externas)
> - Não executar migração de dados de `posts`
> - Não alterar `app/api/posts/route.ts` nem `app/api/posts/generate-feed-text/route.ts`
> - Não fazer merge em `main` sem aprovação explícita

---

## 1. Estado Confirmado do Código

### Entidades existentes relevantes

| Tabela | Status | Papel nas Publicações |
|--------|--------|-----------------------|
| `projects` | ativo | Contexto obrigatório de `EditorialContent` |
| `productions` | ativo | Contexto opcional de `EditorialContent` |
| `posts` | congelado | Legado — não alterar; continua funcional |
| `image_drafts` | ativo | Referenciado via `production_id` compartilhado |
| `video_drafts` | ativo | Referenciado via `production_id` compartilhado |

### APIs relevantes

| Rota | Status | Observação |
|------|--------|-----------|
| `GET/POST /api/productions` | ativo | Padrão de validação a ser seguido |
| `GET/PATCH/DELETE /api/productions/[id]` | ativo | Padrão de PATCH com keys permitidas |
| `GET/POST/PATCH/DELETE /api/posts` | congelado | Banner INTEGRAÇÃO PROVISÓRIA — não alterar |
| `POST /api/posts/generate-feed-text` | congelado | Feed Generator — não alterar em P1–P4 |

### Rota de UI existente que será expandida em P5

```
app/(dashboard)/projetos/[id]/producoes/[productionId]/page.tsx
```

Aba "Publicações" atualmente lista `posts` com `production_id = <id>`. Será
substituída em P5 para exibir `EditorialContent`s.

### Padrões estabelecidos (seguir em P1–P6)

1. **RLS:** `user_id = auth.uid()` em todas as tabelas, em SELECT / INSERT / UPDATE / DELETE
2. **FK pattern:** `ON DELETE RESTRICT` quando a entidade não pode existir sem o pai;
   `ON DELETE CASCADE` quando o filho é dependente semântico; `ON DELETE SET NULL` quando
   o filho sobrevive
3. **Trigger `updated_at`:** função `update_updated_at_column()` já existe (criada em 001)
4. **API auth pattern:** `getAuthenticatedClient()` com `supabase.auth.getUser()`
5. **PATCH seguro:** whitelist de campos permitidos via `ALLOWED_PATCH_KEYS`
6. **Validação de FK:** verificar ownership antes de usar `productionId` ou `projectId`
7. **Tipos TypeScript:** todas as entidades têm interface correspondente em `lib/types.ts`

---

## 2. Modelo de Dados Confirmado

### 2.1 `editorial_contents`

| Campo | Tipo | Restrição | Descrição |
|-------|------|-----------|-----------|
| `id` | uuid | PK DEFAULT gen_random_uuid() | Identificador único |
| `user_id` | uuid | NOT NULL FK → auth.users CASCADE | Proprietário |
| `project_id` | uuid | NOT NULL FK → projects RESTRICT | Projeto obrigatório |
| `production_id` | uuid | nullable FK → productions SET NULL | Produção opcional |
| `title` | text | NOT NULL | Título editorial |
| `body` | text | nullable | Corpo do conteúdo |
| `ai_context` | text | nullable | Instrução para agentes de IA |
| `status` | text | NOT NULL DEFAULT 'draft' CHECK ('draft','ready','archived') | Estado |
| `created_at` | timestamptz | NOT NULL DEFAULT NOW() | |
| `updated_at` | timestamptz | NOT NULL DEFAULT NOW() | |

### 2.2 `channel_pieces`

| Campo | Tipo | Restrição | Descrição |
|-------|------|-----------|-----------|
| `id` | uuid | PK DEFAULT gen_random_uuid() | Identificador único |
| `user_id` | uuid | NOT NULL FK → auth.users CASCADE | Proprietário |
| `editorial_content_id` | uuid | NOT NULL FK → editorial_contents CASCADE | EC de origem |
| `channel` | text | NOT NULL CHECK (ver seção 2.4) | Canal de destino |
| `format` | text | NOT NULL CHECK (ver seção 2.4) | Formato dentro do canal |
| `title` | text | nullable | Override de título para o canal |
| `body` | text | nullable | Texto adaptado para o canal e formato |
| `cta` | text | nullable | Chamada para ação |
| `hashtags` | text | nullable | Hashtags em string livre |
| `status` | text | NOT NULL DEFAULT 'draft' CHECK ('draft','ready','approved','archived') | Estado |
| `created_at` | timestamptz | NOT NULL DEFAULT NOW() | |
| `updated_at` | timestamptz | NOT NULL DEFAULT NOW() | |

### 2.3 Numeração da migration

A próxima migration é `021_create_publication_entities.sql`.
Scripts 001–020 já existem em `scripts/`.

### 2.4 Valores de `channel` e `format` (P1)

**`channel`** (CHECK constraint):
```
instagram | youtube | whatsapp | linkedin | x | tiktok
```

**`format`** (CHECK constraint):
```
feed | story | reel | short | video_description | post | channel_message | carousel | article
```

Combinações válidas são validadas pela camada de aplicação. O banco valida cada
campo individualmente. A lista de combinações válidas reside em
`lib/publication-channels.ts` (criado em P2).

---

## 3. Rotas Aprovadas

| Rota | Tipo | Incremento |
|------|------|-----------|
| `/publicacoes` | Nova — hub global de publicações | P3 |
| `/projetos/[projectId]/conteudos/[editorialContentId]` | Nova — detalhe do EC | P3 |
| `/projetos/[projectId]/producoes/[productionId]` | Existente — aba Publicações expandida | P5 |

**Sidebar:** item "Publicações" aponta para `/publicacoes` a partir de P3.
A rota `/posts` permanece acessível mas não é o item primário.
ChannelPieces não têm rota própria — gerenciadas inline na página do EC.

---

## 4. Valores de Status

### `EditorialContent.status`

| Status | Semântica |
|--------|-----------|
| `draft` | Conteúdo em elaboração (padrão inicial) |
| `ready` | Núcleo editorial finalizado |
| `archived` | Encerrado pelo usuário |

Transições: `draft ↔ ready` (reversível), `qualquer → archived` (reversível).

### `ChannelPiece.status`

| Status | Semântica |
|--------|-----------|
| `draft` | Adaptação em elaboração (padrão inicial) |
| `ready` | Revisada pelo criador, pronta para aprovação |
| `approved` | Aprovada para publicação ("humano aprova uso") |
| `archived` | Encerrada — não será publicada |

Transições: `draft ↔ ready`, `ready ↔ approved`, `qualquer → archived`, `archived → draft`.
**Não existe `published`** — publicação pertence a `Distribution` (adiada).

---

## 5. Mapeamento de `PublicationType` → `channel + format`

Para uso na futura migração de dados. **Não executar em P1–P6.**

| `PublicationType` (posts legados) | `channel` | `format` |
|----------------------------------|-----------|----------|
| `instagram_post` | `instagram` | `feed` |
| `instagram_story` | `instagram` | `story` |
| `youtube_post` | `youtube` | `post` |
| `youtube_shorts` | `youtube` | `short` |
| `youtube_video` | `youtube` | `video_description` |

---

## 6. Migração de `Post` — Estratégia Padrão (fora de P1–P6)

Um `Post` atual mapeia para: **1 `EditorialContent` + 1 `ChannelPiece`**.

Esta migração está condicionada à aprovação de uma auditoria de dados legados.
A auditoria deve avaliar:

- Posts com `project_id = null` (violam `EditorialContent.project_id NOT NULL`)
- Posts com `channel` fora dos valores de `PublicationType`
- Posts com `description` e `feed_text` ambos vazios
- Posts com `status = 'saved'` mas sem `feed_text`
- Posts com `post_images` JSONB não-vazio (cada item → `ChannelPieceAsset` futuro)
- Posts com `image_url` sem rastreabilidade para `images`
- Proporção posts com `production_id` vs sem `production_id`

Nenhuma migration de dados entra em P1–P6. O congelamento de `posts` se mantém.

---

## 7. Dívida Documental Registrada

Estas inconsistências foram identificadas e registradas. **Não bloqueiam P1–P6.**

| Inconsistência | Localização | Ação |
|---------------|------------|------|
| `ARCHITECTURE.md` não menciona tabela `productions`, script 020, rotas de Production, nem componentes de Production | `docs/ARCHITECTURE.md` | Atualizar em sessão dedicada após implementação das entidades de publicação |
| `PRODUCTION_IMPLEMENTATION_PLAN.md` seção 4 e 6 descrevem `ON DELETE CASCADE` para `productions.project_id`, mas D.H.3 e implementação real usam `ON DELETE RESTRICT` | `docs/PRODUCTION_IMPLEMENTATION_PLAN.md` | Corrigir comentário histórico; não é bloqueante |
| `PUBLICATION_DOMAIN_DISCOVERY.md` seção 8 referencia `app/(dashboard)/producao/[id]/page.tsx` — esta rota não existe | `docs/PUBLICATION_DOMAIN_DISCOVERY.md:316` | Rota correta: `app/(dashboard)/projetos/[id]/producoes/[productionId]/page.tsx`; documento é de descoberta e permanece como registro histórico |

---

## P1 — Schema e Tipos ✓ CONCLUÍDO — branch feat/publication-p1-schema

**Objetivo:** criar as tabelas `editorial_contents` e `channel_pieces` no banco e os
tipos TypeScript correspondentes em `lib/types.ts`.

**Status:** concluído. Commit `feat: add publication domain schema and types` em `feat/publication-p1-schema`.

**Arquivos reais criados/modificados:**

| Arquivo | Ação |
|---------|------|
| `scripts/021_create_publication_entities.sql` | Criado |
| `lib/types.ts` | Atualizado — adicionadas interfaces e tipos de publicação |
| `lib/publication-channels.ts` | Criado (antecipado de P2 — ver divergências abaixo) |

**Divergências entre plano e implementação:**

- `lib/publication-channels.ts` foi criado em P1 (o plano original o colocava em P2).
  Razão: os tipos em `lib/types.ts` referenciavam `PublicationChannel` e `PublicationFormat`,
  e o arquivo de constantes runtime é necessário desde P1 para manter consistência entre
  tipos de compilação e valores aceitos pelo banco. A API em P2 já encontrará o arquivo pronto.

**Resultado de typecheck (`pnpm exec tsc --noEmit`):**
- 1 erro pré-existente em `app/(dashboard)/imagens/rascunhos/page.tsx:43` (TS7006 — parâmetro `d` sem tipo)
- 0 erros introduzidos por P1

**Resultado de build (`pnpm build`):**
- Build bem-sucedido — 30 páginas geradas sem erros

**Migration aplicada no Supabase:** não — aguarda autorização explícita.



### Escopo

- Migration `scripts/021_create_publication_entities.sql`
- Atualizar `lib/types.ts`
- Criar `lib/publication-channels.ts` com valores válidos de channel/format

### Fora do escopo de P1

- Qualquer API route
- Qualquer componente de UI
- Migração de dados de `posts`
- Tabela `Distribution`
- Tabela `ChannelPieceAsset`

### Dependências

- Script 020 (tabela `productions`) ✓ implementado

### Arquivos afetados

| Arquivo | Ação |
|---------|------|
| `scripts/021_create_publication_entities.sql` | Criar |
| `lib/types.ts` | Atualizar — adicionar interfaces |
| `lib/publication-channels.ts` | Criar — constantes de channel/format |

### Conteúdo de `scripts/021_create_publication_entities.sql`

```sql
-- editorial_contents
CREATE TABLE IF NOT EXISTS editorial_contents (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  project_id    UUID NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,
  production_id UUID REFERENCES productions(id) ON DELETE SET NULL,
  title         TEXT NOT NULL,
  body          TEXT,
  ai_context    TEXT,
  status        TEXT NOT NULL DEFAULT 'draft'
                CHECK (status IN ('draft', 'ready', 'archived')),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE editorial_contents ENABLE ROW LEVEL SECURITY;

CREATE POLICY "editorial_contents_select" ON editorial_contents
  FOR SELECT USING (user_id = auth.uid());
CREATE POLICY "editorial_contents_insert" ON editorial_contents
  FOR INSERT WITH CHECK (user_id = auth.uid());
CREATE POLICY "editorial_contents_update" ON editorial_contents
  FOR UPDATE USING (user_id = auth.uid());
CREATE POLICY "editorial_contents_delete" ON editorial_contents
  FOR DELETE USING (user_id = auth.uid());

CREATE TRIGGER set_editorial_contents_updated_at
  BEFORE UPDATE ON editorial_contents
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE INDEX IF NOT EXISTS idx_editorial_contents_user_id
  ON editorial_contents(user_id);
CREATE INDEX IF NOT EXISTS idx_editorial_contents_project_id
  ON editorial_contents(project_id);
CREATE INDEX IF NOT EXISTS idx_editorial_contents_production_id
  ON editorial_contents(production_id);

-- channel_pieces
CREATE TABLE IF NOT EXISTS channel_pieces (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id               UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  editorial_content_id  UUID NOT NULL REFERENCES editorial_contents(id) ON DELETE CASCADE,
  channel               TEXT NOT NULL
                        CHECK (channel IN (
                          'instagram', 'youtube', 'whatsapp',
                          'linkedin', 'x', 'tiktok'
                        )),
  format                TEXT NOT NULL
                        CHECK (format IN (
                          'feed', 'story', 'reel', 'short', 'video_description',
                          'post', 'channel_message', 'carousel', 'article'
                        )),
  title                 TEXT,
  body                  TEXT,
  cta                   TEXT,
  hashtags              TEXT,
  status                TEXT NOT NULL DEFAULT 'draft'
                        CHECK (status IN ('draft', 'ready', 'approved', 'archived')),
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE channel_pieces ENABLE ROW LEVEL SECURITY;

CREATE POLICY "channel_pieces_select" ON channel_pieces
  FOR SELECT USING (user_id = auth.uid());
CREATE POLICY "channel_pieces_insert" ON channel_pieces
  FOR INSERT WITH CHECK (user_id = auth.uid());
CREATE POLICY "channel_pieces_update" ON channel_pieces
  FOR UPDATE USING (user_id = auth.uid());
CREATE POLICY "channel_pieces_delete" ON channel_pieces
  FOR DELETE USING (user_id = auth.uid());

CREATE TRIGGER set_channel_pieces_updated_at
  BEFORE UPDATE ON channel_pieces
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE INDEX IF NOT EXISTS idx_channel_pieces_user_id
  ON channel_pieces(user_id);
CREATE INDEX IF NOT EXISTS idx_channel_pieces_editorial_content_id
  ON channel_pieces(editorial_content_id);
```

### Novos tipos em `lib/types.ts`

```typescript
export type EditorialContentStatus = 'draft' | 'ready' | 'archived'
export type ChannelPieceStatus = 'draft' | 'ready' | 'approved' | 'archived'
export type EditorialChannel = 'instagram' | 'youtube' | 'whatsapp' | 'linkedin' | 'x' | 'tiktok'
export type EditorialFormat =
  | 'feed' | 'story' | 'reel' | 'short' | 'video_description'
  | 'post' | 'channel_message' | 'carousel' | 'article'

export interface EditorialContent {
  id: string
  user_id: string
  project_id: string
  production_id: string | null
  title: string
  body: string | null
  ai_context: string | null
  status: EditorialContentStatus
  created_at: string
  updated_at: string
}

export interface ChannelPiece {
  id: string
  user_id: string
  editorial_content_id: string
  channel: EditorialChannel
  format: EditorialFormat
  title: string | null
  body: string | null
  cta: string | null
  hashtags: string | null
  status: ChannelPieceStatus
  created_at: string
  updated_at: string
}
```

### Critérios de aceite

- [ ] Migration aplica sem erro em banco limpo
- [ ] Migration aplica sem erro em banco com dados existentes de productions, posts, image_drafts
- [ ] `INSERT INTO editorial_contents` com `project_id` válido do usuário → sucesso
- [ ] `INSERT INTO editorial_contents` com `project_id` de outro usuário → falha RLS
- [ ] `DELETE projects WHERE id = <id com editorial_contents>` → erro FK RESTRICT
- [ ] `DELETE productions WHERE id = <id>` → editorial_contents com production_id = null
- [ ] `DELETE editorial_contents WHERE id = <id>` → channel_pieces deletadas em CASCADE
- [ ] Usuário A não consegue SELECT em editorial_contents do Usuário B
- [ ] Tipos TypeScript compilam sem erro: `npx tsc --noEmit`
- [ ] Aplicação funciona identicamente ao estado anterior (nenhuma rota quebrada)

### Testes

1. Executar a migration no Supabase local
2. Verificar no painel Supabase: tabelas existem, RLS habilitada, 4 policies cada
3. Rodar `npx tsc --noEmit` — zero erros
4. Verificar que a aplicação inicia e as rotas existentes funcionam

### Riscos

| Risco | Mitigação |
|-------|-----------|
| `update_updated_at_column()` não existir em banco local de teste | Verificar no script 001; garantir que scripts rodam em ordem |
| Conflito de nome com tabela ou tipo existente | Verificar via `SELECT table_name FROM information_schema.tables` antes de aplicar |

### Rollback

```sql
DROP TABLE IF EXISTS channel_pieces;
DROP TABLE IF EXISTS editorial_contents;
```

Remover as interfaces adicionadas de `lib/types.ts`.

---

## P2 — APIs CRUD ✓ CONCLUÍDO — branch feat/publication-p2-api

**Objetivo:** implementar rotas de CRUD para `EditorialContent` e `ChannelPiece`.
API pura sem UI. Sem alterar rotas existentes.

**Status:** concluído. Commit `feat: add publication domain APIs` em `feat/publication-p2-api`.

**Arquivos reais criados/modificados:**

| Arquivo | Ação |
|---------|------|
| `app/api/editorial-contents/route.ts` | Criado — GET (lista) + POST |
| `app/api/editorial-contents/[id]/route.ts` | Criado — GET + PATCH + DELETE |
| `app/api/channel-pieces/route.ts` | Criado — GET (lista) + POST |
| `app/api/channel-pieces/[id]/route.ts` | Criado — GET + PATCH + DELETE |

**Resultado de typecheck (`pnpm exec tsc --noEmit`):**
- 1 erro pré-existente em `app/(dashboard)/imagens/rascunhos/page.tsx:43` (TS7006 — herdado de P1)
- 0 erros introduzidos por P2

**Resultado de build (`pnpm build`):**
- Build bem-sucedido — 4 rotas dinâmicas confirmadas no output:
  `ƒ /api/editorial-contents`, `ƒ /api/editorial-contents/[id]`,
  `ƒ /api/channel-pieces`, `ƒ /api/channel-pieces/[id]`

**Validação de schema via Supabase MCP (modo read-only):**

| Item | Resultado |
|------|-----------|
| Tabelas existem com RLS habilitada | ✓ |
| `editorial_contents`: 8 colunas, checks de title/body/ai_context/status | ✓ |
| `channel_pieces`: 11 colunas, checks de channel/format/title/body/cta/hashtags/status | ✓ |
| FK `editorial_contents.project_id → projects` ON DELETE RESTRICT | ✓ |
| FK `editorial_contents.production_id → productions` ON DELETE SET NULL | ✓ |
| FK `channel_pieces.editorial_content_id → editorial_contents` ON DELETE CASCADE | ✓ |
| RLS SELECT: `auth.uid() = user_id` (ambas tabelas) | ✓ |
| RLS INSERT `editorial_contents`: uid=user_id + project ownership + production ownership | ✓ |
| RLS INSERT `channel_pieces`: uid=user_id + editorial_content ownership | ✓ |
| RLS UPDATE: mesmas regras do INSERT (ambas tabelas) | ✓ |
| RLS DELETE: `auth.uid() = user_id` (ambas tabelas) | ✓ |

**Testes HTTP autenticados:** não executados — o servidor de desenvolvimento não pôde
ser iniciado porque `NEXT_PUBLIC_SUPABASE_URL` e `NEXT_PUBLIC_SUPABASE_ANON_KEY` não
estão presentes em `.env.local` (essas variáveis são injetadas pelo ambiente do usuário
ao iniciar o servidor manualmente). Os testes de integração ficam pendentes para
execução manual pelo responsável do produto ao iniciar `pnpm dev` em sessão autenticada.

**Divergências entre plano e implementação:**

1. **`projectId` é editável no PATCH de `EditorialContent`** — o plano dizia que
   `project_id` nunca seria editável. A spec de P2 expandiu esse comportamento para
   permitir a movimentação de EC entre projetos do mesmo usuário, com revalidação da
   Production existente contra o novo projeto.

2. **`editorialContentId` é editável no PATCH de `ChannelPiece`** — o plano dizia
   que `editorial_content_id` era imutável. A spec de P2 permite mover uma ChannelPiece
   para outro EC do mesmo usuário, com validação de ownership do EC destino.

3. **Modo `linkOnly` não implementado** — o plano descrevia um modo `linkOnly: true`
   no PATCH de EC. A spec de P2 unificou o comportamento: o PATCH padrão já aceita
   `productionId` e `projectId` com toda a validação cruzada necessária, tornando o
   `linkOnly` desnecessário.

4. **GET de `channel_pieces` não exige `editorialContentId` como obrigatório** — o
   plano dizia "(obrigatório)". A spec de P2 tornou todos os filtros opcionais,
   aplicando apenas `.eq('user_id', user.id)` como restrição base (RLS defense in depth).

5. **Limite de caracteres aplicado em dupla camada** — validação na API (400 imediato)
   e CHECK no banco (fallback). Garante mensagens de erro úteis antes de chegar ao banco.

### Escopo

Criar 4 novos arquivos de API. Nenhuma rota existente é modificada.

### Fora do escopo de P2

- Qualquer UI
- Feed Generator — não alterar `generate-feed-text/route.ts`
- Rota de geração de body para `ChannelPiece` (pertence a P4)
- Migração de dados

### Dependências

- P1 concluído (tabelas existem, tipos definidos)

### Arquivos afetados

| Arquivo | Ação |
|---------|------|
| `app/api/editorial-contents/route.ts` | Criar |
| `app/api/editorial-contents/[id]/route.ts` | Criar |
| `app/api/channel-pieces/route.ts` | Criar |
| `app/api/channel-pieces/[id]/route.ts` | Criar |
| `lib/publication-channels.ts` | Criar — validação de combinações channel+format |

### Comportamento de cada rota

**`GET /api/editorial-contents`**
- Query params: `?projectId=<uuid>` (obrigatório se não houver `productionId`) OU `?productionId=<uuid>`
- Retorna: lista de `EditorialContent`s do usuário, ordenados por `updated_at DESC`
- Limite: 200 (cap defensivo, sem paginação no MVP)

**`POST /api/editorial-contents`**
- Body: `{ projectId, productionId?, title, body?, aiContext?, status? }`
- Validações:
  - `projectId` presente e é UUID válido
  - `projectId` pertence ao usuário (`user_id = auth.uid()`)
  - `productionId` (se fornecido) pertence ao usuário e ao mesmo `project_id`
  - `title` não vazio após trim
  - `status` (se fornecido) é um dos valores válidos de `EditorialContentStatus`
- Erro FK 23503 → 400 com mensagem descritiva

**`GET /api/editorial-contents/[id]`**
- Retorna o `EditorialContent` pelo `id` e `user_id`
- 404 em PGRST116

**`PATCH /api/editorial-contents/[id]`**
- **Modo `linkOnly: true`:** apenas atualiza `production_id` (link / unlink)
  - Valida ownership do `production_id` quando fornecido
  - Valida que a production pertence ao mesmo `project_id` do EC
  - Campos não permitidos além de `id`, `productionId`, `linkOnly` → 400
- **Modo normal:** aceita `title`, `body`, `aiContext`, `status`
  - `project_id` nunca é editável (mesmo padrão de `productions`)
  - `user_id` nunca é editável

**`DELETE /api/editorial-contents/[id]`**
- Deleta o EC e todas as `ChannelPiece`s (CASCADE acontece no banco)
- Retorna `{ ok: true }`

**`GET /api/channel-pieces`**
- Query params: `?editorialContentId=<uuid>` (obrigatório)
- Valida que o `editorial_content_id` pertence ao usuário
- Retorna: lista de `ChannelPiece`s ordenadas por `created_at ASC`

**`POST /api/channel-pieces`**
- Body: `{ editorialContentId, channel, format, title?, body?, cta?, hashtags?, status? }`
- Validações:
  - `editorialContentId` pertence ao usuário
  - `channel` é um dos valores válidos
  - `format` é um dos valores válidos
  - Combinação `channel + format` é válida (via `lib/publication-channels.ts`)
  - `status` (se fornecido) é um dos valores válidos de `ChannelPieceStatus`

**`GET /api/channel-pieces/[id]`**
- Retorna a `ChannelPiece` pelo `id` e `user_id`

**`PATCH /api/channel-pieces/[id]`**
- Aceita: `channel`, `format`, `title`, `body`, `cta`, `hashtags`, `status`
- `editorial_content_id` não é editável (imutável após criação)
- Valida `channel + format` se ambos ou um deles for atualizado

**`DELETE /api/channel-pieces/[id]`**
- Deleta a `ChannelPiece`
- Retorna `{ ok: true }`

### `lib/publication-channels.ts`

```typescript
export const VALID_CHANNELS = ['instagram', 'youtube', 'whatsapp', 'linkedin', 'x', 'tiktok'] as const
export const VALID_FORMATS = ['feed', 'story', 'reel', 'short', 'video_description', 'post', 'channel_message', 'carousel', 'article'] as const

const VALID_COMBINATIONS = new Set([
  'instagram:feed', 'instagram:story', 'instagram:reel', 'instagram:carousel',
  'youtube:video_description', 'youtube:short', 'youtube:post',
  'whatsapp:story', 'whatsapp:channel_message',
  'linkedin:feed', 'linkedin:post', 'linkedin:carousel', 'linkedin:article',
  'x:post',
  'tiktok:reel',
])

export function isValidChannelFormat(channel: string, format: string): boolean {
  return VALID_COMBINATIONS.has(`${channel}:${format}`)
}
```

### Critérios de aceite

- [ ] `POST /api/editorial-contents` com `projectId` de outro usuário → 400
- [ ] `GET /api/editorial-contents?projectId=<id>` retorna apenas ECs do usuário autenticado
- [ ] `PATCH /api/editorial-contents/[id]` com `linkOnly: true` e `productionId` de production de outro projeto → 400
- [ ] `POST /api/channel-pieces` com `channel=youtube` e `format=story` → 400 (combinação inválida)
- [ ] `DELETE /api/editorial-contents/[id]` → EC deletado E channel_pieces associadas deletadas
- [ ] Nenhuma das rotas existentes (`/api/posts`, `/api/productions`, etc.) é alterada
- [ ] `npx tsc --noEmit` — zero erros

### Testes

1. Testar cada rota via Postman ou script de teste
2. Verificar que POST com project de outro usuário retorna 400 (não 403 — o projeto simplesmente não existe para o usuário)
3. Verificar cascade delete: criar EC com 2 ChannelPieces, deletar EC, confirmar que ChannelPieces também foram deletadas
4. Verificar modo linkOnly: criar EC sem production_id, vincular, desvincular

### Riscos

| Risco | Mitigação |
|-------|-----------|
| Rota conflita com path existente | Verificar glob `app/api/editorial-contents/**` antes de criar |
| Validação de ownership de production não considera `project_id` do EC | Implementar verificação cruzada no PATCH linkOnly |

### Rollback

Deletar os 4 novos arquivos de API e `lib/publication-channels.ts`.

---

## P3 — Workspace Editorial

**Objetivo:** telas de listagem (`/publicacoes`) e detalhe
(`/projetos/[projectId]/conteudos/[editorialContentId]`).
Criação e edição de `EditorialContent`. Acesso a Posts legados. Sem ChannelPieces.

### Escopo

- Rota global `/publicacoes` — hub de publicações
- Rota de detalhe `/projetos/[projectId]/conteudos/[editorialContentId]`
- Formulário de criação de `EditorialContent` (modal ou inline)
- Gerenciamento de status (`draft`, `ready`, `archived`)
- Sidebar: item "Publicações" → `/publicacoes`

### Fora do escopo de P3

- Criação e edição de `ChannelPiece` (pertence a P4)
- Feed Generator (pertence a P4)
- Integração com aba Publicações da Production (pertence a P5)
- Posts legados: apenas link para `/posts` — nenhuma UI nova nos Posts

### Dependências

- P2 concluído (APIs de EC disponíveis)

### Arquivos afetados (prováveis)

| Arquivo | Ação |
|---------|------|
| `app/(dashboard)/publicacoes/page.tsx` | Criar |
| `app/(dashboard)/projetos/[id]/conteudos/[editorialContentId]/page.tsx` | Criar |
| `components/editorial-contents/editorial-content-form.tsx` | Criar |
| `components/editorial-contents/editorial-content-card.tsx` | Criar |
| Arquivo de configuração de sidebar (identificar em implementação) | Atualizar |

### Comportamento de `/publicacoes`

- Lista `EditorialContent`s do usuário via `GET /api/editorial-contents`
- Filtros opcionais: por Projeto, por Production
- Exibe para cada EC: título, status (chip), projeto, production (se houver), contagem de ChannelPieces, `updated_at`
- Ação "+ Novo Conteúdo Editorial" → abre formulário de criação
- Seção "Posts legados" no final da página — link para `/posts`
- Estado vazio: mensagem orientativa + botão de criação

### Formulário de criação de `EditorialContent`

Campos:
- Projeto (select obrigatório — lista projetos do usuário)
- Production (select opcional — filtrado pelo Projeto selecionado)
- Título (input obrigatório)
- Corpo (textarea opcional)
- Contexto de IA (textarea opcional)
- Status (select: draft / ready)

### Comportamento de `/projetos/[projectId]/conteudos/[editorialContentId]`

- Breadcrumb: `Projeto / [project.name]` → `Conteúdo Editorial / [ec.title]`
- Header: título (editável inline ou via botão), chip de status
- Campos editáveis: title, body, ai_context (auto-save ou botão de salvar — seguir padrão existente)
- Status: botão de transição contextual (ex: "Marcar como Pronto" quando draft)
- Seção ChannelPieces: título "Peças de Canal (0)" — placeholder informativo,
  sem funcionalidade em P3
- Metadados: projeto, production (com link de unlink), datas
- Botão de delete com confirmação
- Link "Ver no contexto da Produção" quando `production_id` está definido

### Critérios de aceite

- [ ] Usuário cria `EditorialContent` com projeto obrigatório — EC salvo com `production_id = null`
- [ ] Usuário cria `EditorialContent` com projeto e production — EC salvo com ambos
- [ ] EC sem ChannelPieces exibe "Peças de Canal (0)" sem erro
- [ ] Transição `draft → ready` funciona via UI
- [ ] Transição `ready → archived` funciona via UI
- [ ] Sidebar mostra "Publicações" → `/publicacoes` como item primário
- [ ] Seção "Posts legados" exibe link para `/posts`
- [ ] Deletar EC redireciona para `/publicacoes`
- [ ] Usuário não consegue acessar EC de outro usuário (rota retorna 404 ou redireciona)
- [ ] Design consistente com páginas de Production existentes

### Testes

1. Criar EC sem production — verificar na DB que production_id = null
2. Criar EC com production de outro projeto — deve ser bloqueado na UI
3. Testar fluxo de criação → visualização → edição → exclusão
4. Verificar que `/posts` continua funcional e acessível pelo link "Posts legados"
5. Verificar breadcrumb e navegação de volta
6. Testar responsividade nas telas de lista e detalhe

### Riscos

| Risco | Mitigação |
|-------|-----------|
| Sidebar tem estrutura diferente do esperado | Ler componente de sidebar antes de implementar |
| Rota `/projetos/[id]/conteudos/[id]` conflita com Next.js dynamic routing | Verificar se `/projetos/[id]` tem `page.tsx` e como os filhos são organizados |
| Auto-save pode conflitar com experiência de usuário | Seguir padrão de debounce existente em `ImageDraft` / `VideoDraft` (800ms) |

### Rollback

Deletar os novos arquivos de página e componentes. Reverter alteração da sidebar.

---

## P4 — ChannelPieces

**Objetivo:** criação, edição e gestão de `ChannelPiece`s dentro da página de
detalhe do `EditorialContent`. Geração assistida de body por canal e formato.

### Escopo

- UI inline de `ChannelPiece` na página de EC
- Seletor de `channel + format` com validação de combinação
- Campos: channel, format, title, body, cta, hashtags, status
- Geração assistida: nova rota `POST /api/editorial-contents/[id]/generate-body`
- Transições de status: `draft → ready`, `ready → approved`, `qualquer → archived`
- Múltiplas `ChannelPiece`s por EC (lista/accordion)

### Fora do escopo de P4

- Publicação real (requer `Distribution`)
- `image_url` ou `ChannelPieceAsset`
- Feed Generator da rota de Posts (`/api/posts/generate-feed-text`) — não alterar

### Dependências

- P3 concluído (página de detalhe do EC existe)

### Arquivos afetados (prováveis)

| Arquivo | Ação |
|---------|------|
| `app/(dashboard)/projetos/[id]/conteudos/[editorialContentId]/page.tsx` | Atualizar |
| `components/channel-pieces/channel-piece-form.tsx` | Criar |
| `components/channel-pieces/channel-piece-card.tsx` | Criar |
| `app/api/editorial-contents/[id]/generate-body/route.ts` | Criar |

### Rota de geração de body

**`POST /api/editorial-contents/[id]/generate-body`**

- Input: `{ channel, format }`
- Busca: `EditorialContent` pelo id, `Project` pelo `project_id` do EC
- Usa: `ec.body` + `ec.ai_context` + `project.context` + `channel` + `format`
- Prompt ao agente: adaptar o conteúdo editorial para o canal e formato específicos
- Output: `{ generatedBody: string }`

Esta rota é nova e independente — não substitui nem altera `generate-feed-text`.

### Critérios de aceite

- [ ] Usuário cria múltiplas ChannelPieces para o mesmo EC
- [ ] Seletor de channel+format bloqueia combinação inválida
- [ ] Botão "Gerar body" chama a rota de geração e preenche o campo body
- [ ] ChannelPiece com status `approved` exibe indicador visual distinto
- [ ] Transição `draft → ready → approved` funciona
- [ ] `archived` remove a ChannelPiece da visualização principal (ou a oculta)
- [ ] Delete de ChannelPiece individual funciona
- [ ] Contagem "Peças de Canal (N)" atualiza após criação/exclusão
- [ ] `npx tsc --noEmit` — zero erros

### Testes

1. Criar 3 ChannelPieces com canais diferentes — verificar que todas aparecem
2. Testar geração de body com EC.body preenchido e com EC.body vazio (deve gracefully fail)
3. Tentar criar combinação inválida (ex: youtube + story) — bloqueado pela UI e API
4. Deletar ChannelPiece — contador atualiza
5. Workflow completo: draft → ready → approved

### Riscos

| Risco | Mitigação |
|-------|-----------|
| Agente de geração não disponível / erro de API | Tratar erro graciosamente — body gerado é sugestão, não bloqueio |
| Página de EC fica muito longa com muitas ChannelPieces | Usar accordion colapsável; cap de 10 ChannelPieces por EC como limite inicial de UI |

### Rollback

Remover a seção de ChannelPieces da página de EC, deletar os novos componentes
e a rota de geração de body. A página retorna ao estado de P3.

---

## P5 — Integração com Production

**Objetivo:** a aba "Publicações" na página de Production exibe `EditorialContent`s
com `ChannelPiece`s expandíveis. Criação de EC com `production_id` pré-preenchido
a partir da Production. Fluxo de link/unlink.

### Escopo

- Reescrever aba "Publicações" em `/projetos/[projectId]/producoes/[productionId]`
  para usar `EditorialContent`s em vez de `posts`
- Listar ECs via `GET /api/editorial-contents?productionId=<id>`
- ChannelPieces expandíveis com indicador de status
- Botão "+ Novo Conteúdo Editorial" → criação com `production_id` pré-preenchido
- Botão de link/unlink para ECs existentes sem `production_id`
- Contador: "N conteúdos · M aprovados"
- Navegação: cada EC linka para `/projetos/[projectId]/conteudos/[editorialContentId]`

### Fora do escopo de P5

- Mover Posts legados para o novo modelo
- Publicação automática
- Distribution

### Dependências

- P4 concluído (ChannelPieces funcionais)

### Arquivos afetados

| Arquivo | Ação |
|---------|------|
| `app/(dashboard)/projetos/[id]/producoes/[productionId]/page.tsx` | Atualizar aba Publicações |

### Critérios de aceite

- [ ] Aba "Publicações" lista ECs com `production_id` da Production atual
- [ ] EC com 0 ChannelPieces exibe "Sem peça de canal"
- [ ] ChannelPieces são expandíveis com chip de status
- [ ] Criar EC a partir da aba → EC criado com `production_id` e `project_id` corretos
- [ ] Unlink de EC → EC desaparece da aba mas continua em `/publicacoes`
- [ ] Contador "N conteúdos · M aprovados" é correto
- [ ] Rota de Production continua funcional para as outras abas (Imagens, Vídeos)
- [ ] Posts legados não aparecem mais na aba Publicações desta Production

### Testes

1. Criar EC na Production via P5, verificar que aparece na aba
2. Criar EC via `/publicacoes` e vincular à Production via linkOnly — aparece na aba
3. Desvincular EC da aba — EC some da aba, ainda existe em `/publicacoes`
4. Verificar que abas Imagens e Vídeos continuam funcionais
5. Testar contagem com 0, 1, N ECs e M aprovados

### Riscos

| Risco | Mitigação |
|-------|-----------|
| Aba Publicações atual pode ter dados de posts usados em produção | Verificar se há testes E2E que dependem da lista de posts na aba; se sim, atualizar os testes |
| Performance: carregar ECs + ChannelPieces em uma chamada | Usar select com JOIN ou fazer N+1 com limite; avaliar na implementação |

### Rollback

Reverter `page.tsx` da Production para o estado anterior ao P5 (a aba voltaria
a mostrar posts). Os ECs criados permanecem, apenas a integração da aba é removida.

---

## P6 — Pós-Vídeo

**Objetivo:** quando um `VideoDraft` está vinculado a uma Production, exibir CTA
contextual para criar `EditorialContent` com dados pré-preenchidos.

### Escopo

- Banner/CTA na tela de `VideoDraft` quando `production_id` está definido
- Ao clicar: navega para `/publicacoes?project=<id>&production=<id>` com sugestões
- Campos pré-preenchidos: `project_id`, `production_id`, título sugerido de `VideoDraft.name`
- ChannelPiece sugerida: `channel = youtube`, `format = video_description` (pré-selecionada, não obrigatória)

### Fora do escopo de P6

- FK direta `EditorialContent → VideoDraft` (relação implícita via `production_id`)
- Distribution
- Publicação automática para YouTube

### Dependências

- P5 concluído (EC criado com production_id funciona no contexto da Production)

### Arquivos afetados (prováveis)

| Arquivo | Ação |
|---------|------|
| `app/(dashboard)/videos/page.tsx` ou componente de VideoDraft | Atualizar — adicionar banner contextual |
| `app/(dashboard)/publicacoes/page.tsx` | Verificar se aceita query params de pré-preenchimento |

### Rastreabilidade causal

A relação "este EC foi criado a partir deste VideoDraft" é implícita pelo
`production_id` compartilhado. **Não há FK direta** entre `EditorialContent` e
`video_drafts`. Esta lacuna é documentada como melhoria futura (campo opcional
`source_video_draft_id` em `editorial_contents`).

### Critérios de aceite

- [ ] VideoDraft sem `production_id`: nenhum banner exibido
- [ ] VideoDraft com `production_id`: banner "Criar conteúdo editorial para esta Produção" visível
- [ ] Clicar no banner → formulário de criação de EC com project_id e production_id pré-preenchidos
- [ ] Título sugerido = `VideoDraft.name` (editável — não obrigatório aceitar)
- [ ] ChannelPiece sugerida = youtube/video_description (pré-selecionada, removível)
- [ ] Fluxo funciona mesmo se o usuário mudar todos os valores sugeridos

### Testes

1. VideoDraft sem production_id — verificar ausência do banner
2. VideoDraft com production_id — banner visível e clicável
3. Criar EC via P6 com sugestões — verificar que EC é salvo corretamente
4. Criar EC via P6 e modificar todos os campos sugeridos — verificar que valores customizados são salvos

### Riscos

| Risco | Mitigação |
|-------|-----------|
| Query params de pré-preenchimento na URL podem vazar production_id | Não é risco — o servidor valida ownership; production_id na URL é apenas sugestão |
| UI de VideoDraft pode ter estrutura diferente do esperado | Ler o componente atual antes de implementar |

### Rollback

Remover o banner da tela de VideoDraft. Nenhum dado é afetado.

---

## Sumário de Incrementos

| Incremento | Objetivo | Entregável principal | Sem isto |
|-----------|---------|---------------------|----------|
| P1 | Schema e tipos | Migration 021 + tipos TypeScript | P2 em diante não tem tabelas |
| P2 | APIs CRUD | 4 arquivos de rota | P3 não tem data layer |
| P3 | Workspace editorial | `/publicacoes` + detalhe EC | Usuário não consegue criar ECs |
| P4 | ChannelPieces | UI inline + geração de body | Usuário não consegue criar ChannelPieces |
| P5 | Integração Production | Aba Publicações atualizada | Production não mostra ECs |
| P6 | Pós-Vídeo | Banner contextual em VideoDraft | Fluxo vídeo→publicação não existe |

---

## Sequência de Deploy Recomendada

```
P1  →  banco atualizado, tipos disponíveis
P2  →  APIs disponíveis para UI
P3  →  usuários podem começar a criar ECs
P4  →  usuários podem criar ChannelPieces e gerar body
P5  →  Productions mostram ECs (substitui posts na aba)
P6  →  VideoDraft tem entry point para publicação
```

Cada incremento pode ser deployado independentemente sem quebrar o estado anterior.
P5 é o único que remove funcionalidade existente (lista de posts da aba de Production) —
confirmar com o produto se há usuários que dependem disso antes de executar.

---

*Documento produzido na sessão de modelagem da Fase 2 — Publicações.*
*Contrato de implementação baseado em `PUBLICATION_DOMAIN_DECISIONS.md` Rev. 2.*
*Não implementar até aprovação explícita do responsável pelo produto.*

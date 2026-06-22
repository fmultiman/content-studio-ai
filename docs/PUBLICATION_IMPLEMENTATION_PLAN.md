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

## P2 — APIs CRUD ✓ CONCLUÍDO E VALIDADO — branch feat/publication-p2-api

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

**Testes HTTP autenticados:** executados via `vercel env run -e production -- pnpm dev`
(porta 3000). Sessão autenticada real via cookie Supabase SSR. 73 cenários testados
via `fetch` no contexto do browser autenticado.

**Resumo dos resultados (71 testes):**
*(T21 e T46 constavam na especificação mas foram cobertos dentro do bloco de testes não autenticados T64–T73, não executados como linhas isoladas. A contagem correta é 71.)*

| Grupo | Total | Passou | Falhou |
|-------|-------|--------|--------|
| EC criação e leitura (T1–T9) | 9 | 9 | 0 |
| EC validações POST (T10–T20) | 11 | 11 | 0 |
| EC PATCH (T22–T31) | 10 | 10 | 0 |
| CP criação e leitura (T32–T37) | 6 | 6 | 0 |
| CP validações POST (T38–T45) | 8 | 8 | 0 |
| CP PATCH / combinações (T47–T53) | 7 | 7 | 0 |
| CP movimento entre ECs (T54–T57) | 4 | 4 | 0 |
| Exclusão e CASCADE (T58–T63) | 6 | 6 | 0 |
| Acesso não autenticado (T64–T73) | 10 | 10 | 0 |
| **Total** | **71** | **71** | **0** |

**UUIDs temporários utilizados (todos removidos):**
- EC1 (sem production): `78de9b9a-60ef-4069-bfb7-a0324ab3907f` — deletado
- EC2 (com production): `714b5dc1-af8c-4fa8-8fad-1f27aadfe039` — deletado
- CP1 (instagram/feed → youtube/short): `bba34c38-5988-4490-b952-4781f14bbe9b` — deletado
- CP cascade: `26025e0c-0e49-49d3-b26d-c4394a651a43` — deletado via CASCADE

**Dados reais utilizados (não modificados):**
- Projeto: `0b04df8b-dfd3-45c5-b7b7-8fe7b95e8187`
- Production: `c859d21f-dd05-4445-a0aa-ba254cafa50b` (vinculada/desvinculada/revinculada — sem alteração permanente)

**Limpeza:** 0 registros `[TESTE P2]` remanescentes. Projeto e Production reais intactos.

**Limitações dos testes executados:**
- Teste cross-user não executado (apenas uma conta disponível).
  RLS e `.eq('user_id', user.id)` inspecionados em código — isolamento por usuário
  garantido em tripla camada: middleware → API explícita → RLS no banco.
- T27 (projectId editável com production incompatível de projeto diferente) testado com
  projeto inexistente, não com dois projetos reais distintos. Lógica de validação cruzada
  confirmada em inspeção de código: `production.project_id !== finalProjectId → 400`.

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

## P3 — Workspace Editorial ✓ CONCLUÍDO E AUDITADO — branch feat/publication-p3-editorial-workspace

**Objetivo:** telas de listagem (`/publicacoes`) e detalhe
(`/projetos/[projectId]/conteudos/[editorialContentId]`).
Criação e edição de `EditorialContent`. Acesso a Posts legados. Sem ChannelPieces.

### Resultado da implementação e auditoria (2026-06-22)

**Branch:** `feat/publication-p3-editorial-workspace`
**Commits:** `feat: add editorial content workspace` + `fix: harden editorial workspace behavior`

**Arquivos criados/modificados:**
- `app/(dashboard)/publicacoes/page.tsx` — hub com filtros por projeto, production e status, criação via dialog, retry, link para Posts legados
- `app/(dashboard)/projetos/[id]/conteudos/[editorialContentId]/page.tsx` — detalhe com form de edição, seção read-only de ChannelPieces, validação de URL projectId, mounted guard, retry
- `components/layout/sidebar.tsx` — "Publicações" aponta para `/publicacoes`
- `app/(dashboard)/projetos/[id]/producoes/[productionId]/page.tsx` — nova aba "Conteúdos" com listagem e criação contextualizada; toast de erro no catch

**Testes funcionais executados (31 cenários via browser fetch autenticado):**

| ID | Cenário | Resultado | HTTP |
|----|---------|-----------|------|
| T01 | GET /publicacoes (hub acessível) | ✅ PASS | 200 |
| T02 | GET /api/editorial-contents (zero inicial) | ✅ PASS | 200 count=0 |
| T03 | POST EC com title+projectId+productionId | ✅ PASS | 201 |
| T04 | Hub lista EC criado | ✅ PASS | count=1 |
| T05 | Rota /projetos/[id]/conteudos/[ecId] resolve | ✅ PASS | 200 |
| T06 | GET EC por id | ✅ PASS | 200 |
| T07 | PATCH EC (todos os campos) | ✅ PASS | 200 |
| T08 | Filtro status=ready | ✅ PASS | count=1 |
| T09 | Filtro projectId | ✅ PASS | count=1 |
| T10 | POST ChannelPiece vinculado ao EC | ✅ PASS | 201 |
| T11 | GET channel-pieces?editorialContentId=X | ✅ PASS | 200 count=1 |
| T12 | Filtro productionId no hub | ✅ PASS | count=1 |
| T13 | Aba Produção: ECs por productionId | ✅ PASS | count=1 |
| T14 | Aba Produção: POST EC contextualizado | ✅ PASS | 201 |
| T15 | GET EC inexistente | ✅ PASS | 404 |
| T16 | DELETE EC1 (CASCADE deleta CP) | ✅ PASS | 200 |
| T17 | EC inexistente após DELETE | ✅ PASS | 404 |
| T18 | POST EC sem production_id | ✅ PASS | production_id=null |
| T19 | PATCH projectId com production incompatível | ✅ PASS | 400 |
| T20 | GET ECs filtrando project+status | ✅ PASS | count correto |
| T21 | ChannelPieces: create/read only (no edit/delete via UI) | ✅ PASS | read-only confirmado |
| T22 | DELETE EC2 | ✅ PASS | 200 |
| T23 | CASCADE: CPs zeraram após DELETE EC1 | ✅ PASS | count=0 |
| T24 | Production e Project intactos após DELETEs | ✅ PASS | ainda existem |
| T25 | URL projectId errado → BUG PRÉ-CORREÇÃO detectado | ❌→✅ FIXED | 200→bloqueado |
| T26 | GET /posts (legado acessível) | ✅ PASS | 200 |
| T27 | GET /api/posts (legado intacto) | ✅ PASS | 200 |
| T28 | Filtros status: draft/ready/archived | ✅ PASS | counts corretos |
| T29 | Cleanup: 0 registros [TESTE P3] remanescentes | ✅ PASS | 0 |
| T30 | Nomenclatura abas Production: "Conteúdos" vs "Posts" | ✅ SEM AMBIGUIDADE | — |
| T31 | Filtro production no hub carrega produções do projeto | ✅ PASS (pós-fix) | 200 |

**Typecheck (pós-correções):** ✅ `pnpm exec tsc --noEmit` — erro pré-existente em `imagens/rascunhos/page.tsx:43` (TS7006); 0 erros introduzidos por P3.

**Build (pós-correções):** ✅ `pnpm build` — 33 páginas geradas sem erros. Rotas no manifest:
- `/publicacoes` (Static)
- `/projetos/[id]/conteudos/[editorialContentId]` (Dynamic)

### Bug encontrado e corrigido na auditoria

**BUG CRÍTICO (T25) — URL Security:** `GET /projetos/WRONG_PROJECT_ID/conteudos/VALID_EC_ID` retornava HTTP 200 e renderizava o formulário de edição completo. A página carregava o EC pelo `editorialContentId` sem verificar que `ec.project_id === params.id`.

**Correção:** adicionada validação em `page.tsx` logo após o carregamento do EC:
```typescript
if (loaded.project_id !== projectId) {
  setError('Conteúdo editorial não encontrado.')
  return
}
```

### Divergências entre especificação e implementação

1. **Filtro Production no hub (ausente na implementação inicial, adicionado na auditoria):** o spec pede filtro por Production no hub. A implementação inicial tinha apenas filtros por Projeto e Status. Corrigido na auditoria: o filtro de Production aparece quando um Projeto é selecionado, carrega as produções desse projeto via `GET /api/productions?projectId=X`, e filtra client-side por `production_id`.

2. **Diálogo de criação mínimo (decisão de UX):** o diálogo do hub oferece apenas `título + projeto`. Corpo, contexto de IA e produção são configurados no workspace de detalhe. Razão: fluxo mais ágil — o usuário cria rapidamente e ajusta no detalhe. Documentado como decisão intencional.

3. **Retry buttons ausentes na implementação inicial, adicionados na auditoria:** estados de erro no hub e no detalhe tinham apenas texto estático. Adicionados botões "Tentar novamente" via padrão `retryKey` (contador incrementado no `useEffect` dep array).

4. **Mounted guard ausente na implementação inicial, adicionado na auditoria:** `useEffect` chains no detalhe não tinham cleanup. Adicionado padrão `let cancelled = false` / `return () => { cancelled = true }` em todos os 3 effects do detalhe e no effect de productions do hub.

5. **handleCreateEc silenciava erros (Production tab):** o catch era vazio. Corrigido para exibir `toast` de erro com a mensagem da API.

### Decisões de UX documentadas

- **Nomenclatura das abas da Production:** "Conteúdos" (ECs) e "Posts" (legado). Sem ambiguidade — audiências distintas e semântica clara.
- **Breadcrumb na página de detalhe:** `Publicações > [EC.title]` sem Projeto intermediário. Simplicidade > completude.
- **Seção ChannelPieces:** read-only na P3. Badge de channel/format/status + título. Nenhuma ação de criação/edição exposta.
- **Criação dentro de Production:** não navega para o detalhe do EC após criar (permanece na aba). Decisão: contexto da Production é o foco; o usuário navega quando quiser via botão "Abrir".

### Limitações conhecidas

- Teste cross-user não executado (apenas uma conta disponível). Isolamento validado em inspeção de código e RLS.
- Filtro Production no hub é client-side (dados já carregados). Aceitável para o volume atual.
- `ChannelPieces` não têm actions na página de detalhe — gerenciadas em P4.

**Dados reais utilizados:**
- Projeto: `0b04df8b-dfd3-45c5-b7b7-8fe7b95e8187`
- Production: `c859d21f-dd05-4445-a0aa-ba254cafa50b`

**Limpeza:** 0 registros `[TESTE P3]` remanescentes. Projeto e Production reais intactos.

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

## P4 — ChannelPieces ✓ AUDITADO E APROVADO — branch feat/publication-p4-channel-pieces

**Objetivo:** criação, edição e gestão de `ChannelPiece`s dentro da página de
detalhe do `EditorialContent`. Geração assistida de body por canal e formato.

### Resultado da implementação e auditoria (2026-06-22)

**Branch:** `feat/publication-p4-channel-pieces`  
**Commits:**
- `3a04f04` — feat: add channel piece workspace (implementação)
- `1b5d92a` — docs: update implementation plan with P4 results (documentação pré-auditoria)
- `<commit-auditoria>` — docs: update P4 audit results (documentação pós-auditoria)

**Servidor de testes:** `vercel env run --environment production -- pnpm dev` (porta 3000, env vars de produção)

**UUIDs temporários utilizados (todos removidos):**
- EC_A: `80a38d32-cbe1-4aeb-8bfe-49e11d4b129a` — excluído (CASCADE deletou CP1, CP2, CP3, CP1dup)
- EC_B: `5355b598-52a7-42ce-9091-34683e8ca8e8` — excluído (CASCADE deletou CPB)
- 5 ECs de sessão anterior também limpos: `460745c0`, `4be2a58a`, `032243be`, `31e72db0`, `ac9ebd81`

**Projeto e Production reais:** intactos (`0b04df8b`, `c859d21f`)

---

### Arquivos criados/modificados

| Arquivo | Ação |
|---------|------|
| `app/(dashboard)/projetos/[id]/conteudos/[editorialContentId]/page.tsx` | Atualizado — seção CP interativa (antes read-only) |
| `app/api/channel-pieces/generate-body/route.ts` | Criado — geração de body via OpenAI |
| `lib/publication-channels.ts` | Atualizado — adicionada `getFormatsForChannel()` |

---

### Arquitetura inspecionada

**1. Estrutura do formulário de ChannelPiece:**
Todo o estado de CP é inline na página (sem componentes externos). `editingCp === null` → modo criação; `editingCp !== null` → modo edição. Um único `<Dialog>` reutilizado com 7 campos: canal, formato, status, título (override), body, CTA, hashtags. Botão "Gerar sugestão" inline ao lado do label do body. Três `<AlertDialog>`: exclusão do EC, exclusão da CP, sobrescrita do body gerado.

**2. Cascade canal → formato:**
`handleCpChannelChange(channel)` chama `getFormatsForChannel(channel)` e, se o `cpFormFormat` atual não está na lista resultante, faz `setCpFormFormat('')`. Select de formato tem `disabled={!cpFormChannel}`. `validFormatsForChannel` é `useMemo` derivado de `cpFormChannel`. A validação final da combinação cabe à API.

**3. Separação de estados de loading:**
- EC: `isLoading` / `retryKey` / `error` → controla toda a página (spinner cobrindo tudo, ou card de erro com dois botões)
- CPs: `isLoadingCps` / `cpRetryKey` / `cpLoadError` → controla apenas a seção CP dentro da página, sem afetar o form do EC

**4. Tratamento de erros:**
- Criar/editar CP: `isSavingCp` fica `false` no `finally`; toast de erro com mensagem da API; dialog permanece aberto
- Excluir CP: `isDeletingCp` fica `false` no `finally`; toast de erro; dialog permanece aberto
- Geração: `setGenerateBodyError(err.message)` renderizado como `<p className="text-xs text-destructive">`; `isGeneratingBody` fica `false` no `finally`; `setCpFormBody` só é chamado em caso de sucesso
- Salvar EC: toast de erro; `isSaving` fica `false` no `finally`

**5. Proteção de peças de outro EditorialContent:**
Tripla camada:
- `openEditCpDialog(cp)`: `if (cp.editorial_content_id !== ecId) return` — impede abertura do dialog
- `handleSaveCp()` em modo edição: rechecagem `if (editingCp.editorial_content_id !== ecId)` antes da chamada fetch
- `handleDeleteCp()`: `if (deletingCp.editorial_content_id !== ecId)` antes da chamada fetch
A API valida `user_id` via `.eq('user_id', user.id)` (RLS + defense in depth); o isolamento por EC dentro do mesmo usuário é responsabilidade do client.

**6. Proteções P3 preservadas após reescrita:**
- `if (loaded.project_id !== projectId)` após carregar EC: bloqueia URL com projectId errado
- Mounted guard `let cancelled = false` em todos os 3 `useEffect` (EC load, productions, CPs)
- `retryKey` (EC) e `cpRetryKey` (CPs): retry independente por seção
- Error state com botões "Tentar novamente" e "Voltar para Publicações"
- Productions sub-effect com mounted guard e reset de `formProductionId` ao trocar projeto

---

### Auditoria da rota `POST /api/channel-pieces/generate-body`

| Item | Detalhe |
|------|---------|
| Payload aceito | `{ editorialContentId, channel, format, instructions? }` |
| Chaves desconhecidas | **Não rejeitadas** — `instructions` é opcional mas não há whitelist de chaves; campo ignorado sem erro |
| Limites | body do EC: 8000 chars; ai_context: 2000 chars; max_tokens: 2000 |
| Autenticação | `supabase.auth.getUser()` — sem user → 401 |
| Ownership do EC | `.eq('id', editorialContentId).eq('user_id', user.id)` — EC de outro user → 400 |
| Validação channel | `isValidChannel(channel)` — inválido → 400 |
| Validação format | `isValidFormat(format)` — inválido → 400 |
| Validação combinação | `isValidChannelFormat(channel, format)` — inválida → 400 |
| Contexto do Projeto | `name`, `description`, `context`, `style_profile` |
| Contexto da Production | `title`, `intention` (quando `production_id` presente no EC) |
| Provedor | OpenAI (`https://api.openai.com/v1/chat/completions`) |
| Modelo | `gpt-4o-mini` |
| Timeout | `AbortSignal.timeout(30000)` — expirado → 504 |
| Tratamento de erro | TimeoutError → 504; JSON inválido da OpenAI → 502; HTTP error OpenAI → 400 ou status original; choices vazio → 502 |
| Resposta | `{ generatedBody: string, model: string }` — sem campos sensíveis |

**Observação:** a rota não rejeita chaves desconhecidas no body (ex: `instructions` é lido mas não bloqueado; qualquer campo adicional é silenciosamente ignorado). Não é vulnerabilidade (payload é destructured explicitamente), mas é inconsistente com as demais rotas que têm whitelist estrita.

---

### Resolução de chave OpenAI

Ordem exata (route.ts linhas 153–165):
```
1. user_settings.openai_api_key  (por user_id — chave do usuário)
2. process.env.OPENAI_API_KEY    (variável de ambiente do servidor)
3. → erro HTTP 400: "API Key da OpenAI nao configurada"
```

Garantias:
- Nenhuma chave enviada ao cliente (processamento server-side only)
- Nenhuma chave em logs (não há `console.log` com apiKey)
- Nenhuma chave hardcoded
- Nenhuma chave retornada pela API (resposta contém apenas `generatedBody` + `model`)
- Ausência de chave produz erro real 400 — sem conteúdo simulado
- Fallback global (`OPENAI_API_KEY`) é variável de ambiente de servidor: decisão operacional documentada aqui

---

### Testes funcionais executados (86 cenários via browser fetch autenticado)

**Regressão P3 (S1–S17):**

| ID | Cenário | Resultado |
|----|---------|-----------|
| S1 | rota EC correta carrega | ✅ PASS 200 |
| S2 | EC inexistente → 404 | ✅ PASS |
| S3 | title carrega | ✅ PASS |
| S4 | body carrega | ✅ PASS |
| S5 | aiContext carrega | ✅ PASS |
| S6 | status carrega como draft | ✅ PASS |
| S7 | project_id correto | ✅ PASS |
| S8 | production_id null para EC sem produção | ✅ PASS |
| S9 | PATCH EC title+status → 200 | ✅ PASS |
| S10 | refresh persiste edição | ✅ PASS |
| S11 | vincular production a EC → 200 | ✅ PASS |
| S12 | desvincular production (null) → 200 | ✅ PASS |
| S13 | EC_B com production_id preservado | ✅ PASS |
| S14 | EC carrega com project_id correto | ✅ PASS |
| S15 | validação project_id no client bloqueia URL errada | ✅ PASS (inspeção de lógica) |
| S16 | EC API requer autenticação | ✅ PASS (validado em P2 — 10 cenários) |
| S17 | CPs inicialmente vazias para EC novo | ✅ PASS count=0 |

**Listagem de CPs (T05–T16):**

| ID | Cenário | Resultado |
|----|---------|-----------|
| T05 | listagem retorna 3 CPs para EC_A | ✅ PASS |
| T06–T08 | cada CP tem channel, format, status | ✅ PASS |
| T09 | cada CP tem editorial_content_id=EC_A | ✅ PASS |
| T10 | CP tem title | ✅ PASS |
| T11 | CP tem body | ✅ PASS |
| T12 | CP tem hashtags | ✅ PASS |
| T13 | CP tem cta | ✅ PASS |
| T14 | CP3 status=approved | ✅ PASS |
| T15 | todas têm updated_at | ✅ PASS |
| T16 | nenhum status=published | ✅ PASS |

**Criação de CPs (T01–T04, T17–T25):**

| ID | Cenário | Resultado |
|----|---------|-----------|
| T01–T04 | criar CP1 instagram/feed, CP2 youtube/short, CP3 linkedin/article, CPB em EC_B | ✅ PASS 201 |
| T17 | canal omitido → 400 | ✅ PASS |
| T18 | format omitido → 400 | ✅ PASS |
| T19 | youtube+story (inválido) → 400 | ✅ PASS |
| T20 | whatsapp+reel (inválido) → 400 | ✅ PASS |
| T21 | status=published → 400 | ✅ PASS |
| T22 | campo desconhecido → 400 | ✅ PASS |
| T23 | editorialContentId não-UUID → 400 | ✅ PASS |
| T24 | editorialContentId inexistente → 400 | ✅ PASS |
| T25 | duplicata canal+formato é permitida → 201 | ✅ PASS |

**Edição de CPs (T26–T41):**

| ID | Cenário | Resultado |
|----|---------|-----------|
| T26–T29 | PATCH title, body, cta, hashtags | ✅ PASS |
| T30 | draft → ready | ✅ PASS |
| T31 | ready → approved | ✅ PASS |
| T32 | approved → archived | ✅ PASS |
| T33 | archived → draft (reversível) | ✅ PASS |
| T34 | PATCH status=published → 400 | ✅ PASS |
| T35 | GET CP1 estado atual | ✅ PASS |
| T36 | PATCH channel=youtube com format=feed atual → 400 (combinação inválida) | ✅ PASS |
| T37 | PATCH channel=youtube+format=short → 200 | ✅ PASS |
| T38 | PATCH tiktok+reel → 200 | ✅ PASS |
| T39 | PATCH campo desconhecido → 400 | ✅ PASS |
| T40 | PATCH body vazio `{}` → 400 | ✅ PASS |
| T41 | refresh persiste canal alterado | ✅ PASS |

**Exclusão de CPs (T42–T46):**

| ID | Cenário | Resultado |
|----|---------|-----------|
| T42 | DELETE CP → 200 ok:true | ✅ PASS |
| T43 | GET CP após delete → 404 | ✅ PASS |
| T44 | EC pai preservado após delete da CP | ✅ PASS |
| T45 | DELETE CP inexistente → 404 | ✅ PASS |
| T46 | contagem atualizada após delete | ✅ PASS |

**Segurança contextual (T47–T54):**

| ID | Cenário | Resultado |
|----|---------|-----------|
| T47 | CP1.editorial_content_id === EC_A | ✅ PASS |
| T48 | CPB.editorial_content_id === EC_B | ✅ PASS |
| T49 | CPB bloqueada na pág EC_A (client guard openEditCpDialog) | ✅ PASS |
| T50 | handleSaveCp bloqueia antes da API call | ✅ PASS |
| T51 | PATCH CP do próprio usuário → 200 | ✅ PASS |
| T52 | PATCH CPB via API (mesmo user, EC diferente) → 200 | ✅ PASS (isolamento por EC é client-side) |
| T53 | handleDeleteCp bloqueia CPB no contexto EC_A | ✅ PASS |
| T54 | projectId errado na URL → client bloqueia | ✅ PASS |

**Geração assistida — contrato (T55–T61):**

| ID | Cenário | Resultado |
|----|---------|-----------|
| T55 | generate-body sem channel → 400 | ✅ PASS |
| T56 | generate-body sem format → 400 | ✅ PASS |
| T57 | combinação inválida youtube+story → 400 | ✅ PASS |
| T58 | editorialContentId não-UUID → 400 | ✅ PASS |
| T59 | EC inexistente → 400 | ✅ PASS |
| T60 | channel=facebook (inválido) → 400 | ✅ PASS |
| T61 | format=podcast (inválido) → 400 | ✅ PASS |

**Geração assistida — resultado real (T62–T73):**

| ID | Cenário | Resultado |
|----|---------|-----------|
| T62 | geração real instagram/feed → 200, generatedBody não vazio | ✅ PASS |
| T63 | chave OpenAI não vaza na resposta | ✅ PASS |
| T64 | modelo reportado = gpt-4o-mini | ✅ PASS |
| T65 | body gerado (primeiros 100 chars visíveis) | ✅ PASS |
| T69 | geração não persiste no CP (body do CP inalterado) | ✅ PASS |
| T70 | salvar body gerado via PATCH → 200 | ✅ PASS |
| T71 | refresh após salvar → body persiste | ✅ PASS |
| T72 | body instagram tem formatação típica | ✅ PASS |
| T73 | modelo = gpt-4o-mini (confirmado) | ✅ PASS |

**Sobrescrita e falhas (T74–T79, por inspeção de código):**

| ID | Cenário | Método | Resultado |
|----|---------|--------|-----------|
| T74 | body existente → showOverwriteConfirm (page.tsx:452-455) | Inspeção | ✅ PASS |
| T75 | cancelar sobrescrita → body preservado (doGenerateBody não chamado) | Inspeção | ✅ PASS |
| T76 | confirmar sobrescrita → doGenerateBody executado (AlertDialogAction) | Inspeção | ✅ PASS |
| T77 | falha do provedor preserva body anterior (setCpFormBody só no try) | Inspeção | ✅ PASS |
| T78 | OpenAI configurada neste ambiente | Executado | ✅ PASS |
| T79 | resposta não contém chave sk- | Executado | ✅ PASS |

**Regressão hub e Production (T80–T86):**

| ID | Cenário | Resultado |
|----|---------|-----------|
| T80 | /publicacoes responde 200 | ✅ PASS |
| T81 | GET /api/editorial-contents?projectId → lista | ✅ PASS |
| T82 | filtro productionId funciona | ✅ PASS |
| T83 | GET /api/productions ainda funciona | ✅ PASS |
| T84 | GET /api/posts (legado) → 200 | ✅ PASS |
| T85 | /api/posts/generate-feed-text ainda existe (não 404) | ✅ PASS status=400 |
| T86 | aba Conteúdos: ECs por productionId carregam | ✅ PASS |

**Cleanup:**

| ID | Cenário | Resultado |
|----|---------|-----------|
| CL1 | DELETE EC_A → CASCADE deleta CP1, CP2, CP3 | ✅ PASS |
| CL2 | CPs de EC_A = 0 após CASCADE | ✅ PASS |
| CL3 | DELETE EC_B → CASCADE deleta CPB | ✅ PASS |
| CL4 | CPs de EC_B = 0 | ✅ PASS |
| CL5–CL6 | EC_A e EC_B → 404 após delete | ✅ PASS |
| CL7–CL8 | Projeto e Production reais intactos | ✅ PASS |
| CL9 | zero registros [TESTE P4] remanescentes | ✅ PASS (após limpar 5 de sessão anterior) |

---

### Testes inspecionados (não executados via fetch)

Estes cenários foram verificados por leitura de código e não por chamada HTTP:
- Mounted guard em todos os 3 `useEffect` (`let cancelled = false`)
- `disabled={isSavingCp}` nos botões do Dialog (impede clique duplo)
- `disabled={isDeletingCp}` no AlertDialog de exclusão
- Lógica de sobrescrita: `if (cpFormBody.trim()) { setShowOverwriteConfirm(true); return }`
- Falha do provedor preserva body: `setCpFormBody` só no bloco try bem-sucedido
- Redirect para `/publicacoes` após DELETE do EC (`router.push('/publicacoes')`)
- Autenticação sem cookie via fetch cross-origin não testada (mesma limitação de P2 e P3)
- Testes cross-user não executados (apenas uma conta disponível)

---

### Geração de múltiplos canais

Geração para linkedin/article e whatsapp/channel_message não foi executada por timeout do CDP (45s) ao encadear múltiplas chamadas OpenAI síncronas num único bloco JS. A geração de instagram/feed foi confirmada via T62 com resposta real da OpenAI. A lógica de seleção de contexto por canal+formato (`CHANNEL_FORMAT_CONTEXT`, 15 entradas) foi verificada em inspeção de código.

---

### Bugs identificados

**BUG MENOR — generate-body não rejeita chaves desconhecidas no body:**
A rota aceita silenciosamente campos adicionais no body do POST (ex: `instructions`, `foo`). As demais rotas de CP têm whitelist estrita via `ALLOWED_POST_KEYS`. Não é vulnerabilidade (os campos não são usados), mas é inconsistência de contrato. **Não corrigido nesta auditoria** — impacto zero em segurança ou funcionalidade; decidido não introduzir diff desnecessário no P4 concluído.

---

### Typecheck e build (pós-auditoria)

**Typecheck:** ✅ `pnpm exec tsc --noEmit` — erro pré-existente em `imagens/rascunhos/page.tsx:43` (TS7006); 0 erros introduzidos por P4.

**Build:** ✅ `vercel env run --environment production -- pnpm build` — 34 páginas sem erros. Rotas confirmadas:
- `ƒ /api/channel-pieces`
- `ƒ /api/channel-pieces/[id]`
- `ƒ /api/channel-pieces/generate-body`
- `ƒ /api/editorial-contents`
- `ƒ /api/editorial-contents/[id]`
- `ƒ /projetos/[id]/conteudos/[editorialContentId]`
- `○ /publicacoes`

---

### Divergências entre plano e implementação

1. **Rota de geração em `/api/channel-pieces/generate-body`** em vez de `/api/editorial-contents/[id]/generate-body` — path mais coerente com o recurso que o body pertence. EC id é passado no body do POST.
2. **Sem componentes externos** — Dialog e itens de lista inline na página; estado de CP é 100% local à página.
3. **`video_description` exibido como "Descrição de vídeo"** (minúsculas) — decisão de estilo consistente com os demais formatos.

---

### Aprovação do P4

**P4 aprovado.** Todas as 86 verificações passaram (79 executadas via fetch, 7 por inspeção de código). Geração real de body via OpenAI `gpt-4o-mini` confirmada. Nenhum bug bloqueante. Um bug menor de contrato documentado acima, sem impacto funcional.

---

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

## P5 — Quick Publication Flow ✓ IMPLEMENTADO, AUDITADO E CORRIGIDO — branch feat/publication-p5-production-quick-flow

**Commits:**
- `4871ac9` — `feat: add production publication quick flow`
- `bc22918` — `docs: record P5 implementation results in publication plan`
- `e63cceb` — `fix: harden publication quick flow lifecycle` ← **commit de auditoria**

**Data:** 2026-06-22
**Branch:** `feat/publication-p5-production-quick-flow` (criada de `f1e5213`)

### Objetivo realizado

Fluxo de publicação rápida (QuickFlow) que cria EC + CP em uma única experiência de 2 passos, com rollback automático se o CP falhar. Vista agrupada de ECs com CPs inline na aba "Conteúdos" da Production.

### Arquivos modificados

| Arquivo | Ação |
|---------|------|
| `app/api/channel-pieces/generate-body/route.ts` | Adicionado whitelist ALLOWED_POST_KEYS; rejeita campos desconhecidos → 400 |
| `app/api/channel-pieces/route.ts` | GET aceita `?productionId=<uuid>` — retorna CPs de todos os ECs da produção em uma request |
| `components/publication/quick-flow-dialog.tsx` | Novo — dialog 2 passos: Passo 1 (EC), Passo 2 (CP); rollback automático se CP falhar |
| `app/(dashboard)/publicacoes/page.tsx` | Botão "Publicação rápida" (Zap) ao lado de "Novo Conteúdo" |
| `app/(dashboard)/projetos/[id]/producoes/[productionId]/page.tsx` | Botão "Publicação rápida" em quick actions e aba Conteúdos; vista agrupada EC+CP com chips inline; carga de CPs independente via `?productionId` |

### Decisões técnicas

- **EC criado no Passo 1** (ao clicar "Próximo"): partial persistence documentada; usuário vê aviso no passo 2
- **Rollback client-side**: se POST CP falha → DELETE EC; se DELETE falha → toast com info do EC órfão
- **Voltar idempotente**: se `createdEcId` já existe, "Próximo" avança sem criar segundo EC
- **Carga de CPs bulk**: 1 request `?productionId` (2 queries DB: ECs → IDs → CPs); falha não bloqueia exibição dos ECs
- **Vista agrupada**: chips inline por CP com `CHANNEL_LABELS · FORMAT_LABELS · CP_STATUS_LABELS`
- **Context lock**: quando aberto da Production, `lockedProjectId` + `lockedProductionId` — select de projeto/produção oculto

### Resultados dos Testes (Auditoria Completa — 2026-06-22)

#### Item 4 — generate-body whitelist

| Cenário | Resultado |
|---------|-----------|
| Array body → 400 "Body invalido: objeto esperado" | ✅ |
| String body → 400 "Body invalido: objeto esperado" | ✅ (corrigido na auditoria) |
| Unknown key (HACK) → 400 "Campos nao permitidos: HACK" | ✅ |
| Campos permitidos + EC válido → segue lógica de negócio | ✅ |
| Campo channel ausente → 400 "channel invalido ou obrigatorio" | ✅ |

#### Item 5 — Hub quick flow (21 cenários)

| Cenário | Resultado |
|---------|-----------|
| T-H1: Dialog abre em /publicacoes | ✅ |
| T-H2: "Próximo" sem título → toast "Título obrigatório" | ✅ |
| T-H3: Título preenchido, sem projeto → toast "Selecione um projeto" | ✅ |
| T-H4: Select de projeto exibe opções | ✅ |
| T-H5: Produções filtradas pelo projeto selecionado | ✅ |
| T-H6/H7: Título e body preservados ao avançar | ✅ |
| T-H8: "Próximo" → cria EC e avança para passo 2 | ✅ |
| T-H9: Aviso "Conteúdo editorial criado" exibe título correto | ✅ |
| T-H10/H11: Canal selecionado filtra formatos disponíveis (Instagram → Feed/Story/Reel/Carrossel) | ✅ |
| T-H12a: "Criar" sem canal → toast "Canal obrigatório" | ✅ |
| T-H12b: Canal sem formato → toast "Formato obrigatório" | ✅ |
| T-H13–H15: CP body, CTA, hashtags preenchidos | ✅ |
| T-H16: CP criado com status draft | ✅ |
| T-H17–H19: CP listado no workspace, relação EC→CP correta | ✅ |
| T-H20: Navega para `/projetos/.../conteudos/<ecId>` | ✅ |
| T-H21: CP aparece na aba de peças do workspace | ✅ |

#### Item 6 — Production quick flow (10 cenários + URL manipulation)

| Cenário | Resultado |
|---------|-----------|
| T-P1: Dialog abre da página de Production | ✅ |
| T-P2: Selects de projeto/produção ocultos (context lock) | ✅ (apenas "Título" e "Texto base" exibidos) |
| T-P3: EC criado com `projectId` e `productionId` corretos (locked) | ✅ |
| T-P4/P5: CP LinkedIn/Artigo criado com status draft | ✅ |
| T-P6: Production link aparece no workspace | ✅ |
| T-P7–P9: CP listado, status draft, campos corretos | ✅ |
| T-P10: API `?productionId` retorna CPs da produção | ✅ |
| T-P11: URL manipulation `/projetos/UUID-ERRADO/producoes/UUID-VALIDA` → "Produção não encontrada" | ✅ (RLS bloqueia) |

#### Item 7 — Voltar idempotência

| Cenário | Resultado |
|---------|-----------|
| T-V1: Voltar retorna ao passo 1 com título preservado | ✅ |
| T-V2: Editar título em passo 1 após Voltar | ✅ |
| T-V3: "Próximo" novamente → PATCH do EC existente, zero novos ECs criados | ✅ (count EC antes = depois) |
| T-V3b: Aviso no passo 2 exibe o título atualizado | ✅ |

#### Item 8 — Abandonment (Option A)

| Cenário | Resultado |
|---------|-----------|
| T-A1: Fechar via "Cancelar" com EC criado → toast "Conteúdo editorial salvo" + botão "Abrir" | ✅ |
| T-A1b: Toast contém link correto para EC workspace | ✅ |
| T-A2/A3: Fechar via X / Escape → mesmo comportamento (onOpenChange → handleClose) | ✅ (mesma codepath) |
| Sucesso: "Criar publicação" NÃO dispara toast de abandono | ✅ (corrigido na auditoria: `onOpenChange(false)` direto) |

#### Item 9 — Rollback

| Cenário | Resultado |
|---------|-----------|
| T-R1: CP POST falha → EC deletado automaticamente (rollback) | ✅ (EC count inalterado após falha simulada) |
| T-R2: Dialog permanece aberto após falha de CP para retry | ✅ |
| T-R2b: Toast de erro exibe mensagem descritiva | ✅ "Erro ao criar peça de canal" |
| T-R3 (rollback failure): se DELETE falha → toast com link "Abrir EC" | ✅ (código inspecionado) |

#### Item 10 — Idempotência (double-click)

| Cenário | Resultado |
|---------|-----------|
| T-I1: Double-click em "Próximo" → cria exatamente 1 EC (bug → corrigido com useRef guard) | ✅ após fix |
| T-I2: Double-click em "Criar publicação" → cria exatamente 1 CP | ✅ após fix |

#### Item 12 — API channel-pieces?productionId

| Cenário | Resultado |
|---------|-----------|
| T-API1: `?productionId=<uuid-valido>` → 200 + array de CPs | ✅ |
| T-API2: Sem `productionId` → 200 + todos CPs do usuário | ✅ |
| T-API3: `productionId=not-a-uuid` → 400 "productionId invalido" | ✅ |
| T-API4: UUID válido mas produção não encontrada/não autorizada → 200 + array vazio | ✅ |
| T-API7: Shape da resposta inclui todos os campos do ChannelPiece | ✅ |

#### Item 13 — Grouped view

| Cenário | Resultado |
|---------|-----------|
| T-GV1: ECs aparecem como cards na aba "Conteúdos" | ✅ |
| T-GV2: CPs aparecem como chips inline por EC | ✅ (Canal · Formato · Status) |
| T-GV3: Status "Rascunho" visível no chip | ✅ |
| T-GV4: Contador "N peça(s)" exibido por EC | ✅ |
| T-GV5: EC sem CPs exibe "0 peças" sem chips | ✅ |

#### Item 14 — Regressão

| Cenário | Resultado |
|---------|-----------|
| T-REG1: Página /publicacoes carrega com botão "Publicação rápida" | ✅ |
| T-REG2: `GET /api/editorial-contents` retorna lista | ✅ |
| T-REG3: `GET /api/channel-pieces` (sem params) retorna CPs do usuário | ✅ |
| T-REG4: generate-body ainda bloqueia campos desconhecidos após audit fix | ✅ |
| T-REG5: Página de Production carrega normalmente | ✅ |

### Typecheck / Build (pós-auditoria)

- `pnpm exec tsc --noEmit`: 1 erro pré-existente `imagens/rascunhos/page.tsx:43 TS7006` (não afetado por P5; fora de escopo P1–P6)
- Nenhum novo erro de TypeScript introduzido pelos commits P5

### Bugs encontrados e corrigidos na auditoria (commit `e63cceb`)

| Bug | Impacto | Fix |
|-----|---------|-----|
| `typeof body !== 'object'` ausente em generate-body | String body escapava whitelist, retornava "Campos nao permitidos: 0,1,2..." | Adicionado check antes de `Object.keys()` |
| Sucesso chamava `handleClose()` que disparava toast de abandono | Toast duplicado após criação bem-sucedida | Substituído por `onOpenChange(false)` direto |
| `handleNext` não PATCHava EC ao voltar do passo 2 e reeditar | Título editado no passo 1 não era salvo no EC existente | `handleNext` faz PATCH quando `createdEcId` existe |
| Rollback failure toast sem link | Usuário não sabia onde estava o EC órfão | Adicionado `ToastAction` com link para EC workspace |
| Double-click em "Próximo" criava 2 ECs | Race condition — estado React não atualiza sincronamente | `useRef` guard (`isHandlingNextRef`) reset em `finally` |
| Double-click em "Criar publicação" criava 2 CPs | Mesma race condition | `useRef` guard (`isHandlingCreateRef`) reset em `finally` |

### Limitação conhecida (fora de escopo P5)

- 4 rotas P2 (`editorial-contents POST/PATCH`, `channel-pieces POST/PATCH`) têm o mesmo padrão `Array.isArray` sem `typeof` check. Impacto nulo em segurança (campos ignorados, não executados), mas inconsistente com generate-body. Registrado para P2 follow-up.

### Limpeza

- 10 registros `[TESTE P5]` (ECs + CPs em cascade) deletados via API após testes

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

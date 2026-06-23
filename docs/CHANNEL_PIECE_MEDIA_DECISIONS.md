# ChannelPiece Media — Decisões de Domínio
**Data:** 2026-06-23 (rev. 3 — auditoria M1)  
**Status:** M1 aprovado para aplicação após auditoria.

> Revisão 2 incorpora as decisões humanas de 2026-06-22:
> correção de política de exclusão (RESTRICT), exatamente uma fonte por registro,
> URLs resolvidas em runtime, upload cria LibraryFile, migração sem Posts sem Projeto.
>
> Revisão 3 incorpora resultados da auditoria de M1 (2026-06-23):
> consistência de Projeto reforçada em RLS (não apenas na API), posição única
> por ChannelPiece (DEFERRABLE), no máximo uma mídia primary por ChannelPiece.

---

## Como ler

Decisões marcadas com **[REVISADA]** foram alteradas em relação à revisão anterior.  
Decisões marcadas com **[NOVA]** não existiam na revisão anterior.  
Decisões sem marcação permanecem inalteradas.

---

## CPM-D1 — Modelo de persistência de mídia

**Decisão:** Tabela `channel_piece_media` com FKs tipadas (não JSONB).

**Razão:** JSONB replica os problemas de `post_images` — sem FK, sem integridade, sem ordenação, sem rastreabilidade. Uma tabela separada permite integridade referencial, `position` explícito, `role` dedicado, e evolução incremental.

**Alternativas rejeitadas:** JSONB (replica `post_images`); polimórfico `asset_kind + asset_id` (sem FK real); apenas `library_files` (requer Asset unificado, prematuro).

---

## CPM-D2 — Schema da tabela `channel_piece_media` **[REVISADA]**

**Contexto:** Revisão 1 incluía `storage_path`, `image_url`, `thumbnail_url`, `file_size`, `mime_type` e `media_kind` como campos persistidos. Rev. 2 removeu campos deriváveis. Rev. 3 adiciona `cpm_unique_position`.

**Schema final aprovado (Rev. 3):**

```sql
channel_piece_media (
  id                 UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id            UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  channel_piece_id   UUID        NOT NULL REFERENCES channel_pieces(id) ON DELETE CASCADE,
  image_id           UUID        REFERENCES images(id) ON DELETE RESTRICT,
  library_file_id    UUID        REFERENCES library_files(id) ON DELETE RESTRICT,
  position           SMALLINT    NOT NULL DEFAULT 0 CHECK (position >= 0),
  role               TEXT        NOT NULL DEFAULT 'primary'
                       CHECK (role IN (
                         'primary', 'thumbnail', 'carousel_item',
                         'background', 'attachment'
                       )),
  alt_text           TEXT CHECK (alt_text IS NULL OR char_length(alt_text) <= 1000),
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT cpm_exactly_one_source CHECK (
    ((image_id IS NOT NULL)::integer +
     (library_file_id IS NOT NULL)::integer) = 1
  ),

  CONSTRAINT cpm_unique_position
    UNIQUE (channel_piece_id, position)
    DEFERRABLE INITIALLY IMMEDIATE
)
```

**O que foi removido em relação à revisão 1:**

| Campo removido | Razão |
|----------------|-------|
| `storage_path`, `storage_provider` | Deriváveis de `images.storage_path` ou `library_files.storage_path` via JOIN |
| `image_url`, `thumbnail_url` | URLs temporárias (presigned) ou públicas — resolvidas em runtime (CPM-D20) |
| `file_size`, `mime_type` | Duplicação de metadados da entidade de origem |
| `media_kind` | Derivável: `image_id` sempre implica `image`; `library_file_id` fornece `kind` via JOIN (CPM-D19) |

**O que foi adicionado ao longo das revisões:**

| Campo / Constraint | Revisão | Razão |
|-------------------|---------|-------|
| `CHECK (position >= 0)` | 2 | Posição não pode ser negativa |
| `CHECK (char_length(alt_text) <= 1000)` | 2 | Limite razoável para acessibilidade |
| `CONSTRAINT cpm_exactly_one_source` | 2 | Exatamente uma fonte por registro (CPM-D10) |
| `CONSTRAINT cpm_unique_position DEFERRABLE` | 3 | Ordenação determinística; defer para reordenação (M6) |

---

## CPM-D3 — Política de exclusão das fontes **[REVISADA]**

**Contexto anterior:** ON DELETE SET NULL nos FKs `image_id` e `library_file_id`. Isso criava conflito com a constraint de exatamente uma fonte: SET NULL violaria `cpm_exactly_one_source`.

**Decisão:** ON DELETE RESTRICT em `image_id` e `library_file_id`.

**Razão:** Uma mídia referenciada por `ChannelPiece` não deve ser excluída fisicamente sem antes remover explicitamente a associação. Soft-delete de `library_files` pode continuar existindo — o objeto S3 permanece, e a API de leitura de `channel_piece_media` pode detectar `library_files.deleted_at IS NOT NULL` e sinalizar "arquivo removido da biblioteca" sem quebrar a referência.

**Fluxo correto de exclusão:**
```
1. Usuário clica "Remover mídia da Versão" → DELETE channel_piece_media
2. Arquivo original em images/library_files não é afetado
3. Exclusão física de Image ou LibraryFile falha se ainda referenciada por channel_piece_media
4. UI deve detectar e orientar: "Remova das Versões antes de excluir este arquivo"
```

**Alternativa rejeitada:** SET NULL — incompatível com `cpm_exactly_one_source`. ON DELETE CASCADE da fonte — destrói silenciosamente histórico de mídia ao limpar qualquer arquivo.

---

## CPM-D4 — CASCADE de `channel_piece_id`

**Decisão:** ON DELETE CASCADE em `channel_piece_id`.

**Razão:** `channel_piece_media` não tem identidade sem seu `ChannelPiece`. Deletar a peça remove o vínculo, mas NÃO o arquivo físico (que permanece em `images` ou `library_files`).

---

## CPM-D5 — Referência sem cópia de arquivo

**Decisão:** Referência — sem cópia de arquivo. A mesma imagem pode ser referenciada por múltiplas `ChannelPiece`s sem overhead de storage.

---

## CPM-D6 — Imagens AI referenciadas diretamente via `image_id`

**Decisão:** Imagens aprovadas em `images` são referenciadas diretamente via `image_id`. Sem promoção obrigatória para `library_files`.

**Restrição (CPM-D12):** `images.project_id` deve coincidir com o Projeto da `ChannelPiece` (via `editorial_content.project_id`). Imagens com `project_id = NULL` não podem ser selecionadas normalmente para uma ChannelPiece de Projeto.

---

## CPM-D7 — Limite de mídias por `ChannelPiece`

**Decisão:** Validação na camada de API por `channel + format`. Sem constraint no banco além de `position >= 0`. Limites por canal documentados em `lib/publication-channels.ts`.

---

## CPM-D8 — Ordenação e capa **[REVISADA]**

**Decisão:**
- `position` define a ordem (0 = primeira); único por `(channel_piece_id, position)` — constraint `cpm_unique_position DEFERRABLE INITIALLY IMMEDIATE`
- `role = 'primary'` identifica a capa/mídia principal; único por `channel_piece_id` — índice `uq_cpm_cp_primary` (partial WHERE role = 'primary')
- Para carrossel: itens com `role = 'carousel_item'` + um item opcional `role = 'primary'` como capa
- Leitura ordena por `position ASC, created_at ASC` (desempate por criação)

**Comportamento ao excluir item intermediário:**
Lacuna de posição é esperada (ex: `[0, _, 2]` após deletar position 1). Não é necessário compactar imediatamente. Compactação delegada a M6 quando a UI de reordenação estiver implementada.

**Reordenação em M6 com DEFERRABLE:**
```sql
BEGIN;
  SET CONSTRAINTS cpm_unique_position DEFERRED;
  UPDATE channel_piece_media SET position = 0 WHERE id = 'a';
  UPDATE channel_piece_media SET position = 1 WHERE id = 'b';
  UPDATE channel_piece_media SET position = 2 WHERE id = 'c';
COMMIT; -- cpm_unique_position verificada aqui
```

---

## CPM-D9 — Thumbnails resolvidos em runtime

**Decisão:** `channel_piece_media` não persiste `thumbnail_url`. Thumbnails são resolvidos em runtime pela API de leitura:
- Para `image_id`: JOIN em `images.thumbnail_path` → presigned URL
- Para `library_file_id`: JOIN em `library_files.thumbnail_url` → URL pública ou presigned

**Razão:** Thumbnails já existem nas entidades de origem. Duplicar no `channel_piece_media` seria redundância que envelhece (URLs presigned expiram).

---

## CPM-D10 — Exatamente uma fonte por registro **[REVISADA]**

**Contexto anterior:** "pelo menos uma fonte" — `cpm_has_source` incluía `storage_path` e `image_url` como opções.

**Decisão:** Exatamente uma fonte, sempre FK real:

```sql
CONSTRAINT cpm_exactly_one_source CHECK (
  ((image_id IS NOT NULL)::integer +
   (library_file_id IS NOT NULL)::integer) = 1
)
```

- `image_id` não nulo + `library_file_id` nulo: válido (imagem AI)
- `image_id` nulo + `library_file_id` não nulo: válido (arquivo de biblioteca)
- Ambos nulos: inválido
- Ambos não nulos: inválido

**Impacto na migração de Posts legados (M8):** Posts com `image_url` mas sem FK para `images` ou `library_files` não podem ser migrados diretamente para o schema novo. A solução para M8 será apresentada separadamente antes da implementação de M8. Não enfraquece o schema de M1.

---

## CPM-D11 — RLS **[REVISADA]**

**Decisão (Rev. 3):** Políticas de INSERT e UPDATE verificam ownership do usuário **e** consistência de Projeto. O JOIN de 2 níveis (`channel_pieces → editorial_contents`) é tecnicamente seguro e eficiente (lookups em PKs; tabelas têm RLS aplicada recursivamente).

```sql
-- SELECT
USING (auth.uid() = user_id)

-- INSERT: ownership + Projeto consistente
WITH CHECK (
  auth.uid() = user_id
  AND EXISTS (
    SELECT 1 FROM channel_pieces
    WHERE channel_pieces.id      = channel_piece_id
      AND channel_pieces.user_id = auth.uid()
  )
  AND (
    image_id IS NULL
    OR EXISTS (
      SELECT 1
      FROM images             i
      JOIN channel_pieces     cp ON cp.id = channel_piece_id
      JOIN editorial_contents ec ON ec.id = cp.editorial_content_id
      WHERE i.id         = image_id
        AND i.user_id    = auth.uid()
        AND i.project_id IS NOT NULL
        AND i.project_id = ec.project_id
    )
  )
  AND (
    library_file_id IS NULL
    OR EXISTS (
      SELECT 1
      FROM library_files      lf
      JOIN channel_pieces     cp ON cp.id = channel_piece_id
      JOIN editorial_contents ec ON ec.id = cp.editorial_content_id
      WHERE lf.id         = library_file_id
        AND lf.user_id    = auth.uid()
        AND lf.project_id IS NOT NULL
        AND lf.project_id = ec.project_id
    )
  )
)

-- UPDATE: USING verifica a linha atual; WITH CHECK verifica o estado resultante
USING (auth.uid() = user_id)
WITH CHECK (  -- mesma estrutura do INSERT  )

-- DELETE
USING (auth.uid() = user_id)
```

**Por que o JOIN é seguro aqui:**
- `channel_pieces` e `editorial_contents` têm RLS ativa; o JOIN filtra automaticamente para linhas do usuário autenticado.
- `channel_piece_id` referencia a chave primária de `channel_pieces` (lookup O(1)).
- `cp.editorial_content_id` referencia a chave primária de `editorial_contents` (lookup O(1)).
- `image_id` / `library_file_id` referenciam PKs (lookup O(1)).
- Total: 3 lookups em PK por subquery; custo fixo e mínimo.

**Fontes com `project_id = NULL`:**
Rejeitadas pelo banco — `IS NOT NULL AND project_id = ec.project_id` falha quando `project_id IS NULL`. O usuário deve atribuir a imagem/arquivo a um Projeto antes de associar a uma ChannelPiece.

**O que a RLS não verifica (responsabilidade da API M2):**
- combinação `channel + format` válida para o canal
- limites de quantidade de mídias por canal/formato
- unicidade de thumbnail (se necessário — ver CPM-D22)

---

## CPM-D12 — Validação de Projeto na API e no banco **[REVISADA]**

**Decisão (Rev. 3):** Defesa em profundidade — RLS verifica consistência de Projeto no INSERT e UPDATE; API (M2) também valida antes de inserir.

**Camadas de proteção:**

| Camada | O que verifica |
|--------|---------------|
| Banco (RLS, Rev. 3) | `images.project_id = ec.project_id`; fontes com `project_id NULL` rejeitadas |
| API (M2) | mesma cadeia + erro amigável + limites por canal/formato |

**Cadeia de projeto verificada:**
```
channel_piece_id
  → channel_pieces.editorial_content_id
    → editorial_contents.project_id  ← projeto alvo

image_id → images.project_id  deve ser = projeto alvo (não NULL)
library_file_id → library_files.project_id  deve ser = projeto alvo (não NULL)
```

**Testes obrigatórios em M2 (cross-project):**
1. Associar imagem de Projeto B à CP de Projeto A (mesmo usuário) → deve ser rejeitado pelo banco (RLS) antes de chegar à API
2. Associar library_file com `project_id = NULL` → deve ser rejeitado pelo banco
3. Associar imagem de Projeto correto → deve ser aceito
4. Bypass via API com `project_id` errado → banco deve rejeitar independente da API

**Imagens/arquivos com `project_id = NULL`:**
O banco rejeita automaticamente. A API deve retornar mensagem orientando o usuário a atribuir o arquivo a um Projeto primeiro. Dados legados com `project_id = NULL` são exceção futura mediante decisão humana explícita.

---

## CPM-D13 — Vídeos via `library_files`

**Decisão:** Arquivo de vídeo publicável é representado por `library_file_id` onde `library_files.kind = 'video'`. `video_drafts` não é FK de mídia publicável.

**Fluxo futuro aprovado:**
```
VideoDraft → renderização/exportação → LibraryFile (kind: 'video') → ChannelPieceMedia
```

---

## CPM-D14 — URLs externas fora do escopo **[REVISADA]**

**Decisão:** Não implementar criação de `channel_piece_media` por URL externa. `image_url` e campos similares são usados apenas como compatibilidade controlada durante a migração de Posts legados (M8), não em registros normais.

---

## CPM-D15 — Crop e aspect ratio em fase futura

**Decisão:** Não no schema inicial. Campos `aspect_ratio text` e `crop_metadata jsonb` podem ser adicionados em migration futura sem breaking change.

---

## CPM-D16 — Alt text

**Decisão:** `alt_text text` com limite de 1000 caracteres, nullable, incluído desde M1.

---

## CPM-D17 — Upload de nova mídia cria `LibraryFile` **[REVISADA]**

**Contexto anterior:** Upload direto criava registro com apenas `storage_path` em `channel_piece_media`, sem entidade de origem.

**Decisão:** Todo upload novo realizado no contexto de uma ChannelPiece deve criar um registro em `library_files` antes de criar o registro em `channel_piece_media`.

**Fluxo aprovado:**
```
1. Usuário faz upload de arquivo
2. POST /api/storage/presign-image-upload {folder: 'library', ...}
3. PUT direto no S3 (cliente → S3)
4. POST /api/library-files {storagePath, publicUrl, projectId, name, kind, ...}
   → cria library_file no projeto correto
5. POST /api/channel-piece-media {libraryFileId: <id>, position, role, ...}
   → cria vínculo com FK real
```

**Pasta inicial:** o arquivo pode ser criado em pasta padrão de uploads de Conteúdos (ex: `/conteudos/`) ou sem pasta específica. A decisão de pasta não bloqueia M1–M4.

**Razão:** `cpm_exactly_one_source` exige FK real. Registros com apenas `storage_path` violam a constraint. Criar `LibraryFile` primeiro satisfaz a constraint e mantém o arquivo gerenciável pelo usuário.

---

## CPM-D18 — Mapeamento Post → EC + CP + CPM

**Decisão:** Mapeamento aprovado (campos — ver `CHANNEL_PIECE_MEDIA_DISCOVERY.md` seção 7). Detalhes de execução em `CHANNEL_PIECE_MEDIA_IMPLEMENTATION_PLAN.md` M8.

---

## CPM-D18a — Posts com `project_id = null` excluídos da migração automática **[RESOLVIDA]**

**Decisão:** Posts com `project_id = null` são excluídos da migração automática e não geram `EditorialContent` (que exige `project_id NOT NULL`).

**Comportamento:**
- Ficam fora do script de migração (`WHERE project_id IS NOT NULL`)
- Aparecem em relatório de pendências gerado pela auditoria de M8
- Permanecem disponíveis no legado (`/posts`) até que o usuário associe manualmente ao Projeto correto
- Após associação manual, o post pode ser incluído em rodada subsequente da migração

**Alternativas rejeitadas:** criar Projeto padrão automaticamente.

---

## CPM-D19 — `media_kind` não persistido **[NOVA]**

**Decisão:** `media_kind` não é campo da tabela `channel_piece_media`. É derivado em runtime via JOIN:
- `image_id IS NOT NULL` → kind implícito `'image'`
- `library_file_id IS NOT NULL` → `library_files.kind` (pode ser `image | video | audio | document | other`)

**Razão:** Duplicar informação derivável cria risco de inconsistência (ex: `library_files.kind` atualizado mas `channel_piece_media.media_kind` não). JOIN é suficiente para as queries previstas.

---

## CPM-D20 — URLs resolvidas em runtime **[NOVA]**

**Decisão:** `channel_piece_media` não persiste URLs (presigned ou públicas). A API de leitura resolve URLs em runtime:
- `image_id`: JOIN em `images`, gerar presigned URL via `images.storage_path` (1h TTL) ou retornar `images.image_url`
- `library_file_id`: JOIN em `library_files`, retornar `library_files.public_url` ou presigned via `library_files.storage_path`

**Campos que a API retorna mas não persiste:**
```typescript
// Tipo de resposta da API — campos calculados no handler, não no banco
image_url?: string
thumbnail_url?: string
media_kind?: LibraryFileKind | 'image'
file_size?: number
mime_type?: string
name?: string  // nome do arquivo (library_files.name)
```

**Razão:** URLs presigned expiram (1h). Persistir URLs temporárias como "fonte canônica" cria stale data sistêmico. O path durável já existe nas entidades de origem.

---

## CPM-D21 — Aposentadoria de Posts **[NOVA — consolida CPM-D19 anterior]**

**Decisão:** Processo em etapas M8 → M9 → M10. Tabela `posts` nunca deletada sem validação humana explícita dos dados migrados.

---

## CPM-D22 — Unicidade de `role = 'primary'` e comportamento de `thumbnail` **[NOVA]**

**Decisão:** No máximo uma mídia com `role = 'primary'` por ChannelPiece. Enforced no banco por índice único parcial `uq_cpm_cp_primary`.

```sql
CREATE UNIQUE INDEX uq_cpm_cp_primary
  ON channel_piece_media(channel_piece_id)
  WHERE role = 'primary';
```

**Comportamento ao inserir second `primary`:** banco retorna erro de unique violation; API deve detectar e retornar mensagem amigável ("esta versão já possui uma mídia principal").

**Roles que podem repetir:**
- `carousel_item` — múltiplos itens de carrossel
- `attachment` — múltiplos anexos
- `background` — múltiplos backgrounds (ex: opções a/b)
- `thumbnail` — não restringido no banco (ver abaixo)

**Decisão sobre `thumbnail`:**
Unicidade de `thumbnail` **não imposta no banco**. Razão: alguns formatos podem ter variações de thumbnail (ex: miniatura 1:1 e 16:9 para o mesmo vídeo). A API (M2) pode restringir `thumbnail` a um por ChannelPiece se o produto exigir — sem necessidade de nova migration.

**Testes obrigatórios em M2:**
1. INSERT de second `primary` na mesma CP → deve retornar unique violation
2. INSERT de second `thumbnail` na mesma CP → deve ser aceito
3. DELETE do único `primary` seguido de INSERT de novo `primary` → deve ser aceito

---

## Questões ainda abertas

Todas as questões bloqueantes para M1–M4 foram respondidas.

| Questão | Status | Milestone relevante |
|---------|--------|---------------------|
| Pasta padrão de uploads de Conteúdos | Não bloqueante para M1–M4; definir em M5 | M5 |
| Schema de migração de `post_images` legados (Posts com image_url sem FK) | Apresentar antes de M8 | M8 |
| Limite de mídias por canal/formato (ex: Instagram carousel = 10) | Documentar em `lib/publication-channels.ts` em M2 | M2 |

---

## Registro de Decisões

| Código | Decisão | Rev | Status |
|--------|---------|-----|--------|
| CPM-D1 | Tabela `channel_piece_media` com FKs (não JSONB) | 1 | Aprovada |
| CPM-D2 | Schema sem campos deriváveis; exatamente uma fonte; posição única DEFERRABLE | 3 | Aprovada |
| CPM-D3 | ON DELETE RESTRICT para `image_id` e `library_file_id` | 2 | Aprovada |
| CPM-D4 | ON DELETE CASCADE de `channel_piece_id` | 1 | Aprovada |
| CPM-D5 | Referência sem cópia de arquivo | 1 | Aprovada |
| CPM-D6 | Imagens AI referenciadas via `image_id`; `project_id` deve coincidir | 1/2 | Aprovada |
| CPM-D7 | Limites por canal validados na API | 1 | Aprovada |
| CPM-D8 | `position` único por CP (DEFERRABLE); `primary` único; ordenação ASC + created_at | 3 | Aprovada |
| CPM-D9 | `thumbnail_url` resolvida em runtime, não persistida | 2 | Aprovada |
| CPM-D10 | Exatamente uma fonte — `cpm_exactly_one_source` | 2 | Aprovada |
| CPM-D11 | RLS verifica ownership + consistência de Projeto via JOIN | 3 | Aprovada |
| CPM-D12 | Consistência de Projeto: banco (RLS) + API (M2); testes cross-project obrigatórios | 3 | Aprovada |
| CPM-D13 | Vídeos via `library_file_id` (kind = 'video') | 1 | Aprovada |
| CPM-D14 | URLs externas fora do escopo inicial | 2 | Aprovada |
| CPM-D15 | Crop/aspect ratio em fase futura | 1 | Aprovada |
| CPM-D16 | `alt_text` no schema (nullable, máx 1000 chars) | 1 | Aprovada |
| CPM-D17 | Upload cria `LibraryFile`; depois cria `channel_piece_media` | 2 | Aprovada |
| CPM-D18 | Mapeamento Post → EC + CP + CPM | 1 | Aprovada |
| CPM-D18a | Posts com `project_id = null` excluídos da migração automática | 2 | Aprovada |
| CPM-D19 | `media_kind` não persistido — derivado via JOIN | 2 | Aprovada |
| CPM-D20 | URLs resolvidas em runtime, não persistidas | 2 | Aprovada |
| CPM-D21 | Aposentadoria de Posts em etapas M8→M10 | 2 | Aprovada |
| CPM-D22 | `primary` único por CP (banco); `thumbnail` sem restrição no banco | 3 | Aprovada |

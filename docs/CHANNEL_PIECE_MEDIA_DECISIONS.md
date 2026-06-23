# ChannelPiece Media — Decisões de Domínio
**Data:** 2026-06-22 (rev. 2 — decisões humanas incorporadas)  
**Status:** Aprovado para implementação de M1.

> Revisão 2 incorpora as decisões humanas de 2026-06-22:
> correção de política de exclusão (RESTRICT), exatamente uma fonte por registro,
> URLs resolvidas em runtime, upload cria LibraryFile, migração sem Posts sem Projeto.

---

## Como ler

Decisões marcadas com **[REVISADA]** foram alteradas em relação à descoberta inicial.  
Decisões marcadas com **[NOVA]** não existiam na revisão 1.  
Decisões sem marcação permanecem inalteradas.

---

## CPM-D1 — Modelo de persistência de mídia

**Decisão:** Tabela `channel_piece_media` com FKs tipadas (não JSONB).

**Razão:** JSONB replica os problemas de `post_images` — sem FK, sem integridade, sem ordenação, sem rastreabilidade. Uma tabela separada permite integridade referencial, `position` explícito, `role` dedicado, e evolução incremental.

**Alternativas rejeitadas:** JSONB (replica `post_images`); polimórfico `asset_kind + asset_id` (sem FK real); apenas `library_files` (requer Asset unificado, prematuro).

---

## CPM-D2 — Schema da tabela `channel_piece_media` **[REVISADA]**

**Contexto:** Revisão 1 incluía `storage_path`, `image_url`, `thumbnail_url`, `file_size`, `mime_type` e `media_kind` como campos persistidos. As correções obrigatórias removem campos deriváveis ou temporários.

**Schema final aprovado:**

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
  )
)
```

**O que foi removido em relação à revisão 1:**

| Campo removido | Razão |
|----------------|-------|
| `storage_path`, `storage_provider` | Deriváveis de `images.storage_path` ou `library_files.storage_path` via JOIN |
| `image_url`, `thumbnail_url` | URLs temporárias (presigned) ou públicas — resolvidas em runtime (CPM-D20) |
| `file_size`, `mime_type` | Duplicação de metadados da entidade de origem |
| `media_kind` | Derivável: `image_id` sempre implica `image`; `library_file_id` fornece `kind` via JOIN (CPM-D19) |

**O que foi adicionado:**

| Campo / Constraint | Razão |
|-------------------|-------|
| `CHECK (position >= 0)` | Posição não pode ser negativa |
| `CHECK (char_length(alt_text) <= 1000)` | Limite razoável para acessibilidade |
| `CONSTRAINT cpm_exactly_one_source` | Exatamente uma fonte por registro (CPM-D10) |

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

## CPM-D8 — Ordenação e capa

**Decisão:**
- `position` define a ordem (0 = primeira)
- `role = 'primary'` identifica a capa/mídia principal
- Para carrossel: itens com `role = 'carousel_item'` + um item opcional `role = 'primary'` como capa

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

**Decisão:** Políticas com ownership duplo em INSERT e UPDATE.

```sql
-- SELECT
USING (auth.uid() = user_id)

-- INSERT: ownership do usuário + ChannelPiece pertence ao usuário
-- + fonte (image ou library_file) pertence ao usuário
WITH CHECK (
  auth.uid() = user_id
  AND EXISTS (
    SELECT 1 FROM channel_pieces
    WHERE channel_pieces.id = channel_piece_id
      AND channel_pieces.user_id = auth.uid()
  )
  AND (
    image_id IS NULL
    OR EXISTS (
      SELECT 1 FROM images
      WHERE images.id = image_id
        AND images.user_id = auth.uid()
    )
  )
  AND (
    library_file_id IS NULL
    OR EXISTS (
      SELECT 1 FROM library_files
      WHERE library_files.id = library_file_id
        AND library_files.user_id = auth.uid()
    )
  )
)

-- UPDATE: USING verifica a linha atual; WITH CHECK verifica o estado resultante
USING (auth.uid() = user_id)
WITH CHECK (
  auth.uid() = user_id
  AND EXISTS (
    SELECT 1 FROM channel_pieces
    WHERE channel_pieces.id = channel_piece_id
      AND channel_pieces.user_id = auth.uid()
  )
  AND (
    image_id IS NULL
    OR EXISTS (
      SELECT 1 FROM images
      WHERE images.id = image_id
        AND images.user_id = auth.uid()
    )
  )
  AND (
    library_file_id IS NULL
    OR EXISTS (
      SELECT 1 FROM library_files
      WHERE library_files.id = library_file_id
        AND library_files.user_id = auth.uid()
    )
  )
)

-- DELETE
USING (auth.uid() = user_id)
```

**Nota sobre consistência de Projeto em RLS:** A verificação de que `image.project_id = editorial_content.project_id` requereria um JOIN de três níveis na policy (image → channel_piece → editorial_content). Isso não é expressável de forma segura e simples em RLS. A consistência de Projeto é responsabilidade da camada de API (CPM-D12), seguindo o mesmo padrão do domínio de Publicações (donde `production_id ↔ project_id` é validado na API, não na policy).

---

## CPM-D12 — Validação de Projeto na API **[REVISADA]**

**Decisão:** Validação na camada de API. RLS verifica ownership; API verifica consistência de Projeto.

**Cadeia de validação na API de INSERT:**
```
channel_piece_id
  → channel_pieces.editorial_content_id
    → editorial_contents.project_id  ← projeto alvo

image_id → images.project_id  deve ser = projeto alvo
                               ou IS NULL (ver nota abaixo)

library_file_id → library_files.project_id  deve ser = projeto alvo
                                             ou IS NULL (ver nota abaixo)
```

**Imagens/arquivos com `project_id = NULL`:**
Imagens sem projeto não podem ser selecionadas normalmente para uma ChannelPiece de Projeto. A API deve rejeitar a associação e orientar o usuário.

Dados legados com `project_id = NULL` podem ser tratados como exceção futura mediante decisão humana explícita.

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
| CPM-D2 | Schema sem campos deriváveis; exatamente uma fonte | 2 | Aprovada |
| CPM-D3 | ON DELETE RESTRICT para `image_id` e `library_file_id` | 2 | Aprovada |
| CPM-D4 | ON DELETE CASCADE de `channel_piece_id` | 1 | Aprovada |
| CPM-D5 | Referência sem cópia de arquivo | 1 | Aprovada |
| CPM-D6 | Imagens AI referenciadas via `image_id`; `project_id` deve coincidir | 1/2 | Aprovada |
| CPM-D7 | Limites por canal validados na API | 1 | Aprovada |
| CPM-D8 | `position` para ordem, `role` para finalidade | 1 | Aprovada |
| CPM-D9 | `thumbnail_url` resolvida em runtime, não persistida | 2 | Aprovada |
| CPM-D10 | Exatamente uma fonte — `cpm_exactly_one_source` | 2 | Aprovada |
| CPM-D11 | RLS com ownership duplo em INSERT e UPDATE | 2 | Aprovada |
| CPM-D12 | Consistência de Projeto validada na API | 2 | Aprovada |
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

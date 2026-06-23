# ChannelPiece Media — Plano de Implementação
**Data:** 2026-06-22 (rev. 2 — schema corrigido após decisões humanas)  
**Status:** M1 autorizado. M2+ aguarda conclusão de M1.

> Cada incremento é deployável e testável de forma independente.  
> Nenhum incremento quebra o que existe. Posts legados permanecem funcionais até M8.

---

## Pré-condições confirmadas

- [x] Todas as decisões CPM-D1 a CPM-D21 aprovadas
- [x] Migration 021 aplicada em produção (`editorial_contents` e `channel_pieces` existem)
- [x] Questões bloqueantes para M1–M4 respondidas
- [ ] Branch `feat/channel-piece-media-m1-schema` criado a partir de `main` (`6e5fefe`)

---

## M1 — Schema, constraints, índices, RLS e tipos

**Objetivo:** Criar a tabela `channel_piece_media` com schema final, RLS completo e índices. Sem API, sem UI.

**Decisões que fundamentam:** CPM-D1, CPM-D2, CPM-D3, CPM-D4, CPM-D9, CPM-D10, CPM-D11, CPM-D16, CPM-D19, CPM-D20

**Arquivo:** `scripts/022_create_channel_piece_media.sql`

```sql
-- 022_create_channel_piece_media.sql
-- Cria a tabela channel_piece_media do domínio de Mídia de ChannelPiece.
--
-- Decisões de FK (CHANNEL_PIECE_MEDIA_DECISIONS.md Rev.2):
--
--   channel_piece_id   → NOT NULL, ON DELETE CASCADE
--     Uma mídia não existe sem sua ChannelPiece.
--     Deletar CP remove todos os vínculos de mídia (não os arquivos físicos).
--
--   image_id           → nullable, ON DELETE RESTRICT
--   library_file_id    → nullable, ON DELETE RESTRICT
--     Exatamente uma dessas deve ser não-nula (cpm_exactly_one_source).
--     RESTRICT impede exclusão de Image ou LibraryFile enquanto referenciada.
--     A UI deve orientar: "Remova das Versões antes de excluir este arquivo."
--
-- Campos não persistidos (derivados em runtime):
--   image_url, thumbnail_url, file_size, mime_type, media_kind
--   São resolvidos via JOIN nas entidades de origem e retornados pela API.
--
-- A função update_updated_at_column() já existe (criada em 001_create_tables.sql).
-- Idempotente: IF NOT EXISTS, DROP POLICY IF EXISTS, DROP TRIGGER IF EXISTS.

CREATE TABLE IF NOT EXISTS channel_piece_media (
  id                 UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id            UUID        NOT NULL REFERENCES auth.users(id)         ON DELETE CASCADE,
  channel_piece_id   UUID        NOT NULL REFERENCES channel_pieces(id)     ON DELETE CASCADE,
  image_id           UUID                 REFERENCES images(id)             ON DELETE RESTRICT,
  library_file_id    UUID                 REFERENCES library_files(id)      ON DELETE RESTRICT,
  position           SMALLINT    NOT NULL DEFAULT 0
                       CHECK (position >= 0),
  role               TEXT        NOT NULL DEFAULT 'primary'
                       CHECK (role IN (
                         'primary',
                         'thumbnail',
                         'carousel_item',
                         'background',
                         'attachment'
                       )),
  alt_text           TEXT
                       CHECK (alt_text IS NULL OR char_length(alt_text) <= 1000),
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Exatamente uma fonte: image_id XOR library_file_id
  CONSTRAINT cpm_exactly_one_source CHECK (
    ((image_id IS NOT NULL)::integer +
     (library_file_id IS NOT NULL)::integer) = 1
  )
);

ALTER TABLE channel_piece_media ENABLE ROW LEVEL SECURITY;

-- ──────────────────────────────────────────────────────────────────────────────
-- RLS
-- ──────────────────────────────────────────────────────────────────────────────

-- SELECT: o usuário vê apenas suas próprias mídias.
DROP POLICY IF EXISTS "cpm_select_own" ON channel_piece_media;
CREATE POLICY "cpm_select_own" ON channel_piece_media
  FOR SELECT
  USING (auth.uid() = user_id);

-- INSERT: verifica
--   (1) ownership do usuário (user_id)
--   (2) ChannelPiece pertence ao usuário
--   (3) Image pertence ao usuário (quando image_id presente)
--   (4) LibraryFile pertence ao usuário (quando library_file_id presente)
--
-- Consistência de project_id (image/library_file pertence ao mesmo Projeto da CP)
-- é responsabilidade da API (não expressável de forma segura e simples em RLS
-- sem JOIN de 3 níveis — mesmo padrão de channel_pieces INSERT policy).
DROP POLICY IF EXISTS "cpm_insert_own" ON channel_piece_media;
CREATE POLICY "cpm_insert_own" ON channel_piece_media
  FOR INSERT
  WITH CHECK (
    auth.uid() = user_id
    AND EXISTS (
      SELECT 1 FROM channel_pieces
      WHERE channel_pieces.id  = channel_piece_id
        AND channel_pieces.user_id = auth.uid()
    )
    AND (
      image_id IS NULL
      OR EXISTS (
        SELECT 1 FROM images
        WHERE images.id      = image_id
          AND images.user_id = auth.uid()
      )
    )
    AND (
      library_file_id IS NULL
      OR EXISTS (
        SELECT 1 FROM library_files
        WHERE library_files.id      = library_file_id
          AND library_files.user_id = auth.uid()
      )
    )
  );

-- UPDATE:
--   USING:      somente os próprios registros podem ser alvo.
--   WITH CHECK: o estado resultante deve manter:
--     (1) user_id correto
--     (2) channel_piece_id ainda pertence ao usuário
--     (3) image_id (se presente) ainda pertence ao usuário
--     (4) library_file_id (se presente) ainda pertence ao usuário
--   Isso impede re-apontar para CP, Image ou LibraryFile de outro usuário.
--   image_id e library_file_id são imutáveis via API (não editáveis após criação),
--   mas a constraint aqui é defensiva contra bypass direto do banco.
DROP POLICY IF EXISTS "cpm_update_own" ON channel_piece_media;
CREATE POLICY "cpm_update_own" ON channel_piece_media
  FOR UPDATE
  USING (auth.uid() = user_id)
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
        SELECT 1 FROM images
        WHERE images.id      = image_id
          AND images.user_id = auth.uid()
      )
    )
    AND (
      library_file_id IS NULL
      OR EXISTS (
        SELECT 1 FROM library_files
        WHERE library_files.id      = library_file_id
          AND library_files.user_id = auth.uid()
      )
    )
  );

-- DELETE: o usuário remove apenas seus próprios vínculos de mídia.
DROP POLICY IF EXISTS "cpm_delete_own" ON channel_piece_media;
CREATE POLICY "cpm_delete_own" ON channel_piece_media
  FOR DELETE
  USING (auth.uid() = user_id);

-- ──────────────────────────────────────────────────────────────────────────────
-- Trigger updated_at
-- ──────────────────────────────────────────────────────────────────────────────
DROP TRIGGER IF EXISTS cpm_updated_at ON channel_piece_media;
CREATE TRIGGER cpm_updated_at
  BEFORE UPDATE ON channel_piece_media
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- ──────────────────────────────────────────────────────────────────────────────
-- Índices
-- ──────────────────────────────────────────────────────────────────────────────

-- (channel_piece_id, position ASC):
--   Query principal: "listar mídias de uma ChannelPiece em ordem".
--   Cobre filtros por channel_piece_id sem position.
CREATE INDEX IF NOT EXISTS idx_cpm_cp_position
  ON channel_piece_media(channel_piece_id, position ASC);

-- (user_id, channel_piece_id):
--   Cobre listagem por usuário + filtro por CP.
--   O prefixo user_id protege queries com RLS que filtram por usuário primeiro.
CREATE INDEX IF NOT EXISTS idx_cpm_user_cp
  ON channel_piece_media(user_id, channel_piece_id);

-- (image_id): rastreabilidade — "quais CPs usam esta imagem?"
--   Partial index (WHERE NOT NULL) reduz tamanho.
--   Usado para verificar dependências antes de tentar excluir uma Image.
CREATE INDEX IF NOT EXISTS idx_cpm_image_id
  ON channel_piece_media(image_id)
  WHERE image_id IS NOT NULL;

-- (library_file_id): rastreabilidade — "quais CPs usam este arquivo?"
--   Partial index (WHERE NOT NULL).
--   Usado para verificar dependências antes de tentar excluir um LibraryFile.
CREATE INDEX IF NOT EXISTS idx_cpm_library_file_id
  ON channel_piece_media(library_file_id)
  WHERE library_file_id IS NOT NULL;
```

**Tipo TypeScript a adicionar em `lib/types.ts`:**

```typescript
export type ChannelPieceMediaRole =
  | 'primary'
  | 'thumbnail'
  | 'carousel_item'
  | 'background'
  | 'attachment'

// Registro persistido — campos do banco
export interface ChannelPieceMedia {
  id: string
  user_id: string
  channel_piece_id: string
  image_id: string | null         // exatamente um destes é não-nulo
  library_file_id: string | null  // exatamente um destes é não-nulo
  position: number
  role: ChannelPieceMediaRole
  alt_text: string | null
  created_at: string
  updated_at: string
}

// Resposta da API — inclui campos resolvidos via JOIN nas entidades de origem
export interface ChannelPieceMediaResolved extends ChannelPieceMedia {
  // Derivados da entidade de origem — calculados no handler, não persistidos
  media_kind: LibraryFileKind | 'image'
  image_url: string | null
  thumbnail_url: string | null
  file_size: number | null
  mime_type: string | null
  name: string | null  // library_files.name; null para imagens AI
}
```

**Validação de M1:**
- [ ] `pnpm build` sem erros
- [ ] `pnpm typecheck` sem erros
- [ ] SQL revisado manualmente (constraints, RLS, índices)
- [ ] `cpm_exactly_one_source` rejeita: ambos nulos, ambos não-nulos
- [ ] `position >= 0` rejeita posição negativa
- [ ] `alt_text` aceita null; rejeita string > 1000 chars
- [ ] RLS verificado: INSERT com CP de outro usuário é rejeitado

---

## M2 — APIs CRUD

**Objetivo:** Rotas `GET/POST /api/channel-piece-media` e `GET/PATCH/DELETE /api/channel-piece-media/[id]`.

**Pré-condição:** M1 aprovado e migration aplicada em staging/dev.

**Decisões:** CPM-D7, CPM-D12, CPM-D20

**Detalhes:**
- GET: retorna `ChannelPieceMediaResolved[]` — JOIN em `images` e `library_files` para resolver `image_url`, `thumbnail_url`, `media_kind`, `file_size`, `mime_type`, `name`
- POST: validação de `project_id` na cadeia CP → EC → project_id = image.project_id ou library_file.project_id
- PATCH: somente `position`, `role`, `alt_text` editáveis; `image_id`, `library_file_id`, `channel_piece_id` imutáveis
- DELETE: remove vínculo apenas — nunca deleta `images` ou `library_files`
- Documentar limites por canal em `lib/publication-channels.ts`

---

## M3 — Leitura e exibição no Workspace

**Objetivo:** Exibir mídias de uma ChannelPiece na tela de detalhe do EditorialContent.

**Pré-condição:** M2 aprovado.

**Componente:** `components/publication/channel-piece-media-section.tsx`

**UX:**
- Grid de thumbnails em ordem `position`
- Badge de `role`
- Estado "mídia indisponível" quando `deleted_at IS NOT NULL` em `library_files`
- Botão "Remover da Versão" (DELETE channel_piece_media — não apaga arquivo)
- Botão "Adicionar mídia" (shell — funcionalidade em M4/M5)

---

## M4 — Picker Galeria e Biblioteca

**Objetivo:** Associar imagem existente (`images` aprovadas ou `library_files`) a uma ChannelPiece.

**Pré-condição:** M3 aprovado.

**Decisões:** CPM-D5, CPM-D6, CPM-D12

**UX:**
- "Selecionar da Galeria" → imagens aprovadas do mesmo Projeto
- "Selecionar da Biblioteca" → library_files do mesmo Projeto, filtráveis por kind
- Múltipla seleção para carrossel

---

## M5 — Upload de nova mídia

**Objetivo:** Upload de arquivo direto no contexto de uma ChannelPiece.

**Pré-condição:** M4 aprovado.

**Decisão:** CPM-D17 (upload → LibraryFile → channel_piece_media)

**Fluxo:**
```
1. Usuário seleciona arquivo
2. POST /api/storage/presign-image-upload {folder: 'library', mimeType, filename, prefix: '/conteudos/'}
3. PUT S3 (cliente direto)
4. POST /api/library-files {storagePath, publicUrl, projectId, name, kind}
   → INSERT library_files com project_id do EC
5. POST /api/channel-piece-media {libraryFileId: <id>, channelPieceId, position, role}
   → INSERT channel_piece_media com library_file_id FK
```

**Pasta padrão:** `/conteudos/` (ou subfolder do projeto). Decisão final de pasta em M5.

---

## M6 — Reordenação e capa

**Objetivo:** Drag-and-drop para reordenar mídias; definir capa (`role = 'primary'`).

**Pré-condição:** M5 aprovado.

**API:** endpoint batch `PATCH /api/channel-piece-media/reorder` recebendo `[{id, position}]`.

---

## M7 — Suporte a vídeo

**Objetivo:** Associar `library_files` com `kind = 'video'` a ChannelPieces de formatos de vídeo.

**Pré-condição:** M6 aprovado.

**Decisão:** CPM-D13 — vídeos via `library_file_id`.

---

## M8 — Migração de Posts

**Objetivo:** Migrar dados `posts` para `editorial_contents + channel_pieces + channel_piece_media`.

**Pré-condição:** M7 aprovado. Schema de migração de `post_images` legados apresentado e aprovado separadamente.

**Decisão:** CPM-D18, CPM-D18a

**Posts excluídos da migração automática:**
- `project_id IS NULL` — relatório de pendências; aguardam escolha humana de Projeto

**Schema de migração legada (a ser apresentado antes de M8):**
Os `post_images` com apenas `image_url` sem FK para `images` ou `library_files` violam `cpm_exactly_one_source`. A solução (ex: criar `library_files` temporários a partir de `storage_path` existente, ou manter tabela de compatibilidade isolada) será modelada separadamente sem enfraquecer M1.

**Script de migração:** `scripts/023_migrate_posts.sql` — idempotente com `migrated_post_id` em `editorial_contents`.

---

## M9 — Posts read-only

**Objetivo:** Desabilitar criação/edição de Posts na UI. API GET preservada.

**Pré-condição:** M8 validado.

---

## M10 — Remoção visual de Posts

**Objetivo:** Remover Posts do menu sidebar. Tabela e API permanecem.

**Pré-condição:** M9 monitorado por período definido.

---

## Sumário

| M | Entregável | Decisões base | Pré-cond |
|---|-----------|--------------|---------|
| M1 | Schema + RLS + tipos | D1–D4, D9–D11, D16, D19, D20 | Aprovação |
| M2 | APIs CRUD | D7, D12, D20 | M1 |
| M3 | Leitura + exibição | D8, D9 | M2 |
| M4 | Picker Galeria + Biblioteca | D5, D6, D12 | M3 |
| M5 | Upload → LibraryFile → CPM | D17 | M4 |
| M6 | Reordenação + capa | D8 | M5 |
| M7 | Vídeo via library_files | D13 | M6 |
| M8 | Migração de Posts | D18, D18a | M7 + schema legado aprovado |
| M9 | Posts read-only | D21 | M8 |
| M10 | Remoção visual Posts | D21 | M9 |

---

## Próxima fase (após M10)

```
Content Studio — Production-first UX
```

Pré-requisitos conforme `HANDOFF_PUBLICATION_PHASE.md`:
1. ✅ ChannelPiece com suporte de mídia (este plano)
2. ✅ Posts aposentados (M10)
3. Reorganização da página do Projeto — Production como unidade central

# ChannelPiece Media — Plano de Implementação
**Data:** 2026-06-22  
**Status:** Proposta. Não iniciar implementação sem aprovação de `CHANNEL_PIECE_MEDIA_DECISIONS.md`.

> Cada incremento é deployável e testável de forma independente.  
> Nenhum incremento quebra o que existe. Posts legados permanecem funcionais até M8.

---

## Pré-condições confirmadas antes de iniciar

- [ ] Decisões CPM-D1 a CPM-D4 aprovadas (suficientes para M1)
- [ ] Migration 021 aplicada em produção (tabelas `editorial_contents` e `channel_pieces` existem)
- [ ] Questões abertas CPM-D17 e CPM-D18a respondidas antes de M5 e M8 respectivamente
- [ ] Branch criado a partir de `main` atual (`28756d3`)

---

## M1 — Schema e RLS

**Objetivo:** Criar a tabela `channel_piece_media` com RLS e índices. Sem API, sem UI.

**Decisões que fundamentam:** CPM-D1, CPM-D2, CPM-D3, CPM-D4, CPM-D10, CPM-D11

**Arquivo:** `scripts/022_create_channel_piece_media.sql`

```sql
CREATE TABLE IF NOT EXISTS channel_piece_media (
  id                 UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id            UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  channel_piece_id   UUID        NOT NULL REFERENCES channel_pieces(id) ON DELETE CASCADE,
  image_id           UUID        REFERENCES images(id) ON DELETE SET NULL,
  library_file_id    UUID        REFERENCES library_files(id) ON DELETE SET NULL,
  storage_path       TEXT,
  storage_provider   TEXT,
  image_url          TEXT,
  thumbnail_url      TEXT,
  file_size          INTEGER,
  mime_type          TEXT,
  media_kind         TEXT        NOT NULL DEFAULT 'image'
                       CHECK (media_kind IN ('image', 'video', 'document', 'other')),
  position           SMALLINT    NOT NULL DEFAULT 0,
  role               TEXT        NOT NULL DEFAULT 'primary'
                       CHECK (role IN (
                         'primary', 'thumbnail', 'carousel_item',
                         'background', 'attachment'
                       )),
  alt_text           TEXT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT cpm_has_source CHECK (
    image_id      IS NOT NULL
    OR library_file_id IS NOT NULL
    OR storage_path    IS NOT NULL
    OR image_url       IS NOT NULL
  )
);

ALTER TABLE channel_piece_media ENABLE ROW LEVEL SECURITY;

-- RLS: SELECT
CREATE POLICY "cpm_select_own" ON channel_piece_media
  FOR SELECT USING (auth.uid() = user_id);

-- RLS: INSERT (ownership + CP pertence ao usuário)
CREATE POLICY "cpm_insert_own" ON channel_piece_media
  FOR INSERT WITH CHECK (
    auth.uid() = user_id
    AND EXISTS (
      SELECT 1 FROM channel_pieces
      WHERE channel_pieces.id = channel_piece_id
        AND channel_pieces.user_id = auth.uid()
    )
  );

-- RLS: UPDATE
CREATE POLICY "cpm_update_own" ON channel_piece_media
  FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- RLS: DELETE
CREATE POLICY "cpm_delete_own" ON channel_piece_media
  FOR DELETE USING (auth.uid() = user_id);

-- Trigger updated_at
CREATE TRIGGER cpm_updated_at
  BEFORE UPDATE ON channel_piece_media
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Índices
-- (channel_piece_id, position): listagem ordenada de mídias por peça
CREATE INDEX idx_cpm_cp_position
  ON channel_piece_media(channel_piece_id, position);

-- (user_id, channel_piece_id): RLS + filtros por usuário
CREATE INDEX idx_cpm_user_cp
  ON channel_piece_media(user_id, channel_piece_id);

-- (image_id): rastreabilidade de qual Image está em uso
CREATE INDEX idx_cpm_image_id
  ON channel_piece_media(image_id)
  WHERE image_id IS NOT NULL;

-- (library_file_id): rastreabilidade de qual LibraryFile está em uso
CREATE INDEX idx_cpm_library_file_id
  ON channel_piece_media(library_file_id)
  WHERE library_file_id IS NOT NULL;
```

**Tipo TypeScript a adicionar em `lib/types.ts`:**

```typescript
export type ChannelPieceMediaKind = 'image' | 'video' | 'document' | 'other'
export type ChannelPieceMediaRole = 'primary' | 'thumbnail' | 'carousel_item' | 'background' | 'attachment'

export interface ChannelPieceMedia {
  id: string
  user_id: string
  channel_piece_id: string
  image_id: string | null
  library_file_id: string | null
  storage_path: string | null
  storage_provider: string | null
  image_url: string | null
  thumbnail_url: string | null
  file_size: number | null
  mime_type: string | null
  media_kind: ChannelPieceMediaKind
  position: number
  role: ChannelPieceMediaRole
  alt_text: string | null
  created_at: string
  updated_at: string
}
```

**Validação de M1:**
- Tabela existe com constraints corretas
- RLS bloqueia acesso cross-user (teste com inserção direta no Supabase)
- Índices criados

---

## M2 — APIs CRUD

**Objetivo:** Implementar rotas de API para `channel_piece_media`. Sem UI.

**Decisões que fundamentam:** CPM-D7, CPM-D12, CPM-D16

**Arquivos:**
- `app/api/channel-piece-media/route.ts` — GET, POST
- `app/api/channel-piece-media/[id]/route.ts` — GET, PATCH, DELETE

**GET `/api/channel-piece-media`**  
Parâmetros: `channelPieceId` (obrigatório), `role` (opcional)  
Resposta: `{ media: ChannelPieceMedia[] }` ordenado por `position ASC`

**POST `/api/channel-piece-media`**  
Body: `{ channelPieceId, imageId?, libraryFileId?, storagePath?, storageProvider?, imageUrl?, thumbnailUrl?, fileSize?, mimeType?, mediaKind, position?, role?, altText? }`  
Validações:
- `channelPieceId` pertence ao usuário (ownership check)
- Pelo menos uma fonte presente (imageId, libraryFileId, storagePath, imageUrl)
- `imageId`: validar `images.user_id = auth.uid()` + `images.project_id` coincide com EC.project_id (CPM-D12)
- `libraryFileId`: validar `library_files.user_id = auth.uid()`
- Limite de mídias por ChannelPiece por canal/formato (CPM-D7): buscar contagem atual + validar

**PATCH `/api/channel-piece-media/[id]`**  
Campos editáveis: `position`, `role`, `alt_text`, `thumbnail_url` (correção de thumbnail)  
Campos imutáveis: `channel_piece_id`, `image_id`, `library_file_id`, `storage_path`

**DELETE `/api/channel-piece-media/[id]`**  
Remove registro. Não deleta arquivo S3. Não deleta `images` ou `library_files`.

**Validação de M2:**
- CRUD via curl/Postman sem UI
- Ownership check: usuario B não consegue acessar mídia de usuário A
- Pelo menos uma fonte obrigatória na criação
- Ordenação correta por position

---

## M3 — Leitura e exibição no Workspace de ChannelPiece

**Objetivo:** Exibir mídias associadas a uma `ChannelPiece` na tela de detalhe do `EditorialContent`.

**Arquivo:** `app/(dashboard)/projetos/[id]/conteudos/[editorialContentId]/page.tsx`

**Funcionalidades:**
- Carregar mídias ao expandir ChannelPiece: `GET /api/channel-piece-media?channelPieceId=<id>`
- Exibir grid de thumbnails em ordem de `position`
- Badge de `role` (capa, carrossel, thumbnail)
- Estado "mídia não disponível" quando `image_id = null AND library_file_id = null AND storage_path = null`
- Botão "Adicionar mídia" (UI shell, sem funcionalidade — preenchida em M4/M5)
- Botão "Remover" por item (chamada DELETE)

**Componente novo:** `components/publication/channel-piece-media-section.tsx`

**Validação de M3:**
- Registros existentes (criados via API no M2) aparecem no workspace
- Thumbnails exibidos corretamente
- Remoção funciona sem deletar arquivo original

---

## M4 — Seleção da Biblioteca e da Galeria

**Objetivo:** Permitir associar uma imagem existente (`images` aprovadas ou `library_files`) a uma `ChannelPiece`.

**Decisões que fundamentam:** CPM-D5, CPM-D6, CPM-D12

**Funcionalidades:**
- Botão "Selecionar da Galeria" → modal com imagens aprovadas do mesmo Projeto
- Botão "Selecionar da Biblioteca" → modal com `library_files` do mesmo Projeto
- Seleção cria registro via `POST /api/channel-piece-media` com `image_id` ou `library_file_id`
- Filtro por `kind = 'image'` na biblioteca para evitar documentos/áudios onde não faz sentido
- Múltipla seleção para carrossel

**Componentes:**
- `components/publication/media-picker-gallery.tsx`
- `components/publication/media-picker-library.tsx`

**Validação de M4:**
- Imagem aprovada da galeria pode ser associada a qualquer ChannelPiece do mesmo Projeto
- Arquivo da biblioteca pode ser associado
- Mesma imagem pode ser associada a duas ChannelPieces diferentes sem duplicação de storage
- Usuário B não vê imagens de A no picker

---

## M5 — Upload de nova mídia na ChannelPiece

**Objetivo:** Permitir upload de arquivo direto no contexto de uma `ChannelPiece`.

**Pré-condição:** CPM-D17 respondida (upload cria LibraryFile? ou apenas CPM?)

**Funcionalidades:**
- Botão "Upload" → input file ou drag-and-drop
- Fluxo: `POST /api/storage/presign-image-upload {folder: 'posts'}` → PUT S3 → `POST /api/channel-piece-media {storagePath, imageUrl, ...}`
- Thumbnail gerado no cliente (canvas, mesmo padrão de `createThumbnail` em posts/page.tsx)
- Exibição imediata após upload
- Estado de progresso durante upload

**Validação de M5:**
- Upload de imagem PNG/JPG/WEBP funciona
- Thumbnail gerado e exibido
- Registro aparece no workspace após upload
- Arquivo em S3 no path `users/{userId}/posts/{uuid}/`

---

## M6 — Ordenação, reordenação e capa

**Objetivo:** Permitir reordenar mídias (carrossel) e definir a capa.

**Funcionalidades:**
- Drag-and-drop para reordenar (atualiza `position` de todos os itens afetados)
- Botão "Definir como capa" → PATCH `role = 'primary'` no item selecionado
- Ordenação salva via `PATCH /api/channel-piece-media/[id]` para cada item (ou batch update)
- Indicador visual de "capa" (pin icon, badge)

**Decisão de API:** reordenação pode exigir endpoint batch `PATCH /api/channel-piece-media/reorder` recebendo `[{id, position}]` para atualizar todos em uma transação.

**Validação de M6:**
- Reordenar e salvar: mídias persistem na nova ordem após refresh
- "Definir como capa" funciona

---

## M7 — Suporte a vídeo

**Objetivo:** Permitir associar vídeo de `library_files` (kind = 'video') a ChannelPieces com formatos de vídeo (`reel`, `short`, `video_description`).

**Decisões que fundamentam:** CPM-D13

**Pré-condição:** Upload de vídeos para biblioteca (`library_files.kind = 'video'`) já funciona.

**Funcionalidades:**
- Picker de biblioteca filtrado por `kind = 'video'`
- Preview básico (poster/thumbnail do vídeo)
- Validação: formatos `reel`, `short`, `video_description` aceitam `media_kind = 'video'`; `feed` e `story` também (vídeo é válido no Instagram feed/story)

**Validação de M7:**
- Vídeo da biblioteca pode ser associado a ChannelPiece com formato de vídeo
- Associação não quebra ChannelPieces sem vídeo

---

## M8 — Migração de Posts

**Objetivo:** Migrar registros `posts` para `editorial_contents + channel_pieces + channel_piece_media`.

**Pré-condições:**
- M1 a M7 validados em produção
- CPM-D18a respondida (posts com `project_id = null`)
- Auditoria de dados legados executada (read-only queries no Supabase)
- Script de migração revisado e aprovado

**Auditoria prévia (read-only):**

```sql
-- Posts com project_id = null (violam NOT NULL em EC)
SELECT COUNT(*) FROM posts WHERE project_id IS NULL;

-- Posts sem feed_text (EC sem conteúdo de canal)
SELECT COUNT(*) FROM posts WHERE feed_text IS NULL OR feed_text = '';

-- Posts com post_images não-vazios
SELECT COUNT(*) FROM posts WHERE jsonb_array_length(post_images) > 0;

-- Posts com image_url mas sem storage_path
SELECT COUNT(*) FROM posts WHERE image_url IS NOT NULL AND storage_path IS NULL;

-- Posts por canal
SELECT channel, COUNT(*) FROM posts GROUP BY channel;

-- Posts por status
SELECT status, COUNT(*) FROM posts GROUP BY status;
```

**Script de migração (idempotente):**

Arquivo: `scripts/023_migrate_posts.sql` (não executar até aprovação)

```sql
-- Migração idempotente: pula posts já migrados
-- Adicionar campo migrated_post_id em editorial_contents para rastrear origem

ALTER TABLE editorial_contents
  ADD COLUMN IF NOT EXISTS migrated_post_id UUID REFERENCES posts(id) ON DELETE SET NULL;

-- INSERT editorial_contents para cada post não migrado
INSERT INTO editorial_contents (
  user_id, project_id, production_id, title, body, ai_context, status, migrated_post_id
)
SELECT
  p.user_id,
  p.project_id,       -- posts com project_id = null: decidir em CPM-D18a
  p.production_id,
  p.name,
  p.description,
  p.ai_context,
  CASE WHEN p.status = 'saved' THEN 'ready' ELSE 'draft' END,
  p.id
FROM posts p
WHERE NOT EXISTS (
  SELECT 1 FROM editorial_contents ec WHERE ec.migrated_post_id = p.id
)
AND p.project_id IS NOT NULL;  -- excluir posts sem projeto por ora

-- INSERT channel_pieces para cada EC migrado
INSERT INTO channel_pieces (
  user_id, editorial_content_id, channel, format, body, status
)
SELECT
  ec.user_id,
  ec.id,
  CASE p.channel
    WHEN 'instagram_post'  THEN 'instagram'
    WHEN 'instagram_story' THEN 'instagram'
    WHEN 'youtube_post'    THEN 'youtube'
    WHEN 'youtube_shorts'  THEN 'youtube'
    WHEN 'youtube_video'   THEN 'youtube'
  END,
  CASE p.channel
    WHEN 'instagram_post'  THEN 'feed'
    WHEN 'instagram_story' THEN 'story'
    WHEN 'youtube_post'    THEN 'post'
    WHEN 'youtube_shorts'  THEN 'short'
    WHEN 'youtube_video'   THEN 'video_description'
  END,
  p.feed_text,
  CASE WHEN p.status = 'saved' THEN 'approved' ELSE 'draft' END
FROM editorial_contents ec
JOIN posts p ON p.id = ec.migrated_post_id
WHERE NOT EXISTS (
  SELECT 1 FROM channel_pieces cp WHERE cp.editorial_content_id = ec.id
);

-- INSERT channel_piece_media: imagem principal do post
INSERT INTO channel_piece_media (
  user_id, channel_piece_id, storage_path, storage_provider,
  image_url, thumbnail_url, file_size, mime_type, media_kind, position, role
)
SELECT
  cp.user_id, cp.id,
  p.storage_path, p.storage_provider,
  p.image_url, p.thumbnail_url, p.file_size, p.mime_type,
  'image', 0, 'primary'
FROM channel_pieces cp
JOIN editorial_contents ec ON ec.id = cp.editorial_content_id
JOIN posts p ON p.id = ec.migrated_post_id
WHERE p.image_url IS NOT NULL
AND NOT EXISTS (
  SELECT 1 FROM channel_piece_media m
  WHERE m.channel_piece_id = cp.id AND m.position = 0 AND m.role = 'primary'
);

-- INSERT channel_piece_media: imagens adicionais (post_images JSONB)
-- Requer função PL/pgSQL ou execução via script da aplicação
-- (JSONB → INSERT iterado por item do array)
```

**Validação de M8:**
- Contar ECs criados = posts migrados esperados
- Verificar que cada EC tem exatamente 1 CP
- Verificar que CPs com `role = 'primary'` correspondem a posts com `image_url`
- Posts originais intactos (nenhum DELETE executado ainda)

---

## M9 — Posts read-only

**Objetivo:** Desabilitar criação e edição de Posts legados no frontend. Posts continuam visíveis mas marcados como legados.

**Funcionalidades:**
- `app/(dashboard)/posts/page.tsx`: remover botão "Novo Post", tornar formulário read-only
- Banner: "Posts legados — use Conteúdos para criar novas publicações"
- Link para `/conteudos` no banner
- Production tabs: remover aba "Posts legados" (ou deixar como "Histórico")
- API `/api/posts` continua funcionando (GET livre, POST retorna 405)

**Validação de M9:**
- Não é possível criar novo post pela UI
- Posts existentes ainda visíveis
- Link para `/conteudos` funciona

---

## M10 — Remoção visual de Posts

**Objetivo:** Remover Posts do menu sidebar e das rotas de navegação principais. API e tabela permanecem.

**Funcionalidades:**
- Remover "Posts legados" do sidebar
- Rota `/posts` retorna redirect para `/conteudos`
- Rota `/posts/[id]` retorna 410 Gone ou redirect

**Nota:** A tabela `posts` e a API `/api/posts` permanecem em produção até auditoria final de dados e decisão explícita de remoção (fase posterior a este plano).

---

## Sumário de incrementos

| Incremento | Entregável | Pré-condição | Decisões CPM-D |
|------------|-----------|-------------|----------------|
| M1 | Schema `channel_piece_media` + RLS | Migration 021 aplicada | D1, D2, D3, D4, D10, D11 |
| M2 | APIs CRUD | M1 aprovado | D7, D12, D16 |
| M3 | Leitura + exibição no workspace | M2 aprovado | D8, D9 |
| M4 | Picker Galeria + Biblioteca | M3 aprovado | D5, D6, D12 |
| M5 | Upload direto na ChannelPiece | M4 aprovado; D17 respondida | D17 |
| M6 | Reordenação + capa | M5 aprovado | D8 |
| M7 | Suporte a vídeo | M6 aprovado | D13 |
| M8 | Migração de Posts | M7 aprovado; D18a respondida | D18, D19 |
| M9 | Posts read-only | M8 validado | D19 |
| M10 | Remoção visual de Posts | M9 monitorado por 2 semanas | D19 |

---

## Registro de próxima fase (após M10)

Após aposentadoria completa de Posts, a próxima fase conforme `HANDOFF_PUBLICATION_PHASE.md` é:

```
Content Studio — Production-first UX
```

Pré-requisitos (conforme handoff):
1. ✅ ChannelPiece com suporte de mídia (este plano)
2. ✅ Posts aposentados (M10)
3. Reorganização da página do Projeto para tornar Production a unidade central

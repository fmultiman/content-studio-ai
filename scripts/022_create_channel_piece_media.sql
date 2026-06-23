-- 022_create_channel_piece_media.sql
-- Cria a tabela channel_piece_media do domínio de Mídia de ChannelPiece.
--
-- Contexto: CHANNEL_PIECE_MEDIA_DECISIONS.md Rev.2
--
-- Decisões de FK:
--
--   channel_piece_id → NOT NULL, ON DELETE CASCADE
--     Uma mídia não existe sem sua ChannelPiece.
--     Deletar a CP remove todos os vínculos de mídia (não os arquivos físicos).
--
--   image_id         → nullable, ON DELETE RESTRICT
--   library_file_id  → nullable, ON DELETE RESTRICT
--     Exatamente uma dessas deve ser não-nula (cpm_exactly_one_source).
--     RESTRICT impede a exclusão de Image ou LibraryFile enquanto
--     o arquivo estiver referenciado por alguma ChannelPiece.
--     A UI deve orientar: "Remova este arquivo das Versões antes de excluí-lo."
--
-- Campos não persistidos (derivados via JOIN em runtime pela API de leitura):
--   image_url, thumbnail_url, file_size, mime_type, media_kind, name
--   → de images: storage_path → presigned URL (1h) ou image_url público
--   → de library_files: storage_path → public_url ou presigned
--
-- Soft-delete de library_files (deleted_at IS NOT NULL):
--   O RESTRICT não bloqueia soft-delete porque o registro continua na tabela.
--   A API de leitura deve sinalizar "arquivo removido da biblioteca"
--   quando library_files.deleted_at IS NOT NULL.
--
-- Idempotência: IF NOT EXISTS, DROP POLICY IF EXISTS, DROP TRIGGER IF EXISTS.
-- A função update_updated_at_column() já existe (criada em 001_create_tables.sql).
-- CREATE TABLE IF NOT EXISTS não altera tabela preexistente.

CREATE TABLE IF NOT EXISTS channel_piece_media (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           UUID        NOT NULL REFERENCES auth.users(id)        ON DELETE CASCADE,
  channel_piece_id  UUID        NOT NULL REFERENCES channel_pieces(id)    ON DELETE CASCADE,
  image_id          UUID                 REFERENCES images(id)            ON DELETE RESTRICT,
  library_file_id   UUID                 REFERENCES library_files(id)     ON DELETE RESTRICT,
  position          SMALLINT    NOT NULL DEFAULT 0
                      CHECK (position >= 0),
  role              TEXT        NOT NULL DEFAULT 'primary'
                      CHECK (role IN (
                        'primary',
                        'thumbnail',
                        'carousel_item',
                        'background',
                        'attachment'
                      )),
  alt_text          TEXT
                      CHECK (alt_text IS NULL OR char_length(alt_text) <= 1000),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Exatamente uma fonte: image_id XOR library_file_id.
  -- Nunca ambos nulos, nunca ambos não-nulos.
  CONSTRAINT cpm_exactly_one_source CHECK (
    ((image_id      IS NOT NULL)::integer +
     (library_file_id IS NOT NULL)::integer) = 1
  )
);

ALTER TABLE channel_piece_media ENABLE ROW LEVEL SECURITY;

-- ─────────────────────────────────────────────────────────────────────────────
-- RLS
-- ─────────────────────────────────────────────────────────────────────────────

-- SELECT: o usuário vê apenas as próprias mídias.
DROP POLICY IF EXISTS "cpm_select_own" ON channel_piece_media;
CREATE POLICY "cpm_select_own" ON channel_piece_media
  FOR SELECT
  USING (auth.uid() = user_id);

-- INSERT: verifica
--   (1) user_id do registro pertence ao usuário autenticado
--   (2) ChannelPiece referenciada pertence ao mesmo usuário
--   (3) Image referenciada (quando image_id presente) pertence ao mesmo usuário
--   (4) LibraryFile referenciada (quando library_file_id presente) pertence ao mesmo usuário
--
-- Consistência de project_id (image/library_file pertence ao mesmo Projeto da CP)
-- é responsabilidade da camada de API — não é expressável de forma segura e simples
-- em RLS sem JOIN de 3 níveis (channel_piece_media → channel_pieces →
-- editorial_contents → projects). Mesmo padrão documentado em 021_*.sql para
-- a coerência production_id ↔ project_id em editorial_contents.
DROP POLICY IF EXISTS "cpm_insert_own" ON channel_piece_media;
CREATE POLICY "cpm_insert_own" ON channel_piece_media
  FOR INSERT
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

-- UPDATE:
--   USING:      somente os próprios registros podem ser alvo da atualização.
--   WITH CHECK: o estado resultante deve manter:
--     (1) user_id correto (auth.uid())
--     (2) channel_piece_id aponta para CP do mesmo usuário
--     (3) image_id (quando presente) aponta para Image do mesmo usuário
--     (4) library_file_id (quando presente) aponta para LibraryFile do mesmo usuário
--   Impede reaponte para CP, Image ou LibraryFile de outro usuário.
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
-- Nunca deleta images nem library_files — apenas a associação.
DROP POLICY IF EXISTS "cpm_delete_own" ON channel_piece_media;
CREATE POLICY "cpm_delete_own" ON channel_piece_media
  FOR DELETE
  USING (auth.uid() = user_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- Trigger updated_at
-- ─────────────────────────────────────────────────────────────────────────────
DROP TRIGGER IF EXISTS cpm_updated_at ON channel_piece_media;
CREATE TRIGGER cpm_updated_at
  BEFORE UPDATE ON channel_piece_media
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- ─────────────────────────────────────────────────────────────────────────────
-- Índices
-- ─────────────────────────────────────────────────────────────────────────────

-- (channel_piece_id, position ASC):
--   Query principal: "listar mídias de uma ChannelPiece em ordem de posição".
--   Cobre filtros por channel_piece_id sem position (prefix scan).
--   Substitui: índices simples em channel_piece_id e em position isolados.
CREATE INDEX IF NOT EXISTS idx_cpm_cp_position
  ON channel_piece_media(channel_piece_id, position ASC);

-- (user_id, channel_piece_id):
--   Cobre listagem global por usuário + filtro por CP.
--   O prefixo user_id é necessário para queries com RLS que filtram por
--   usuário primeiro (planner pode usá-lo como leading column).
CREATE INDEX IF NOT EXISTS idx_cpm_user_cp
  ON channel_piece_media(user_id, channel_piece_id);

-- (image_id) parcial:
--   Rastreabilidade: "quais ChannelPieces usam esta Image?"
--   Usado pela UI/API para verificar dependências antes de tentar excluir uma Image.
--   Partial (WHERE NOT NULL) elimina as linhas com library_file_id, reduzindo tamanho.
CREATE INDEX IF NOT EXISTS idx_cpm_image_id
  ON channel_piece_media(image_id)
  WHERE image_id IS NOT NULL;

-- (library_file_id) parcial:
--   Rastreabilidade: "quais ChannelPieces usam este LibraryFile?"
--   Usado para verificar dependências antes de tentar excluir um LibraryFile.
--   Partial (WHERE NOT NULL) elimina as linhas com image_id.
CREATE INDEX IF NOT EXISTS idx_cpm_library_file_id
  ON channel_piece_media(library_file_id)
  WHERE library_file_id IS NOT NULL;

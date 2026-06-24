-- 022_create_channel_piece_media.sql
-- Cria a tabela channel_piece_media do domínio de Mídia de ChannelPiece.
--
-- Contexto: CHANNEL_PIECE_MEDIA_DECISIONS.md Rev.3 (auditoria M1 — 2026-06-23)
--
-- ─── DECISÕES DE FK ────────────────────────────────────────────────────────────
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
-- ─── CAMPOS NÃO PERSISTIDOS ────────────────────────────────────────────────────
--
--   image_url, thumbnail_url, file_size, mime_type, media_kind, name
--   → de images: storage_path → presigned URL (1h) ou image_url público
--   → de library_files: storage_path → public_url ou presigned
--
-- ─── SOFT-DELETE DE library_files ─────────────────────────────────────────────
--
--   O RESTRICT não bloqueia soft-delete (deleted_at) porque o registro continua
--   na tabela. A API de leitura deve sinalizar "arquivo removido da biblioteca"
--   quando library_files.deleted_at IS NOT NULL.
--
-- ─── CONSISTÊNCIA DE PROJETO (RLS) ─────────────────────────────────────────────
--
--   INSERT e UPDATE verificam que a fonte de mídia (images ou library_files)
--   pertence ao mesmo project_id do EditorialContent ancestral da ChannelPiece:
--
--     channel_piece_id
--       → channel_pieces.editorial_content_id
--         → editorial_contents.project_id  ← projeto alvo
--
--   images.project_id        deve ser igual ao projeto alvo (não pode ser NULL)
--   library_files.project_id deve ser igual ao projeto alvo (não pode ser NULL)
--
--   Fontes com project_id NULL são rejeitadas pelo banco — o usuário deve
--   atribuir a imagem/arquivo a um Projeto antes de associá-la a uma ChannelPiece.
--
--   A API (M2) também valida essa cadeia antes de fazer INSERT — defesa em profundidade.
--   Testes cross-project obrigatórios em M2.
--
-- ─── UNICIDADE DE POSIÇÃO ──────────────────────────────────────────────────────
--
--   cpm_unique_position: UNIQUE (channel_piece_id, position) DEFERRABLE INITIALLY IMMEDIATE
--   Garante ordenação determinística. Substituiu o índice não-único idx_cpm_cp_position.
--
--   Reordenação (M6): usar SET CONSTRAINTS cpm_unique_position DEFERRED dentro de
--   transação, então atribuir as posições novas, então COMMIT (verifica no final).
--   Lacunas de posição após exclusão são esperadas; compactação delegada a M6.
--   Leitura sempre ordena por (position ASC, created_at ASC).
--
-- ─── UNICIDADE DE role = 'primary' ────────────────────────────────────────────
--
--   uq_cpm_cp_primary: índice único parcial WHERE role = 'primary'.
--   No máximo uma mídia primary por ChannelPiece.
--   Demais roles (thumbnail, carousel_item, background, attachment) podem repetir.
--   thumbnail: unicidade não imposta no banco — API pode restringir se necessário.
--
-- ─── IDEMPOTÊNCIA ──────────────────────────────────────────────────────────────
--
--   IF NOT EXISTS, DROP POLICY IF EXISTS, DROP TRIGGER IF EXISTS.
--   A função update_updated_at_column() já existe (criada em 001_create_tables.sql).
--   CREATE TABLE IF NOT EXISTS não altera tabela preexistente — constraints declaradas
--   inline (cpm_exactly_one_source, cpm_unique_position) não são adicionadas
--   retroativamente se a tabela já existir. Se necessário, aplicar manualmente:
--     ALTER TABLE channel_piece_media
--       ADD CONSTRAINT cpm_unique_position
--         UNIQUE (channel_piece_id, position) DEFERRABLE INITIALLY IMMEDIATE;

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
  ),

  -- Posição única por ChannelPiece — garante ordenação determinística.
  -- DEFERRABLE INITIALLY IMMEDIATE: verificada imediatamente por padrão;
  -- pode ser deferida em transações de reordenação (M6):
  --   SET CONSTRAINTS cpm_unique_position DEFERRED;
  --   -- ... UPDATEs de posição ...
  --   COMMIT;  -- verificação ocorre aqui
  CONSTRAINT cpm_unique_position
    UNIQUE (channel_piece_id, position)
    DEFERRABLE INITIALLY IMMEDIATE
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
--   (3) Image referenciada (quando image_id presente):
--       - pertence ao mesmo usuário
--       - project_id não-nulo igual ao project_id do EC ancestral da CP
--   (4) LibraryFile referenciada (quando library_file_id presente):
--       - pertence ao mesmo usuário
--       - project_id não-nulo igual ao project_id do EC ancestral da CP
--
-- O JOIN de 2 níveis (channel_pieces → editorial_contents) é seguro:
--   - Ambas as tabelas têm RLS ativa, então o JOIN filtra automaticamente
--     para linhas onde user_id = auth.uid() (sem acesso cross-user).
--   - O subquery é O(1): lookups em PKs (channel_pieces.id, editorial_contents.id).
--   - Fontes com project_id NULL são rejeitadas (IS NOT NULL na condição).
--
-- Consistência de project_id que não é verificada aqui (responsabilidade da API M2):
--   - combinação channel + format válida para o projeto
--   - limites de mídias por canal/formato
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
        SELECT 1
        FROM images              i
        JOIN channel_pieces      cp ON cp.id = channel_piece_id
        JOIN editorial_contents  ec ON ec.id = cp.editorial_content_id
        WHERE i.id          = image_id
          AND i.user_id     = auth.uid()
          AND i.project_id  IS NOT NULL
          AND i.project_id  = ec.project_id
      )
    )
    AND (
      library_file_id IS NULL
      OR EXISTS (
        SELECT 1
        FROM library_files       lf
        JOIN channel_pieces      cp ON cp.id = channel_piece_id
        JOIN editorial_contents  ec ON ec.id = cp.editorial_content_id
        WHERE lf.id          = library_file_id
          AND lf.user_id     = auth.uid()
          AND lf.project_id  IS NOT NULL
          AND lf.project_id  = ec.project_id
      )
    )
  );

-- UPDATE:
--   USING:      somente os próprios registros podem ser alvo da atualização.
--   WITH CHECK: o estado resultante deve manter:
--     (1) user_id correto (auth.uid())
--     (2) channel_piece_id aponta para CP do mesmo usuário
--     (3) image_id (quando presente) — mesmo usuário e mesmo Projeto da CP
--     (4) library_file_id (quando presente) — mesmo usuário e mesmo Projeto da CP
--   Impede reaponte para CP, Image ou LibraryFile de outro usuário ou outro Projeto.
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
        SELECT 1
        FROM images              i
        JOIN channel_pieces      cp ON cp.id = channel_piece_id
        JOIN editorial_contents  ec ON ec.id = cp.editorial_content_id
        WHERE i.id          = image_id
          AND i.user_id     = auth.uid()
          AND i.project_id  IS NOT NULL
          AND i.project_id  = ec.project_id
      )
    )
    AND (
      library_file_id IS NULL
      OR EXISTS (
        SELECT 1
        FROM library_files       lf
        JOIN channel_pieces      cp ON cp.id = channel_piece_id
        JOIN editorial_contents  ec ON ec.id = cp.editorial_content_id
        WHERE lf.id          = library_file_id
          AND lf.user_id     = auth.uid()
          AND lf.project_id  IS NOT NULL
          AND lf.project_id  = ec.project_id
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

-- Nota: (channel_piece_id, position) já está coberto pela constraint cpm_unique_position,
-- que cria implicitamente um B-tree index com o mesmo prefixo. O índice não-único
-- idx_cpm_cp_position da revisão anterior foi removido — seria redundante.

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

-- role = 'primary' única por ChannelPiece:
--   No máximo uma mídia com role = 'primary' por ChannelPiece.
--   Demais roles (thumbnail, carousel_item, background, attachment) podem repetir.
--   Se thumbnail também precisar ser única por CP, adicionar índice parcial separado
--   após decisão explícita — não imposto aqui.
CREATE UNIQUE INDEX IF NOT EXISTS uq_cpm_cp_primary
  ON channel_piece_media(channel_piece_id)
  WHERE role = 'primary';

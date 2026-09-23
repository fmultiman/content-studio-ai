-- 033_create_channel_piece_static_authoring_states.sql
-- Cria a tabela channel_piece_static_authoring_states — Slice 1 do Portal
-- Carousel V1 (fundação persistida de 2 slides + desacoplamento light/dark).
--
-- Contexto: docs/architecture/MEDIA_PRODUCTION_ARCHITECTURE_V1.md e
-- docs/productization/creative-rendering/PORTAL_CAROUSEL_V1_FACTUAL_REENTRY.md
-- identificam a persistência do AuthoringState como a principal lacuna de
-- reprodutibilidade do caminho de autoria estática: hoje, reabrir "Editar
-- Visual" sempre recalcula o estado do zero a partir do ChannelPiece/
-- EditorialContent — nenhuma escolha de primitiva/transform/conteúdo/variante/
-- aparência sobrevive a um reload.
--
-- ─── LIMITE DE RESPONSABILIDADE ─────────────────────────────────────────────
--
--   Esta tabela é o PRIMEIRO passo do ciclo de vida:
--     estado autorado  →  render  →  PNG gerado  →  save opcional  →  LibraryFile / ChannelPieceMedia
--   Ela NUNCA se torna o output renderizado, um LibraryFile, ou uma
--   ChannelPieceMedia. channel_piece_media continua a ordenar ANEXOS/outputs
--   salvos (papel inalterado); esta tabela ordena SLIDES AUTORADOS, uma
--   distinção deliberada (ver ARCHITECTURE V1 §11: "Gallery visibility ≠
--   ChannelPiece attachment", mesmo princípio aplicado aqui).
--
-- ─── FORMATO ─────────────────────────────────────────────────────────────────
--
--   Uma linha por ChannelPiece. `slides` é um array JSONB ordenado — a mesma
--   forma serve tanto uma peça static de slide único quanto um carousel
--   multi-slide; apenas a UI decide se expõe navegação (não há redesenho de
--   todo formato static para parecer simétrico com o carousel).
--
--   O contrato de cada elemento de `slides` (id, order, variant, appearance,
--   content, primitiveSelection, primitiveTransforms, heroRef?) é validado em
--   TypeScript por PersistedAuthoredSlideSchema
--   (lib/creative/authoring/carousel-state.ts) antes de qualquer INSERT/UPDATE
--   — o banco impõe apenas a forma mínima (array não-vazio) via CHECK.
--
-- ─── NÃO PERSISTIDO (deliberado) ─────────────────────────────────────────────
--
--   productContext (Project/Production/EditorialContent/ChannelPiece/Identity)
--   é sempre re-derivado da linha viva — nunca duplicado aqui.
--   PreviewTuning nunca é persistido (é dev-only, nunca entra em um manifest).
--
-- ─── UNICIDADE ───────────────────────────────────────────────────────────────
--
--   Uma linha por ChannelPiece: cpsas_unique_channel_piece. Upsert por
--   channel_piece_id é o padrão de escrita esperado da API.

CREATE TABLE IF NOT EXISTS channel_piece_static_authoring_states (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           UUID        NOT NULL REFERENCES auth.users(id)     ON DELETE CASCADE,
  channel_piece_id  UUID        NOT NULL REFERENCES channel_pieces(id) ON DELETE CASCADE,
  schema_version    TEXT        NOT NULL DEFAULT 'static-authoring-state.v1',
  slides            JSONB       NOT NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT cpsas_unique_channel_piece UNIQUE (channel_piece_id),

  -- Forma mínima mecanicamente verificável no banco. A validação completa do
  -- contrato de cada slide (variant/appearance/content/etc.) é feita em
  -- TypeScript (PersistedAuthoredSlideSchema) antes do INSERT/UPDATE chegar
  -- aqui — replicar um schema Zod inteiro em CHECK constraints não é o padrão
  -- deste projeto (mesma decisão registrada em 027_add_project_identity.sql
  -- para a coluna identity JSONB de projects).
  CONSTRAINT cpsas_slides_is_nonempty_array CHECK (
    jsonb_typeof(slides) = 'array' AND jsonb_array_length(slides) >= 1
  )
);

ALTER TABLE channel_piece_static_authoring_states ENABLE ROW LEVEL SECURITY;

-- ─────────────────────────────────────────────────────────────────────────────
-- RLS
-- ─────────────────────────────────────────────────────────────────────────────

-- SELECT: o usuário vê apenas o próprio estado de autoria.
DROP POLICY IF EXISTS "cpsas_select_own" ON channel_piece_static_authoring_states;
CREATE POLICY "cpsas_select_own" ON channel_piece_static_authoring_states
  FOR SELECT
  USING (auth.uid() = user_id);

-- INSERT: user_id do registro pertence ao usuário autenticado E a
-- ChannelPiece referenciada pertence ao mesmo usuário.
DROP POLICY IF EXISTS "cpsas_insert_own" ON channel_piece_static_authoring_states;
CREATE POLICY "cpsas_insert_own" ON channel_piece_static_authoring_states
  FOR INSERT
  WITH CHECK (
    auth.uid() = user_id
    AND EXISTS (
      SELECT 1 FROM channel_pieces
      WHERE channel_pieces.id      = channel_piece_id
        AND channel_pieces.user_id = auth.uid()
    )
  );

-- UPDATE: mesma verificação de propriedade em USING e WITH CHECK — impede
-- reapontar o registro para uma ChannelPiece de outro usuário.
DROP POLICY IF EXISTS "cpsas_update_own" ON channel_piece_static_authoring_states;
CREATE POLICY "cpsas_update_own" ON channel_piece_static_authoring_states
  FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (
    auth.uid() = user_id
    AND EXISTS (
      SELECT 1 FROM channel_pieces
      WHERE channel_pieces.id      = channel_piece_id
        AND channel_pieces.user_id = auth.uid()
    )
  );

-- DELETE: o usuário remove apenas o próprio estado de autoria.
-- CASCADE em channel_piece_id já cobre a exclusão da ChannelPiece em si.
DROP POLICY IF EXISTS "cpsas_delete_own" ON channel_piece_static_authoring_states;
CREATE POLICY "cpsas_delete_own" ON channel_piece_static_authoring_states
  FOR DELETE
  USING (auth.uid() = user_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- Trigger updated_at (função já existe — criada em 001_create_tables.sql)
-- ─────────────────────────────────────────────────────────────────────────────
DROP TRIGGER IF EXISTS cpsas_updated_at ON channel_piece_static_authoring_states;
CREATE TRIGGER cpsas_updated_at
  BEFORE UPDATE ON channel_piece_static_authoring_states
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- ─────────────────────────────────────────────────────────────────────────────
-- Índices
-- ─────────────────────────────────────────────────────────────────────────────

-- Nota: channel_piece_id já tem índice implícito via cpsas_unique_channel_piece,
-- que também é o único padrão de leitura desta tabela (GET/PUT por ChannelPiece).
CREATE INDEX IF NOT EXISTS idx_cpsas_user_id
  ON channel_piece_static_authoring_states(user_id);

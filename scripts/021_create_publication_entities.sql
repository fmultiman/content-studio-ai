-- 021_create_publication_entities.sql
-- Cria as tabelas editorial_contents e channel_pieces do domínio de Publicações.
--
-- Decisões de FK (PUB-D5, PUB-D6, PUB-D7 de PUBLICATION_DOMAIN_DECISIONS.md):
--   editorial_contents.project_id       → NOT NULL, ON DELETE RESTRICT
--     O conteúdo editorial não pode existir sem um Projeto.
--     A exclusão de um Projeto com ECs associados é bloqueada (FK 23503).
--     A UI deve orientar o usuário a excluir ou mover ECs antes de excluir o Projeto.
--
--   editorial_contents.production_id    → nullable, ON DELETE SET NULL
--     O conteúdo editorial sobrevive à exclusão da Produção.
--     Comportamento idêntico ao de image_drafts.production_id e video_drafts.production_id.
--
--   channel_pieces.editorial_content_id → NOT NULL, ON DELETE CASCADE
--     Uma ChannelPiece não tem identidade fora do seu EditorialContent.
--     Se o EC for excluído, todas as peças de canal são excluídas em cascata.
--
-- Integridade user → Projeto → Production — o que cada camada garante:
--   BANCO (FK + RLS):
--     - user_id = auth.uid() em INSERT/UPDATE (ownership do usuário)
--     - project_id pertence ao mesmo usuário (EXISTS em projects)
--     - production_id IS NULL ou pertence ao mesmo usuário (EXISTS em productions)
--     - editorial_content_id pertence ao mesmo usuário (EXISTS em editorial_contents)
--   API (P2):
--     - production_id (quando não nulo) pertence ao mesmo project_id do EC
--       (cross-check productions.project_id = editorial_contents.project_id)
--     - combinação channel + format é válida conforme lib/publication-channels.ts
--   Inconsistência possível via acesso direto ao Supabase (sem a API):
--     - Um usuário poderia vincular um EC a uma Production de outro Projeto seu.
--       O banco verifica apenas ownership do usuário, não a consistência de Projeto.
--
-- Idempotência: IF NOT EXISTS, DROP POLICY IF EXISTS, DROP TRIGGER IF EXISTS.
-- Segue o padrão de 020_create_productions.sql.
-- A função update_updated_at_column() já existe (criada em 001_create_tables.sql).
-- CREATE TABLE IF NOT EXISTS não altera tabela preexistente — mesma ressalva do 020.

-- ============================================================
-- EDITORIAL_CONTENTS
-- ============================================================
CREATE TABLE IF NOT EXISTS editorial_contents (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID        NOT NULL REFERENCES auth.users(id)  ON DELETE CASCADE,
  project_id    UUID        NOT NULL REFERENCES projects(id)    ON DELETE RESTRICT,
  production_id UUID                 REFERENCES productions(id)  ON DELETE SET NULL,
  title         TEXT        NOT NULL
                  CHECK (
                    char_length(trim(title)) > 0
                    AND char_length(title) <= 500
                  ),
  body          TEXT
                  CHECK (body IS NULL OR char_length(body) <= 50000),
  ai_context    TEXT
                  CHECK (ai_context IS NULL OR char_length(ai_context) <= 5000),
  status        TEXT        NOT NULL DEFAULT 'draft'
                  CHECK (status IN ('draft', 'ready', 'archived')),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE editorial_contents ENABLE ROW LEVEL SECURITY;

-- SELECT: o usuário vê apenas os próprios conteúdos editoriais.
DROP POLICY IF EXISTS "editorial_contents_select_own" ON editorial_contents;
CREATE POLICY "editorial_contents_select_own" ON editorial_contents
  FOR SELECT
  USING (auth.uid() = user_id);

-- INSERT: verifica (1) ownership do usuário, (2) ownership do Projeto e
-- (3) ownership da Production quando production_id não for nulo.
-- A coerência production_id ↔ project_id (mesma Production pertence ao mesmo Projeto)
-- é verificada pela API em P2 — a policy não impõe essa regra de negócio.
DROP POLICY IF EXISTS "editorial_contents_insert_own" ON editorial_contents;
CREATE POLICY "editorial_contents_insert_own" ON editorial_contents
  FOR INSERT
  WITH CHECK (
    auth.uid() = user_id
    AND EXISTS (
      SELECT 1 FROM projects
      WHERE projects.id = project_id
        AND projects.user_id = auth.uid()
    )
    AND (
      production_id IS NULL
      OR EXISTS (
        SELECT 1 FROM productions
        WHERE productions.id = production_id
          AND productions.user_id = auth.uid()
      )
    )
  );

-- UPDATE: USING determina quais linhas podem ser alvo; WITH CHECK valida o estado
-- resultante. Impede mover um EC para um Projeto alheio e impede vincular a uma
-- Production de outro usuário.
-- project_id não é editável pela API normal; a constraint aqui é defensiva.
DROP POLICY IF EXISTS "editorial_contents_update_own" ON editorial_contents;
CREATE POLICY "editorial_contents_update_own" ON editorial_contents
  FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (
    auth.uid() = user_id
    AND EXISTS (
      SELECT 1 FROM projects
      WHERE projects.id = project_id
        AND projects.user_id = auth.uid()
    )
    AND (
      production_id IS NULL
      OR EXISTS (
        SELECT 1 FROM productions
        WHERE productions.id = production_id
          AND productions.user_id = auth.uid()
      )
    )
  );

-- DELETE: o usuário exclui apenas os próprios ECs.
-- ON DELETE CASCADE em channel_pieces remove as peças associadas automaticamente.
DROP POLICY IF EXISTS "editorial_contents_delete_own" ON editorial_contents;
CREATE POLICY "editorial_contents_delete_own" ON editorial_contents
  FOR DELETE
  USING (auth.uid() = user_id);

DROP TRIGGER IF EXISTS editorial_contents_updated_at ON editorial_contents;
CREATE TRIGGER editorial_contents_updated_at
  BEFORE UPDATE ON editorial_contents
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- Índices:
--
-- (user_id, project_id, updated_at DESC):
--   Cobre listagem por usuário + Projeto com ordenação. O prefix (user_id) cobre
--   também listagem global por usuário. Índice simples em user_id seria redundante.
--
-- (user_id, production_id, updated_at DESC):
--   Cobre listagem por usuário + Produção com ordenação.
--   Inclui production_id=NULL nas queries de "sem produção".
--
-- (user_id, status):
--   Cobre filtro por status dentro do contexto do usuário.
--   Índice simples em status seria de seletividade mínima (3 valores distintos).
--
-- Índices removidos em relação ao rascunho original:
--   (status) simples — seletividade de 3 valores, inútil sem prefixo de usuário
--   (updated_at DESC) simples — covered pelos compostos acima via prefix scan
CREATE INDEX IF NOT EXISTS idx_editorial_contents_user_project
  ON editorial_contents(user_id, project_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_editorial_contents_user_production
  ON editorial_contents(user_id, production_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_editorial_contents_user_status
  ON editorial_contents(user_id, status);

-- ============================================================
-- CHANNEL_PIECES
-- ============================================================
CREATE TABLE IF NOT EXISTS channel_pieces (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id              UUID NOT NULL REFERENCES auth.users(id)         ON DELETE CASCADE,
  editorial_content_id UUID NOT NULL REFERENCES editorial_contents(id) ON DELETE CASCADE,
  channel              TEXT NOT NULL
                         CHECK (channel IN (
                           'instagram', 'youtube', 'whatsapp',
                           'linkedin', 'x', 'tiktok'
                         )),
  format               TEXT NOT NULL
                         CHECK (format IN (
                           'feed', 'story', 'reel', 'short', 'video_description',
                           'post', 'channel_message', 'carousel', 'article'
                         )),
  title                TEXT
                         CHECK (title IS NULL OR char_length(title) <= 500),
  body                 TEXT
                         CHECK (body IS NULL OR char_length(body) <= 100000),
  cta                  TEXT
                         CHECK (cta IS NULL OR char_length(cta) <= 500),
  hashtags             TEXT
                         CHECK (hashtags IS NULL OR char_length(hashtags) <= 2000),
  status               TEXT NOT NULL DEFAULT 'draft'
                         CHECK (status IN ('draft', 'ready', 'approved', 'archived')),
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE channel_pieces ENABLE ROW LEVEL SECURITY;

-- SELECT: o usuário vê apenas as próprias peças de canal.
DROP POLICY IF EXISTS "channel_pieces_select_own" ON channel_pieces;
CREATE POLICY "channel_pieces_select_own" ON channel_pieces
  FOR SELECT
  USING (auth.uid() = user_id);

-- INSERT: verifica ownership do usuário e que o EditorialContent referenciado
-- pertence ao mesmo usuário.
-- Previne criação de ChannelPieces sobre ECs de outros usuários, mesmo que o
-- UUID seja obtido por meios externos.
DROP POLICY IF EXISTS "channel_pieces_insert_own" ON channel_pieces;
CREATE POLICY "channel_pieces_insert_own" ON channel_pieces
  FOR INSERT
  WITH CHECK (
    auth.uid() = user_id
    AND EXISTS (
      SELECT 1 FROM editorial_contents
      WHERE editorial_contents.id = editorial_content_id
        AND editorial_contents.user_id = auth.uid()
    )
  );

-- UPDATE:
--   USING: o usuário só pode atualizar as próprias ChannelPieces.
--   WITH CHECK: o estado resultante não pode ter user_id ou editorial_content_id
--     de outro usuário.
--     - Impede mudança de user_id: auth.uid() = user_id seria falso para outro usuário.
--     - Impede mover para EC de outro usuário: EXISTS falha se editorial_content_id
--       aponta para EC que não pertence ao usuário autenticado.
--   editorial_content_id não é editável pela API (imutável após criação), mas a
--   constraint aqui é defensiva contra bypass direto do banco.
DROP POLICY IF EXISTS "channel_pieces_update_own" ON channel_pieces;
CREATE POLICY "channel_pieces_update_own" ON channel_pieces
  FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (
    auth.uid() = user_id
    AND EXISTS (
      SELECT 1 FROM editorial_contents
      WHERE editorial_contents.id = editorial_content_id
        AND editorial_contents.user_id = auth.uid()
    )
  );

-- DELETE: o usuário exclui apenas as próprias peças de canal.
DROP POLICY IF EXISTS "channel_pieces_delete_own" ON channel_pieces;
CREATE POLICY "channel_pieces_delete_own" ON channel_pieces
  FOR DELETE
  USING (auth.uid() = user_id);

DROP TRIGGER IF EXISTS channel_pieces_updated_at ON channel_pieces;
CREATE TRIGGER channel_pieces_updated_at
  BEFORE UPDATE ON channel_pieces
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- Índices:
--
-- (editorial_content_id, updated_at DESC):
--   Cobre o fluxo principal: listar ChannelPieces de um EC com ordenação por data.
--   O prefix (editorial_content_id) cobre também filtros sem ordenação.
--   Substitui: índice simples em editorial_content_id + índice simples em updated_at.
--
-- (user_id, status):
--   Cobre filtro global de peças por usuário e status (ex: "todos os aprovados").
--   Substitui: índice simples em user_id e índice simples em status, ambos de
--   seletividade muito baixa isolados (status tem 4 valores distintos).
--
-- Índices removidos em relação ao rascunho original:
--   (user_id) simples — prefixo do composto user_status
--   (channel) simples — 6 valores distintos, seletividade ínfima sem contexto
--   (format) simples — 9 valores distintos, seletividade ínfima sem contexto
--   (status) simples — 4 valores distintos, seletividade ínfima sem contexto
--   (updated_at DESC) simples — coberto pelo composto ec_updated_at
--
-- Filtros por channel e format dentro do contexto de um EC serão avaliados em P4;
-- a seletividade existente (poucos registros por EC) torna índices adicionais
-- desnecessários até que o volume justifique.
CREATE INDEX IF NOT EXISTS idx_channel_pieces_ec_updated_at
  ON channel_pieces(editorial_content_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_channel_pieces_user_status
  ON channel_pieces(user_id, status);

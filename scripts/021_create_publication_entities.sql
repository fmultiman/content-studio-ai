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
-- Integridade user → Projeto → Production:
--   O banco garante via RLS INSERT:
--     - user_id = auth.uid() (ownership do usuário)
--     - project_id pertence ao mesmo usuário (EXISTS em projects)
--     - editorial_content_id pertence ao mesmo usuário (EXISTS em editorial_contents)
--   A API garantirá em P2:
--     - production_id (nullable) pertence ao mesmo usuário E ao mesmo Projeto do EC
--     - combinação channel + format é válida conforme lib/publication-channels.ts
--
-- Idempotência: IF NOT EXISTS, DROP POLICY IF EXISTS, DROP TRIGGER IF EXISTS.
-- Segue o padrão de 020_create_productions.sql.
-- A função update_updated_at_column() já existe (criada em 001_create_tables.sql).

-- ============================================================
-- EDITORIAL_CONTENTS
-- ============================================================
CREATE TABLE IF NOT EXISTS editorial_contents (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID        NOT NULL REFERENCES auth.users(id)  ON DELETE CASCADE,
  project_id    UUID        NOT NULL REFERENCES projects(id)    ON DELETE RESTRICT,
  production_id UUID                 REFERENCES productions(id)  ON DELETE SET NULL,
  title         TEXT        NOT NULL,
  body          TEXT,
  ai_context    TEXT,
  status        TEXT        NOT NULL DEFAULT 'draft'
                CHECK (status IN ('draft', 'ready', 'archived')),
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE editorial_contents ENABLE ROW LEVEL SECURITY;

-- SELECT: o usuário vê apenas os próprios conteúdos editoriais.
DROP POLICY IF EXISTS "editorial_contents_select_own" ON editorial_contents;
CREATE POLICY "editorial_contents_select_own" ON editorial_contents
  FOR SELECT
  USING (auth.uid() = user_id);

-- INSERT: verifica que user_id pertence ao usuário autenticado e que o Projeto
-- também pertence ao mesmo usuário. A ownership da Production (nullable) é
-- verificada pela API em P2 — não pode ser imposta aqui sem tornar a policy
-- incompatível com production_id = null.
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
  );

-- UPDATE: USING determina quais linhas podem ser alvo; WITH CHECK valida
-- o estado resultante. Impede mover um EC para um Projeto alheio.
-- project_id não é editável pela API normal, mas a constraint aqui é defensiva.
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
-- Compostos (user_id, ...) cobrem listagem global por usuário (prefix scan),
-- listagem por Projeto e listagem por Produção — os três fluxos principais de P3.
-- Simple user_id não é criado: já coberto como prefixo dos compostos.
-- Simple project_id e production_id não são criados: queries sempre incluem user_id
-- via RLS, tornando os compostos suficientes.
CREATE INDEX IF NOT EXISTS idx_editorial_contents_user_project
  ON editorial_contents(user_id, project_id);

CREATE INDEX IF NOT EXISTS idx_editorial_contents_user_production
  ON editorial_contents(user_id, production_id);

CREATE INDEX IF NOT EXISTS idx_editorial_contents_status
  ON editorial_contents(status);

CREATE INDEX IF NOT EXISTS idx_editorial_contents_updated_at
  ON editorial_contents(updated_at DESC);

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
  title                TEXT,
  body                 TEXT,
  cta                  TEXT,
  hashtags             TEXT,
  status               TEXT NOT NULL DEFAULT 'draft'
                         CHECK (status IN ('draft', 'ready', 'approved', 'archived')),
  created_at           TIMESTAMPTZ DEFAULT NOW(),
  updated_at           TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE channel_pieces ENABLE ROW LEVEL SECURITY;

-- SELECT: o usuário vê apenas as próprias peças de canal.
DROP POLICY IF EXISTS "channel_pieces_select_own" ON channel_pieces;
CREATE POLICY "channel_pieces_select_own" ON channel_pieces
  FOR SELECT
  USING (auth.uid() = user_id);

-- INSERT: verifica ownership do usuário e que o EditorialContent referenciado
-- pertence ao mesmo usuário. Previne que um usuário crie ChannelPieces
-- em cima de ECs de outro usuário, mesmo que obtenha o UUID por outros meios.
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

-- UPDATE: USING para controle de acesso à linha; WITH CHECK para validar estado resultante.
-- editorial_content_id não é editável pela API (imutável após criação), mas a
-- constraint aqui é defensiva: impede mover uma ChannelPiece para EC de outro usuário.
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
-- editorial_content_id: fluxo principal de listagem e chave de CASCADE DELETE.
-- user_id: queries globais por usuário e reforço de RLS.
-- channel, format, status: filtros esperados em P4.
-- updated_at DESC: ordenação padrão dos resultados.
CREATE INDEX IF NOT EXISTS idx_channel_pieces_editorial_content_id
  ON channel_pieces(editorial_content_id);

CREATE INDEX IF NOT EXISTS idx_channel_pieces_user_id
  ON channel_pieces(user_id);

CREATE INDEX IF NOT EXISTS idx_channel_pieces_channel
  ON channel_pieces(channel);

CREATE INDEX IF NOT EXISTS idx_channel_pieces_format
  ON channel_pieces(format);

CREATE INDEX IF NOT EXISTS idx_channel_pieces_status
  ON channel_pieces(status);

CREATE INDEX IF NOT EXISTS idx_channel_pieces_updated_at
  ON channel_pieces(updated_at DESC);

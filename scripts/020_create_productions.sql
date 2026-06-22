-- 020_create_productions.sql
-- Cria a tabela productions e vincula entidades existentes via production_id.
--
-- Reexecutável no estado esperado desta migration.
-- Os comandos IF EXISTS / IF NOT EXISTS evitam falhas comuns de repetição,
-- mas o script não reconcilia schemas parcialmente divergentes.
-- CREATE TABLE IF NOT EXISTS não corrige uma tabela preexistente com constraints
-- diferentes, e ADD COLUMN IF NOT EXISTS não recria uma FK ausente caso a coluna
-- já exista sem ela.

-- ============================================================
-- TABELA
-- ============================================================
CREATE TABLE IF NOT EXISTS productions (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  project_id UUID NOT NULL REFERENCES projects(id)  ON DELETE RESTRICT,
  title      TEXT NOT NULL,
  intention  TEXT NOT NULL,
  type       TEXT NOT NULL DEFAULT 'editorial'
               CHECK (type IN ('editorial', 'branding', 'campaign')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- ROW LEVEL SECURITY
-- ============================================================
ALTER TABLE productions ENABLE ROW LEVEL SECURITY;

-- SELECT: o usuário vê apenas as próprias Produções.
DROP POLICY IF EXISTS "productions_select_own" ON productions;
CREATE POLICY "productions_select_own" ON productions
  FOR SELECT
  USING (auth.uid() = user_id);

-- INSERT: valida que user_id da nova linha pertence ao usuário autenticado
-- e que project_id referencia um Projeto desse mesmo usuário.
--
-- A subconsulta EXISTS opera em conjunto com a policy SELECT existente na tabela
-- projects ("Users can view their own projects": USING auth.uid() = user_id).
-- Essa policy restringe as linhas visíveis na subconsulta ao conjunto de projetos
-- do usuário autenticado. A condição explícita projects.user_id = auth.uid()
-- reforça a verificação de propriedade no texto da policy, tornando a intenção
-- inequívoca independentemente do contexto de execução da subconsulta.
DROP POLICY IF EXISTS "productions_insert_own" ON productions;
CREATE POLICY "productions_insert_own" ON productions
  FOR INSERT
  WITH CHECK (
    auth.uid() = user_id
    AND EXISTS (
      SELECT 1 FROM projects
      WHERE projects.id = project_id
        AND projects.user_id = auth.uid()
    )
  );

-- UPDATE:
--   USING  → determina quais linhas podem ser alvo do UPDATE (estado atual da linha).
--   WITH CHECK → valida o estado resultante após a modificação.
-- Impede atualizar Produções alheias (USING) e impede mover uma Produção
-- para um Projeto alheio (WITH CHECK com EXISTS).
-- A mesma observação sobre a policy SELECT de projects se aplica aqui.
DROP POLICY IF EXISTS "productions_update_own" ON productions;
CREATE POLICY "productions_update_own" ON productions
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

-- DELETE: o usuário exclui apenas as próprias Produções.
-- Não verifica project_id: o DELETE remove a linha, não altera a qual Projeto ela aponta.
-- ON DELETE SET NULL nas tabelas filhas desvincula rascunhos automaticamente.
DROP POLICY IF EXISTS "productions_delete_own" ON productions;
CREATE POLICY "productions_delete_own" ON productions
  FOR DELETE
  USING (auth.uid() = user_id);

-- ============================================================
-- TRIGGER updated_at
-- ============================================================
DROP TRIGGER IF EXISTS productions_updated_at ON productions;
CREATE TRIGGER productions_updated_at
  BEFORE UPDATE ON productions
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- ============================================================
-- ÍNDICES
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_productions_user_id    ON productions(user_id);
CREATE INDEX IF NOT EXISTS idx_productions_project_id ON productions(project_id);

-- ============================================================
-- COLUNAS production_id NAS ENTIDADES EXISTENTES
-- Nullable em todas — sem backfill, sem breaking change.
-- ON DELETE SET NULL: excluir uma Produção desvincula os rascunhos
-- sem destruí-los.
-- ============================================================
ALTER TABLE image_drafts
  ADD COLUMN IF NOT EXISTS production_id UUID
  REFERENCES productions(id) ON DELETE SET NULL;

ALTER TABLE video_drafts
  ADD COLUMN IF NOT EXISTS production_id UUID
  REFERENCES productions(id) ON DELETE SET NULL;

ALTER TABLE posts
  ADD COLUMN IF NOT EXISTS production_id UUID
  REFERENCES productions(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_image_drafts_production_id ON image_drafts(production_id);
CREATE INDEX IF NOT EXISTS idx_video_drafts_production_id ON video_drafts(production_id);
CREATE INDEX IF NOT EXISTS idx_posts_production_id        ON posts(production_id);

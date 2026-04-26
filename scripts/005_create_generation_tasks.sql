-- Tabela para armazenar tasks de geração assíncrona (NanoBanana)
CREATE TABLE IF NOT EXISTS generation_tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  project_id UUID REFERENCES projects(id) ON DELETE SET NULL,
  
  -- Task info da API externa
  task_id TEXT NOT NULL UNIQUE,
  provider TEXT NOT NULL DEFAULT 'nanobanana',
  
  -- Input
  prompt TEXT NOT NULL,
  aspect_ratio TEXT DEFAULT '1:1',
  
  -- Output
  image_url TEXT,
  
  -- Status: pending, processing, completed, failed
  status TEXT NOT NULL DEFAULT 'processing',
  error_message TEXT,
  
  -- Metadata
  callback_received_at TIMESTAMPTZ,
  raw_response JSONB,
  
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index para buscar por task_id (usado pelo callback)
CREATE INDEX IF NOT EXISTS idx_generation_tasks_task_id ON generation_tasks(task_id);

-- Index para buscar tasks do usuário
CREATE INDEX IF NOT EXISTS idx_generation_tasks_user_id ON generation_tasks(user_id);

-- Index para buscar tasks pendentes (polling)
CREATE INDEX IF NOT EXISTS idx_generation_tasks_status ON generation_tasks(status) WHERE status = 'processing';

-- RLS
ALTER TABLE generation_tasks ENABLE ROW LEVEL SECURITY;

-- Políticas
CREATE POLICY "Users can view own tasks" ON generation_tasks
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own tasks" ON generation_tasks
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own tasks" ON generation_tasks
  FOR UPDATE USING (auth.uid() = user_id);

-- Trigger para updated_at
CREATE OR REPLACE FUNCTION update_generation_tasks_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_generation_tasks_updated_at ON generation_tasks;
CREATE TRIGGER trigger_generation_tasks_updated_at
  BEFORE UPDATE ON generation_tasks
  FOR EACH ROW
  EXECUTE FUNCTION update_generation_tasks_updated_at();

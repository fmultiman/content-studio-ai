-- 039_create_video_generations.sql

CREATE TABLE IF NOT EXISTS video_generations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  production_id UUID NOT NULL REFERENCES productions(id) ON DELETE CASCADE,
  
  -- Core domain
  mode TEXT NOT NULL CHECK (mode IN ('image_to_video', 'text_to_video')),
  prompt TEXT NOT NULL,
  source_image_id UUID REFERENCES images(id) ON DELETE SET NULL,
  source_library_file_id UUID REFERENCES library_files(id) ON DELETE SET NULL,
  
  -- Provider Execution
  provider TEXT NOT NULL DEFAULT 'kling',
  model TEXT NOT NULL,
  task_id TEXT UNIQUE,
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'submitted', 'running', 'completed', 'failed')),
  
  -- Data
  request_config JSONB DEFAULT '{}',
  provider_metadata JSONB DEFAULT '{}',
  result_metadata JSONB DEFAULT '{}',
  error_details JSONB,
  
  -- Result storage
  storage_path TEXT,
  public_url TEXT,
  library_file_id UUID REFERENCES library_files(id) ON DELETE SET NULL,
  
  -- Lifecycle
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_video_generations_user_project ON video_generations(user_id, project_id);
CREATE INDEX IF NOT EXISTS idx_video_generations_production ON video_generations(production_id);
CREATE INDEX IF NOT EXISTS idx_video_generations_status ON video_generations(status);
CREATE INDEX IF NOT EXISTS idx_video_generations_task_id ON video_generations(task_id);

-- RLS
ALTER TABLE video_generations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can create their own video generations"
ON video_generations FOR INSERT
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can view their own video generations"
ON video_generations FOR SELECT
USING (auth.uid() = user_id);

CREATE POLICY "Users can update their own video generations"
ON video_generations FOR UPDATE
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete their own video generations"
ON video_generations FOR DELETE
USING (auth.uid() = user_id);

-- Constraints
-- If mode is image_to_video, source_image_id MUST be NOT NULL, wait, the user's instructions say "Não use uma source_image NOT NULL que depois exija migration só para T2V. Se fizer sentido no banco, estabeleça constraint coerente com mode, sem criar sistema genérico de inputs."
ALTER TABLE video_generations
ADD CONSTRAINT check_mode_source_image
CHECK (
  (mode = 'image_to_video' AND (
    (source_image_id IS NOT NULL AND source_library_file_id IS NULL) OR 
    (source_image_id IS NULL AND source_library_file_id IS NOT NULL)
  )) OR
  (mode = 'text_to_video' AND source_image_id IS NULL AND source_library_file_id IS NULL)
);

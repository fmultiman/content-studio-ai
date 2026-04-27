CREATE TABLE IF NOT EXISTS library_files (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  project_id UUID REFERENCES projects(id) ON DELETE SET NULL,
  folder TEXT NOT NULL DEFAULT '/',
  name TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'other' CHECK (kind IN ('image', 'video', 'audio', 'document', 'other')),
  mime_type TEXT,
  file_size INTEGER,
  storage_provider TEXT NOT NULL DEFAULT 's3',
  storage_path TEXT NOT NULL,
  public_url TEXT NOT NULL,
  thumbnail_url TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE library_files ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view their own library files" ON library_files;
CREATE POLICY "Users can view their own library files" ON library_files
  FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can insert their own library files" ON library_files;
CREATE POLICY "Users can insert their own library files" ON library_files
  FOR INSERT WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can update their own library files" ON library_files;
CREATE POLICY "Users can update their own library files" ON library_files
  FOR UPDATE USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can delete their own library files" ON library_files;
CREATE POLICY "Users can delete their own library files" ON library_files
  FOR DELETE USING (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_library_files_user_id ON library_files(user_id);
CREATE INDEX IF NOT EXISTS idx_library_files_project_id ON library_files(project_id);
CREATE INDEX IF NOT EXISTS idx_library_files_folder ON library_files(folder);
CREATE INDEX IF NOT EXISTS idx_library_files_kind ON library_files(kind);

DROP TRIGGER IF EXISTS update_library_files_updated_at ON library_files;
CREATE TRIGGER update_library_files_updated_at
  BEFORE UPDATE ON library_files
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

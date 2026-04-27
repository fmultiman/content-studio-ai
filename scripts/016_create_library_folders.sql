CREATE TABLE IF NOT EXISTS library_folders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  path TEXT NOT NULL,
  parent_path TEXT NOT NULL DEFAULT '/',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, project_id, path)
);

ALTER TABLE library_folders ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view their own library folders" ON library_folders;
CREATE POLICY "Users can view their own library folders" ON library_folders
  FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can insert their own library folders" ON library_folders;
CREATE POLICY "Users can insert their own library folders" ON library_folders
  FOR INSERT WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can update their own library folders" ON library_folders;
CREATE POLICY "Users can update their own library folders" ON library_folders
  FOR UPDATE USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can delete their own library folders" ON library_folders;
CREATE POLICY "Users can delete their own library folders" ON library_folders
  FOR DELETE USING (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_library_folders_user_id ON library_folders(user_id);
CREATE INDEX IF NOT EXISTS idx_library_folders_project_id ON library_folders(project_id);
CREATE INDEX IF NOT EXISTS idx_library_folders_path ON library_folders(path);

DROP TRIGGER IF EXISTS update_library_folders_updated_at ON library_folders;
CREATE TRIGGER update_library_folders_updated_at
  BEFORE UPDATE ON library_folders
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

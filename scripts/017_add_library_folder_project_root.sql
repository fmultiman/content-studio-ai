ALTER TABLE library_folders
  ADD COLUMN IF NOT EXISTS is_project_root BOOLEAN NOT NULL DEFAULT false;

CREATE UNIQUE INDEX IF NOT EXISTS idx_library_folders_project_root
  ON library_folders(user_id, project_id)
  WHERE is_project_root = true;

ALTER TABLE library_files
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_library_files_deleted_at ON library_files(deleted_at);

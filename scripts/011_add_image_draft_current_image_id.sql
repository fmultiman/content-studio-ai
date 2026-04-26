ALTER TABLE image_drafts
  ADD COLUMN IF NOT EXISTS current_image_id UUID REFERENCES images(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_image_drafts_current_image_id
  ON image_drafts(current_image_id);

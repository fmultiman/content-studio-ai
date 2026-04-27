ALTER TABLE posts
  ADD COLUMN IF NOT EXISTS post_images JSONB DEFAULT '[]'::jsonb;

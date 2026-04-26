-- Migration: Store image draft workspace state

ALTER TABLE image_drafts
  ADD COLUMN IF NOT EXISTS prompt_details JSONB,
  ADD COLUMN IF NOT EXISTS current_evaluation JSONB,
  ADD COLUMN IF NOT EXISTS generation_attempts JSONB DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS current_attempt INTEGER DEFAULT 1,
  ADD COLUMN IF NOT EXISTS image_status TEXT DEFAULT 'draft';

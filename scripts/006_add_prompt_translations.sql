-- Migration: Store Portuguese prompt translations for image drafts

ALTER TABLE image_drafts
  ADD COLUMN IF NOT EXISTS generated_prompt_pt TEXT;

-- Migration: Create drafts tables for Content Agent Studio
-- This migration creates tables for image and video drafts

-- =============================================
-- IMAGE DRAFTS TABLE
-- =============================================
CREATE TABLE IF NOT EXISTS image_drafts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  project_id UUID REFERENCES projects(id) ON DELETE SET NULL,
  name TEXT,
  user_input TEXT NOT NULL,
  generated_prompt TEXT,
  auto_mode BOOLEAN DEFAULT false,
  image_url TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Enable RLS
ALTER TABLE image_drafts ENABLE ROW LEVEL SECURITY;

-- RLS Policies for image_drafts
CREATE POLICY "image_drafts_select_own" ON image_drafts
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "image_drafts_insert_own" ON image_drafts
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "image_drafts_update_own" ON image_drafts
  FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "image_drafts_delete_own" ON image_drafts
  FOR DELETE USING (auth.uid() = user_id);

-- Trigger for updated_at
CREATE TRIGGER image_drafts_updated_at
  BEFORE UPDATE ON image_drafts
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- =============================================
-- VIDEO DRAFTS TABLE
-- =============================================
CREATE TABLE IF NOT EXISTS video_drafts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  project_id UUID REFERENCES projects(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  scenes JSONB DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Enable RLS
ALTER TABLE video_drafts ENABLE ROW LEVEL SECURITY;

-- RLS Policies for video_drafts
CREATE POLICY "video_drafts_select_own" ON video_drafts
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "video_drafts_insert_own" ON video_drafts
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "video_drafts_update_own" ON video_drafts
  FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "video_drafts_delete_own" ON video_drafts
  FOR DELETE USING (auth.uid() = user_id);

-- Trigger for updated_at
CREATE TRIGGER video_drafts_updated_at
  BEFORE UPDATE ON video_drafts
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- Create indexes for better performance
CREATE INDEX IF NOT EXISTS idx_image_drafts_user_id ON image_drafts(user_id);
CREATE INDEX IF NOT EXISTS idx_image_drafts_project_id ON image_drafts(project_id);
CREATE INDEX IF NOT EXISTS idx_video_drafts_user_id ON video_drafts(user_id);
CREATE INDEX IF NOT EXISTS idx_video_drafts_project_id ON video_drafts(project_id);

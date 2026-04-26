-- User Settings Table
-- Stores user preferences including theme, notifications, and API keys

CREATE TABLE IF NOT EXISTS user_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  
  -- Appearance
  theme TEXT DEFAULT 'dark' CHECK (theme IN ('light', 'dark', 'system')),
  auto_mode_default BOOLEAN DEFAULT true,
  save_prompt_history BOOLEAN DEFAULT true,
  
  -- Notifications
  notifications_email BOOLEAN DEFAULT true,
  notifications_browser BOOLEAN DEFAULT false,
  
  -- API Keys (encrypted in production)
  openai_api_key TEXT,
  replicate_api_key TEXT,
  
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  
  UNIQUE(user_id)
);

-- Enable RLS
ALTER TABLE user_settings ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "user_settings_select_own" ON user_settings
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "user_settings_insert_own" ON user_settings
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "user_settings_update_own" ON user_settings
  FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "user_settings_delete_own" ON user_settings
  FOR DELETE USING (auth.uid() = user_id);

-- Add style_profile column to projects table
ALTER TABLE projects ADD COLUMN IF NOT EXISTS style_profile TEXT;

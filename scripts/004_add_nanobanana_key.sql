-- Add NanoBanana API key to user_settings table
ALTER TABLE user_settings 
ADD COLUMN IF NOT EXISTS nanobanana_api_key TEXT DEFAULT NULL;

-- Add NanoBanana base URL for custom endpoints (optional)
ALTER TABLE user_settings 
ADD COLUMN IF NOT EXISTS nanobanana_base_url TEXT DEFAULT 'https://api.nanobanana.ai';

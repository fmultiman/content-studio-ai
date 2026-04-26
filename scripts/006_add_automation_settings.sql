-- Adicionar campos de automação e modelo NanoBanana
ALTER TABLE user_settings 
ADD COLUMN IF NOT EXISTS automation_enabled boolean DEFAULT false;

ALTER TABLE user_settings 
ADD COLUMN IF NOT EXISTS nanobanana_model text DEFAULT 'v1';

-- Comentário: nanobanana_model pode ser 'v1' ou 'v2'

-- Renomear campo nanobanana_model para default_image_model e adicionar OpenAI como opção
-- Esta migração substitui o campo anterior por um mais abrangente

-- Adicionar novo campo
ALTER TABLE user_settings 
ADD COLUMN IF NOT EXISTS default_image_model VARCHAR(20) DEFAULT 'openai';

-- Migrar dados existentes
UPDATE user_settings 
SET default_image_model = CASE 
  WHEN nanobanana_model = 'v1' THEN 'nanobanana-v1'
  WHEN nanobanana_model = 'v2' THEN 'nanobanana-v2'
  ELSE 'openai'
END
WHERE default_image_model IS NULL OR default_image_model = 'openai';

-- Remover campo antigo (opcional - comentado para segurança)
-- ALTER TABLE user_settings DROP COLUMN IF EXISTS nanobanana_model;

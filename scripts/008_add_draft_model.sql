-- Adicionar campo selected_model ao image_drafts para persistir modelo selecionado
ALTER TABLE image_drafts 
ADD COLUMN IF NOT EXISTS selected_model VARCHAR(20) DEFAULT 'openai';

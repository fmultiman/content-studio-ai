-- Add image evaluator settings to user_settings
ALTER TABLE user_settings 
ADD COLUMN IF NOT EXISTS image_evaluator_enabled BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS max_refinement_iterations INTEGER DEFAULT 2;

-- Update existing rows
UPDATE user_settings 
SET image_evaluator_enabled = false, 
    max_refinement_iterations = 2 
WHERE image_evaluator_enabled IS NULL;

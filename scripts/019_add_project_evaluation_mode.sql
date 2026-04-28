ALTER TABLE projects
ADD COLUMN IF NOT EXISTS evaluation_mode TEXT NOT NULL DEFAULT 'default'
CHECK (evaluation_mode IN ('default', 'conceptual', 'aesthetic', 'commercial', 'experimental'));

UPDATE projects
SET evaluation_mode = 'default'
WHERE evaluation_mode IS NULL;

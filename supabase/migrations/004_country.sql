-- Add country field to shops for multi-country payment routing
ALTER TABLE shops ADD COLUMN IF NOT EXISTS country TEXT DEFAULT 'NG';

-- Update existing shops to NG (Nigeria) as default
UPDATE shops SET country = 'NG' WHERE country IS NULL;

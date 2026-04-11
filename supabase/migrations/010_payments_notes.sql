-- Add notes column to payments for tracking context (e.g. "Inclus dans vente #X")
ALTER TABLE payments ADD COLUMN IF NOT EXISTS notes text;

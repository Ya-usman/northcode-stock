-- Migration 033: persist locale preference in user profile
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS locale text DEFAULT 'en'
  CHECK (locale IN ('en', 'fr', 'ha'));

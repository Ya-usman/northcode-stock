-- ============================================================
-- Migration 062 : Recreate notes RLS policies (idempotent)
-- Fixes "new row violates row-level security policy for table notes"
-- caused by the INSERT policy being missing or auth.uid() returning
-- null when the JWT was not sent correctly.
-- ============================================================

-- Drop all existing notes policies first (safe — recreated below)
DROP POLICY IF EXISTS "notes_select" ON notes;
DROP POLICY IF EXISTS "notes_insert" ON notes;
DROP POLICY IF EXISTS "notes_update" ON notes;
DROP POLICY IF EXISTS "notes_delete" ON notes;

ALTER TABLE notes ENABLE ROW LEVEL SECURITY;

-- Each user can only see and manage their own notes
CREATE POLICY "notes_select" ON notes FOR SELECT USING (owner_id = auth.uid());
CREATE POLICY "notes_insert" ON notes FOR INSERT WITH CHECK (owner_id = auth.uid());
CREATE POLICY "notes_update" ON notes FOR UPDATE USING (owner_id = auth.uid());
CREATE POLICY "notes_delete" ON notes FOR DELETE USING (owner_id = auth.uid());

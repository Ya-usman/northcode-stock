-- ============================================================
-- Migration 046 : Notes personnelles liées aux boutiques
-- ============================================================

CREATE TABLE IF NOT EXISTS notes (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id    uuid REFERENCES shops(id) ON DELETE CASCADE NOT NULL,
  owner_id   uuid REFERENCES auth.users ON DELETE CASCADE NOT NULL,
  title      text,
  content    text NOT NULL DEFAULT '',
  color      text NOT NULL DEFAULT 'default',
  pinned     boolean NOT NULL DEFAULT false,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_notes_owner_id ON notes(owner_id);
CREATE INDEX IF NOT EXISTS idx_notes_shop_id  ON notes(shop_id);

ALTER TABLE notes ENABLE ROW LEVEL SECURITY;

-- Only the creator can see/manage their own notes
CREATE POLICY "notes_select" ON notes FOR SELECT USING (owner_id = auth.uid());
CREATE POLICY "notes_insert" ON notes FOR INSERT WITH CHECK (owner_id = auth.uid());
CREATE POLICY "notes_update" ON notes FOR UPDATE USING (owner_id = auth.uid());
CREATE POLICY "notes_delete" ON notes FOR DELETE USING (owner_id = auth.uid());

-- Auto-update updated_at
CREATE OR REPLACE FUNCTION touch_notes_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;

DROP TRIGGER IF EXISTS notes_updated_at ON notes;
CREATE TRIGGER notes_updated_at
  BEFORE UPDATE ON notes
  FOR EACH ROW EXECUTE FUNCTION touch_notes_updated_at();

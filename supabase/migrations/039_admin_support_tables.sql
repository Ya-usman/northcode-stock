-- ============================================================
-- 039 — Tables support StockShop Admin
-- shop_notes : notes internes par boutique (admin uniquement)
-- admin_notifications : messages in-app envoyés aux owners
-- ============================================================

-- Notes internes par boutique
CREATE TABLE IF NOT EXISTS shop_notes (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id     uuid        NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  author_email text       NOT NULL,
  content     text        NOT NULL,
  created_at  timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_shop_notes_shop_id ON shop_notes(shop_id);

-- Notifications in-app envoyées par le support aux owners
CREATE TABLE IF NOT EXISTS admin_notifications (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id    uuid        NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  type       text        NOT NULL DEFAULT 'info' CHECK (type IN ('info', 'warning', 'urgent')),
  title      text        NOT NULL,
  message    text        NOT NULL,
  read_at    timestamptz DEFAULT NULL,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_admin_notifs_shop_id ON admin_notifications(shop_id);
CREATE INDEX IF NOT EXISTS idx_admin_notifs_unread  ON admin_notifications(shop_id, read_at) WHERE read_at IS NULL;

-- RLS
ALTER TABLE shop_notes           ENABLE ROW LEVEL SECURITY;
ALTER TABLE admin_notifications  ENABLE ROW LEVEL SECURITY;

-- Notes : accès exclusif super_admin
CREATE POLICY "notes_super_admin_all" ON shop_notes
  FOR ALL USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'super_admin')
  );

-- Notifications : super_admin gère tout
CREATE POLICY "notifs_super_admin_all" ON admin_notifications
  FOR ALL USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'super_admin')
  );

-- Owner peut lire ses propres notifications
CREATE POLICY "notifs_owner_read" ON admin_notifications
  FOR SELECT USING (
    shop_id IN (
      SELECT shop_id FROM shop_members
      WHERE user_id = auth.uid() AND role = 'owner' AND is_active = true
    )
  );

-- Owner peut marquer comme lu (update read_at uniquement)
CREATE POLICY "notifs_owner_mark_read" ON admin_notifications
  FOR UPDATE USING (
    shop_id IN (
      SELECT shop_id FROM shop_members
      WHERE user_id = auth.uid() AND role = 'owner' AND is_active = true
    )
  );

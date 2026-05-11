-- ============================================================
-- 037 — Permettre au propriétaire de lire son propre journal
--        de suppressions et de restaurer ses données
-- ============================================================

-- Le propriétaire peut lire les enregistrements supprimés de SA boutique
DROP POLICY IF EXISTS "deleted_log_owner_read" ON deleted_records_log;
CREATE POLICY "deleted_log_owner_read" ON deleted_records_log
  FOR SELECT USING (
    shop_id IN (
      SELECT shop_id FROM shop_members
      WHERE user_id = auth.uid()
        AND role = 'owner'
        AND is_active = true
    )
  );

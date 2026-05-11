-- ============================================================
-- 038 — Révoquer l'accès owner au journal de suppressions
-- La restauration est gérée exclusivement par le support StockShop
-- via le panneau d'administration super_admin.
-- ============================================================

DROP POLICY IF EXISTS "deleted_log_owner_read" ON deleted_records_log;

-- Seul le super_admin conserve l'accès (déjà défini en 036)

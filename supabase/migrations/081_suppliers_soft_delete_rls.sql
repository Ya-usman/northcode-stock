-- ============================================================
-- Migration 081 : Fournisseurs — suppression douce + restriction de rôle
-- ============================================================
-- La policy RLS "suppliers_member_all" (migration 065) permettait à
-- n'importe quel membre actif de modifier/supprimer un fournisseur,
-- y compris le rôle "viewer" (lecture seule en théorie). Aligne sur
-- le pattern déjà utilisé pour expenses (même migration 065) et pour
-- le soft-delete de customers (migration 034) : lecture/création pour
-- tout membre, modification/suppression réservées à owner/manager/
-- shop_manager/stock_manager, et suppression = soft-delete (deleted_at)
-- plutôt qu'un DELETE définitif, pour garder une trace.

ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS deleted_at timestamptz DEFAULT NULL;

CREATE INDEX IF NOT EXISTS idx_suppliers_not_deleted
  ON suppliers (shop_id) WHERE deleted_at IS NULL;

DROP POLICY IF EXISTS suppliers_member_all ON suppliers;

CREATE POLICY suppliers_member_select ON suppliers
  FOR SELECT USING (is_shop_member(shop_id) AND deleted_at IS NULL);

CREATE POLICY suppliers_member_insert ON suppliers
  FOR INSERT WITH CHECK (is_shop_member(shop_id));

CREATE POLICY suppliers_write_update ON suppliers
  FOR UPDATE USING (
    is_shop_member(shop_id)
    AND get_role_in_shop(shop_id) IN ('owner', 'manager', 'shop_manager', 'stock_manager')
  )
  WITH CHECK (
    is_shop_member(shop_id)
    AND get_role_in_shop(shop_id) IN ('owner', 'manager', 'shop_manager', 'stock_manager')
  );

-- Pas de policy DELETE — la suppression définitive côté client est retirée,
-- comme pour customers ; la suppression se fait via UPDATE (deleted_at).


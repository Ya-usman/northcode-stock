-- ============================================================
-- Migration 067 : Let shop_manager see full sales history
-- ============================================================
-- sales_owner_all / sale_items_owner_all / payments_owner_all only
-- listed role IN ('owner', 'manager') — written before the
-- 'shop_manager' role existed (migration 066). Since shop_manager has
-- no other SELECT policy on "sales", they currently see zero rows
-- regardless of the "sales_history" toggle in role_permissions.
-- Fix: add shop_manager alongside owner/manager everywhere.

-- ── SALES ───────────────────────────────────────────────────
DROP POLICY IF EXISTS "sales_owner_all" ON sales;
CREATE POLICY "sales_owner_all" ON sales
  FOR ALL USING (
    is_shop_member(shop_id)
    AND get_role_in_shop(shop_id) IN ('owner', 'manager', 'shop_manager')
  )
  WITH CHECK (
    is_shop_member(shop_id)
    AND get_role_in_shop(shop_id) IN ('owner', 'manager', 'shop_manager')
  );

-- ── SALE ITEMS ──────────────────────────────────────────────
DROP POLICY IF EXISTS sale_items_owner_all ON sale_items;
CREATE POLICY sale_items_owner_all ON sale_items
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM sales s
      WHERE s.id = sale_id
        AND is_shop_member(s.shop_id)
        AND get_role_in_shop(s.shop_id) IN ('owner', 'manager', 'shop_manager')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM sales s
      WHERE s.id = sale_id
        AND is_shop_member(s.shop_id)
        AND get_role_in_shop(s.shop_id) IN ('owner', 'manager', 'shop_manager')
    )
  );

-- ── PAYMENTS ────────────────────────────────────────────────
DROP POLICY IF EXISTS payments_owner_all ON payments;
CREATE POLICY payments_owner_all ON payments
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM sales s
      WHERE s.id = sale_id
        AND is_shop_member(s.shop_id)
        AND get_role_in_shop(s.shop_id) IN ('owner', 'manager', 'shop_manager')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM sales s
      WHERE s.id = sale_id
        AND is_shop_member(s.shop_id)
        AND get_role_in_shop(s.shop_id) IN ('owner', 'manager', 'shop_manager')
    )
  );

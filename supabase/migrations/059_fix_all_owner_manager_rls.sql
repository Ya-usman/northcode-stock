-- ============================================================
-- Migration 059 : Fix all owner/manager RLS policies (BUG-18)
-- ============================================================
-- Migration 042 replaced shop_id checks with get_user_role() (reads
-- profiles.role). But profiles.role is stale since migration 005 moved
-- role authority to shop_members. Owners with null/stale profiles.role
-- cannot insert/update/delete products, customers, expenses, etc.
-- Fix: use is_shop_member(shop_id) + get_role_in_shop(shop_id) everywhere.

-- ── PRODUCTS ────────────────────────────────────────────────
DROP POLICY IF EXISTS products_owner_buying_price ON products;
CREATE POLICY products_owner_buying_price ON products
  FOR SELECT USING (
    is_shop_member(shop_id)
    AND get_role_in_shop(shop_id) IN ('owner', 'manager')
  );

DROP POLICY IF EXISTS products_owner_all ON products;
CREATE POLICY products_owner_all ON products
  FOR ALL USING (
    is_shop_member(shop_id)
    AND get_role_in_shop(shop_id) IN ('owner', 'manager')
  )
  WITH CHECK (
    is_shop_member(shop_id)
    AND get_role_in_shop(shop_id) IN ('owner', 'manager')
  );

-- ── CUSTOMERS ───────────────────────────────────────────────
DROP POLICY IF EXISTS customers_owner_update ON customers;
CREATE POLICY customers_owner_update ON customers
  FOR UPDATE USING (
    is_shop_member(shop_id)
    AND get_role_in_shop(shop_id) IN ('owner', 'manager')
  );

DROP POLICY IF EXISTS customers_owner_delete ON customers;
CREATE POLICY customers_owner_delete ON customers
  FOR DELETE USING (
    is_shop_member(shop_id)
    AND get_role_in_shop(shop_id) IN ('owner', 'manager')
  );

-- ── SALE ITEMS ──────────────────────────────────────────────
DROP POLICY IF EXISTS sale_items_owner_all ON sale_items;
CREATE POLICY sale_items_owner_all ON sale_items
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM sales s
      WHERE s.id = sale_id
        AND is_shop_member(s.shop_id)
        AND get_role_in_shop(s.shop_id) IN ('owner', 'manager')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM sales s
      WHERE s.id = sale_id
        AND is_shop_member(s.shop_id)
        AND get_role_in_shop(s.shop_id) IN ('owner', 'manager')
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
        AND get_role_in_shop(s.shop_id) IN ('owner', 'manager')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM sales s
      WHERE s.id = sale_id
        AND is_shop_member(s.shop_id)
        AND get_role_in_shop(s.shop_id) IN ('owner', 'manager')
    )
  );

-- ── STOCK MOVEMENTS ─────────────────────────────────────────
DROP POLICY IF EXISTS stock_movements_owner_all ON stock_movements;
CREATE POLICY stock_movements_owner_all ON stock_movements
  FOR ALL USING (
    is_shop_member(shop_id)
    AND get_role_in_shop(shop_id) IN ('owner', 'manager')
  )
  WITH CHECK (
    is_shop_member(shop_id)
    AND get_role_in_shop(shop_id) IN ('owner', 'manager')
  );

-- ── EXPENSES ────────────────────────────────────────────────
DROP POLICY IF EXISTS expenses_owner_all ON expenses;
CREATE POLICY expenses_owner_all ON expenses
  FOR ALL USING (
    is_shop_member(shop_id)
    AND get_role_in_shop(shop_id) IN ('owner', 'manager')
  )
  WITH CHECK (
    is_shop_member(shop_id)
    AND get_role_in_shop(shop_id) IN ('owner', 'manager')
  );

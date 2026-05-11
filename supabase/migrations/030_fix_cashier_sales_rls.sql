-- ============================================================
-- Migration 030 : Fix cashier RLS for sales visibility (BUG-16)
-- ============================================================
-- sales_cashier_own and sales_cashier_insert used get_user_shop_id()
-- (reads profiles.shop_id) and get_user_role() (reads profiles.role).
-- If profiles.shop_id is NULL or stale, the condition shop_id = NULL
-- evaluates to NULL (not TRUE) and the cashier sees nothing.
-- Fix: use is_shop_member() and get_role_in_shop() which read from
-- shop_members — the authoritative source since migration 005.

-- Cashier SELECT: sees only their own sales in any shop they belong to
DROP POLICY IF EXISTS "sales_cashier_own" ON sales;
CREATE POLICY "sales_cashier_own" ON sales
  FOR SELECT USING (
    is_shop_member(shop_id)
    AND get_role_in_shop(shop_id) = 'cashier'
    AND cashier_id = auth.uid()
  );

-- Cashier INSERT: can create sales in any shop they belong to as cashier
DROP POLICY IF EXISTS "sales_cashier_insert" ON sales;
CREATE POLICY "sales_cashier_insert" ON sales
  FOR INSERT WITH CHECK (
    is_shop_member(shop_id)
    AND get_role_in_shop(shop_id) = 'cashier'
    AND cashier_id = auth.uid()
  );

-- Viewer SELECT: can read all sales in shops they belong to
DROP POLICY IF EXISTS "sales_viewer_select" ON sales;
CREATE POLICY "sales_viewer_select" ON sales
  FOR SELECT USING (
    is_shop_member(shop_id)
    AND get_role_in_shop(shop_id) = 'viewer'
  );

-- Also fix sale_items cashier write to use shop_members
DROP POLICY IF EXISTS "sale_items_cashier_write" ON sale_items;
CREATE POLICY "sale_items_cashier_write" ON sale_items
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM sales s
      WHERE s.id = sale_id
        AND is_shop_member(s.shop_id)
        AND get_role_in_shop(s.shop_id) = 'cashier'
    )
  );

-- Also fix payments cashier write to use shop_members
DROP POLICY IF EXISTS "payments_cashier_write" ON payments;
CREATE POLICY "payments_cashier_write" ON payments
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM sales s
      WHERE s.id = sale_id
        AND is_shop_member(s.shop_id)
        AND get_role_in_shop(s.shop_id) = 'cashier'
    )
  );

-- ============================================================
-- Migration 058 : Fix owner RLS for sales table (BUG-17)
-- ============================================================
-- "sales_owner_all" used get_user_shop_id() (reads profiles.shop_id)
-- and get_user_role() (reads profiles.role).
-- If profiles.shop_id is NULL or stale, the condition evaluates to NULL
-- (not TRUE) and the owner cannot INSERT/UPDATE/DELETE sales.
-- This is the same root cause fixed for cashiers in migration 030.
-- Fix: use is_shop_member() and get_role_in_shop() which read from
-- shop_members — the authoritative source since migration 005.

DROP POLICY IF EXISTS "sales_owner_all" ON sales;
CREATE POLICY "sales_owner_all" ON sales
  FOR ALL USING (
    is_shop_member(shop_id)
    AND get_role_in_shop(shop_id) IN ('owner', 'manager')
  )
  WITH CHECK (
    is_shop_member(shop_id)
    AND get_role_in_shop(shop_id) IN ('owner', 'manager')
  );

-- ============================================================
-- Migration 068 : Let manager/shop_manager manage subordinate team roles
-- ============================================================
-- shop_members_owner_manage only allows 'owner' (and super_admin) to
-- UPDATE shop_members. The Team page lets manager/shop_manager change
-- a colleague's role directly via the client, but RLS silently blocked
-- it for anyone but the owner.
--
-- Fix: allow manager/shop_manager to UPDATE rows that are currently
-- cashier/stock_manager/viewer, and only into cashier/stock_manager/
-- viewer (WITH CHECK) — they can never touch the owner or promote
-- someone into a manager/shop_manager/owner role.

DROP POLICY IF EXISTS "shop_members_manager_update_subordinates" ON shop_members;
CREATE POLICY "shop_members_manager_update_subordinates" ON shop_members
  FOR UPDATE USING (
    get_role_in_shop(shop_id) IN ('manager', 'shop_manager')
    AND role IN ('cashier', 'stock_manager', 'viewer')
  )
  WITH CHECK (
    get_role_in_shop(shop_id) IN ('manager', 'shop_manager')
    AND role IN ('cashier', 'stock_manager', 'viewer')
  );

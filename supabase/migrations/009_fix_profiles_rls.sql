-- ============================================================
-- Migration 009 — Fix profiles RLS for multi-shop
-- Allow owners to read profiles of all members in their shops
-- ============================================================

-- Allow anyone to read profiles of people in the same shops
DROP POLICY IF EXISTS "profiles_read_own" ON profiles;
CREATE POLICY "profiles_read_own" ON profiles
  FOR SELECT USING (
    id = auth.uid()
    OR id IN (
      SELECT sm.user_id FROM shop_members sm
      WHERE sm.shop_id IN (SELECT get_user_shop_ids())
    )
  );

-- Owner can manage profiles of members in their shops
DROP POLICY IF EXISTS "profiles_owner_manage" ON profiles;
CREATE POLICY "profiles_owner_manage" ON profiles
  FOR ALL USING (
    id = auth.uid()
    OR id IN (
      SELECT sm.user_id FROM shop_members sm
      WHERE sm.shop_id IN (SELECT get_user_shop_ids())
    )
  );

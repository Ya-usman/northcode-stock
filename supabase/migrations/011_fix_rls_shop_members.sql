-- ============================================================
-- Migration 011 — Fix RLS: backfill shop_members + update helpers
-- ============================================================

-- 1. Backfill shop_members for all profiles that have a shop_id but no membership
INSERT INTO shop_members (shop_id, user_id, role, is_active)
SELECT
  p.shop_id,
  p.id AS user_id,
  p.role,
  true
FROM profiles p
WHERE
  p.shop_id IS NOT NULL
  AND p.is_active = true
  AND NOT EXISTS (
    SELECT 1 FROM shop_members sm
    WHERE sm.shop_id = p.shop_id AND sm.user_id = p.id
  )
ON CONFLICT (shop_id, user_id) DO NOTHING;

-- 2. Update get_user_shop_ids() to also fall back to profiles.shop_id
CREATE OR REPLACE FUNCTION get_user_shop_ids()
RETURNS SETOF uuid AS $$
  SELECT shop_id FROM shop_members
  WHERE user_id = auth.uid() AND is_active = true
  UNION
  SELECT shop_id FROM profiles
  WHERE id = auth.uid() AND shop_id IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM shop_members sm WHERE sm.user_id = auth.uid() AND sm.is_active = true
    );
$$ LANGUAGE sql SECURITY DEFINER STABLE ROWS 10;

-- 3. Update get_role_in_shop() to fall back to profiles.role if no shop_members entry
CREATE OR REPLACE FUNCTION get_role_in_shop(p_shop_id uuid)
RETURNS text AS $$
  SELECT COALESCE(
    (SELECT role FROM shop_members
     WHERE shop_id = p_shop_id AND user_id = auth.uid() AND is_active = true
     LIMIT 1),
    (SELECT role FROM profiles
     WHERE id = auth.uid() AND shop_id = p_shop_id
     LIMIT 1)
  );
$$ LANGUAGE sql SECURITY DEFINER STABLE;

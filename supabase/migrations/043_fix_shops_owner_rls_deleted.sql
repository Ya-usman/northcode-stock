-- Fix: shops_owner_all (from migration 018) lacks deleted_at IS NULL filter,
-- causing soft-deleted shops to reappear for owners after refresh.
-- Replace it with split SELECT / write policies that respect deleted_at.

DROP POLICY IF EXISTS "shops_owner_all" ON shops;

-- Owner: read only non-deleted shops
CREATE POLICY "shops_owner_select" ON shops
  FOR SELECT USING (
    deleted_at IS NULL
    AND (owner_id = auth.uid() OR is_shop_member(id))
  );

-- Owner: insert new shops
CREATE POLICY "shops_owner_insert" ON shops
  FOR INSERT WITH CHECK (owner_id = auth.uid());

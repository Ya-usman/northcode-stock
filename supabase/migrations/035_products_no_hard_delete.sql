-- ============================================================
-- 035 — BLOCK HARD DELETE ON PRODUCTS
-- Products can only be archived (is_active = false) via UPDATE.
-- Permanent deletion requires the service-role API endpoint.
-- ============================================================

-- Replace the catch-all "owner_all" policy (which included DELETE)
-- with explicit SELECT / INSERT / UPDATE policies only.
DROP POLICY IF EXISTS "products_owner_all" ON products;

-- Owner: INSERT new products in their shops
CREATE POLICY "products_owner_insert" ON products
  FOR INSERT WITH CHECK (get_role_in_shop(shop_id) = 'owner');

-- Owner: UPDATE (including archiving via is_active = false and restoring)
CREATE POLICY "products_owner_update" ON products
  FOR UPDATE USING (get_role_in_shop(shop_id) = 'owner');

-- !! No DELETE policy for the owner role !!
-- Hard DELETE from the client is now blocked at the database level.
-- The only way to permanently remove a product is via the
-- /api/products DELETE endpoint which uses the service-role key
-- and requires an explicit typed confirmation from the owner.

-- ============================================================
-- Migration 006 — Super Admin
-- ============================================================

-- 1. Add super_admin to profiles role
ALTER TABLE profiles
  DROP CONSTRAINT IF EXISTS profiles_role_check;
ALTER TABLE profiles
  ADD CONSTRAINT profiles_role_check
  CHECK (role IN ('super_admin','owner','cashier','stock_manager','viewer'));

-- ============================================================
-- HELPER FUNCTION: is_super_admin
-- ============================================================
CREATE OR REPLACE FUNCTION is_super_admin()
RETURNS boolean AS $$
  SELECT EXISTS (
    SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'super_admin'
  );
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- ============================================================
-- RLS OVERRIDES — super_admin bypasses all shop restrictions
-- ============================================================

-- SHOPS: super_admin voit tout
DROP POLICY IF EXISTS "shops_owner_all" ON shops;
CREATE POLICY "shops_owner_all" ON shops
  FOR ALL USING (
    is_super_admin() OR
    owner_id = auth.uid() OR
    id IN (SELECT get_user_shop_ids())
  );

-- PRODUCTS: super_admin voit tout
DROP POLICY IF EXISTS "products_shop_select" ON products;
CREATE POLICY "products_shop_select" ON products
  FOR SELECT USING (
    is_super_admin() OR
    shop_id IN (SELECT get_user_shop_ids())
  );

DROP POLICY IF EXISTS "products_owner_all" ON products;
CREATE POLICY "products_owner_all" ON products
  FOR ALL USING (
    is_super_admin() OR
    (shop_id IN (SELECT get_user_shop_ids()) AND get_role_in_shop(shop_id) IN ('owner','stock_manager'))
  );

-- SALES: super_admin voit tout
DROP POLICY IF EXISTS "sales_owner_all" ON sales;
CREATE POLICY "sales_owner_all" ON sales
  FOR ALL USING (
    is_super_admin() OR
    (shop_id IN (SELECT get_user_shop_ids()) AND get_role_in_shop(shop_id) = 'owner')
  );

DROP POLICY IF EXISTS "sales_cashier_own" ON sales;
CREATE POLICY "sales_cashier_own" ON sales
  FOR SELECT USING (
    shop_id IN (SELECT get_user_shop_ids()) AND
    get_role_in_shop(shop_id) = 'cashier' AND
    cashier_id = auth.uid()
  );

DROP POLICY IF EXISTS "sales_cashier_insert" ON sales;
CREATE POLICY "sales_cashier_insert" ON sales
  FOR INSERT WITH CHECK (
    shop_id IN (SELECT get_user_shop_ids()) AND
    get_role_in_shop(shop_id) IN ('cashier','owner')
  );

-- STOCK MOVEMENTS: super_admin voit tout
DROP POLICY IF EXISTS "stock_movements_owner_all" ON stock_movements;
CREATE POLICY "stock_movements_owner_all" ON stock_movements
  FOR ALL USING (
    is_super_admin() OR
    (shop_id IN (SELECT get_user_shop_ids()) AND get_role_in_shop(shop_id) IN ('owner','stock_manager'))
  );

-- PROFILES: super_admin peut gérer tous les profils
DROP POLICY IF EXISTS "profiles_owner_manage" ON profiles;
CREATE POLICY "profiles_owner_manage" ON profiles
  FOR ALL USING (
    is_super_admin() OR
    (get_user_role() = 'owner' AND shop_id = get_user_shop_id())
  );

-- SHOP_MEMBERS: super_admin peut tout gérer
DROP POLICY IF EXISTS "shop_members_owner_manage" ON shop_members;
CREATE POLICY "shop_members_owner_manage" ON shop_members
  FOR ALL USING (
    is_super_admin() OR
    get_role_in_shop(shop_id) = 'owner'
  );

-- SHOP_MEMBERS: allow owner of a shop to insert self (fix RLS for new shops)
DROP POLICY IF EXISTS "shop_owner_can_insert_self" ON shop_members;
CREATE POLICY "shop_owner_can_insert_self" ON shop_members
  FOR INSERT WITH CHECK (
    is_super_admin() OR
    user_id = auth.uid() OR
    get_role_in_shop(shop_id) = 'owner'
  );

-- ============================================================
-- VIEW: super_admin_dashboard_stats — KPIs cumulés
-- ============================================================
CREATE OR REPLACE VIEW super_admin_shop_stats AS
SELECT
  s.id AS shop_id,
  s.name AS shop_name,
  s.city,
  s.plan,
  s.country,
  COUNT(DISTINCT p.id) FILTER (WHERE p.is_active) AS product_count,
  COALESCE(SUM(p.quantity * p.selling_price) FILTER (WHERE p.is_active), 0) AS stock_value,
  COALESCE(SUM(p.quantity) FILTER (WHERE p.is_active), 0) AS total_units,
  COUNT(DISTINCT sa.id) FILTER (WHERE sa.created_at >= now() - interval '30 days') AS sales_30d,
  COALESCE(SUM(sa.total) FILTER (WHERE sa.created_at >= now() - interval '30 days'), 0) AS revenue_30d
FROM shops s
LEFT JOIN products p ON p.shop_id = s.id
LEFT JOIN sales sa ON sa.shop_id = s.id
GROUP BY s.id, s.name, s.city, s.plan, s.country;

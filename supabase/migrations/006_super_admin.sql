-- ============================================================
-- Migration 006 — Super Admin + Bordereau + Cross-shop search
-- ============================================================

-- 1. Add super_admin to profiles role
ALTER TABLE profiles
  DROP CONSTRAINT IF EXISTS profiles_role_check;
ALTER TABLE profiles
  ADD CONSTRAINT profiles_role_check
  CHECK (role IN ('super_admin','owner','cashier','stock_manager','viewer'));

-- 2. Add transfer_number (bordereau) to stock_transfers
ALTER TABLE stock_transfers
  ADD COLUMN IF NOT EXISTS transfer_number text,
  ADD COLUMN IF NOT EXISTS bordereau_ref text; -- numéro de bordereau saisi manuellement

-- 3. Sequence for auto-generated transfer numbers
CREATE SEQUENCE IF NOT EXISTS transfer_number_seq START 1;

-- 4. Auto-generate transfer number on insert
CREATE OR REPLACE FUNCTION set_transfer_number()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.transfer_number IS NULL THEN
    NEW.transfer_number := 'TRF-' || LPAD(nextval('transfer_number_seq')::text, 4, '0');
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_set_transfer_number ON stock_transfers;
CREATE TRIGGER trg_set_transfer_number
  BEFORE INSERT ON stock_transfers
  FOR EACH ROW EXECUTE FUNCTION set_transfer_number();

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
-- VIEW: cross_shop_stock — produits disponibles par boutique
-- (utilisé pour la recherche cross-boutique)
-- ============================================================
CREATE OR REPLACE VIEW cross_shop_stock AS
SELECT
  p.id AS product_id,
  p.name,
  p.name_hausa,
  p.sku,
  p.quantity,
  p.selling_price,
  p.unit,
  p.shop_id,
  s.name AS shop_name,
  s.city AS shop_city
FROM products p
JOIN shops s ON s.id = p.shop_id
WHERE p.is_active = true AND p.quantity > 0;

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
  COUNT(DISTINCT sm.id) FILTER (WHERE sm.created_at >= now() - interval '30 days') AS movements_30d,
  COUNT(DISTINCT sa.id) FILTER (WHERE sa.created_at >= now() - interval '30 days') AS sales_30d,
  COALESCE(SUM(sa.total) FILTER (WHERE sa.created_at >= now() - interval '30 days'), 0) AS revenue_30d
FROM shops s
LEFT JOIN products p ON p.shop_id = s.id
LEFT JOIN stock_movements sm ON sm.shop_id = s.id
LEFT JOIN sales sa ON sa.shop_id = s.id
GROUP BY s.id, s.name, s.city, s.plan, s.country;

-- Index for cross-shop product search by name/sku
CREATE INDEX IF NOT EXISTS idx_products_name_trgm ON products USING gin (name gin_trgm_ops) WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_products_sku_active ON products(sku, shop_id) WHERE is_active = true AND sku IS NOT NULL;

-- ============================================================
-- Migration 017 — Fix RLS for multi-shop owners
--
-- Problem: get_user_shop_id() returns only profiles.shop_id
-- (the user's primary shop). An owner with multiple shops
-- cannot read or write in their secondary shops via the anon client.
--
-- Fix:
--   SELECT  → allow if user is a member of the shop (any role)
--   WRITE   → owner: any shop where get_role_in_shop() = 'owner'
--              non-owners: primary shop only (unchanged)
-- ============================================================

-- ============================================================
-- PRODUCTS
-- ============================================================

-- SELECT: any shop member can read products
DROP POLICY IF EXISTS "products_shop_select" ON products;
CREATE POLICY "products_shop_select" ON products
  FOR SELECT USING (is_shop_member(shop_id));

-- Owner: full access in any shop where they hold the 'owner' role
DROP POLICY IF EXISTS "products_owner_all" ON products;
CREATE POLICY "products_owner_all" ON products
  FOR ALL USING (get_role_in_shop(shop_id) = 'owner');

-- Stock manager: write only in their primary shop
DROP POLICY IF EXISTS "products_manager_write" ON products;
CREATE POLICY "products_manager_write" ON products
  FOR INSERT WITH CHECK (
    shop_id = get_user_shop_id() AND get_user_role() = 'stock_manager'
  );

DROP POLICY IF EXISTS "products_manager_update" ON products;
CREATE POLICY "products_manager_update" ON products
  FOR UPDATE USING (
    shop_id = get_user_shop_id() AND get_user_role() = 'stock_manager'
  );

-- Cashier: write only in their primary shop
DROP POLICY IF EXISTS "products_cashier_write" ON products;
CREATE POLICY "products_cashier_write" ON products
  FOR INSERT WITH CHECK (
    shop_id = get_user_shop_id() AND get_user_role() = 'cashier'
  );

DROP POLICY IF EXISTS "products_cashier_update" ON products;
CREATE POLICY "products_cashier_update" ON products
  FOR UPDATE USING (
    shop_id = get_user_shop_id() AND get_user_role() = 'cashier'
  );

-- ============================================================
-- CATEGORIES
-- ============================================================

-- SELECT: any shop member can read categories
DROP POLICY IF EXISTS "categories_shop_select" ON categories;
CREATE POLICY "categories_shop_select" ON categories
  FOR SELECT USING (is_shop_member(shop_id));

-- Owner: full access in any shop where they hold the 'owner' role
DROP POLICY IF EXISTS "categories_owner_manager_write" ON categories;
CREATE POLICY "categories_owner_manager_write" ON categories
  FOR ALL USING (
    get_role_in_shop(shop_id) = 'owner'
    OR (shop_id = get_user_shop_id() AND get_user_role() = 'stock_manager')
  );

-- Cashier: write only in their primary shop
DROP POLICY IF EXISTS "categories_cashier_write" ON categories;
CREATE POLICY "categories_cashier_write" ON categories
  FOR INSERT WITH CHECK (
    shop_id = get_user_shop_id() AND get_user_role() = 'cashier'
  );

DROP POLICY IF EXISTS "categories_cashier_update" ON categories;
CREATE POLICY "categories_cashier_update" ON categories
  FOR UPDATE USING (
    shop_id = get_user_shop_id() AND get_user_role() = 'cashier'
  );

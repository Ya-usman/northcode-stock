-- ============================================================
-- Migration 018 — Fix ALL remaining RLS violations for multi-shop
--
-- Problem: all tables below still use get_user_shop_id() which
-- returns only profiles.shop_id (primary shop). Owners cannot
-- read or write in their secondary shops.
--
-- Helper functions from migration 005:
--   is_shop_member(shop_id)       → any active member
--   get_role_in_shop(shop_id)     → 'owner'|'cashier'|... or null
--   get_user_shop_ids()           → all shops for the user
-- ============================================================

-- ============================================================
-- SHOPS
-- ============================================================

DROP POLICY IF EXISTS "shops_owner_all" ON shops;
CREATE POLICY "shops_owner_all" ON shops
  FOR ALL USING (
    owner_id = auth.uid()
    OR is_shop_member(id)
  );

-- ============================================================
-- PROFILES
-- ============================================================

-- profiles_own (select true) and profiles_update_own / profiles_insert
-- are correct — only profiles_owner_manage needs fixing.
DROP POLICY IF EXISTS "profiles_owner_manage" ON profiles;
CREATE POLICY "profiles_owner_manage" ON profiles
  FOR ALL USING (
    get_role_in_shop(shop_id) = 'owner'
  );

-- ============================================================
-- SUPPLIERS
-- ============================================================

DROP POLICY IF EXISTS "suppliers_shop_select" ON suppliers;
CREATE POLICY "suppliers_shop_select" ON suppliers
  FOR SELECT USING (is_shop_member(shop_id));

DROP POLICY IF EXISTS "suppliers_owner_manager_write" ON suppliers;
CREATE POLICY "suppliers_owner_manager_write" ON suppliers
  FOR ALL USING (
    get_role_in_shop(shop_id) = 'owner'
    OR (shop_id = get_user_shop_id() AND get_user_role() = 'stock_manager')
  );

-- ============================================================
-- CUSTOMERS
-- ============================================================

DROP POLICY IF EXISTS "customers_shop_select" ON customers;
CREATE POLICY "customers_shop_select" ON customers
  FOR SELECT USING (is_shop_member(shop_id));

DROP POLICY IF EXISTS "customers_owner_cashier_write" ON customers;
CREATE POLICY "customers_owner_cashier_write" ON customers
  FOR INSERT WITH CHECK (
    get_role_in_shop(shop_id) = 'owner'
    OR (shop_id = get_user_shop_id() AND get_user_role() = 'cashier')
  );

DROP POLICY IF EXISTS "customers_owner_update" ON customers;
CREATE POLICY "customers_owner_update" ON customers
  FOR UPDATE USING (get_role_in_shop(shop_id) = 'owner');

DROP POLICY IF EXISTS "customers_owner_delete" ON customers;
CREATE POLICY "customers_owner_delete" ON customers
  FOR DELETE USING (get_role_in_shop(shop_id) = 'owner');

-- ============================================================
-- SALES
-- ============================================================

-- Owner: full access in any shop they own
DROP POLICY IF EXISTS "sales_owner_all" ON sales;
CREATE POLICY "sales_owner_all" ON sales
  FOR ALL USING (get_role_in_shop(shop_id) = 'owner');

-- Cashier: can only see their own sales in their primary shop
DROP POLICY IF EXISTS "sales_cashier_own" ON sales;
CREATE POLICY "sales_cashier_own" ON sales
  FOR SELECT USING (
    shop_id = get_user_shop_id()
    AND get_user_role() = 'cashier'
    AND cashier_id = auth.uid()
  );

-- Cashier insert: primary shop only
DROP POLICY IF EXISTS "sales_cashier_insert" ON sales;
CREATE POLICY "sales_cashier_insert" ON sales
  FOR INSERT WITH CHECK (
    shop_id = get_user_shop_id()
    AND get_user_role() = 'cashier'
    AND cashier_id = auth.uid()
  );

-- Viewer: can read all sales in any shop they are a member of
DROP POLICY IF EXISTS "sales_viewer_select" ON sales;
CREATE POLICY "sales_viewer_select" ON sales
  FOR SELECT USING (
    is_shop_member(shop_id)
    AND get_role_in_shop(shop_id) = 'viewer'
  );

-- ============================================================
-- SALE ITEMS
-- ============================================================

-- All members can read sale_items belonging to their shops
DROP POLICY IF EXISTS "sale_items_owner_all" ON sale_items;
DROP POLICY IF EXISTS "sale_items_cashier" ON sale_items;
DROP POLICY IF EXISTS "sale_items_member_select" ON sale_items;
DROP POLICY IF EXISTS "sale_items_owner_write" ON sale_items;
DROP POLICY IF EXISTS "sale_items_cashier_write" ON sale_items;

CREATE POLICY "sale_items_member_select" ON sale_items
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM sales s
      WHERE s.id = sale_id AND is_shop_member(s.shop_id)
    )
  );

CREATE POLICY "sale_items_owner_write" ON sale_items
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM sales s
      WHERE s.id = sale_id AND get_role_in_shop(s.shop_id) = 'owner'
    )
  );

CREATE POLICY "sale_items_cashier_write" ON sale_items
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM sales s
      WHERE s.id = sale_id
        AND s.shop_id = get_user_shop_id()
        AND get_user_role() = 'cashier'
    )
  );

-- ============================================================
-- PAYMENTS
-- ============================================================

DROP POLICY IF EXISTS "payments_owner_all" ON payments;
DROP POLICY IF EXISTS "payments_cashier_insert" ON payments;
DROP POLICY IF EXISTS "payments_member_select" ON payments;
DROP POLICY IF EXISTS "payments_cashier_write" ON payments;

CREATE POLICY "payments_member_select" ON payments
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM sales s
      WHERE s.id = sale_id AND is_shop_member(s.shop_id)
    )
  );

CREATE POLICY "payments_owner_all" ON payments
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM sales s
      WHERE s.id = sale_id AND get_role_in_shop(s.shop_id) = 'owner'
    )
  );

CREATE POLICY "payments_cashier_write" ON payments
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM sales s
      WHERE s.id = sale_id
        AND s.shop_id = get_user_shop_id()
        AND get_user_role() = 'cashier'
    )
  );

-- ============================================================
-- STOCK MOVEMENTS
-- ============================================================

-- Any member can read stock movements in their shops
DROP POLICY IF EXISTS "stock_movements_owner_all" ON stock_movements;
DROP POLICY IF EXISTS "stock_movements_manager" ON stock_movements;
DROP POLICY IF EXISTS "stock_movements_system_insert" ON stock_movements;
DROP POLICY IF EXISTS "stock_movements_select" ON stock_movements;

CREATE POLICY "stock_movements_select" ON stock_movements
  FOR SELECT USING (is_shop_member(shop_id));

CREATE POLICY "stock_movements_owner_all" ON stock_movements
  FOR ALL USING (get_role_in_shop(shop_id) = 'owner');

-- Stock manager: writes only in primary shop
CREATE POLICY "stock_movements_manager" ON stock_movements
  FOR ALL USING (
    shop_id = get_user_shop_id() AND get_user_role() = 'stock_manager'
  );

-- System insert: any active member (cashier processing sales, etc.)
CREATE POLICY "stock_movements_system_insert" ON stock_movements
  FOR INSERT WITH CHECK (
    is_shop_member(shop_id)
    AND get_role_in_shop(shop_id) IN ('owner', 'cashier', 'stock_manager')
  );

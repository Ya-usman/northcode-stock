-- ============================================================
-- Migration 065 : Fix RLS to respect dynamic role_permissions
-- ============================================================
-- Problem: Multiple tables have RLS policies hardcoded to
-- 'owner'/'manager' only. When the owner grants a feature
-- (e.g. expenses, stock, categories) to any other role via the
-- "Accès par rôle" UI (shops.role_permissions JSONB), the RLS
-- still blocks those users from inserting/reading.
--
-- Fix philosophy (same as migration 063 for sales):
--   • SELECT / INSERT: any active shop member (is_shop_member)
--   • UPDATE / DELETE: owner, manager, shop_manager only
-- The UI's role_permissions is the authority on WHO sees what;
-- RLS just enforces data isolation (member-of-shop only).
-- ============================================================

-- ── EXPENSES ────────────────────────────────────────────────
DROP POLICY IF EXISTS expenses_owner_all ON expenses;
DROP POLICY IF EXISTS expenses_member_select ON expenses;
DROP POLICY IF EXISTS expenses_member_insert ON expenses;
DROP POLICY IF EXISTS expenses_owner_modify ON expenses;
DROP POLICY IF EXISTS expenses_owner_delete ON expenses;

CREATE POLICY expenses_member_select ON expenses
  FOR SELECT USING (is_shop_member(shop_id));

CREATE POLICY expenses_member_insert ON expenses
  FOR INSERT WITH CHECK (is_shop_member(shop_id));

CREATE POLICY expenses_owner_modify ON expenses
  FOR UPDATE USING (
    is_shop_member(shop_id)
    AND get_role_in_shop(shop_id) IN ('owner', 'manager', 'shop_manager')
  )
  WITH CHECK (
    is_shop_member(shop_id)
    AND get_role_in_shop(shop_id) IN ('owner', 'manager', 'shop_manager')
  );

CREATE POLICY expenses_owner_delete ON expenses
  FOR DELETE USING (
    is_shop_member(shop_id)
    AND get_role_in_shop(shop_id) IN ('owner', 'manager', 'shop_manager')
  );

-- ── EXPENSE BUDGETS ─────────────────────────────────────────
DROP POLICY IF EXISTS expense_budgets_owner_all ON expense_budgets;
DROP POLICY IF EXISTS "expense_budgets_owner_all" ON expense_budgets;
DROP POLICY IF EXISTS expense_budgets_member_select ON expense_budgets;
DROP POLICY IF EXISTS expense_budgets_member_insert ON expense_budgets;
DROP POLICY IF EXISTS expense_budgets_owner_modify ON expense_budgets;

CREATE POLICY expense_budgets_member_select ON expense_budgets
  FOR SELECT USING (is_shop_member(shop_id));

CREATE POLICY expense_budgets_member_insert ON expense_budgets
  FOR INSERT WITH CHECK (is_shop_member(shop_id));

CREATE POLICY expense_budgets_owner_modify ON expense_budgets
  FOR UPDATE USING (
    is_shop_member(shop_id)
    AND get_role_in_shop(shop_id) IN ('owner', 'manager', 'shop_manager')
  )
  WITH CHECK (
    is_shop_member(shop_id)
    AND get_role_in_shop(shop_id) IN ('owner', 'manager', 'shop_manager')
  );

CREATE POLICY expense_budgets_owner_delete ON expense_budgets
  FOR DELETE USING (
    is_shop_member(shop_id)
    AND get_role_in_shop(shop_id) IN ('owner', 'manager', 'shop_manager')
  );

-- ── PRODUCTS ────────────────────────────────────────────────
-- Drop all old product policies that use hardcoded roles
DROP POLICY IF EXISTS products_owner_buying_price ON products;
DROP POLICY IF EXISTS products_owner_all ON products;
DROP POLICY IF EXISTS "products_manager_write" ON products;
DROP POLICY IF EXISTS "products_manager_update" ON products;
DROP POLICY IF EXISTS "products_cashier_write" ON products;
DROP POLICY IF EXISTS "products_cashier_update" ON products;
DROP POLICY IF EXISTS products_member_select ON products;
DROP POLICY IF EXISTS products_member_write ON products;
DROP POLICY IF EXISTS products_member_update ON products;
DROP POLICY IF EXISTS products_owner_delete ON products;

-- Any member can read products in their shop
CREATE POLICY products_member_select ON products
  FOR SELECT USING (is_shop_member(shop_id));

-- Any member can add products (UI controls who sees the form)
CREATE POLICY products_member_write ON products
  FOR INSERT WITH CHECK (is_shop_member(shop_id));

-- Any member can update products (stock edits, price changes, etc.)
CREATE POLICY products_member_update ON products
  FOR UPDATE USING (is_shop_member(shop_id))
  WITH CHECK (is_shop_member(shop_id));

-- Only privileged roles can delete products
CREATE POLICY products_owner_delete ON products
  FOR DELETE USING (
    is_shop_member(shop_id)
    AND get_role_in_shop(shop_id) IN ('owner', 'manager', 'shop_manager')
  );

-- ── CUSTOMERS ────────────────────────────────────────────────
DROP POLICY IF EXISTS customers_owner_update ON customers;
DROP POLICY IF EXISTS customers_owner_delete ON customers;
DROP POLICY IF EXISTS "customers_owner_cashier_write" ON customers;
DROP POLICY IF EXISTS customers_member_insert ON customers;
DROP POLICY IF EXISTS customers_owner_update_v2 ON customers;
DROP POLICY IF EXISTS customers_owner_delete_v2 ON customers;

-- Any member can add customers
CREATE POLICY customers_member_insert ON customers
  FOR INSERT WITH CHECK (is_shop_member(shop_id));

-- Any member can update customer info (name, phone, debt corrections)
CREATE POLICY customers_owner_update_v2 ON customers
  FOR UPDATE USING (is_shop_member(shop_id))
  WITH CHECK (is_shop_member(shop_id));

-- Only privileged roles can delete customers
CREATE POLICY customers_owner_delete_v2 ON customers
  FOR DELETE USING (
    is_shop_member(shop_id)
    AND get_role_in_shop(shop_id) IN ('owner', 'manager', 'shop_manager')
  );

-- ── CATEGORIES ───────────────────────────────────────────────
DROP POLICY IF EXISTS "categories_owner_manager_write" ON categories;
DROP POLICY IF EXISTS "categories_cashier_write" ON categories;
DROP POLICY IF EXISTS "categories_cashier_update" ON categories;
DROP POLICY IF EXISTS categories_member_all ON categories;

-- Any member can manage categories (UI controls visibility)
CREATE POLICY categories_member_all ON categories
  FOR ALL USING (is_shop_member(shop_id))
  WITH CHECK (is_shop_member(shop_id));

-- ── SUPPLIERS ────────────────────────────────────────────────
DROP POLICY IF EXISTS "suppliers_owner_manager_write" ON suppliers;
DROP POLICY IF EXISTS suppliers_member_all ON suppliers;

-- Any member can manage suppliers (UI controls visibility)
CREATE POLICY suppliers_member_all ON suppliers
  FOR ALL USING (is_shop_member(shop_id))
  WITH CHECK (is_shop_member(shop_id));

-- ── STOCK MOVEMENTS ─────────────────────────────────────────
DROP POLICY IF EXISTS stock_movements_owner_all ON stock_movements;
DROP POLICY IF EXISTS "stock_movements_manager" ON stock_movements;
DROP POLICY IF EXISTS "stock_movements_system_insert" ON stock_movements;
DROP POLICY IF EXISTS stock_movements_member_select ON stock_movements;
DROP POLICY IF EXISTS stock_movements_member_insert ON stock_movements;
DROP POLICY IF EXISTS stock_movements_owner_modify ON stock_movements;

-- Any member can read movement history for their shop
CREATE POLICY stock_movements_member_select ON stock_movements
  FOR SELECT USING (is_shop_member(shop_id));

-- Any member can insert movements (stockin, adjustments — UI controls who can)
CREATE POLICY stock_movements_member_insert ON stock_movements
  FOR INSERT WITH CHECK (is_shop_member(shop_id));

-- Only privileged roles can update/delete movements
CREATE POLICY stock_movements_owner_modify ON stock_movements
  FOR UPDATE USING (
    is_shop_member(shop_id)
    AND get_role_in_shop(shop_id) IN ('owner', 'manager', 'shop_manager')
  )
  WITH CHECK (
    is_shop_member(shop_id)
    AND get_role_in_shop(shop_id) IN ('owner', 'manager', 'shop_manager')
  );

CREATE POLICY stock_movements_owner_delete ON stock_movements
  FOR DELETE USING (
    is_shop_member(shop_id)
    AND get_role_in_shop(shop_id) IN ('owner', 'manager', 'shop_manager')
  );

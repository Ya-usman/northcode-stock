-- ============================================================
-- Migration 060 : Fix remaining broken RLS policies
-- ============================================================
-- All policies below use get_user_shop_id() / get_user_role()
-- (reads stale profiles columns). Replace with is_shop_member()
-- + get_role_in_shop() which read from shop_members (authoritative).

-- ── PRODUCTS : cashier + stock_manager ──────────────────────
DROP POLICY IF EXISTS "products_manager_write" ON products;
CREATE POLICY "products_manager_write" ON products
  FOR INSERT WITH CHECK (
    is_shop_member(shop_id)
    AND get_role_in_shop(shop_id) = 'stock_manager'
  );

DROP POLICY IF EXISTS "products_manager_update" ON products;
CREATE POLICY "products_manager_update" ON products
  FOR UPDATE USING (
    is_shop_member(shop_id)
    AND get_role_in_shop(shop_id) = 'stock_manager'
  );

DROP POLICY IF EXISTS "products_cashier_write" ON products;
CREATE POLICY "products_cashier_write" ON products
  FOR INSERT WITH CHECK (
    is_shop_member(shop_id)
    AND get_role_in_shop(shop_id) = 'cashier'
  );

DROP POLICY IF EXISTS "products_cashier_update" ON products;
CREATE POLICY "products_cashier_update" ON products
  FOR UPDATE USING (
    is_shop_member(shop_id)
    AND get_role_in_shop(shop_id) = 'cashier'
  );

-- ── CATEGORIES ───────────────────────────────────────────────
DROP POLICY IF EXISTS "categories_owner_manager_write" ON categories;
CREATE POLICY "categories_owner_manager_write" ON categories
  FOR ALL USING (
    is_shop_member(shop_id)
    AND get_role_in_shop(shop_id) IN ('owner', 'manager', 'stock_manager')
  )
  WITH CHECK (
    is_shop_member(shop_id)
    AND get_role_in_shop(shop_id) IN ('owner', 'manager', 'stock_manager')
  );

DROP POLICY IF EXISTS "categories_cashier_write" ON categories;
CREATE POLICY "categories_cashier_write" ON categories
  FOR INSERT WITH CHECK (
    is_shop_member(shop_id)
    AND get_role_in_shop(shop_id) = 'cashier'
  );

DROP POLICY IF EXISTS "categories_cashier_update" ON categories;
CREATE POLICY "categories_cashier_update" ON categories
  FOR UPDATE USING (
    is_shop_member(shop_id)
    AND get_role_in_shop(shop_id) = 'cashier'
  );

-- ── SUPPLIERS ────────────────────────────────────────────────
DROP POLICY IF EXISTS "suppliers_owner_manager_write" ON suppliers;
CREATE POLICY "suppliers_owner_manager_write" ON suppliers
  FOR ALL USING (
    is_shop_member(shop_id)
    AND get_role_in_shop(shop_id) IN ('owner', 'manager', 'stock_manager')
  )
  WITH CHECK (
    is_shop_member(shop_id)
    AND get_role_in_shop(shop_id) IN ('owner', 'manager', 'stock_manager')
  );

-- ── CUSTOMERS : INSERT (owner + manager + cashier) ──────────
DROP POLICY IF EXISTS "customers_owner_cashier_write" ON customers;
CREATE POLICY "customers_owner_cashier_write" ON customers
  FOR INSERT WITH CHECK (
    is_shop_member(shop_id)
    AND get_role_in_shop(shop_id) IN ('owner', 'manager', 'cashier')
  );

-- ── STOCK MOVEMENTS : stock_manager + system insert ─────────
DROP POLICY IF EXISTS "stock_movements_manager" ON stock_movements;
CREATE POLICY "stock_movements_manager" ON stock_movements
  FOR ALL USING (
    is_shop_member(shop_id)
    AND get_role_in_shop(shop_id) = 'stock_manager'
  )
  WITH CHECK (
    is_shop_member(shop_id)
    AND get_role_in_shop(shop_id) = 'stock_manager'
  );

DROP POLICY IF EXISTS "stock_movements_system_insert" ON stock_movements;
CREATE POLICY "stock_movements_system_insert" ON stock_movements
  FOR INSERT WITH CHECK (
    is_shop_member(shop_id)
    AND get_role_in_shop(shop_id) IN ('owner', 'manager', 'cashier', 'stock_manager')
  );

-- ── EXPENSE BUDGETS : add manager ───────────────────────────
DROP POLICY IF EXISTS "expense_budgets_owner_all" ON expense_budgets;
CREATE POLICY "expense_budgets_owner_all" ON expense_budgets
  FOR ALL USING (
    is_shop_member(shop_id)
    AND get_role_in_shop(shop_id) IN ('owner', 'manager')
  )
  WITH CHECK (
    is_shop_member(shop_id)
    AND get_role_in_shop(shop_id) IN ('owner', 'manager')
  );

-- ── SUBSCRIPTIONS : use shop_members instead of profiles ────
DROP POLICY IF EXISTS "subscriptions_owner_select" ON subscriptions;
CREATE POLICY "subscriptions_owner_select" ON subscriptions
  FOR SELECT USING (
    is_shop_member(shop_id)
  );

-- ── AGENTS : restrict to service_role only ──────────────────
DROP POLICY IF EXISTS "agents_service_role" ON agents;
CREATE POLICY "agents_service_role" ON agents
  FOR ALL USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

DROP POLICY IF EXISTS "agent_commissions_service_role" ON agent_commissions;
CREATE POLICY "agent_commissions_service_role" ON agent_commissions
  FOR ALL USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

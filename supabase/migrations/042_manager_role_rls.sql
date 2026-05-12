-- Grant manager role the same RLS access as owner for shop data
-- Manager is a designated responsable, not the account owner

-- Helper: extend get_user_role() to return 'manager' properly (it reads shop_members.role, already works)
-- No change needed to get_user_role() — it already reads the role column.

-- Products: manager can read buying_price (same as owner)
DROP POLICY IF EXISTS products_owner_buying_price ON products;
CREATE POLICY products_owner_buying_price ON products
  FOR SELECT USING (
    get_user_role() IN ('owner', 'manager')
  );

-- Products: manager can insert/update/delete (same as owner)
DROP POLICY IF EXISTS products_owner_all ON products;
CREATE POLICY products_owner_all ON products
  FOR ALL USING (get_user_role() IN ('owner', 'manager'))
  WITH CHECK (get_user_role() IN ('owner', 'manager'));

-- Customers: manager can update and delete
DROP POLICY IF EXISTS customers_owner_update ON customers;
CREATE POLICY customers_owner_update ON customers
  FOR UPDATE USING (get_user_role() IN ('owner', 'manager'));

DROP POLICY IF EXISTS customers_owner_delete ON customers;
CREATE POLICY customers_owner_delete ON customers
  FOR DELETE USING (get_user_role() IN ('owner', 'manager'));

-- Sales: manager has full access (same as owner)
DROP POLICY IF EXISTS sales_owner_all ON sales;
CREATE POLICY sales_owner_all ON sales
  FOR ALL USING (get_user_role() IN ('owner', 'manager'))
  WITH CHECK (get_user_role() IN ('owner', 'manager'));

-- Sale items: manager has full access
DROP POLICY IF EXISTS sale_items_owner_all ON sale_items;
CREATE POLICY sale_items_owner_all ON sale_items
  FOR ALL USING (get_user_role() IN ('owner', 'manager'))
  WITH CHECK (get_user_role() IN ('owner', 'manager'));

-- Payments: manager has full access
DROP POLICY IF EXISTS payments_owner_all ON payments;
CREATE POLICY payments_owner_all ON payments
  FOR ALL USING (get_user_role() IN ('owner', 'manager'))
  WITH CHECK (get_user_role() IN ('owner', 'manager'));

-- Stock movements: manager has full access
DROP POLICY IF EXISTS stock_movements_owner_all ON stock_movements;
CREATE POLICY stock_movements_owner_all ON stock_movements
  FOR ALL USING (get_user_role() IN ('owner', 'manager'))
  WITH CHECK (get_user_role() IN ('owner', 'manager'));

-- Expenses: manager can read, insert, update, delete
DROP POLICY IF EXISTS expenses_owner_all ON expenses;
CREATE POLICY expenses_owner_all ON expenses
  FOR ALL USING (get_user_role() IN ('owner', 'manager'))
  WITH CHECK (get_user_role() IN ('owner', 'manager'));

-- Shop members: manager can view team (needed for team page)
-- The existing select policy likely covers all members already.
-- Manager cannot update shop itself (shops table restricted to owner).

-- ============================================================
-- Migration 016 — Allow cashiers to insert/update products and categories
-- Cashiers can manage stock in their shop but cannot delete.
-- ============================================================

-- Products: cashier can INSERT new products
DROP POLICY IF EXISTS "products_cashier_write" ON products;
CREATE POLICY "products_cashier_write" ON products
  FOR INSERT WITH CHECK (
    shop_id = get_user_shop_id() AND
    get_user_role() = 'cashier'
  );

-- Products: cashier can UPDATE existing products (price, stock, etc.)
DROP POLICY IF EXISTS "products_cashier_update" ON products;
CREATE POLICY "products_cashier_update" ON products
  FOR UPDATE USING (
    shop_id = get_user_shop_id() AND
    get_user_role() = 'cashier'
  );

-- Categories: cashier can INSERT new categories
DROP POLICY IF EXISTS "categories_cashier_write" ON categories;
CREATE POLICY "categories_cashier_write" ON categories
  FOR INSERT WITH CHECK (
    shop_id = get_user_shop_id() AND
    get_user_role() = 'cashier'
  );

-- Categories: cashier can UPDATE existing categories
DROP POLICY IF EXISTS "categories_cashier_update" ON categories;
CREATE POLICY "categories_cashier_update" ON categories
  FOR UPDATE USING (
    shop_id = get_user_shop_id() AND
    get_user_role() = 'cashier'
  );

-- ============================================================
-- 034 — DATA PROTECTION
-- Soft delete for customers, missing indexes, RLS hardening
-- ============================================================

-- 1. Soft delete column for customers
--    A deleted customer is hidden from all views but their sales/payments history is intact.
ALTER TABLE customers ADD COLUMN IF NOT EXISTS deleted_at timestamptz DEFAULT NULL;

-- Partial index: fast lookup of non-deleted customers (the common case)
CREATE INDEX IF NOT EXISTS idx_customers_not_deleted
  ON customers (shop_id) WHERE deleted_at IS NULL;

-- 2. Update SELECT RLS: exclude soft-deleted customers
DROP POLICY IF EXISTS "customers_shop_select" ON customers;
CREATE POLICY "customers_shop_select" ON customers
  FOR SELECT USING (is_shop_member(shop_id) AND deleted_at IS NULL);

-- 3. Remove hard DELETE permission for customers.
--    Deletion is now done via UPDATE (setting deleted_at = now()).
--    The existing UPDATE policy already allows owners to update customer rows.
DROP POLICY IF EXISTS "customers_owner_delete" ON customers;

-- 4. Missing FK indexes (fix slow queries and protect referential integrity checks)
CREATE INDEX IF NOT EXISTS idx_sales_customer_id
  ON sales (customer_id);

CREATE INDEX IF NOT EXISTS idx_stock_movements_performed_by
  ON stock_movements (performed_by);

CREATE INDEX IF NOT EXISTS idx_products_supplier_id
  ON products (supplier_id);

-- 5. Guard: prevent deleting a category that still has active products
--    (enforced at API level too, but this function can be called as a check)
CREATE OR REPLACE FUNCTION category_has_products(p_category_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT EXISTS (
    SELECT 1 FROM products
    WHERE category_id = p_category_id
      AND is_active = true
  );
$$;

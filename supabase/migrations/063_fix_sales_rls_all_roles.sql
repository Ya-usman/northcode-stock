-- ============================================================
-- Migration 063 : Fix sales RLS to respect owner's role_permissions
-- ============================================================
-- Problem: sales_cashier_insert only allows role='cashier' to INSERT.
-- But the owner can grant "new_sale" to any role via the "Accès par rôle"
-- UI (shops.role_permissions JSONB). A stock_manager with new_sale=true
-- can create offline sales but sync fails because RLS blocks the INSERT.
--
-- Fix: any active shop member can insert their OWN sales in their shop.
-- The UI's "Accès par rôle" is the authority on WHO can sell — RLS just
-- enforces data integrity (member only, own cashier_id only).

-- ── SALES INSERT ─────────────────────────────────────────────
DROP POLICY IF EXISTS "sales_cashier_insert" ON sales;
CREATE POLICY "sales_member_insert" ON sales
  FOR INSERT WITH CHECK (
    is_shop_member(shop_id)
    AND cashier_id = auth.uid()
  );

-- ── SALES SELECT for stock_manager ───────────────────────────
-- stock_manager can see their own sales (owner may enable sales_history)
DROP POLICY IF EXISTS "sales_stock_manager_own" ON sales;
CREATE POLICY "sales_stock_manager_own" ON sales
  FOR SELECT USING (
    is_shop_member(shop_id)
    AND get_role_in_shop(shop_id) = 'stock_manager'
    AND cashier_id = auth.uid()
  );

-- ── SALE ITEMS INSERT ─────────────────────────────────────────
-- Allow any shop member to insert items for their own sales
DROP POLICY IF EXISTS "sale_items_cashier_write" ON sale_items;
CREATE POLICY "sale_items_member_write" ON sale_items
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM sales s
      WHERE s.id = sale_id
        AND is_shop_member(s.shop_id)
        AND s.cashier_id = auth.uid()
    )
  );

-- ── PAYMENTS INSERT ───────────────────────────────────────────
-- Allow any shop member to insert payments for their own sales
DROP POLICY IF EXISTS "payments_cashier_write" ON payments;
CREATE POLICY "payments_member_write" ON payments
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM sales s
      WHERE s.id = sale_id
        AND is_shop_member(s.shop_id)
        AND s.cashier_id = auth.uid()
    )
  );

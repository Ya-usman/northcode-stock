-- ============================================================
-- Migration 019 : Quantity non-negative guard (BUG-01)
-- ============================================================

-- 1. Add CHECK constraint so the DB enforces quantity >= 0 at all times
ALTER TABLE public.products
  ADD CONSTRAINT products_quantity_non_negative CHECK (quantity >= 0);

-- 2. Replace deduct_stock_on_sale trigger to raise a clear error
--    instead of silently going negative
CREATE OR REPLACE FUNCTION deduct_stock_on_sale()
RETURNS trigger AS $$
DECLARE
  v_shop_id uuid;
  v_cashier_id uuid;
  v_sale_number text;
  v_current_qty int;
BEGIN
  -- Only deduct when a product_id is present (walk-in items without a linked product are skipped)
  IF new.product_id IS NULL THEN
    RETURN new;
  END IF;

  SELECT quantity INTO v_current_qty FROM products WHERE id = new.product_id;

  IF v_current_qty IS NULL THEN
    RETURN new; -- product deleted between select and insert, skip
  END IF;

  IF v_current_qty < new.quantity THEN
    RAISE EXCEPTION 'Stock insuffisant pour le produit % (disponible: %, demandé: %)',
      new.product_id, v_current_qty, new.quantity
      USING ERRCODE = 'P0001';
  END IF;

  -- Deduct product quantity
  UPDATE products
  SET quantity = quantity - new.quantity,
      updated_at = now()
  WHERE id = new.product_id;

  -- Log stock movement
  SELECT s.shop_id, s.cashier_id, s.sale_number
  INTO v_shop_id, v_cashier_id, v_sale_number
  FROM sales s WHERE s.id = new.sale_id;

  INSERT INTO stock_movements (shop_id, product_id, type, quantity, reason, performed_by)
  VALUES (v_shop_id, new.product_id, 'sale', new.quantity, 'Sale ' || v_sale_number, v_cashier_id);

  RETURN new;
END;
$$ LANGUAGE plpgsql;

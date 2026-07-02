-- ============================================================
-- Migration 057 : Add FOR UPDATE to deduct_stock_on_sale trigger
-- ============================================================
-- Without FOR UPDATE, two concurrent sale_items inserts can both read
-- quantity = 1, both pass the check, and then one UPDATE violates the
-- products_quantity_non_negative constraint with a raw Postgres error
-- instead of the friendly "Stock insuffisant" message.
-- FOR UPDATE locks the product row for the duration of the transaction,
-- so the second transaction waits and then sees the updated quantity.

CREATE OR REPLACE FUNCTION deduct_stock_on_sale()
RETURNS trigger AS $$
DECLARE
  v_shop_id uuid;
  v_cashier_id uuid;
  v_sale_number text;
  v_current_qty int;
BEGIN
  IF new.product_id IS NULL THEN
    RETURN new;
  END IF;

  -- Lock the product row before reading to prevent TOCTOU race condition:
  -- without FOR UPDATE, two concurrent transactions can both read the same
  -- quantity and both pass the stock check before either deducts.
  SELECT quantity INTO v_current_qty
  FROM products
  WHERE id = new.product_id
  FOR UPDATE;

  IF v_current_qty IS NULL THEN
    RETURN new;
  END IF;

  IF v_current_qty < new.quantity THEN
    RAISE EXCEPTION 'Stock insuffisant pour le produit % (disponible: %, demandé: %)',
      new.product_id, v_current_qty, new.quantity
      USING ERRCODE = 'P0001';
  END IF;

  UPDATE products
  SET quantity = quantity - new.quantity,
      updated_at = now()
  WHERE id = new.product_id;

  SELECT s.shop_id, s.cashier_id, s.sale_number
  INTO v_shop_id, v_cashier_id, v_sale_number
  FROM sales s WHERE s.id = new.sale_id;

  INSERT INTO stock_movements (shop_id, product_id, type, quantity, reason, performed_by)
  VALUES (v_shop_id, new.product_id, 'sale', new.quantity, 'Sale ' || v_sale_number, v_cashier_id);

  RETURN new;
END;
$$ LANGUAGE plpgsql;

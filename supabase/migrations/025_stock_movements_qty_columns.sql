-- ============================================================
-- Migration 025 : Add previous_qty / new_qty to stock_movements
-- ============================================================
-- These two columns allow the movements log to show the stock
-- level before and after each operation, giving full traceability.

ALTER TABLE public.stock_movements
  ADD COLUMN IF NOT EXISTS previous_qty integer,
  ADD COLUMN IF NOT EXISTS new_qty      integer;

-- ---------------------------------------------------------------
-- Update deduct_stock_on_sale trigger to capture before/after qty
-- ---------------------------------------------------------------
CREATE OR REPLACE FUNCTION deduct_stock_on_sale()
RETURNS trigger AS $$
DECLARE
  v_shop_id      uuid;
  v_cashier_id   uuid;
  v_sale_number  text;
  v_current_qty  int;
BEGIN
  IF new.product_id IS NULL THEN
    RETURN new;
  END IF;

  SELECT quantity INTO v_current_qty FROM products WHERE id = new.product_id;

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

  INSERT INTO stock_movements (shop_id, product_id, type, quantity, reason, performed_by, previous_qty, new_qty)
  VALUES (
    v_shop_id, new.product_id, 'sale', new.quantity,
    'Sale ' || v_sale_number,
    v_cashier_id,
    v_current_qty,
    v_current_qty - new.quantity
  );

  RETURN new;
END;
$$ LANGUAGE plpgsql;

-- ---------------------------------------------------------------
-- Update cancel_sale to capture before/after qty on stock restore
-- ---------------------------------------------------------------
CREATE OR REPLACE FUNCTION cancel_sale(
  p_sale_id      uuid,
  p_cancelled_by uuid,
  p_reason       text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sale     record;
  v_item     record;
  v_prev_qty int;
BEGIN
  SELECT * INTO v_sale FROM sales WHERE id = p_sale_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Vente introuvable' USING ERRCODE = 'P0002';
  END IF;
  IF v_sale.sale_status = 'cancelled' THEN
    RAISE EXCEPTION 'Vente déjà annulée' USING ERRCODE = 'P0003';
  END IF;

  FOR v_item IN SELECT * FROM sale_items WHERE sale_id = p_sale_id LOOP
    IF v_item.product_id IS NOT NULL THEN
      SELECT quantity INTO v_prev_qty FROM products WHERE id = v_item.product_id;

      UPDATE products
        SET quantity = quantity + v_item.quantity, updated_at = now()
        WHERE id = v_item.product_id;

      INSERT INTO stock_movements (shop_id, product_id, type, quantity, reason, notes, performed_by, previous_qty, new_qty)
      VALUES (
        v_sale.shop_id, v_item.product_id, 'in', v_item.quantity,
        'Annulation vente #' || v_sale.sale_number,
        p_reason,
        p_cancelled_by,
        v_prev_qty,
        v_prev_qty + v_item.quantity
      );
    END IF;
  END LOOP;

  IF v_sale.balance > 0 AND v_sale.customer_id IS NOT NULL THEN
    UPDATE customers
    SET total_debt = greatest(0, total_debt - v_sale.balance)
    WHERE id = v_sale.customer_id;
  END IF;

  UPDATE sales SET
    sale_status   = 'cancelled',
    cancelled_by  = p_cancelled_by,
    cancelled_at  = now(),
    cancel_reason = p_reason
  WHERE id = p_sale_id;
END;
$$;

REVOKE ALL ON FUNCTION cancel_sale(uuid, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION cancel_sale(uuid, uuid, text) TO service_role;


-- ---------------------------------------------------------------
-- Update delete_sale to capture before/after qty on stock restore
-- ---------------------------------------------------------------
CREATE OR REPLACE FUNCTION delete_sale(
  p_sale_id uuid,
  p_user_id  uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sale     record;
  v_item     record;
  v_prev_qty int;
BEGIN
  SELECT * INTO v_sale FROM sales WHERE id = p_sale_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Vente introuvable' USING ERRCODE = 'P0002';
  END IF;

  IF v_sale.sale_status = 'active' THEN
    FOR v_item IN SELECT * FROM sale_items WHERE sale_id = p_sale_id LOOP
      IF v_item.product_id IS NOT NULL THEN
        SELECT quantity INTO v_prev_qty FROM products WHERE id = v_item.product_id;

        UPDATE products
          SET quantity = quantity + v_item.quantity, updated_at = now()
          WHERE id = v_item.product_id;
      END IF;
    END LOOP;

    IF v_sale.balance > 0 AND v_sale.customer_id IS NOT NULL THEN
      UPDATE customers
      SET total_debt = greatest(0, total_debt - v_sale.balance)
      WHERE id = v_sale.customer_id;
    END IF;
  END IF;

  DELETE FROM sale_items WHERE sale_id = p_sale_id;
  DELETE FROM payments   WHERE sale_id = p_sale_id;
  DELETE FROM sales      WHERE id      = p_sale_id;
END;
$$;

REVOKE ALL ON FUNCTION delete_sale(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION delete_sale(uuid, uuid) TO service_role;

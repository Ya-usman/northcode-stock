-- ============================================================
-- Migration 022 : Reverse customer debt on sale cancel/delete (BUG-11)
-- ============================================================
-- cancel_sale() and delete_sale() restored stock but never reduced
-- customers.total_debt, leaving debt permanently inflated after a
-- cancellation or deletion.

-- ---- cancel_sale (updated) -------------------------------------------------
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
  v_sale  record;
  v_item  record;
BEGIN
  SELECT * INTO v_sale FROM sales WHERE id = p_sale_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Vente introuvable' USING ERRCODE = 'P0002';
  END IF;
  IF v_sale.sale_status = 'cancelled' THEN
    RAISE EXCEPTION 'Vente déjà annulée' USING ERRCODE = 'P0003';
  END IF;

  -- Restore stock
  FOR v_item IN SELECT * FROM sale_items WHERE sale_id = p_sale_id LOOP
    IF v_item.product_id IS NOT NULL THEN
      UPDATE products
        SET quantity = quantity + v_item.quantity, updated_at = now()
        WHERE id = v_item.product_id;

      INSERT INTO stock_movements (shop_id, product_id, type, quantity, reason, notes, performed_by)
      VALUES (
        v_sale.shop_id, v_item.product_id, 'in', v_item.quantity,
        'Annulation vente #' || v_sale.sale_number,
        p_reason,
        p_cancelled_by
      );
    END IF;
  END LOOP;

  -- Reverse customer debt if the sale had an outstanding balance
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


-- ---- delete_sale (updated) -------------------------------------------------
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
  v_sale record;
  v_item record;
BEGIN
  SELECT * INTO v_sale FROM sales WHERE id = p_sale_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Vente introuvable' USING ERRCODE = 'P0002';
  END IF;

  -- Restore stock only if sale was never cancelled (cancellation already restored stock)
  IF v_sale.sale_status = 'active' THEN
    FOR v_item IN SELECT * FROM sale_items WHERE sale_id = p_sale_id LOOP
      IF v_item.product_id IS NOT NULL THEN
        UPDATE products
          SET quantity = quantity + v_item.quantity, updated_at = now()
          WHERE id = v_item.product_id;
      END IF;
    END LOOP;

    -- Reverse debt only for active sales (cancelled sales already had debt reversed in cancel_sale)
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

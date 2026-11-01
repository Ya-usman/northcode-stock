CREATE OR REPLACE FUNCTION public.delete_sale(p_sale_id uuid, p_user_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
        PERFORM 1 FROM products WHERE id = v_item.product_id FOR UPDATE;

        UPDATE products
          SET quantity = quantity + v_item.quantity, updated_at = now()
          WHERE id = v_item.product_id;

        PERFORM restore_sale_item_batches(v_item.id);
      END IF;
    END LOOP;

    -- Reverse debt only for active sales — a cancelled sale already had its
    -- debt reversed by cancel_sale (022, régressé par 087)
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
$function$

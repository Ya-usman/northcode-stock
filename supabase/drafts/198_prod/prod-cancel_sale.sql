CREATE OR REPLACE FUNCTION public.cancel_sale(p_sale_id uuid, p_cancelled_by uuid, p_reason text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_sale  record;
  v_item  record;
  v_back  int;
BEGIN
  SELECT * INTO v_sale FROM sales WHERE id = p_sale_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Vente introuvable' USING ERRCODE = 'P0002';
  END IF;
  IF v_sale.sale_status = 'cancelled' THEN
    RAISE EXCEPTION 'Vente déjà annulée' USING ERRCODE = 'P0003';
  END IF;

  FOR v_item IN SELECT * FROM sale_items WHERE sale_id = p_sale_id LOOP
    v_back := v_item.quantity - coalesce(v_item.stock_shortfall, 0);
    IF v_item.product_id IS NOT NULL AND v_back > 0 THEN
      PERFORM 1 FROM products WHERE id = v_item.product_id FOR UPDATE;

      UPDATE products
        SET quantity = quantity + v_back, updated_at = now()
        WHERE id = v_item.product_id;

      PERFORM restore_sale_item_batches(v_item.id);

      INSERT INTO stock_movements (shop_id, product_id, type, quantity, reason, notes, performed_by)
      VALUES (
        v_sale.shop_id, v_item.product_id, 'in', v_back,
        'Annulation vente #' || v_sale.sale_number,
        p_reason,
        p_cancelled_by
      );
    END IF;
  END LOOP;

  -- Dette du client annulée si la vente laissait un solde (022, régressé par 087)
  IF v_sale.balance > 0 AND v_sale.customer_id IS NOT NULL THEN
    UPDATE customers
    SET total_debt = greatest(0, total_debt - v_sale.balance)
    WHERE id = v_sale.customer_id;
  END IF;

  UPDATE sales SET
    sale_status  = 'cancelled',
    cancelled_by = p_cancelled_by,
    cancelled_at = now(),
    cancel_reason = p_reason
  WHERE id = p_sale_id;
END;
$function$

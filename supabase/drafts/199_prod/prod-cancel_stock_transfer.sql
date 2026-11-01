CREATE OR REPLACE FUNCTION public.cancel_stock_transfer(p_transfer_id uuid, p_source_shop_id uuid, p_performed_by uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_status text;
  v_src    uuid;
  v_ref    text;
  v_it     record;
  v_a      record;
  v_batch  uuid;
  v_total  int;
  v_prev   int;
BEGIN
  SELECT status, source_shop_id, reference INTO v_status, v_src, v_ref FROM stock_transfers WHERE id = p_transfer_id FOR UPDATE;
  IF NOT FOUND OR v_src IS DISTINCT FROM p_source_shop_id THEN RAISE EXCEPTION 'transfer_not_found' USING ERRCODE = 'P0063'; END IF;
  IF v_status = 'cancelled' THEN RETURN; END IF;                       -- déjà annulé : rien de plus
  IF v_status = 'received' THEN RAISE EXCEPTION 'transfer_not_cancellable' USING ERRCODE = 'P0074'; END IF;
  IF v_status = 'sent' THEN
    PERFORM 1 FROM products WHERE id IN (SELECT source_product_id FROM stock_transfer_items WHERE stock_transfer_id = p_transfer_id)
      ORDER BY id FOR UPDATE;
    FOR v_it IN SELECT * FROM stock_transfer_items WHERE stock_transfer_id = p_transfer_id ORDER BY source_product_id LOOP
      v_total := 0;
      FOR v_a IN SELECT * FROM stock_transfer_allocations WHERE item_id = v_it.id AND quantity_in_transit > 0 FOR UPDATE LOOP
        IF v_a.coverage = 'batch' THEN
          -- Rendu au lot source EXACT ; lot disparu entre-temps : recréé (même péremption, même coût s'il est connu)
          v_batch := NULL;
          UPDATE product_batches SET quantity = quantity + v_a.quantity_in_transit, updated_at = now() WHERE id = v_a.source_batch_id
            RETURNING id INTO v_batch;
          IF v_batch IS NULL AND v_it.source_product_id IS NOT NULL THEN
            INSERT INTO product_batches (shop_id, product_id, quantity, initial_quantity, buying_price, expiry_date, source, received_at, origin_transfer_id)
              VALUES (v_src, v_it.source_product_id, v_a.quantity_in_transit, v_a.quantity_in_transit, v_a.unit_cost, v_a.source_expiry_date,
                      'adjustment', coalesce(v_a.source_received_at, now()), p_transfer_id);
          END IF;
        END IF;
        v_total := v_total + v_a.quantity_in_transit;
        UPDATE stock_transfer_allocations SET quantity_returned = quantity_returned + v_a.quantity_in_transit WHERE id = v_a.id;
      END LOOP;
      IF v_total > 0 AND v_it.source_product_id IS NOT NULL THEN
        SELECT quantity INTO v_prev FROM products WHERE id = v_it.source_product_id AND shop_id = v_src;
        IF FOUND THEN
          UPDATE products SET quantity = v_prev + v_total, updated_at = now() WHERE id = v_it.source_product_id;
          INSERT INTO stock_movements (shop_id, product_id, type, quantity, previous_qty, new_qty, reason, performed_by, transfer_id)
            VALUES (v_src, v_it.source_product_id, 'in', v_total, v_prev, v_prev + v_total, 'Annulation transfert ' || v_ref, p_performed_by, p_transfer_id);
        END IF;
      END IF;
    END LOOP;
  END IF;
  UPDATE stock_transfers SET status = 'cancelled', cancelled_at = now(), cancelled_by = p_performed_by, updated_at = now() WHERE id = p_transfer_id;
  UPDATE stock_transfer_tokens SET revoked_at = now() WHERE transfer_id = p_transfer_id AND revoked_at IS NULL;
  PERFORM _transfer_audit(v_src, p_performed_by, 'stock_transfer.cancel', p_transfer_id, jsonb_build_object('reference', v_ref, 'was', v_status));
END;
$function$

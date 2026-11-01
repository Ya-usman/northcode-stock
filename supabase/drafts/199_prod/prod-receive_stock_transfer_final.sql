CREATE OR REPLACE FUNCTION public.receive_stock_transfer_final(p_transfer_id uuid, p_dest uuid, p_user uuid, p_receipt_key uuid, p_lines jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_t         record;
  v_src_name  text;
  v_same_cur  boolean;
  v_ids       uuid[];
  v_it        record;
  v_line      jsonb;
  v_transit   int;
  v_r         int;
  v_m         int;
  v_cat       text;
  v_dest_pid  uuid;
  v_prev      int;
  v_mv        uuid;
  v_left      int;
  v_a         record;
  v_take      int;
  v_miss      int;
  v_batch     uuid;
  v_created   jsonb := '[]'::jsonb;
  v_sent_tot  int := 0;
  v_recv_tot  int := 0;
BEGIN
  SELECT * INTO v_t FROM stock_transfers WHERE id = p_transfer_id FOR UPDATE;
  IF NOT FOUND OR v_t.destination_shop_id <> p_dest THEN RAISE EXCEPTION 'transfer_not_found' USING ERRCODE = 'P0063'; END IF;
  IF v_t.status = 'received' THEN
    IF v_t.receipt_key IS NOT DISTINCT FROM p_receipt_key THEN
      RETURN jsonb_build_object('id', v_t.id, 'reference', v_t.reference, 'status', 'received', 'replayed', true);
    END IF;
    RAISE EXCEPTION 'transfer_already_received' USING ERRCODE = 'P0078',
      DETAIL = jsonb_build_object('received_at', v_t.received_at, 'received_by', v_t.received_by)::text;
  END IF;
  IF v_t.status <> 'sent' THEN RAISE EXCEPTION 'transfer_not_in_transit' USING ERRCODE = 'P0068'; END IF;
  SELECT name INTO v_src_name FROM shops WHERE id = v_t.source_shop_id;
  SELECT s.currency IS NOT DISTINCT FROM d.currency INTO v_same_cur FROM shops s, shops d WHERE s.id = v_t.source_shop_id AND d.id = p_dest;

  -- Toutes les lignes, chacune une seule fois, quantité entre 0 et le reste en transit
  IF EXISTS (SELECT 1 FROM stock_transfer_items i WHERE i.stock_transfer_id = p_transfer_id
               AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(coalesce(p_lines, '[]'::jsonb)) l WHERE nullif(l->>'item_id', '')::uuid = i.id))
     OR (SELECT count(*) FROM jsonb_array_elements(coalesce(p_lines, '[]'::jsonb))) <> (SELECT count(*) FROM stock_transfer_items WHERE stock_transfer_id = p_transfer_id) THEN
    RAISE EXCEPTION 'transfer_lines_incomplete' USING ERRCODE = 'P0080';
  END IF;

  -- Produits d'arrivée touchés verrouillés dans un ordre fixe
  SELECT array_agg(x) INTO v_ids FROM (
    SELECT nullif(l->>'destination_product_id', '')::uuid AS x FROM jsonb_array_elements(p_lines) l
    UNION SELECT destination_product_id FROM stock_transfer_items WHERE stock_transfer_id = p_transfer_id
  ) s WHERE x IS NOT NULL;
  PERFORM 1 FROM products WHERE id = ANY(v_ids) ORDER BY id FOR UPDATE;

  FOR v_it IN SELECT * FROM stock_transfer_items WHERE stock_transfer_id = p_transfer_id ORDER BY id FOR UPDATE LOOP
    SELECT l INTO v_line FROM jsonb_array_elements(p_lines) l WHERE nullif(l->>'item_id', '')::uuid = v_it.id LIMIT 1;
    SELECT coalesce(sum(quantity_in_transit), 0) INTO v_transit FROM stock_transfer_allocations WHERE item_id = v_it.id;
    v_r := coalesce(nullif(v_line->>'quantity_received', '')::int, -1);
    IF v_r < 0 OR v_r > v_transit THEN
      RAISE EXCEPTION 'invalid_quantity' USING ERRCODE = 'P0076', DETAIL = jsonb_build_object('product', v_it.product_name, 'max', v_transit)::text;
    END IF;
    v_m := v_transit - v_r;
    v_cat := CASE WHEN v_m > 0 AND v_line->>'discrepancy_category' IN ('transport_loss', 'theft', 'breakage', 'count_error', 'other')
                  THEN v_line->>'discrepancy_category' END;
    v_dest_pid := coalesce(nullif(v_line->>'destination_product_id', '')::uuid, v_it.destination_product_id);
    v_mv := NULL;

    IF v_r > 0 THEN
      IF v_dest_pid IS NOT NULL THEN
        SELECT quantity INTO v_prev FROM products WHERE id = v_dest_pid AND shop_id = p_dest;
        IF NOT FOUND THEN RAISE EXCEPTION 'destination_product_not_found' USING ERRCODE = 'P0070'; END IF;
      ELSE
        -- Nouveau produit à l'arrivée. Même devise : prix et coût de la source. Devises différentes : DÉSACTIVÉ,
        -- prix et coût à 0 (inconnus ; colonnes obligatoires) — le propriétaire fixe le prix puis l'active.
        INSERT INTO products (shop_id, name, unit, buying_price, selling_price, quantity, is_active)
          VALUES (p_dest, v_it.product_name, v_it.unit,
                  CASE WHEN v_same_cur THEN greatest(coalesce(v_it.buying_price, 0), 0) ELSE 0 END,
                  CASE WHEN v_same_cur THEN greatest(coalesce(v_it.selling_price, 0), 0) ELSE 0 END,
                  0, v_same_cur)
          RETURNING id, quantity INTO v_dest_pid, v_prev;
        v_created := v_created || jsonb_build_object('product_id', v_dest_pid, 'name', v_it.product_name, 'needs_price', NOT v_same_cur);
      END IF;
      UPDATE products SET quantity = v_prev + v_r, updated_at = now() WHERE id = v_dest_pid;
      INSERT INTO stock_movements (shop_id, product_id, type, quantity, previous_qty, new_qty, reason, performed_by, transfer_id)
        VALUES (p_dest, v_dest_pid, 'in', v_r, v_prev, v_prev + v_r, 'Transfert ' || v_t.reference || ' depuis ' || v_src_name, p_user, p_transfer_id)
        RETURNING id INTO v_mv;
    END IF;

    -- Répartition : reçu d'abord sur les allocations qui périment le plus tôt ; le manque sur les suivantes
    v_left := v_r;
    FOR v_a IN SELECT * FROM stock_transfer_allocations
                WHERE item_id = v_it.id AND quantity_in_transit > 0
                ORDER BY (coverage = 'batch') DESC, source_expiry_date ASC NULLS LAST, source_received_at ASC NULLS LAST, id
                FOR UPDATE LOOP
      v_take := least(v_a.quantity_in_transit, v_left);
      v_miss := v_a.quantity_in_transit - v_take;
      v_batch := NULL;
      IF v_take > 0 THEN
        -- Un lot d'arrivée par lot source reçu : même péremption (jamais inventée), coût du lot source si même devise
        INSERT INTO product_batches (shop_id, product_id, quantity, initial_quantity, buying_price, expiry_date, source, received_at,
                                     origin_transfer_id, origin_batch_id, origin_untracked)
          VALUES (p_dest, v_dest_pid, v_take, v_take,
                  CASE WHEN v_same_cur THEN v_a.unit_cost END,
                  CASE WHEN v_a.coverage = 'batch' THEN v_a.source_expiry_date END, 'transfer', now(),
                  p_transfer_id,
                  CASE WHEN v_a.coverage = 'batch' AND EXISTS (SELECT 1 FROM product_batches WHERE id = v_a.source_batch_id) THEN v_a.source_batch_id END,
                  v_a.coverage <> 'batch')
          RETURNING id INTO v_batch;
      END IF;
      UPDATE stock_transfer_allocations
         SET quantity_received = quantity_received + v_take, quantity_missing = quantity_missing + v_miss, destination_batch_id = coalesce(v_batch, destination_batch_id)
       WHERE id = v_a.id;
      v_left := v_left - v_take;
    END LOOP;

    -- Manque : écart enregistré à la SOURCE, aucun stock ne bouge
    IF v_m > 0 THEN
      INSERT INTO stock_movements (shop_id, product_id, type, quantity, previous_qty, new_qty, reason, notes, performed_by, transfer_id)
        VALUES (v_t.source_shop_id, v_it.source_product_id, 'transit_loss', v_m, NULL, NULL,
                'Transfert ' || v_t.reference || ' : manquant à la réception', nullif(btrim(v_line->>'discrepancy_detail'), ''), p_user, p_transfer_id);
    END IF;

    UPDATE stock_transfer_items
       SET quantity_received = v_r,
           destination_product_id = coalesce(v_dest_pid, destination_product_id),
           discrepancy_category = v_cat,
           discrepancy_detail = CASE WHEN v_m > 0 THEN nullif(left(btrim(coalesce(v_line->>'discrepancy_detail', '')), 300), '') END
     WHERE id = v_it.id;
    v_sent_tot := v_sent_tot + v_transit;
    v_recv_tot := v_recv_tot + v_r;
  END LOOP;

  UPDATE stock_transfers
     SET status = 'received', received_at = now(), received_by = p_user, receipt_key = p_receipt_key,
         has_discrepancy = (v_recv_tot < v_sent_tot), updated_at = now()
   WHERE id = p_transfer_id;
  UPDATE stock_transfer_tokens SET revoked_at = now() WHERE transfer_id = p_transfer_id AND revoked_at IS NULL;
  PERFORM _transfer_audit(p_dest, p_user, 'stock_transfer.receive', p_transfer_id,
    jsonb_build_object('reference', v_t.reference, 'sent', v_sent_tot, 'received', v_recv_tot, 'missing', v_sent_tot - v_recv_tot));
  RETURN jsonb_build_object('id', v_t.id, 'reference', v_t.reference, 'status', 'received', 'replayed', false,
                            'sent', v_sent_tot, 'received', v_recv_tot, 'missing', v_sent_tot - v_recv_tot, 'created_products', v_created);
END;
$function$

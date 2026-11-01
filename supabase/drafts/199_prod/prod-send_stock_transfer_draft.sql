CREATE OR REPLACE FUNCTION public.send_stock_transfer_draft(p_transfer_id uuid, p_source uuid, p_user uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_status    text;
  v_src       uuid;
  v_dest      uuid;
  v_ref       text;
  v_dest_name text;
  v_asof      date;
  v_it        record;
  v_p         record;
  v_s         record;
  v_left      int;
  v_b         record;
  v_take      int;
  v_units     int := 0;
BEGIN
  SELECT status, source_shop_id, destination_shop_id, reference INTO v_status, v_src, v_dest, v_ref
    FROM stock_transfers WHERE id = p_transfer_id FOR UPDATE;
  IF NOT FOUND OR v_src <> p_source THEN RAISE EXCEPTION 'transfer_not_found' USING ERRCODE = 'P0063'; END IF;
  IF v_status IN ('sent', 'received') THEN
    RETURN jsonb_build_object('id', p_transfer_id, 'reference', v_ref, 'status', v_status, 'already_sent', true);
  END IF;
  IF v_status <> 'draft' THEN RAISE EXCEPTION 'transfer_not_draft' USING ERRCODE = 'P0064'; END IF;
  PERFORM _transfer_check_shops(v_src, v_dest);
  SELECT name INTO v_dest_name FROM shops WHERE id = v_dest;
  v_asof := shop_business_date(v_src);          -- date métier de la boutique source (178)

  -- Produits verrouillés dans un ordre fixe (comme une vente : produit puis ses lots)
  PERFORM 1 FROM products
    WHERE id IN (SELECT source_product_id FROM stock_transfer_items WHERE stock_transfer_id = p_transfer_id)
    ORDER BY id FOR UPDATE;

  FOR v_it IN SELECT * FROM stock_transfer_items WHERE stock_transfer_id = p_transfer_id ORDER BY source_product_id LOOP
    SELECT id, quantity, buying_price, selling_price, name, unit INTO v_p
      FROM products WHERE id = v_it.source_product_id AND shop_id = v_src;
    IF NOT FOUND THEN RAISE EXCEPTION 'product_not_found' USING ERRCODE = 'P0066'; END IF;
    -- Transférable = vendable, MÊME règle que la caisse (lots périmés exclus, stock sans lot compris)
    SELECT * INTO v_s FROM sellable_stock(v_it.source_product_id, v_asof);
    IF v_s.sellable < v_it.quantity_sent THEN
      RAISE EXCEPTION 'insufficient_transferable_stock' USING ERRCODE = 'P0067', DETAIL = jsonb_build_object(
        'product', v_p.name, 'transferable', v_s.sellable, 'expired', v_s.expired, 'requested', v_it.quantity_sent)::text;
    END IF;

    UPDATE products SET quantity = v_p.quantity - v_it.quantity_sent, updated_at = now() WHERE id = v_it.source_product_id;
    INSERT INTO stock_movements (shop_id, product_id, type, quantity, previous_qty, new_qty, reason, performed_by, transfer_id)
      VALUES (v_src, v_it.source_product_id, 'out', v_it.quantity_sent, v_p.quantity, v_p.quantity - v_it.quantity_sent,
              'Transfert ' || v_ref || ' vers ' || v_dest_name, p_user, p_transfer_id);

    -- Lots : même choix que allocate_sale_batches (péremption croissante, sans date en dernier, puis réception ;
    -- lots périmés à la date métier EXCLUS)
    v_left := v_it.quantity_sent;
    FOR v_b IN SELECT id, quantity, expiry_date, buying_price, received_at FROM product_batches
                WHERE product_id = v_it.source_product_id AND quantity > 0
                  AND NOT coalesce(expiry_date < v_asof, false)
                ORDER BY expiry_date ASC NULLS LAST, received_at ASC
                FOR UPDATE LOOP
      EXIT WHEN v_left <= 0;
      v_take := least(v_b.quantity, v_left);
      UPDATE product_batches SET quantity = quantity - v_take, updated_at = now() WHERE id = v_b.id;
      INSERT INTO stock_transfer_allocations (transfer_id, item_id, coverage, source_batch_id, source_expiry_date, source_received_at, unit_cost, quantity_sent)
        VALUES (p_transfer_id, v_it.id, 'batch', v_b.id, v_b.expiry_date, v_b.received_at, CASE WHEN v_b.buying_price > 0 THEN v_b.buying_price END, v_take);
      v_left := v_left - v_take;
    END LOOP;
    -- Stock non couvert par un lot : il part tel quel, sans lot inventé ; coût = coût moyen actuel du produit (valeur
    -- tenue pour ce stock sans lot), inconnu s'il vaut 0
    IF v_left > 0 THEN
      INSERT INTO stock_transfer_allocations (transfer_id, item_id, coverage, unit_cost, quantity_sent)
        VALUES (p_transfer_id, v_it.id, 'uncovered', CASE WHEN v_p.buying_price > 0 THEN v_p.buying_price END, v_left);
    END IF;

    UPDATE stock_transfer_items SET product_name = v_p.name, unit = v_p.unit, buying_price = v_p.buying_price, selling_price = v_p.selling_price
     WHERE id = v_it.id;
    v_units := v_units + v_it.quantity_sent;
  END LOOP;

  UPDATE stock_transfers SET status = 'sent', sent_at = now(), sent_by = p_user, updated_at = now() WHERE id = p_transfer_id;
  INSERT INTO stock_transfer_tokens (transfer_id, token)
    VALUES (p_transfer_id, replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', ''))
    ON CONFLICT (transfer_id) DO NOTHING;
  PERFORM _transfer_audit(v_src, p_user, 'stock_transfer.send', p_transfer_id,
    jsonb_build_object('reference', v_ref, 'destination_shop_id', v_dest, 'units', v_units));
  RETURN jsonb_build_object('id', p_transfer_id, 'reference', v_ref, 'status', 'sent', 'already_sent', false);
END;
$function$

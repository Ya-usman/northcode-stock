CREATE OR REPLACE FUNCTION public.deduct_stock_on_sale()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  v_shop_id     uuid;
  v_cashier_id  uuid;
  v_sale_number text;
  v_sale_at     timestamptz;
  v_current_qty int;
  v_take        int;
  v_as_of       date;
  v_st          RECORD;
  v_allocs      jsonb;
  v_alloc       jsonb;
  v_allocated   int := 0;
  v_rest        int;
  v_unal        int;
  v_mode text := coalesce(current_setting('stockshop.stock_mode', true), '');
BEGIN
  IF new.product_id IS NULL OR v_mode = 'skip' THEN
    RETURN new;
  END IF;

  -- Verrou de la ligne produit avant lecture (anti-concurrence, migration 057)
  SELECT quantity INTO v_current_qty FROM products WHERE id = new.product_id FOR UPDATE;
  IF v_current_qty IS NULL THEN
    RETURN new;
  END IF;

  SELECT s.shop_id, s.cashier_id, s.sale_number, s.created_at
    INTO v_shop_id, v_cashier_id, v_sale_number, v_sale_at
    FROM sales s WHERE s.id = new.sale_id;

  -- Date métier DE LA VENTE (hors ligne : instant réel de la vente), seulement si un lot daté existe
  IF EXISTS (SELECT 1 FROM product_batches WHERE product_id = new.product_id AND quantity > 0 AND expiry_date IS NOT NULL) THEN
    v_as_of := shop_business_date(v_shop_id, v_sale_at);
  END IF;
  SELECT * INTO v_st FROM sellable_stock(new.product_id, v_as_of);

  IF v_current_qty < new.quantity THEN
    IF v_mode = 'offline' THEN
      v_take := greatest(v_current_qty, 0);
      UPDATE sale_items SET stock_shortfall = new.quantity - v_take WHERE id = new.id;
    ELSE
      RAISE EXCEPTION 'Stock insuffisant pour le produit % (disponible: %, demandé: %)',
        new.product_id, v_current_qty, new.quantity
        USING ERRCODE = 'P0001';
    END IF;
  ELSE
    v_take := new.quantity;
  END IF;

  -- En ligne : jamais au-delà du VENDABLE. Hors ligne : la vente a eu lieu, jamais refusée ici.
  IF v_mode <> 'offline' AND new.quantity > v_st.sellable THEN
    RAISE EXCEPTION 'sellable_insufficient'
      USING ERRCODE = 'P0030',
            DETAIL = json_build_object('product_id', new.product_id, 'sellable', v_st.sellable,
                                       'non_sellable', v_st.non_sellable, 'requested', new.quantity)::text;
  END IF;

  IF v_take > 0 THEN
    UPDATE products SET quantity = quantity - v_take, updated_at = now() WHERE id = new.product_id;

    -- 1) lots frais (FEFO) ; jamais un lot périmé
    v_allocs := allocate_sale_batches(new.product_id, v_take, v_as_of);
    FOR v_alloc IN SELECT * FROM jsonb_array_elements(v_allocs) LOOP
      INSERT INTO sale_item_batches (sale_item_id, batch_id, quantity)
      VALUES (new.id, (v_alloc->>'batch_id')::uuid, (v_alloc->>'quantity')::int);
      v_allocated := v_allocated + (v_alloc->>'quantity')::int;
    END LOOP;

    -- 2) stock historique sans lot : couvert, aucune alerte (comportement historique)
    -- 3) reste : sortie impossible à attribuer à cause des périmés → écart de lot EXPLICITE (jamais inventé)
    v_rest := v_take - v_allocated;
    v_unal := greatest(v_rest - v_st.untracked, 0);
    IF v_unal > 0 THEN
      UPDATE sale_items SET batch_unallocated = v_unal WHERE id = new.id;
      UPDATE sales SET review_reason = concat_ws(',', NULLIF(review_reason, ''), 'expired_stock_unresolved')
        WHERE id = new.sale_id AND coalesce(review_reason, '') NOT LIKE '%expired_stock_unresolved%';
    END IF;

    INSERT INTO stock_movements (shop_id, product_id, type, quantity, reason, performed_by)
    VALUES (v_shop_id, new.product_id, 'sale', v_take, 'Sale ' || v_sale_number, v_cashier_id);
  END IF;

  RETURN new;
END;
$function$

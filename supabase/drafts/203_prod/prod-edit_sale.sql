CREATE OR REPLACE FUNCTION public.edit_sale(p_sale_id uuid, p_edited_by uuid, p_customer_id uuid, p_payment_method text, p_notes text, p_items jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_sale         RECORD;
  v_elem         JSONB;
  v_new_sub      NUMERIC := 0;
  v_new_total    NUMERIC;
  v_new_bal      NUMERIC;
  v_new_status   TEXT;
  v_prod_id      UUID;
  v_old_prices   JSONB;
  v_buying_price NUMERIC;
  v_new_item_id  UUID;
  v_old          JSONB;
  v_new_qty      JSONB;
  v_plan         JSONB := '{}'::jsonb;
  v_pid          UUID;
  v_o            JSONB;
  v_old_q        INT;
  v_short        INT;
  v_unal         INT;
  v_allocs       JSONB;
  v_alloc_sum    INT;
  v_untracked    INT;
  v_new_q        INT;
  v_r            INT;
  v_d            INT;
  v_back         INT;
  v_i            INT;
  v_cur          INT;
  v_as_of        DATE;
  v_st           RECORD;
  v_got          JSONB;
  v_got_sum      INT;
  v_a            JSONB;
  v_rest         JSONB;
  v_kept         JSONB;
  v_cap          INT;
  v_put          INT;
  v_line_short   INT;
  v_line_unal    INT;
  v_line_allocs  JSONB;
  v_add_unal     INT;
  v_flag         BOOLEAN := false;
BEGIN
  SELECT * INTO v_sale FROM sales WHERE id = p_sale_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Vente introuvable' USING ERRCODE = 'P0002';
  END IF;
  IF v_sale.sale_status = 'cancelled' THEN
    RAISE EXCEPTION 'Vente annulée, modification impossible' USING ERRCODE = 'P0003';
  END IF;
  IF JSONB_ARRAY_LENGTH(p_items) = 0 THEN
    RAISE EXCEPTION 'La vente doit avoir au moins un article' USING ERRCODE = 'P0004';
  END IF;

  IF v_sale.customer_id IS NOT NULL AND v_sale.balance > 0 THEN
    UPDATE customers SET total_debt = greatest(0, total_debt - v_sale.balance) WHERE id = v_sale.customer_id;
  END IF;

  SELECT COALESCE(JSONB_OBJECT_AGG(product_id, buying_price), '{}'::JSONB)
    INTO v_old_prices FROM sale_items WHERE sale_id = p_sale_id AND product_id IS NOT NULL;

  -- État connu AVANT modification, par produit (ordre de restitution : allocations sans lot, puis inverse du FEFO)
  SELECT COALESCE(JSONB_OBJECT_AGG(x.pid, x.st), '{}'::JSONB) INTO v_old FROM (
    SELECT si.product_id AS pid, JSONB_BUILD_OBJECT(
      'q', SUM(si.quantity), 'short', SUM(si.stock_shortfall), 'unal', SUM(si.batch_unallocated),
      'allocs', COALESCE((
        SELECT JSONB_AGG(JSONB_BUILD_OBJECT('batch_id', sib.batch_id, 'quantity', sib.quantity)
                         ORDER BY (sib.batch_id IS NOT NULL), b.expiry_date DESC NULLS FIRST, b.received_at DESC, sib.created_at DESC)
        FROM sale_item_batches sib
        JOIN sale_items s2 ON s2.id = sib.sale_item_id
        LEFT JOIN product_batches b ON b.id = sib.batch_id
        WHERE s2.sale_id = p_sale_id AND s2.product_id = si.product_id), '[]'::JSONB)) AS st
    FROM sale_items si WHERE si.sale_id = p_sale_id AND si.product_id IS NOT NULL
    GROUP BY si.product_id) x;

  SELECT COALESCE(JSONB_OBJECT_AGG(y.pid, y.q), '{}'::JSONB) INTO v_new_qty FROM (
    SELECT NULLIF(e->>'product_id', '')::UUID AS pid, SUM((e->>'quantity')::INT) AS q
    FROM JSONB_ARRAY_ELEMENTS(p_items) e WHERE NULLIF(e->>'product_id', '') IS NOT NULL GROUP BY 1) y;

  FOR v_pid IN
    SELECT k::UUID FROM (SELECT JSONB_OBJECT_KEYS(v_old) AS k UNION SELECT JSONB_OBJECT_KEYS(v_new_qty)) z ORDER BY 1
  LOOP
    v_o := COALESCE(v_old->(v_pid::TEXT), '{"q":0,"short":0,"unal":0,"allocs":[]}'::JSONB);
    v_old_q := (v_o->>'q')::INT;
    v_short := (v_o->>'short')::INT;
    v_unal := (v_o->>'unal')::INT;
    v_allocs := v_o->'allocs';
    SELECT COALESCE(SUM((a->>'quantity')::INT), 0) INTO v_alloc_sum FROM JSONB_ARRAY_ELEMENTS(v_allocs) a;
    v_untracked := GREATEST(v_old_q - v_short - v_unal - v_alloc_sum, 0);
    v_new_q := COALESCE((v_new_qty->>(v_pid::TEXT))::INT, 0);

    SELECT quantity INTO v_cur FROM products WHERE id = v_pid FOR UPDATE;

    IF v_new_q < v_old_q THEN
      v_r := v_old_q - v_new_q;
      v_back := 0;
      v_d := LEAST(v_r, v_short);     v_short := v_short - v_d;         v_r := v_r - v_d;
      v_d := LEAST(v_r, v_untracked); v_untracked := v_untracked - v_d; v_r := v_r - v_d; v_back := v_back + v_d;
      v_d := LEAST(v_r, v_unal);      v_unal := v_unal - v_d;           v_r := v_r - v_d; v_back := v_back + v_d;
      v_rest := '[]'::JSONB;
      FOR v_a IN SELECT * FROM JSONB_ARRAY_ELEMENTS(v_allocs) LOOP
        v_d := LEAST(v_r, (v_a->>'quantity')::INT);
        IF v_d > 0 THEN
          IF NULLIF(v_a->>'batch_id', '') IS NOT NULL THEN
            UPDATE product_batches SET quantity = quantity + v_d, updated_at = now() WHERE id = (v_a->>'batch_id')::UUID;
          END IF;
          v_back := v_back + v_d;
          v_r := v_r - v_d;
        END IF;
        IF (v_a->>'quantity')::INT - v_d > 0 THEN
          v_rest := v_rest || JSONB_BUILD_OBJECT('batch_id', v_a->'batch_id', 'quantity', (v_a->>'quantity')::INT - v_d);
        END IF;
      END LOOP;
      v_allocs := v_rest;
      IF v_back > 0 AND v_cur IS NOT NULL THEN
        UPDATE products SET quantity = quantity + v_back, updated_at = now() WHERE id = v_pid;
        INSERT INTO stock_movements(shop_id, product_id, type, quantity, reason, performed_by)
        VALUES (v_sale.shop_id, v_pid, 'in', v_back, 'Modification vente #' || v_sale.sale_number, p_edited_by);
      END IF;

    ELSIF v_new_q > v_old_q AND v_cur IS NOT NULL THEN
      v_i := v_new_q - v_old_q;
      v_as_of := NULL;
      IF EXISTS (SELECT 1 FROM product_batches WHERE product_id = v_pid AND quantity > 0 AND expiry_date IS NOT NULL) THEN
        v_as_of := shop_business_date(v_sale.shop_id, now());   -- date de la MODIFICATION
      END IF;
      SELECT * INTO v_st FROM sellable_stock(v_pid, v_as_of);
      IF v_cur < v_i THEN
        RAISE EXCEPTION 'Stock insuffisant pour le produit % (disponible: %, demandé: %)', v_pid, v_cur, v_i
          USING ERRCODE = 'P0001';
      END IF;
      IF v_i > v_st.sellable THEN
        RAISE EXCEPTION 'sellable_insufficient'
          USING ERRCODE = 'P0030',
                DETAIL = json_build_object('product_id', v_pid, 'sellable', v_st.sellable,
                                           'non_sellable', v_st.non_sellable, 'requested', v_i)::text;
      END IF;
      UPDATE products SET quantity = quantity - v_i, updated_at = now() WHERE id = v_pid;
      v_got := allocate_sale_batches(v_pid, v_i, v_as_of);
      SELECT COALESCE(SUM((a->>'quantity')::INT), 0) INTO v_got_sum FROM JSONB_ARRAY_ELEMENTS(v_got) a;
      v_allocs := v_allocs || v_got;
      -- reste couvert par le stock sans lot ; au-delà (impossible ici puisque i ≤ sellable) → écart explicite
      v_add_unal := GREATEST(v_i - v_got_sum - v_st.untracked, 0);
      IF v_add_unal > 0 THEN
        v_unal := v_unal + v_add_unal;
        v_flag := true;
      END IF;
      INSERT INTO stock_movements(shop_id, product_id, type, quantity, reason, performed_by)
      VALUES (v_sale.shop_id, v_pid, 'sale', v_i, 'Modification vente #' || v_sale.sale_number, p_edited_by);
    END IF;

    v_plan := v_plan || JSONB_BUILD_OBJECT(v_pid::TEXT, JSONB_BUILD_OBJECT('short', v_short, 'unal', v_unal, 'allocs', v_allocs));
  END LOOP;

  DELETE FROM sale_items WHERE sale_id = p_sale_id;   -- sale_item_batches suivent (ON DELETE CASCADE)

  -- Le stock a été ajusté ci-dessus : le déclencheur se tait
  PERFORM set_config('stockshop.stock_mode', 'skip', true);

  FOR v_elem IN SELECT * FROM JSONB_ARRAY_ELEMENTS(p_items) LOOP
    v_new_sub := v_new_sub + (v_elem->>'quantity')::INT * (v_elem->>'unit_price')::NUMERIC;
    v_prod_id := NULLIF(v_elem->>'product_id', '')::UUID;

    IF v_prod_id IS NOT NULL THEN
      IF v_old_prices ? v_prod_id::TEXT THEN
        v_buying_price := (v_old_prices->>(v_prod_id::TEXT))::NUMERIC;
      ELSE
        SELECT buying_price INTO v_buying_price FROM products WHERE id = v_prod_id;
      END IF;
    ELSE
      v_buying_price := 0;
    END IF;

    -- Composantes conservées de ce produit reportées sur ses lignes (dans l'ordre des lignes)
    v_line_short := 0; v_line_unal := 0; v_line_allocs := '[]'::JSONB;
    IF v_prod_id IS NOT NULL AND v_plan ? v_prod_id::TEXT THEN
      v_kept := v_plan->(v_prod_id::TEXT);
      v_cap := (v_elem->>'quantity')::INT;
      v_line_short := LEAST(v_cap, (v_kept->>'short')::INT); v_cap := v_cap - v_line_short;
      v_line_unal := LEAST(v_cap, (v_kept->>'unal')::INT);   v_cap := v_cap - v_line_unal;
      v_rest := '[]'::JSONB;
      FOR v_a IN SELECT * FROM JSONB_ARRAY_ELEMENTS(v_kept->'allocs') LOOP
        v_put := LEAST(v_cap, (v_a->>'quantity')::INT);
        IF v_put > 0 THEN
          v_line_allocs := v_line_allocs || JSONB_BUILD_OBJECT('batch_id', v_a->'batch_id', 'quantity', v_put);
          v_cap := v_cap - v_put;
        END IF;
        IF (v_a->>'quantity')::INT - v_put > 0 THEN
          v_rest := v_rest || JSONB_BUILD_OBJECT('batch_id', v_a->'batch_id', 'quantity', (v_a->>'quantity')::INT - v_put);
        END IF;
      END LOOP;
      v_plan := JSONB_SET(v_plan, ARRAY[v_prod_id::TEXT], JSONB_BUILD_OBJECT(
        'short', (v_kept->>'short')::INT - v_line_short, 'unal', (v_kept->>'unal')::INT - v_line_unal, 'allocs', v_rest));
    END IF;

    INSERT INTO sale_items(sale_id, product_id, product_name, quantity, unit_price, buying_price, stock_shortfall, batch_unallocated)
    VALUES (p_sale_id, v_prod_id, v_elem->>'product_name', (v_elem->>'quantity')::INT, (v_elem->>'unit_price')::NUMERIC,
            COALESCE(v_buying_price, 0), v_line_short, v_line_unal)
    RETURNING id INTO v_new_item_id;

    FOR v_a IN SELECT * FROM JSONB_ARRAY_ELEMENTS(v_line_allocs) LOOP
      INSERT INTO sale_item_batches (sale_item_id, batch_id, quantity)
      VALUES (v_new_item_id, NULLIF(v_a->>'batch_id', '')::UUID, (v_a->>'quantity')::INT);
    END LOOP;
  END LOOP;

  PERFORM set_config('stockshop.stock_mode', '', true);

  IF v_flag THEN
    UPDATE sales SET review_reason = concat_ws(',', NULLIF(review_reason, ''), 'expired_stock_unresolved')
      WHERE id = p_sale_id AND coalesce(review_reason, '') NOT LIKE '%expired_stock_unresolved%';
  END IF;

  v_new_total := v_new_sub - COALESCE(v_sale.discount, 0) + COALESCE(v_sale.tax, 0);
  IF v_new_total < 0 THEN v_new_total := 0; END IF;

  IF v_sale.amount_paid > v_new_total THEN
    RAISE EXCEPTION 'Le montant déjà encaissé (%) dépasse le nouveau total (%)', v_sale.amount_paid, v_new_total USING ERRCODE = 'P0005';
  END IF;

  v_new_bal := v_new_total - v_sale.amount_paid;
  IF v_new_bal <= 0 THEN
    v_new_status := 'paid'; v_new_bal := 0;
  ELSIF v_sale.amount_paid > 0 THEN
    v_new_status := 'partial';
  ELSE
    v_new_status := 'pending';
  END IF;

  UPDATE sales SET
    customer_id = p_customer_id, payment_method = p_payment_method, notes = p_notes,
    subtotal = v_new_sub, total = v_new_total, payment_status = v_new_status
  WHERE id = p_sale_id;

  IF p_customer_id IS NOT NULL AND v_new_bal > 0 THEN
    UPDATE customers SET total_debt = total_debt + v_new_bal WHERE id = p_customer_id;
  END IF;

  RETURN JSONB_BUILD_OBJECT('new_total', v_new_total, 'new_balance', v_new_bal, 'new_status', v_new_status);
END;
$function$
;

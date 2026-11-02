CREATE OR REPLACE FUNCTION public.complete_sale(p_shop_id uuid, p_cashier_id uuid, p_customer_id uuid, p_customer_name text, p_customer_phone text, p_subtotal numeric, p_discount numeric, p_tax numeric, p_total numeric, p_payment_method text, p_notes text, p_paystack_reference text, p_client_request_id text, p_items jsonb, p_payments jsonb, p_due_date date DEFAULT NULL::date, p_created_at timestamp with time zone DEFAULT NULL::timestamp with time zone, p_receipt_token text DEFAULT NULL::text, p_review_reason text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_sale_id         uuid;
  v_customer_id     uuid;
  v_already_existed boolean := false;
  v_payments_total  numeric := 0;
  v_sale            sales%ROWTYPE;
  v_items_json      jsonb;
  v_customer_json   jsonb;
  v_at              timestamptz := coalesce(p_created_at, now());
BEGIN
  IF p_client_request_id IS NULL OR length(trim(p_client_request_id)) = 0 THEN
    RAISE EXCEPTION 'client_request_id requis' USING ERRCODE = 'P0010';
  END IF;
  IF p_items IS NULL OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'La vente doit avoir au moins un article' USING ERRCODE = 'P0004';
  END IF;

  -- Déjà enregistrée (réponse perdue, renvoi de l'appareil) : on la renvoie telle quelle
  SELECT id INTO v_sale_id FROM sales WHERE client_request_id = p_client_request_id;
  IF FOUND THEN
    v_already_existed := true;
  END IF;

  IF NOT v_already_existed THEN
    v_customer_id := p_customer_id;
    IF v_customer_id IS NOT NULL THEN
      PERFORM 1 FROM customers WHERE id = v_customer_id AND shop_id = p_shop_id;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'Client invalide pour cette boutique' USING ERRCODE = 'P0006';
      END IF;
    ELSIF p_customer_name IS NOT NULL AND length(trim(p_customer_name)) > 0 THEN
      IF p_customer_phone IS NOT NULL AND length(trim(p_customer_phone)) > 0 THEN
        SELECT id INTO v_customer_id FROM customers WHERE shop_id = p_shop_id AND phone = trim(p_customer_phone) LIMIT 1;
      END IF;
      IF v_customer_id IS NULL THEN
        INSERT INTO customers (shop_id, name, phone)
        VALUES (p_shop_id, trim(p_customer_name), NULLIF(trim(p_customer_phone), ''))
        RETURNING id INTO v_customer_id;
      END IF;
    END IF;

    IF EXISTS (
      SELECT 1 FROM jsonb_array_elements(p_items) elem
      WHERE NULLIF(elem->>'product_id', '') IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM products p WHERE p.id = (elem->>'product_id')::uuid AND p.shop_id = p_shop_id)
    ) THEN
      RAISE EXCEPTION 'Produit invalide pour cette boutique' USING ERRCODE = 'P0008';
    END IF;

    IF p_payments IS NOT NULL AND jsonb_array_length(p_payments) > 0 THEN
      SELECT COALESCE(SUM((elem->>'amount')::numeric), 0) INTO v_payments_total FROM jsonb_array_elements(p_payments) elem;
      IF v_payments_total > p_total + 0.01 THEN
        RAISE EXCEPTION 'Le total des paiements (%) dépasse le total de la vente (%)', v_payments_total, p_total USING ERRCODE = 'P0007';
      END IF;
    END IF;

    BEGIN
      INSERT INTO sales (
        shop_id, customer_id, cashier_id, subtotal, discount, tax, total,
        payment_method, payment_status, amount_paid, sale_status, notes,
        paystack_reference, client_request_id, due_date, created_at, receipt_token, review_reason
      ) VALUES (
        p_shop_id, v_customer_id, p_cashier_id, p_subtotal, p_discount, p_tax, p_total,
        p_payment_method, 'pending', 0, 'active', p_notes,
        p_paystack_reference, p_client_request_id, p_due_date, v_at,
        coalesce(NULLIF(trim(p_receipt_token), ''), gen_receipt_token()), NULLIF(trim(p_review_reason), '')
      )
      RETURNING id INTO v_sale_id;
    EXCEPTION WHEN unique_violation THEN
      SELECT id INTO v_sale_id FROM sales WHERE client_request_id = p_client_request_id;
      IF v_sale_id IS NULL THEN
        RAISE;
      END IF;
      v_already_existed := true;
    END;
  END IF;

  IF NOT v_already_existed THEN
    -- Vente hors ligne : le stock manquant ne bloque pas, l'écart est noté (déclencheur)
    IF p_created_at IS NOT NULL THEN
      PERFORM set_config('stockshop.stock_mode', 'offline', true);
    END IF;

    -- Un seul INSERT multi-lignes : tout ou rien avec la vente
    INSERT INTO sale_items (sale_id, product_id, product_name, quantity, unit_price, buying_price, original_price)
    SELECT
      v_sale_id,
      NULLIF(elem->>'product_id', '')::uuid,
      elem->>'product_name',
      (elem->>'quantity')::int,
      (elem->>'unit_price')::numeric,
      COALESCE((elem->>'buying_price')::numeric, 0),
      NULLIF(elem->>'original_price', '')::numeric
    FROM jsonb_array_elements(p_items) elem;

    PERFORM set_config('stockshop.stock_mode', '', true);

    -- 198 : numéros de série des produits suivis (en ligne : refus si incomplet ou invalide ; hors ligne : jamais
    -- refusé, vente « à vérifier » si un numéro manque ou est inconnu)
    IF assign_sale_serials(v_sale_id, p_shop_id, p_items, p_created_at IS NOT NULL, v_at) THEN
      UPDATE sales
        SET review_reason = concat_ws(',', NULLIF(review_reason, ''), 'serial_unresolved')
        WHERE id = v_sale_id;
    END IF;

    -- Écart de stock → vente à vérifier
    IF EXISTS (SELECT 1 FROM sale_items WHERE sale_id = v_sale_id AND stock_shortfall > 0) THEN
      UPDATE sales
        SET review_reason = concat_ws(',', NULLIF(review_reason, ''), 'stock_shortfall')
        WHERE id = v_sale_id;
    END IF;

    IF p_payments IS NOT NULL AND jsonb_array_length(p_payments) > 0 THEN
      INSERT INTO payments (sale_id, amount, method, reference, received_by, paid_at)
      SELECT v_sale_id, (elem->>'amount')::numeric, elem->>'method', NULLIF(elem->>'reference', ''), p_cashier_id, v_at
      FROM jsonb_array_elements(p_payments) elem
      WHERE (elem->>'amount')::numeric > 0;
    END IF;
  END IF;

  SELECT * INTO v_sale FROM sales WHERE id = v_sale_id;
  SELECT COALESCE(jsonb_agg(to_jsonb(si) ORDER BY si.id), '[]'::jsonb) INTO v_items_json FROM sale_items si WHERE si.sale_id = v_sale_id;
  SELECT to_jsonb(c) INTO v_customer_json FROM customers c WHERE c.id = v_sale.customer_id;

  RETURN jsonb_build_object(
    'sale', to_jsonb(v_sale) || jsonb_build_object('sale_items', v_items_json, 'customers', v_customer_json),
    'already_existed', v_already_existed
  );
END;
$function$
;

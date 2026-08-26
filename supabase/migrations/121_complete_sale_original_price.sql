-- ============================================================
-- 121 — complete_sale() : transmet original_price (120)
-- ============================================================
-- Reprend exactement complete_sale() telle que redéfinie par la migration
-- 110 (signature p_client_request_id en text) — seul changement : l'INSERT
-- dans sale_items lit désormais elem->>'original_price' (nullable, absent
-- ou égal à unit_price = rien à signaler sur le reçu). Aucune autre ligne
-- ni logique de la fonction ne change ; pas de DROP nécessaire puisque la
-- signature des paramètres reste identique.

CREATE OR REPLACE FUNCTION complete_sale(
  p_shop_id            uuid,
  p_cashier_id         uuid,
  p_customer_id        uuid,          -- client déjà sélectionné, NULL sinon
  p_customer_name      text,          -- renseigné seulement si pas de p_customer_id
  p_customer_phone     text,
  p_subtotal           numeric,
  p_discount           numeric,
  p_tax                numeric,
  p_total              numeric,
  p_payment_method     text,
  p_notes              text,
  p_paystack_reference text,
  p_client_request_id  text,          -- text, pas uuid — voir migration 099
  p_items              jsonb,         -- [{product_id, product_name, quantity, unit_price, buying_price, original_price}]
  p_payments           jsonb          -- [{amount, method, reference}] — pour CETTE vente uniquement
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sale_id         uuid;
  v_customer_id     uuid;
  v_already_existed boolean := false;
  v_payments_total  numeric := 0;
  v_sale            sales%ROWTYPE;
  v_items_json      jsonb;
  v_customer_json   jsonb;
BEGIN
  IF p_client_request_id IS NULL OR length(trim(p_client_request_id)) = 0 THEN
    RAISE EXCEPTION 'client_request_id requis' USING ERRCODE = 'P0010';
  END IF;
  IF p_items IS NULL OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'La vente doit avoir au moins un article' USING ERRCODE = 'P0004';
  END IF;

  -- Raccourci : cette tentative de paiement a déjà été enregistrée
  -- (réponse perdue à un timeout/coupure réseau précédent).
  SELECT id INTO v_sale_id FROM sales WHERE client_request_id = p_client_request_id;
  IF FOUND THEN
    v_already_existed := true;
  END IF;

  IF NOT v_already_existed THEN
    -- ── Résolution / création du client ────────────────────────────────
    v_customer_id := p_customer_id;
    IF v_customer_id IS NOT NULL THEN
      PERFORM 1 FROM customers WHERE id = v_customer_id AND shop_id = p_shop_id;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'Client invalide pour cette boutique' USING ERRCODE = 'P0006';
      END IF;
    ELSIF p_customer_name IS NOT NULL AND length(trim(p_customer_name)) > 0 THEN
      IF p_customer_phone IS NOT NULL AND length(trim(p_customer_phone)) > 0 THEN
        SELECT id INTO v_customer_id FROM customers
          WHERE shop_id = p_shop_id AND phone = trim(p_customer_phone)
          LIMIT 1;
      END IF;
      IF v_customer_id IS NULL THEN
        INSERT INTO customers (shop_id, name, phone)
        VALUES (p_shop_id, trim(p_customer_name), NULLIF(trim(p_customer_phone), ''))
        RETURNING id INTO v_customer_id;
      END IF;
    END IF;

    -- ── Garde-fou : chaque produit référencé appartient à cette boutique ──
    IF EXISTS (
      SELECT 1 FROM jsonb_array_elements(p_items) elem
      WHERE NULLIF(elem->>'product_id', '') IS NOT NULL
        AND NOT EXISTS (
          SELECT 1 FROM products p
          WHERE p.id = (elem->>'product_id')::uuid AND p.shop_id = p_shop_id
        )
    ) THEN
      RAISE EXCEPTION 'Produit invalide pour cette boutique' USING ERRCODE = 'P0008';
    END IF;

    -- ── Insertion de la vente ──────────────────────────────────────────
    BEGIN
      INSERT INTO sales (
        shop_id, customer_id, cashier_id, subtotal, discount, tax, total,
        payment_method, payment_status, amount_paid, sale_status, notes,
        paystack_reference, client_request_id
      ) VALUES (
        p_shop_id, v_customer_id, p_cashier_id, p_subtotal, p_discount, p_tax, p_total,
        p_payment_method, 'pending', 0, 'active', p_notes,
        p_paystack_reference, p_client_request_id
      )
      RETURNING id INTO v_sale_id;
    EXCEPTION WHEN unique_violation THEN
      -- Les collisions de sale_number sont déjà entièrement gérées DANS la
      -- boucle du déclencheur BEFORE INSERT (set_sale_number, 029) — donc
      -- seule sales_client_request_id_unique peut lever ici : double envoi
      -- quasi simultané avec la même clé.
      SELECT id INTO v_sale_id FROM sales WHERE client_request_id = p_client_request_id;
      IF v_sale_id IS NULL THEN
        RAISE;
      END IF;
      v_already_existed := true;
    END;
  END IF;

  IF NOT v_already_existed THEN
    -- ── Articles ───────────────────────────────────────────────────────
    -- Un seul INSERT multi-lignes = une seule instruction atomique : si
    -- deduct_stock_on_sale lève sur une ligne (stock insuffisant), toute la
    -- fonction (vente comprise) fait rollback — plus de vente "orpheline"
    -- sans articles, possible aujourd'hui puisque c'était 2 requêtes REST
    -- séparées.
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

    -- ── Paiement(s) pour cette vente ───────────────────────────────────
    IF p_payments IS NOT NULL AND jsonb_array_length(p_payments) > 0 THEN
      SELECT COALESCE(SUM((elem->>'amount')::numeric), 0) INTO v_payments_total
        FROM jsonb_array_elements(p_payments) elem;
      IF v_payments_total > p_total + 0.01 THEN
        RAISE EXCEPTION 'Le total des paiements (%) dépasse le total de la vente (%)',
          v_payments_total, p_total USING ERRCODE = 'P0007';
      END IF;

      INSERT INTO payments (sale_id, amount, method, reference, received_by)
      SELECT
        v_sale_id,
        (elem->>'amount')::numeric,
        elem->>'method',
        NULLIF(elem->>'reference', ''),
        p_cashier_id
      FROM jsonb_array_elements(p_payments) elem
      WHERE (elem->>'amount')::numeric > 0;
    END IF;
  END IF;

  -- ── Vente complète pour le reçu — remplace l'ancienne relecture finale ──
  SELECT * INTO v_sale FROM sales WHERE id = v_sale_id;

  SELECT COALESCE(jsonb_agg(to_jsonb(si) ORDER BY si.id), '[]'::jsonb)
    INTO v_items_json
    FROM sale_items si WHERE si.sale_id = v_sale_id;

  SELECT to_jsonb(c) INTO v_customer_json
    FROM customers c WHERE c.id = v_sale.customer_id;

  RETURN jsonb_build_object(
    'sale', to_jsonb(v_sale) || jsonb_build_object(
      'sale_items', v_items_json,
      'customers', v_customer_json
    ),
    'already_existed', v_already_existed
  );
END;
$$;

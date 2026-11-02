-- ============================================================
-- 203 : mesures de vente (riz au verre, à la boîte, au kilo, au seau, au sac…) — 2 nov. 2026, plan validé
-- ============================================================
-- Le stock d'un produit est compté dans la PLUS PETITE mesure vendue (ex. : le verre), toujours en nombres entiers.
-- Le produit peut se vendre AUSSI en mesures plus grandes, chacune avec son contenu (en mesures de base) et son prix,
-- fixé librement (pas forcément proportionnel), comme au marché :
--   products.sale_measures jsonb : NULL, ou 1 à 5 objets { "key", "label"?, "units", "price" }
--     key   : mesure de la liste (glass, cup, box, pack, sachet, heap, bowl, half_kg, kg, bag, bottle, litre, bucket)
--             ou « custom » avec un label libre (1 à 20 caractères)
--     units : contenu en mesures de base, entier de 2 à 100 000 ; price : > 0 ; jamais deux fois la même mesure.
-- Une ligne de vente garde la mesure vendue (ticket : « 3 boîtes de riz », jamais « 9 verres ») :
--   sale_items.measure_key, measure_label, measure_qty (nombre de mesures), measure_units (contenu d'une mesure)
--   et toujours quantity = measure_qty × measure_units (stock, lots, marges inchangés : tout reste en mesure de base).
-- complete_sale : la version EN PRODUCTION (supabase/drafts/203_prod/prod-complete_sale.sql, 198 comprise) avec, en
-- plus, les 4 colonnes de mesure lues dans chaque ligne (absentes = NULL, vente comme avant). Rien d'autre ne change.
-- Le prix d'une mesure est contrôlé par le serveur avant l'enregistrement (lib/api/sale-validation), comme le prix
-- minimum. Ré-exécutable. Retour arrière : supabase/rollbacks/203_sale_measures_rollback.sql
-- ============================================================

SET LOCAL lock_timeout = '5s';

-- ── 1. Mesures d'un produit ─────────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.valid_sale_measures(m jsonb)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = pg_catalog
AS $$
  SELECT m IS NULL OR (
    jsonb_typeof(m) = 'array'
    AND jsonb_array_length(m) BETWEEN 1 AND 5
    AND NOT EXISTS (
      SELECT 1 FROM jsonb_array_elements(m) e
      WHERE jsonb_typeof(e) <> 'object'
         OR jsonb_typeof(e -> 'key') IS DISTINCT FROM 'string'
         OR NOT ((e ->> 'key') = ANY (ARRAY['glass','cup','box','pack','sachet','heap','bowl','half_kg','kg','bag','bottle','litre','bucket','custom']))
         OR ((e ->> 'key') = 'custom' AND (jsonb_typeof(e -> 'label') IS DISTINCT FROM 'string' OR char_length(btrim(e ->> 'label')) NOT BETWEEN 1 AND 20))
         OR jsonb_typeof(e -> 'units') IS DISTINCT FROM 'number'
         OR jsonb_typeof(e -> 'price') IS DISTINCT FROM 'number'
         OR (e ->> 'units')::numeric <> trunc((e ->> 'units')::numeric)
         OR (e ->> 'units')::numeric < 2 OR (e ->> 'units')::numeric > 100000
         OR (e ->> 'price')::numeric <= 0
    )
    -- jamais deux fois la même mesure (même clé, et même libellé pour les mesures libres)
    AND (SELECT count(*) FROM jsonb_array_elements(m))
      = (SELECT count(DISTINCT (e ->> 'key') || '|' || lower(coalesce(btrim(e ->> 'label'), ''))) FROM jsonb_array_elements(m) e)
  )
$$;

ALTER TABLE public.products ADD COLUMN IF NOT EXISTS sale_measures jsonb;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'products_sale_measures_check' AND conrelid = 'public.products'::regclass) THEN
    ALTER TABLE public.products ADD CONSTRAINT products_sale_measures_check CHECK (public.valid_sale_measures(sale_measures));
  END IF;
END $$;
GRANT SELECT (sale_measures) ON public.products TO authenticated;
REVOKE ALL ON FUNCTION public.valid_sale_measures(jsonb) FROM PUBLIC, anon;

-- ── 2. Mesure vendue sur une ligne de vente ─────────────────────────────────────────────────────────────────
ALTER TABLE public.sale_items ADD COLUMN IF NOT EXISTS measure_key text;
ALTER TABLE public.sale_items ADD COLUMN IF NOT EXISTS measure_label text;
ALTER TABLE public.sale_items ADD COLUMN IF NOT EXISTS measure_qty integer;
ALTER TABLE public.sale_items ADD COLUMN IF NOT EXISTS measure_units integer;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sale_items_measure_check' AND conrelid = 'public.sale_items'::regclass) THEN
    ALTER TABLE public.sale_items ADD CONSTRAINT sale_items_measure_check CHECK (
      (measure_key IS NULL AND measure_label IS NULL AND measure_qty IS NULL AND measure_units IS NULL)
      OR (measure_key IS NOT NULL AND measure_qty IS NOT NULL AND measure_units IS NOT NULL
          AND measure_qty >= 1 AND measure_units BETWEEN 2 AND 100000
          AND quantity = measure_qty * measure_units
          AND (measure_label IS NULL OR char_length(measure_label) <= 20))
    );
  END IF;
END $$;
-- Lecture des lignes : mêmes droits que les autres colonnes de sale_items (droits par colonne s'ils existent)
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.column_privileges WHERE table_schema = 'public' AND table_name = 'sale_items' AND grantee = 'authenticated' AND column_name = 'unit_price') THEN
    GRANT SELECT (measure_key, measure_label, measure_qty, measure_units) ON public.sale_items TO authenticated;
  END IF;
END $$;

-- ── 3. complete_sale : version de production + colonnes de mesure (seul changement) ─────────────────────────
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
    -- 203 : mesure vendue (verre, boîte, seau…) : absente = NULL, la vente est enregistrée comme avant
    INSERT INTO sale_items (sale_id, product_id, product_name, quantity, unit_price, buying_price, original_price,
                            measure_key, measure_label, measure_qty, measure_units)
    SELECT
      v_sale_id,
      NULLIF(elem->>'product_id', '')::uuid,
      elem->>'product_name',
      (elem->>'quantity')::int,
      (elem->>'unit_price')::numeric,
      COALESCE((elem->>'buying_price')::numeric, 0),
      NULLIF(elem->>'original_price', '')::numeric,
      NULLIF(elem->>'measure_key', ''),
      NULLIF(btrim(elem->>'measure_label'), ''),
      NULLIF(elem->>'measure_qty', '')::int,
      NULLIF(elem->>'measure_units', '')::int
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

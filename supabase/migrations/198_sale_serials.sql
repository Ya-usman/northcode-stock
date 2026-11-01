-- ============================================================
-- 198 : numéros de série, lot B : la vente (étape 11 du Stock, 1er nov. 2026)
-- ============================================================
-- Après la 197 (registre). Une vente d'un produit SUIVI porte un numéro par unité vendue :
-- 1. assign_sale_serials : rattache les numéros aux lignes de la vente (par produit, dans l'ordre des lignes).
--    En ligne : autant de numéros que d'unités, chacun « en stock » pour ce produit dans la boutique, sinon REFUS
--    (P0041 nombre, P0044 doublon, P0046 numéro pas en stock) : la vente entière est annulée (une transaction).
--    Hors ligne (p_created_at fourni) : jamais de refus ; numéros valides vendus, le reste → « serial_unresolved ».
-- 2. complete_sale : définition de PRODUCTION (159, drafts/198_prod) + UN appel à assign_sale_serials juste après
--    l'insertion des lignes ; rien d'autre ne change (produits non suivis : comportement identique).
-- 3. Retour en stock : vente annulée (sales.sale_status → cancelled) ou ligne supprimée (delete_sale, suppression en
--    cascade) → numéros remis « en stock ». Mode 'skip' (edit_sale, qui efface puis recrée les lignes) : les numéros
--    restent vendus ; l'application refuse de modifier une vente qui contient des numéros.
-- Additive, ré-exécutable. Retour arrière : supabase/rollbacks/198_sale_serials_rollback.sql
-- ============================================================

SET LOCAL lock_timeout = '5s';

-- 1. Numéros d'une vente ---------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.assign_sale_serials(p_sale uuid, p_shop uuid, p_items jsonb, p_offline boolean, p_at timestamptz)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  r            record;
  v_serials    text[];
  v_clean      text[];
  v_s          text;
  v_idx        int;
  v_k          int;
  v_u          int;
  v_id         uuid;
  v_unresolved boolean := false;
BEGIN
  FOR r IN
    SELECT si.product_id, p.name, sum(si.quantity)::int AS qty,
           array_agg(si.id ORDER BY si.id) AS ids, array_agg(si.quantity ORDER BY si.id) AS qtys
      FROM sale_items si JOIN products p ON p.id = si.product_id
      WHERE si.sale_id = p_sale AND p.track_serials
      GROUP BY si.product_id, p.name
  LOOP
    SELECT COALESCE(array_agg(btrim(x)), '{}') INTO v_serials
      FROM jsonb_array_elements(p_items) e, jsonb_array_elements_text(COALESCE(e->'serials', '[]'::jsonb)) x
      WHERE NULLIF(e->>'product_id', '')::uuid = r.product_id AND btrim(x) <> '';
    -- Doublons dans la saisie (casse ignorée)
    SELECT COALESCE(array_agg(s ORDER BY first), '{}') INTO v_clean FROM (
      SELECT min(s) AS s, min(o) AS first FROM unnest(v_serials) WITH ORDINALITY AS u(s, o) GROUP BY upper(s)
    ) d;
    IF COALESCE(array_length(v_clean, 1), 0) <> COALESCE(array_length(v_serials, 1), 0) THEN
      IF NOT p_offline THEN RAISE EXCEPTION 'serial_duplicate_input' USING ERRCODE = 'P0044', DETAIL = r.name; END IF;
      v_unresolved := true;
    END IF;
    IF COALESCE(array_length(v_clean, 1), 0) <> r.qty THEN
      IF NOT p_offline THEN RAISE EXCEPTION 'serial_count_mismatch' USING ERRCODE = 'P0041', DETAIL = r.name; END IF;
      v_unresolved := true;
    END IF;
    -- Un numéro par unité, ligne après ligne
    v_idx := 1;
    FOR v_k IN 1 .. array_length(r.ids, 1) LOOP
      FOR v_u IN 1 .. r.qtys[v_k] LOOP
        EXIT WHEN v_idx > COALESCE(array_length(v_clean, 1), 0);
        v_s := v_clean[v_idx]; v_idx := v_idx + 1;
        UPDATE product_serials SET status = 'sold', sale_item_id = r.ids[v_k], sold_at = p_at, updated_at = now()
          WHERE shop_id = p_shop AND product_id = r.product_id AND upper(serial) = upper(v_s) AND status = 'in_stock'
          RETURNING id INTO v_id;
        IF NOT FOUND THEN
          IF NOT p_offline THEN RAISE EXCEPTION 'serial_not_in_stock' USING ERRCODE = 'P0046', DETAIL = v_s; END IF;
          v_unresolved := true;
        END IF;
      END LOOP;
    END LOOP;
  END LOOP;
  RETURN v_unresolved;
END $$;

-- 2. complete_sale : production + numéros -----------------------------------------------------------------------------
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
$function$;

REVOKE ALL ON FUNCTION public.assign_sale_serials(uuid, uuid, jsonb, boolean, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.assign_sale_serials(uuid, uuid, jsonb, boolean, timestamptz) TO service_role;
REVOKE ALL ON FUNCTION public.complete_sale(uuid, uuid, uuid, text, text, numeric, numeric, numeric, numeric, text, text, text, text, jsonb, jsonb, date, timestamptz, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.complete_sale(uuid, uuid, uuid, text, text, numeric, numeric, numeric, numeric, text, text, text, text, jsonb, jsonb, date, timestamptz, text, text) TO service_role;

-- 3. Retour en stock ---------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.release_serials_on_sale_cancel() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF OLD.sale_status IS DISTINCT FROM 'cancelled' AND NEW.sale_status = 'cancelled' THEN
    UPDATE product_serials SET status = 'in_stock', sale_item_id = NULL, sold_at = NULL, updated_at = now()
      WHERE status = 'sold' AND sale_item_id IN (SELECT id FROM sale_items WHERE sale_id = NEW.id);
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_release_serials_on_sale_cancel ON public.sales;
CREATE TRIGGER trg_release_serials_on_sale_cancel AFTER UPDATE OF sale_status ON public.sales
  FOR EACH ROW EXECUTE FUNCTION public.release_serials_on_sale_cancel();

CREATE OR REPLACE FUNCTION public.release_serials_on_sale_item_delete() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  -- edit_sale (mode 'skip') efface puis recrée les lignes : les numéros restent vendus
  IF coalesce(current_setting('stockshop.stock_mode', true), '') = 'skip' THEN RETURN OLD; END IF;
  UPDATE product_serials SET status = 'in_stock', sale_item_id = NULL, sold_at = NULL, updated_at = now()
    WHERE sale_item_id = OLD.id AND status = 'sold';
  RETURN OLD;
END $$;
DROP TRIGGER IF EXISTS trg_release_serials_on_sale_item_delete ON public.sale_items;
CREATE TRIGGER trg_release_serials_on_sale_item_delete BEFORE DELETE ON public.sale_items
  FOR EACH ROW EXECUTE FUNCTION public.release_serials_on_sale_item_delete();

REVOKE ALL ON FUNCTION public.release_serials_on_sale_cancel() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.release_serials_on_sale_item_delete() FROM PUBLIC, anon, authenticated;

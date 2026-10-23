-- Retour arrière de 178 (périmé non vendable) — à n'exécuter QUE sur décision explicite.
-- Restaure EXACTEMENT les définitions en place le 23 oct. 2026 (relevées par pg_get_functiondef ; md5 du corps
-- sans retours chariot : deduct_stock_on_sale 4ad6a01442269a6009f1c474c92f9cfe, edit_sale 8dd687601cc52e7666e8bfbb90a8845a),
-- puis retire les fonctions, le garde, les contraintes et les colonnes ajoutées (shops.timezone,
-- sale_items.batch_unallocated), et rend les droits d'exécution d'origine.
-- ⚠ Supprimer sale_items.batch_unallocated efface les écarts de lot enregistrés depuis 178 : les exporter avant
--   (SELECT id, sale_id, product_id, batch_unallocated FROM sale_items WHERE batch_unallocated > 0).
-- ⚠ Supprimer shops.timezone efface les fuseaux saisis (dont Boutique de Ange Kossa → America/Chicago) : les exporter
--   avant (SELECT id, name, timezone FROM shops).
-- Les valeurs « expired_stock_unresolved » déjà écrites dans sales.review_reason restent (texte, sans effet).

-- 1. Déclencheur de vente d'origine
CREATE OR REPLACE FUNCTION public.deduct_stock_on_sale()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_shop_id uuid;
  v_cashier_id uuid;
  v_sale_number text;
  v_current_qty int;
  v_take int;
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

  IF v_take > 0 THEN
    UPDATE products SET quantity = quantity - v_take, updated_at = now() WHERE id = new.product_id;
    -- Suivi des lots (FEFO) — ne bloque jamais la vente (migration 086)
    PERFORM deplete_product_batches(new.product_id, v_take, new.id);

    SELECT s.shop_id, s.cashier_id, s.sale_number INTO v_shop_id, v_cashier_id, v_sale_number
      FROM sales s WHERE s.id = new.sale_id;
    INSERT INTO stock_movements (shop_id, product_id, type, quantity, reason, performed_by)
    VALUES (v_shop_id, new.product_id, 'sale', v_take, 'Sale ' || v_sale_number, v_cashier_id);
  END IF;

  RETURN new;
END;
$function$;

-- 2. Modification de vente d'origine
CREATE OR REPLACE FUNCTION public.edit_sale(p_sale_id uuid, p_edited_by uuid, p_customer_id uuid, p_payment_method text, p_notes text, p_items jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_sale         RECORD;
  v_item         RECORD;
  v_elem         JSONB;
  v_new_sub      NUMERIC := 0;
  v_new_total    NUMERIC;
  v_new_bal      NUMERIC;
  v_new_status   TEXT;
  v_prod_id      UUID;
  v_old_prices   JSONB;
  v_buying_price NUMERIC;
  v_new_item_id  UUID;
  v_back         INT;
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

  FOR v_item IN SELECT * FROM sale_items WHERE sale_id = p_sale_id LOOP
    v_back := v_item.quantity - coalesce(v_item.stock_shortfall, 0);
    IF v_item.product_id IS NOT NULL AND v_back > 0 THEN
      PERFORM 1 FROM products WHERE id = v_item.product_id FOR UPDATE;
      UPDATE products SET quantity = quantity + v_back, updated_at = now() WHERE id = v_item.product_id;
      PERFORM restore_sale_item_batches(v_item.id);
      INSERT INTO stock_movements(shop_id, product_id, type, quantity, reason, performed_by)
      VALUES (v_sale.shop_id, v_item.product_id, 'in', v_back, 'Modification vente #' || v_sale.sale_number, p_edited_by);
    END IF;
  END LOOP;

  DELETE FROM sale_items WHERE sale_id = p_sale_id;

  -- Le stock des nouvelles lignes est retiré ci-dessous : le déclencheur se tait
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

    INSERT INTO sale_items(sale_id, product_id, product_name, quantity, unit_price, buying_price)
    VALUES (p_sale_id, v_prod_id, v_elem->>'product_name', (v_elem->>'quantity')::INT, (v_elem->>'unit_price')::NUMERIC, COALESCE(v_buying_price, 0))
    RETURNING id INTO v_new_item_id;

    IF v_prod_id IS NOT NULL THEN
      PERFORM 1 FROM products WHERE id = v_prod_id FOR UPDATE;
      UPDATE products SET quantity = quantity - (v_elem->>'quantity')::INT, updated_at = now() WHERE id = v_prod_id;
      PERFORM deplete_product_batches(v_prod_id, (v_elem->>'quantity')::INT, v_new_item_id);
      INSERT INTO stock_movements(shop_id, product_id, type, quantity, reason, performed_by)
      VALUES (v_sale.shop_id, v_prod_id, 'sale', (v_elem->>'quantity')::INT, 'Modification vente #' || v_sale.sale_number, p_edited_by);
    END IF;
  END LOOP;

  PERFORM set_config('stockshop.stock_mode', '', true);

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
$function$;

-- 3. Garde du fuseau et fonctions ajoutées par 178
DROP TRIGGER IF EXISTS trg_shops_timezone_guard ON public.shops;
DROP FUNCTION IF EXISTS public.shops_timezone_guard();
DROP FUNCTION IF EXISTS public.allocate_sale_batches(uuid, integer, date);
DROP FUNCTION IF EXISTS public.sellable_stock(uuid, date);
DROP FUNCTION IF EXISTS public.shop_business_date(uuid, timestamptz);
DROP FUNCTION IF EXISTS public.country_time_zones(text);
DROP FUNCTION IF EXISTS public.country_default_time_zone(text);
DROP FUNCTION IF EXISTS public.is_iana_time_zone(text);

-- 4. Colonnes et contrainte ajoutées par 178 (voir ⚠ en tête)
ALTER TABLE public.sale_items DROP CONSTRAINT IF EXISTS sale_items_batch_unallocated_check;
ALTER TABLE public.sale_items DROP COLUMN IF EXISTS batch_unallocated;
ALTER TABLE public.shops DROP COLUMN IF EXISTS timezone;

-- 5. Droits d'exécution d'origine (proacl relevé : PUBLIC, anon, authenticated, service_role)
GRANT EXECUTE ON FUNCTION public.deplete_product_batches(uuid, integer, uuid) TO PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.restore_sale_item_batches(uuid)              TO PUBLIC, anon, authenticated;

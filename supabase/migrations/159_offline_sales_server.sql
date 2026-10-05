-- ============================================================
-- 159 — Ventes hors ligne par le serveur (lot 3 permissions, 5 oct. 2026)
--
-- Constat (relevés du 5 oct., lecture seule) :
--   • la synchronisation hors ligne insérait vente, lignes et paiements
--     directement depuis le navigateur, en 3 requêtes, sans les contrôles du
--     serveur (prix plancher, droit de remise, total) — depuis le 3 oct., les
--     8 ventes enregistrées sont toutes passées par ce chemin ;
--   • DEUX versions de complete_sale coexistent (112 avec p_due_date, 121 avec
--     original_price) : la caisse en ligne appelle celle de 112, qui
--     n'enregistre pas original_price ;
--   • une vente hors ligne arrivant alors que le stock a baissé entre-temps
--     était refusée (« Stock insuffisant ») et restait bloquée sur l'appareil ;
--   • edit_sale retirait le stock deux fois (à la main ET par le déclencheur
--     after_sale_item_insert) — 2 cas, Boutique Alpha (test), juillet.
--
-- Décision utilisateur (5 oct.) : une vente hors ligne non conforme n'est
-- jamais perdue (l'argent est encaissé) — enregistrée et marquée « à vérifier ».
--
-- Ce que fait la migration (aucune donnée existante modifiée) :
--   1. sales.review_reason / reviewed_at / reviewed_by : vente à vérifier ;
--   2. sale_items.stock_shortfall : quantité vendue hors ligne au-delà du stock ;
--   3. deduct_stock_on_sale : mode « offline » (prend le stock disponible,
--      note l'écart) et mode « skip » (edit_sale gère le stock lui-même) ;
--   4. cancel_sale / edit_sale : ne remettent en stock que ce qui en a été retiré ;
--      edit_sale ne retire plus le stock deux fois ;
--   5. complete_sale : UNE seule version (original_price + échéance + heure
--      réelle de la vente + jeton du reçu + motif « à vérifier »).
-- Ré-exécutable.
-- ============================================================

-- ── 1. Vente à vérifier ────────────────────────────────────────────────────
ALTER TABLE sales ADD COLUMN IF NOT EXISTS review_reason text;
ALTER TABLE sales ADD COLUMN IF NOT EXISTS reviewed_at timestamptz;
ALTER TABLE sales ADD COLUMN IF NOT EXISTS reviewed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_sales_to_review ON sales(shop_id) WHERE review_reason IS NOT NULL AND reviewed_at IS NULL;

-- ── 2. Écart de stock d'une ligne vendue hors ligne ────────────────────────
ALTER TABLE sale_items ADD COLUMN IF NOT EXISTS stock_shortfall int NOT NULL DEFAULT 0;
DO $$ BEGIN
  ALTER TABLE sale_items ADD CONSTRAINT sale_items_stock_shortfall_check CHECK (stock_shortfall >= 0 AND stock_shortfall <= quantity);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── 3. Déclencheur de stock (base : migration 087) ─────────────────────────
-- stockshop.stock_mode (local à la transaction) :
--   'skip'    → ne fait rien (edit_sale retire le stock lui-même) ;
--   'offline' → vente synchronisée : si le stock ne suffit plus, retire ce qui
--               reste et note l'écart sur la ligne (jamais de refus) ;
--   sinon     → comportement inchangé (refus « Stock insuffisant »).
CREATE OR REPLACE FUNCTION deduct_stock_on_sale()
RETURNS trigger AS $$
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
$$ LANGUAGE plpgsql;

-- ── 4a. Annulation (base : migration 111) — remet en stock ce qui a été retiré ──
CREATE OR REPLACE FUNCTION cancel_sale(
  p_sale_id      uuid,
  p_cancelled_by uuid,
  p_reason       text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sale  record;
  v_item  record;
  v_back  int;
BEGIN
  SELECT * INTO v_sale FROM sales WHERE id = p_sale_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Vente introuvable' USING ERRCODE = 'P0002';
  END IF;
  IF v_sale.sale_status = 'cancelled' THEN
    RAISE EXCEPTION 'Vente déjà annulée' USING ERRCODE = 'P0003';
  END IF;

  FOR v_item IN SELECT * FROM sale_items WHERE sale_id = p_sale_id LOOP
    v_back := v_item.quantity - coalesce(v_item.stock_shortfall, 0);
    IF v_item.product_id IS NOT NULL AND v_back > 0 THEN
      PERFORM 1 FROM products WHERE id = v_item.product_id FOR UPDATE;

      UPDATE products
        SET quantity = quantity + v_back, updated_at = now()
        WHERE id = v_item.product_id;

      PERFORM restore_sale_item_batches(v_item.id);

      INSERT INTO stock_movements (shop_id, product_id, type, quantity, reason, notes, performed_by)
      VALUES (
        v_sale.shop_id, v_item.product_id, 'in', v_back,
        'Annulation vente #' || v_sale.sale_number,
        p_reason,
        p_cancelled_by
      );
    END IF;
  END LOOP;

  -- Dette du client annulée si la vente laissait un solde (022, régressé par 087)
  IF v_sale.balance > 0 AND v_sale.customer_id IS NOT NULL THEN
    UPDATE customers
    SET total_debt = greatest(0, total_debt - v_sale.balance)
    WHERE id = v_sale.customer_id;
  END IF;

  UPDATE sales SET
    sale_status  = 'cancelled',
    cancelled_by = p_cancelled_by,
    cancelled_at = now(),
    cancel_reason = p_reason
  WHERE id = p_sale_id;
END;
$$;
REVOKE ALL ON FUNCTION cancel_sale(uuid, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION cancel_sale(uuid, uuid, text) TO service_role;

-- ── 4b. Modification (base : migration 087) ────────────────────────────────
-- Remet en stock ce qui avait été retiré (écart hors ligne exclu) ; le stock
-- des nouvelles lignes est retiré UNE fois (le déclencheur est en mode « skip »).
CREATE OR REPLACE FUNCTION edit_sale(
  p_sale_id        UUID,
  p_edited_by      UUID,
  p_customer_id    UUID,
  p_payment_method TEXT,
  p_notes          TEXT,
  p_items          JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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
$$;
REVOKE ALL ON FUNCTION edit_sale(uuid, uuid, uuid, text, text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION edit_sale(uuid, uuid, uuid, text, text, jsonb) TO service_role;

-- ── 5. complete_sale : UNE seule version ───────────────────────────────────
DROP FUNCTION IF EXISTS complete_sale(uuid, uuid, uuid, text, text, numeric, numeric, numeric, numeric, text, text, text, text, jsonb, jsonb);
DROP FUNCTION IF EXISTS complete_sale(uuid, uuid, uuid, text, text, numeric, numeric, numeric, numeric, text, text, text, text, jsonb, jsonb, date);

CREATE FUNCTION complete_sale(
  p_shop_id            uuid,
  p_cashier_id         uuid,
  p_customer_id        uuid,
  p_customer_name      text,
  p_customer_phone     text,
  p_subtotal           numeric,
  p_discount           numeric,
  p_tax                numeric,
  p_total              numeric,
  p_payment_method     text,
  p_notes              text,
  p_paystack_reference text,
  p_client_request_id  text,
  p_items              jsonb,          -- [{product_id, product_name, quantity, unit_price, buying_price, original_price}]
  p_payments           jsonb,          -- [{amount, method, reference}]
  p_due_date           date DEFAULT NULL,
  p_created_at         timestamptz DEFAULT NULL,  -- vente hors ligne : heure réelle de la vente
  p_receipt_token      text DEFAULT NULL,         -- vente hors ligne : jeton du QR déjà imprimé
  p_review_reason      text DEFAULT NULL          -- vente hors ligne non conforme : motif « à vérifier »
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
$$;
REVOKE ALL ON FUNCTION complete_sale(uuid, uuid, uuid, text, text, numeric, numeric, numeric, numeric, text, text, text, text, jsonb, jsonb, date, timestamptz, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION complete_sale(uuid, uuid, uuid, text, text, numeric, numeric, numeric, numeric, text, text, text, text, jsonb, jsonb, date, timestamptz, text, text) TO service_role;

NOTIFY pgrst, 'reload schema';

-- ── Vérification après exécution ───────────────────────────────────────────
-- SELECT count(*) FROM pg_proc WHERE proname = 'complete_sale';   -- 1
-- SELECT column_name FROM information_schema.columns WHERE table_name = 'sales' AND column_name LIKE 'review%';  -- 2 lignes (+ reviewed_by)
-- SELECT column_name FROM information_schema.columns WHERE table_name = 'sale_items' AND column_name = 'stock_shortfall';  -- 1

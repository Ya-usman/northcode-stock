-- Migration 169 — Reprise de dette : tolérance d'un jour sur la « date future »
--
-- current_date est calculé en UTC par la base. Une boutique en UTC+1 (Cameroun,
-- Nigeria…) qui saisit une dette datée « aujourd'hui » entre minuit et 1 h
-- (heure locale) était refusée (« date dans le futur »). On accepte J+1 UTC.
-- Seule la ligne du contrôle de date change ; le reste est identique à la 168.

CREATE OR REPLACE FUNCTION create_customer_opening_balance(
  p_shop_id           uuid,
  p_customer_id       uuid,
  p_amount            numeric,
  p_debt_date         date,
  p_due_date          date,
  p_note              text,
  p_actor             uuid,
  p_client_request_id text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_existing sales%ROWTYPE;
  v_sale     sales%ROWTYPE;
  v_n        int;
  v_number   text;
BEGIN
  IF p_amount IS NULL OR p_amount <= 0 THEN RAISE EXCEPTION 'Montant invalide' USING ERRCODE = 'P0020'; END IF;
  -- current_date est en UTC : +1 jour de tolérance (boutique en UTC+1 juste après minuit)
  IF p_debt_date IS NOT NULL AND p_debt_date > current_date + 1 THEN RAISE EXCEPTION 'Date future' USING ERRCODE = 'P0021'; END IF;
  PERFORM 1 FROM customers WHERE id = p_customer_id AND shop_id = p_shop_id AND deleted_at IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'Client invalide pour cette boutique' USING ERRCODE = 'P0006'; END IF;

  -- Déjà enregistrée (double clic, réponse perdue) : on la renvoie telle quelle
  IF p_client_request_id IS NOT NULL THEN
    SELECT * INTO v_existing FROM sales WHERE client_request_id = p_client_request_id;
    IF FOUND THEN RETURN jsonb_build_object('id', v_existing.id, 'number', v_existing.sale_number, 'already_existed', true); END IF;
  END IF;

  SET LOCAL lock_timeout = '8s';
  LOOP
    INSERT INTO opening_balance_counters (shop_id, kind, counter) VALUES (p_shop_id, 'customer', 1)
    ON CONFLICT (shop_id, kind) DO UPDATE SET counter = opening_balance_counters.counter + 1
    RETURNING counter INTO v_n;
    v_number := 'REP-' || lpad(v_n::text, 4, '0');
    EXIT WHEN NOT EXISTS (SELECT 1 FROM sales WHERE shop_id = p_shop_id AND sale_number = v_number);
  END LOOP;

  INSERT INTO sales (
    shop_id, sale_number, customer_id, cashier_id, subtotal, discount, tax, total,
    payment_method, payment_status, amount_paid, sale_status, notes, client_request_id, due_date, created_at
  ) VALUES (
    p_shop_id, v_number, p_customer_id, p_actor, p_amount, 0, 0, p_amount,
    'credit', 'pending', 0, 'opening', NULLIF(trim(p_note), ''), p_client_request_id, p_due_date,
    -- Midi le jour de la dette : la reprise se range à sa date réelle (remboursements du plus ancien au plus récent)
    coalesce(p_debt_date::timestamp + time '12:00', now())
  )
  RETURNING * INTO v_sale;

  RETURN jsonb_build_object('id', v_sale.id, 'number', v_sale.sale_number, 'already_existed', false);
END;
$$;
REVOKE ALL ON FUNCTION create_customer_opening_balance(uuid, uuid, numeric, date, date, text, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION create_customer_opening_balance(uuid, uuid, numeric, date, date, text, uuid, text) TO service_role;

-- ── 7. Créer une reprise FOURNISSEUR ───────────────────────────────────────
CREATE OR REPLACE FUNCTION create_supplier_opening_balance(
  p_shop_id           uuid,
  p_supplier_id       uuid,
  p_amount            numeric,
  p_debt_date         date,
  p_note              text,
  p_actor             uuid,
  p_client_request_id text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_existing purchase_orders%ROWTYPE;
  v_po_id    uuid;
  v_n        int;
  v_ref      text;
BEGIN
  IF p_amount IS NULL OR p_amount <= 0 THEN RAISE EXCEPTION 'Montant invalide' USING ERRCODE = 'P0020'; END IF;
  -- current_date est en UTC : +1 jour de tolérance (boutique en UTC+1 juste après minuit)
  IF p_debt_date IS NOT NULL AND p_debt_date > current_date + 1 THEN RAISE EXCEPTION 'Date future' USING ERRCODE = 'P0021'; END IF;
  PERFORM 1 FROM suppliers WHERE id = p_supplier_id AND shop_id = p_shop_id AND deleted_at IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'Fournisseur invalide pour cette boutique' USING ERRCODE = 'P0022'; END IF;

  IF p_client_request_id IS NOT NULL THEN
    SELECT * INTO v_existing FROM purchase_orders WHERE client_request_id = p_client_request_id;
    IF FOUND THEN RETURN jsonb_build_object('id', v_existing.id, 'number', v_existing.reference, 'already_existed', true); END IF;
  END IF;

  SET LOCAL lock_timeout = '8s';
  LOOP
    INSERT INTO opening_balance_counters (shop_id, kind, counter) VALUES (p_shop_id, 'supplier', 1)
    ON CONFLICT (shop_id, kind) DO UPDATE SET counter = opening_balance_counters.counter + 1
    RETURNING counter INTO v_n;
    v_ref := 'REP-F-' || lpad(v_n::text, 4, '0');
    EXIT WHEN NOT EXISTS (SELECT 1 FROM purchase_orders WHERE shop_id = p_shop_id AND reference = v_ref);
  END LOOP;

  INSERT INTO purchase_orders (
    shop_id, supplier_id, reference, status, notes, created_by, received_at, created_at,
    total_amount, amount_paid, payment_status, is_opening_balance, client_request_id
  ) VALUES (
    p_shop_id, p_supplier_id, v_ref, 'received', NULLIF(trim(p_note), ''), p_actor,
    coalesce(p_debt_date::timestamp + time '12:00', now()), coalesce(p_debt_date::timestamp + time '12:00', now()),
    p_amount, 0, 'unpaid', true, p_client_request_id
  )
  RETURNING id INTO v_po_id;

  UPDATE suppliers SET total_owed = COALESCE(total_owed, 0) + p_amount WHERE id = p_supplier_id;

  RETURN jsonb_build_object('id', v_po_id, 'number', v_ref, 'already_existed', false);
END;
$$;
REVOKE ALL ON FUNCTION create_supplier_opening_balance(uuid, uuid, numeric, date, text, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION create_supplier_opening_balance(uuid, uuid, numeric, date, text, uuid, text) TO service_role;

NOTIFY pgrst, 'reload schema';

-- ── Vérification après exécution ───────────────────────────────────────────
-- Doit afficher 2 lignes contenant « current_date + 1 »
SELECT proname, (regexp_match(prosrc, 'p_debt_date > current_date[^T]*'))[1] AS controle
FROM pg_proc WHERE proname IN ('create_customer_opening_balance', 'create_supplier_opening_balance');

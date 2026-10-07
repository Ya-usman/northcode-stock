-- ============================================================
-- 168 — Reprise de dette (soldes d'ouverture) — 7 oct. 2026
--
-- Un commerçant qui arrive avec son cahier de crédit doit pouvoir entrer
-- « Awa me doit 25 000 F » (et « je dois 80 000 F à tel fournisseur ») sans
-- fausser son chiffre d'affaires ni ses achats.
--
-- Côté CLIENT : une « reprise » est une ligne de `sales` au statut 'opening'
-- (numéro REP-0001, compteur à part, aucun article, aucun stock). Toute la
-- mécanique de crédit marche telle quelle : dette du client (déclencheur à
-- l'insertion), remboursements (FIFO, déclencheur sur payments), échéance,
-- abandon de créance, annulation. Les totaux de CHIFFRE D'AFFAIRES filtrent
-- tous sale_status = 'active' : la reprise en est exclue d'office. Les
-- totaux d'ENCAISSEMENT (argent reçu) excluent seulement les ventes annulées :
-- un remboursement de reprise y compte, c'est une vraie rentrée d'argent.
--
-- Côté FOURNISSEUR : un bon de commande « reçu » marqué is_opening_balance
-- (référence REP-F-0001, aucun article, aucun stock), payé comme les autres.
-- Exclu de la liste des bons de commande et de la réception.
--
-- Écritures : serveur seulement (/api/opening-balances, service_role).
-- Ré-exécutable.
-- ============================================================

-- ── 1. Statut « reprise » des ventes ───────────────────────────────────────
DO $$
DECLARE c record;
BEGIN
  FOR c IN SELECT conname FROM pg_constraint
           WHERE conrelid = 'public.sales'::regclass AND contype = 'c' AND pg_get_constraintdef(oid) ILIKE '%sale_status%'
  LOOP
    EXECUTE format('ALTER TABLE sales DROP CONSTRAINT %I', c.conname);
  END LOOP;
END $$;
ALTER TABLE sales ADD CONSTRAINT sales_sale_status_check CHECK (sale_status IN ('active', 'cancelled', 'opening'));

-- ── 2. Reprise fournisseur : bon de commande marqué ────────────────────────
ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS is_opening_balance boolean NOT NULL DEFAULT false;
ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS client_request_id text;
CREATE UNIQUE INDEX IF NOT EXISTS idx_purchase_orders_client_request ON purchase_orders(client_request_id) WHERE client_request_id IS NOT NULL;

-- ── 3. Compteurs des numéros de reprise (REP-0001 / REP-F-0001), par boutique ──
CREATE TABLE IF NOT EXISTS opening_balance_counters (
  shop_id uuid NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  kind    text NOT NULL CHECK (kind IN ('customer', 'supplier')),
  counter int  NOT NULL DEFAULT 0,
  PRIMARY KEY (shop_id, kind)
);
ALTER TABLE opening_balance_counters ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON opening_balance_counters FROM anon, authenticated;

-- ── 4. Numérotation des ventes : une reprise garde son numéro REP-… ────────
-- (copie de la 029, seule la garde du début est nouvelle)
CREATE OR REPLACE FUNCTION set_sale_number()
RETURNS trigger AS $$
DECLARE
  shop_name_raw text;
  shop_prefix   text;
  next_num      int;
  candidate     text;
BEGIN
  -- Reprise de dette : numéro REP-… déjà attribué (compteur à part) — les
  -- numéros de vente ne sont jamais consommés par une reprise
  IF new.sale_status = 'opening' AND new.sale_number IS NOT NULL THEN
    RETURN new;
  END IF;

  -- Abort immediately if any lock cannot be obtained within 8 seconds.
  SET LOCAL lock_timeout = '8s';

  SELECT name INTO shop_name_raw FROM shops WHERE id = new.shop_id;

  -- Keep only A-Z letters, take first 3, upper-case; fall back to 'SHP'
  shop_prefix := upper(
    substring(
      regexp_replace(coalesce(shop_name_raw, ''), '[^A-Za-z]', '', 'g'),
      1, 3
    )
  );
  IF shop_prefix IS NULL OR length(shop_prefix) = 0 THEN
    shop_prefix := 'SHP';
  END IF;

  LOOP
    INSERT INTO shop_sale_counters (shop_id, counter)
    VALUES (new.shop_id, 1)
    ON CONFLICT (shop_id)
    DO UPDATE SET counter = shop_sale_counters.counter + 1
    RETURNING counter INTO next_num;

    candidate := shop_prefix || '-' || lpad(next_num::text, 4, '0');

    EXIT WHEN NOT EXISTS (
      SELECT 1 FROM sales
      WHERE shop_id = new.shop_id AND sale_number = candidate
    );
  END LOOP;

  new.sale_number := candidate;
  RETURN new;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ── 5. Recalculs de dette : les reprises comptent (copies de la 113 et de la 151) ──
CREATE OR REPLACE FUNCTION cancel_payment(
  p_payment_id   uuid,
  p_cancelled_by uuid,
  p_reason       text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_payment payments%ROWTYPE;
  v_sale    sales%ROWTYPE;
  v_new_debt numeric;
BEGIN
  SELECT * INTO v_payment FROM payments WHERE id = p_payment_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Paiement introuvable' USING ERRCODE = 'P0002';
  END IF;
  IF v_payment.is_cancelled THEN
    RAISE EXCEPTION 'Paiement déjà annulé' USING ERRCODE = 'P0003';
  END IF;

  SELECT * INTO v_sale FROM sales WHERE id = v_payment.sale_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Vente introuvable' USING ERRCODE = 'P0002';
  END IF;

  UPDATE payments SET
    is_cancelled  = true,
    cancelled_at  = now(),
    cancelled_by  = p_cancelled_by,
    cancel_reason = p_reason
  WHERE id = p_payment_id;

  UPDATE sales SET
    amount_paid = greatest(0, amount_paid - v_payment.amount),
    payment_status = CASE
      WHEN (amount_paid - v_payment.amount) >= total THEN 'paid'
      WHEN (amount_paid - v_payment.amount) > 0 THEN 'partial'
      ELSE 'pending'
    END
  WHERE id = v_sale.id;

  -- Recalcul complet de la dette du client : ventes actives ET reprises
  IF v_sale.customer_id IS NOT NULL THEN
    SELECT COALESCE(SUM(balance), 0) INTO v_new_debt
    FROM sales WHERE customer_id = v_sale.customer_id AND sale_status IN ('active', 'opening');

    UPDATE customers SET total_debt = v_new_debt WHERE id = v_sale.customer_id;
  END IF;

  RETURN jsonb_build_object('sale_id', v_sale.id, 'sale_number', v_sale.sale_number, 'amount', v_payment.amount);
END;
$$;
REVOKE ALL ON FUNCTION cancel_payment(uuid, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION cancel_payment(uuid, uuid, text) TO service_role;

CREATE OR REPLACE FUNCTION merge_customers(p_shop_id uuid, p_keep_id uuid, p_merge_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_keep        customers%ROWTYPE;
  v_merge       customers%ROWTYPE;
  v_sales_moved int;
  v_debt_after  numeric;
BEGIN
  IF p_keep_id = p_merge_id THEN
    RAISE EXCEPTION 'same_customer' USING ERRCODE = 'P0010';
  END IF;

  SELECT * INTO v_keep FROM customers WHERE id = p_keep_id AND shop_id = p_shop_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'customer_not_found' USING ERRCODE = 'P0011'; END IF;
  SELECT * INTO v_merge FROM customers WHERE id = p_merge_id AND shop_id = p_shop_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'customer_not_found' USING ERRCODE = 'P0011'; END IF;

  IF v_keep.merged_into IS NOT NULL OR v_keep.deleted_at IS NOT NULL
     OR v_merge.merged_into IS NOT NULL OR v_merge.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'customer_unavailable' USING ERRCODE = 'P0012';
  END IF;

  UPDATE sales SET customer_id = p_keep_id WHERE customer_id = p_merge_id;
  GET DIAGNOSTICS v_sales_moved = ROW_COUNT;

  UPDATE customers SET
    phone        = COALESCE(NULLIF(trim(phone), ''), v_merge.phone),
    city         = COALESCE(NULLIF(trim(city), ''), v_merge.city),
    credit_limit = COALESCE(credit_limit, v_merge.credit_limit),
    total_debt   = COALESCE((
      SELECT SUM(s.balance) FROM sales s
      WHERE s.customer_id = p_keep_id AND s.sale_status IN ('active', 'opening')
    ), 0)
  WHERE id = p_keep_id
  RETURNING total_debt INTO v_debt_after;

  UPDATE customers
  SET merged_into = p_keep_id, deleted_at = now(), total_debt = 0
  WHERE id = p_merge_id;

  RETURN jsonb_build_object(
    'sales_moved',     v_sales_moved,
    'debt_moved',      COALESCE(v_merge.total_debt, 0),
    'kept_total_debt', v_debt_after,
    'kept_name',       v_keep.name,
    'merged_name',     v_merge.name
  );
END;
$$;
REVOKE ALL ON FUNCTION merge_customers(uuid, uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION merge_customers(uuid, uuid, uuid) TO service_role;

-- ── 6. Créer une reprise CLIENT ────────────────────────────────────────────
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
  IF p_debt_date IS NOT NULL AND p_debt_date > current_date THEN RAISE EXCEPTION 'Date future' USING ERRCODE = 'P0021'; END IF;
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
  IF p_debt_date IS NOT NULL AND p_debt_date > current_date THEN RAISE EXCEPTION 'Date future' USING ERRCODE = 'P0021'; END IF;
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

-- ── 8. Annuler une reprise FOURNISSEUR (rien de payé) ──────────────────────
-- (la reprise client s'annule avec cancel_sale, qui retire déjà la dette)
CREATE OR REPLACE FUNCTION cancel_supplier_opening_balance(p_po_id uuid, p_shop_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_po purchase_orders%ROWTYPE;
BEGIN
  SELECT * INTO v_po FROM purchase_orders WHERE id = p_po_id AND shop_id = p_shop_id FOR UPDATE;
  IF NOT FOUND OR NOT v_po.is_opening_balance THEN RAISE EXCEPTION 'Reprise introuvable' USING ERRCODE = 'P0002'; END IF;
  IF v_po.status = 'cancelled' THEN RAISE EXCEPTION 'Reprise déjà annulée' USING ERRCODE = 'P0003'; END IF;
  IF COALESCE(v_po.amount_paid, 0) > 0 THEN RAISE EXCEPTION 'Reprise déjà en partie payée' USING ERRCODE = 'P0023'; END IF;

  UPDATE purchase_orders SET status = 'cancelled', updated_at = now() WHERE id = p_po_id;
  IF v_po.supplier_id IS NOT NULL THEN
    UPDATE suppliers SET total_owed = greatest(0, COALESCE(total_owed, 0) - COALESCE(v_po.total_amount, 0)) WHERE id = v_po.supplier_id;
  END IF;
  RETURN jsonb_build_object('id', v_po.id, 'number', v_po.reference);
END;
$$;
REVOKE ALL ON FUNCTION cancel_supplier_opening_balance(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION cancel_supplier_opening_balance(uuid, uuid) TO service_role;

NOTIFY pgrst, 'reload schema';

-- ── Vérification après exécution ───────────────────────────────────────────
-- SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname = 'sales_sale_status_check';  -- … 'opening' …
-- SELECT count(*) FROM sales WHERE sale_status = 'opening';                                        -- 0
-- SELECT column_name FROM information_schema.columns WHERE table_name = 'purchase_orders' AND column_name IN ('is_opening_balance', 'client_request_id');  -- 2
-- SELECT proname FROM pg_proc WHERE proname IN ('create_customer_opening_balance', 'create_supplier_opening_balance', 'cancel_supplier_opening_balance');  -- 3

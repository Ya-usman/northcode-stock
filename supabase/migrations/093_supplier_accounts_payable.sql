-- ============================================================
-- Migration 093 : Comptes fournisseurs (accounts payable)
-- ============================================================
-- Miroir du système de crédit client déjà en place (customers.total_debt,
-- table payments, remboursement FIFO) — même mécanique, appliquée à ce
-- que la boutique doit à ses fournisseurs quand un bon de commande n'est
-- pas payé cash à la réception.
--
-- Différence structurelle avec le côté client : une vente crée sa dette
-- à l'INSERT (trigger sur `sales`), mais un bon de commande existe déjà
-- en brouillon avant réception — la dette naît au moment de la réception,
-- pas d'une insertion. On le fait donc directement dans
-- apply_purchase_order_receipt (déjà SECURITY DEFINER, déjà atomique)
-- plutôt que via un trigger sur UPDATE.

ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS total_amount numeric;
ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS amount_paid numeric NOT NULL DEFAULT 0;
ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS payment_status text DEFAULT 'unpaid'
  CHECK (payment_status IN ('unpaid', 'partial', 'paid'));
ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS balance numeric
  GENERATED ALWAYS AS (COALESCE(total_amount, 0) - amount_paid) STORED;

ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS total_owed numeric DEFAULT 0;

-- ── supplier_payments (miroir de `payments`) ─────────────────────────────
CREATE TABLE IF NOT EXISTS supplier_payments (
  id uuid primary key default gen_random_uuid(),
  purchase_order_id uuid references purchase_orders(id) on delete cascade,
  amount numeric not null check (amount > 0),
  method text not null,
  reference text,
  notes text,
  paid_by uuid references auth.users on delete set null,
  paid_at timestamptz default now(),
  client_request_id text
);

CREATE INDEX IF NOT EXISTS idx_supplier_payments_po ON supplier_payments(purchase_order_id);
CREATE INDEX IF NOT EXISTS idx_supplier_payments_client_request
  ON supplier_payments(client_request_id) WHERE client_request_id IS NOT NULL;

ALTER TABLE supplier_payments ENABLE ROW LEVEL SECURITY;

-- Même pattern que purchase_order_items : pas de shop_id direct, on
-- remonte via purchase_orders.shop_id.
CREATE POLICY supplier_payments_select ON supplier_payments
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM purchase_orders po WHERE po.id = purchase_order_id AND is_shop_member(po.shop_id)
    )
  );

CREATE POLICY supplier_payments_insert ON supplier_payments
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM purchase_orders po WHERE po.id = purchase_order_id
      AND is_shop_member(po.shop_id)
      AND get_role_in_shop(po.shop_id) IN ('owner', 'manager', 'shop_manager', 'stock_manager')
    )
  );

-- ── Trigger : décrémente la dette fournisseur à chaque paiement ─────────
-- Copie conforme de update_customer_debt_on_payment (001_schema.sql).
CREATE OR REPLACE FUNCTION update_supplier_debt_on_payment()
RETURNS trigger AS $$
BEGIN
  UPDATE suppliers s
  SET total_owed = GREATEST(0, s.total_owed - new.amount)
  FROM purchase_orders po
  WHERE po.id = new.purchase_order_id
    AND po.supplier_id = s.id;

  UPDATE purchase_orders
  SET amount_paid = amount_paid + new.amount,
      payment_status = CASE
        WHEN (amount_paid + new.amount) >= COALESCE(total_amount, 0) THEN 'paid'
        WHEN (amount_paid + new.amount) > 0 THEN 'partial'
        ELSE 'unpaid'
      END
  WHERE id = new.purchase_order_id;

  RETURN new;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS after_supplier_payment_insert ON supplier_payments;
CREATE TRIGGER after_supplier_payment_insert
  AFTER INSERT ON supplier_payments
  FOR EACH ROW EXECUTE FUNCTION update_supplier_debt_on_payment();

-- ── apply_purchase_order_receipt : pose la dette à la réception ─────────
-- Repart du corps de 092_purchase_order_partial_receipt.sql, ajoute
-- l'accumulation de v_po_total et la mise à jour de total_amount/
-- payment_status/suppliers.total_owed.
CREATE OR REPLACE FUNCTION apply_purchase_order_receipt(
  p_shop_id       UUID,
  p_po_id         UUID,
  p_performed_by  UUID,
  p_items         JSONB   -- [{ "item_id": uuid, "product_id": uuid, "quantity_received": int, "unit_price": numeric, "expiry_date": date, "receipt_note": text }]
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_po_status      TEXT;
  v_reference      TEXT;
  v_po_supplier_id UUID;
  v_item           JSONB;
  v_item_id        UUID;
  v_product_id     UUID;
  v_received       INT;
  v_unit_price     NUMERIC;
  v_expiry_date    DATE;
  v_receipt_note   TEXT;
  v_ordered_qty    INT;
  v_previous_qty   INT;
  v_previous_price NUMERIC;
  v_new_price      NUMERIC;
  v_product_name   TEXT;
  v_new_qty        INT;
  v_any_shortfall  BOOLEAN := false;
  v_po_total       NUMERIC := 0;
  v_details        JSONB := '[]'::JSONB;
BEGIN
  SELECT status, reference, supplier_id INTO v_po_status, v_reference, v_po_supplier_id
    FROM purchase_orders
    WHERE id = p_po_id AND shop_id = p_shop_id
    FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Bon de commande introuvable';
  END IF;
  IF v_po_status NOT IN ('draft', 'sent') THEN
    RAISE EXCEPTION 'Ce bon de commande a déjà été reçu ou annulé';
  END IF;

  FOR v_item IN SELECT * FROM JSONB_ARRAY_ELEMENTS(p_items) LOOP
    v_item_id     := NULLIF(v_item->>'item_id', '')::UUID;
    v_product_id  := NULLIF(v_item->>'product_id', '')::UUID;
    v_received    := NULLIF(v_item->>'quantity_received', '')::INT;
    v_unit_price  := NULLIF(v_item->>'unit_price', '')::NUMERIC;
    v_expiry_date := NULLIF(v_item->>'expiry_date', '')::DATE;
    v_receipt_note := NULLIF(v_item->>'receipt_note', '');

    CONTINUE WHEN v_item_id IS NULL;
    v_received := COALESCE(v_received, 0);

    -- Toujours enregistrer la quantité reçue, même 0 — trace honnête
    -- de ce qui n'a pas été livré, même si aucun réassort n'a lieu.
    UPDATE purchase_order_items SET quantity_received = v_received, receipt_note = v_receipt_note
      WHERE id = v_item_id AND purchase_order_id = p_po_id
      RETURNING quantity_ordered INTO v_ordered_qty;

    IF v_ordered_qty IS NOT NULL AND v_received < v_ordered_qty THEN
      v_any_shortfall := true;
    END IF;

    CONTINUE WHEN v_product_id IS NULL OR v_received <= 0;

    SELECT quantity, buying_price, name INTO v_previous_qty, v_previous_price, v_product_name
      FROM products
      WHERE id = v_product_id AND shop_id = p_shop_id
      FOR UPDATE;

    CONTINUE WHEN NOT FOUND;

    -- Valeur de cette livraison — même valorisation que le lot créé
    -- ci-dessous, alimente la dette fournisseur posée en fin de fonction.
    v_po_total := v_po_total + COALESCE(v_unit_price, v_previous_price, 0) * v_received;

    v_new_qty := v_previous_qty + v_received;

    IF v_unit_price IS NOT NULL AND v_unit_price > 0 THEN
      -- Moyenne pondérée : (stock existant × ancien prix + reçu × prix payé) / nouvelle quantité.
      v_new_price := ROUND(
        (v_previous_qty * COALESCE(v_previous_price, 0) + v_received * v_unit_price) / v_new_qty,
        2
      );
      UPDATE products SET quantity = v_new_qty, buying_price = v_new_price, updated_at = now()
        WHERE id = v_product_id;
    ELSE
      v_new_price := v_previous_price;
      UPDATE products SET quantity = v_new_qty, updated_at = now()
        WHERE id = v_product_id;
    END IF;

    INSERT INTO stock_movements(
      shop_id, product_id, type, quantity, previous_qty, new_qty, reason, performed_by
    ) VALUES (
      p_shop_id, v_product_id, 'in', v_received,
      v_previous_qty, v_new_qty, 'Réception ' || v_reference, p_performed_by
    );

    -- Nouveau lot pour cette réception — coût et date de péremption propres
    -- à cette livraison, distincts du stock déjà en rayon (migration 086).
    INSERT INTO product_batches (
      shop_id, product_id, supplier_id, quantity, initial_quantity,
      buying_price, expiry_date, source, received_at
    ) VALUES (
      p_shop_id, v_product_id, v_po_supplier_id, v_received, v_received,
      COALESCE(v_unit_price, v_previous_price, 0), v_expiry_date, 'purchase_order', now()
    );

    v_details := v_details || JSONB_BUILD_OBJECT(
      'product_id',   v_product_id,
      'product_name', v_product_name,
      'previous_qty', v_previous_qty,
      'new_qty',      v_new_qty,
      'price_from',   v_previous_price,
      'price_to',     COALESCE(v_new_price, v_previous_price)
    );
  END LOOP;

  UPDATE purchase_orders SET
    status = CASE WHEN v_any_shortfall THEN 'partial' ELSE 'received' END,
    total_amount = v_po_total,
    payment_status = CASE WHEN v_po_total <= 0 THEN 'paid' ELSE 'unpaid' END,
    received_at = now(),
    updated_at = now()
    WHERE id = p_po_id;

  IF v_po_total > 0 AND v_po_supplier_id IS NOT NULL THEN
    UPDATE suppliers SET total_owed = total_owed + v_po_total WHERE id = v_po_supplier_id;
  END IF;

  RETURN JSONB_BUILD_OBJECT('items', v_details);
END;
$$;

REVOKE ALL ON FUNCTION apply_purchase_order_receipt(UUID, UUID, UUID, JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION apply_purchase_order_receipt(UUID, UUID, UUID, JSONB) TO service_role;

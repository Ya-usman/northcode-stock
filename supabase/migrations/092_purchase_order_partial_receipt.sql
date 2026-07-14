-- ============================================================
-- Migration 092 : Statut "partiellement reçu" + suivi du solde manquant
-- ============================================================
-- Jusqu'ici, une réception incomplète (quantity_received < quantity_ordered)
-- ne se voyait que via un badge visuel côté client — le bon passait quand
-- même en statut 'received', sans distinction. Impossible de filtrer "quels
-- bons ont encore un solde en attente" sans rouvrir chacun. On ajoute un
-- vrai statut 'partial', une note de motif par ligne en écart, et on
-- calcule le nouveau statut à la réception selon que tout a été livré ou non.
--
-- Le solde manquant n'est pas rouvert sur le même bon plus tard — le suivi
-- se fait via un nouveau bon de commande dédié au reste (bouton "Commander
-- le reste" côté UI), ce qui garde une trace claire : le bon d'origine
-- reste un instantané figé de cette livraison précise.

-- Le nom de la contrainte inline n'était pas fixé explicitement — on la
-- retrouve dynamiquement plutôt que de deviner son nom généré.
DO $$
DECLARE
  con_name text;
BEGIN
  SELECT conname INTO con_name
  FROM pg_constraint
  WHERE conrelid = 'purchase_orders'::regclass
    AND contype = 'c'
    AND pg_get_constraintdef(oid) LIKE '%status%draft%sent%received%cancelled%';
  IF con_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE purchase_orders DROP CONSTRAINT %I', con_name);
  END IF;
END $$;

ALTER TABLE purchase_orders ADD CONSTRAINT purchase_orders_status_check
  CHECK (status IN ('draft', 'sent', 'received', 'partial', 'cancelled'));

ALTER TABLE purchase_order_items ADD COLUMN IF NOT EXISTS receipt_note text;

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
    received_at = now(),
    updated_at = now()
    WHERE id = p_po_id;

  RETURN JSONB_BUILD_OBJECT('items', v_details);
END;
$$;

REVOKE ALL ON FUNCTION apply_purchase_order_receipt(UUID, UUID, UUID, JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION apply_purchase_order_receipt(UUID, UUID, UUID, JSONB) TO service_role;

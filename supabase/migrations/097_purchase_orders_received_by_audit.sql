-- ============================================================
-- Migration 097 : qui a confirmé la réception + trace d'audit envoi/réception
-- ============================================================
-- Complète 096 (created_by/sent_by/cancelled_by) : la réception est
-- l'action la plus engageante du cycle (stock + argent), et n'avait
-- pourtant aucun acteur associé.

ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS received_by uuid references auth.users on delete set null;

-- Reprend apply_purchase_order_receipt (093) à l'identique, ajoute
-- uniquement received_by = p_performed_by dans l'UPDATE final.
CREATE OR REPLACE FUNCTION apply_purchase_order_receipt(
  p_shop_id       UUID,
  p_po_id         UUID,
  p_performed_by  UUID,
  p_items         JSONB
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

    v_po_total := v_po_total + COALESCE(v_unit_price, v_previous_price, 0) * v_received;

    v_new_qty := v_previous_qty + v_received;

    IF v_unit_price IS NOT NULL AND v_unit_price > 0 THEN
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
    received_by = p_performed_by,
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

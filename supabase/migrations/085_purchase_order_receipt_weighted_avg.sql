-- ============================================================
-- Migration 085 : Prix d'achat moyen pondéré à la réception
-- ============================================================
-- apply_purchase_order_receipt (migration 084) remplaçait purement le
-- buying_price du produit par le prix du dernier arrivage, alors que le
-- stock existant (acheté à l'ancien prix) et le stock reçu sont regroupés
-- sous une seule quantité. Ça faussait la marge sur le stock déjà en
-- rayon. On calcule désormais une moyenne pondérée par quantité.

CREATE OR REPLACE FUNCTION apply_purchase_order_receipt(
  p_shop_id       UUID,
  p_po_id         UUID,
  p_performed_by  UUID,
  p_items         JSONB   -- [{ "item_id": uuid, "product_id": uuid, "quantity_received": int, "unit_price": numeric }]
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_po_status     TEXT;
  v_reference     TEXT;
  v_item          JSONB;
  v_item_id       UUID;
  v_product_id    UUID;
  v_received      INT;
  v_unit_price    NUMERIC;
  v_previous_qty  INT;
  v_previous_price NUMERIC;
  v_new_price     NUMERIC;
  v_product_name  TEXT;
  v_new_qty       INT;
  v_details       JSONB := '[]'::JSONB;
BEGIN
  SELECT status, reference INTO v_po_status, v_reference
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
    v_item_id    := NULLIF(v_item->>'item_id', '')::UUID;
    v_product_id := NULLIF(v_item->>'product_id', '')::UUID;
    v_received   := NULLIF(v_item->>'quantity_received', '')::INT;
    v_unit_price := NULLIF(v_item->>'unit_price', '')::NUMERIC;

    CONTINUE WHEN v_item_id IS NULL;
    v_received := COALESCE(v_received, 0);

    -- Toujours enregistrer la quantité reçue, même 0 — trace honnête
    -- de ce qui n'a pas été livré, même si aucun réassort n'a lieu.
    UPDATE purchase_order_items SET quantity_received = v_received
      WHERE id = v_item_id AND purchase_order_id = p_po_id;

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

    v_details := v_details || JSONB_BUILD_OBJECT(
      'product_id',   v_product_id,
      'product_name', v_product_name,
      'previous_qty', v_previous_qty,
      'new_qty',      v_new_qty,
      'price_from',   v_previous_price,
      'price_to',     COALESCE(v_new_price, v_previous_price)
    );
  END LOOP;

  UPDATE purchase_orders SET status = 'received', received_at = now(), updated_at = now()
    WHERE id = p_po_id;

  RETURN JSONB_BUILD_OBJECT('items', v_details);
END;
$$;

REVOKE ALL ON FUNCTION apply_purchase_order_receipt(UUID, UUID, UUID, JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION apply_purchase_order_receipt(UUID, UUID, UUID, JSONB) TO service_role;

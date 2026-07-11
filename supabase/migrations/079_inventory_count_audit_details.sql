-- ============================================================
-- Migration 079 : Inventaire physique — détail des items pour le journal
-- ============================================================
-- apply_inventory_count() ne retournait que l'agrégat (adjusted_count,
-- value_delta), insuffisant pour construire un journal de session
-- ("qui a compté quoi") côté audit_logs. Ajoute un tableau `items`
-- au résultat JSONB, avec le nom du produit capturé au moment du
-- comptage (comme le fait déjà l'audit log de suppression de produit).

CREATE OR REPLACE FUNCTION apply_inventory_count(
  p_shop_id       UUID,
  p_performed_by  UUID,
  p_items         JSONB   -- [{ "product_id": uuid, "counted_qty": int, "reason_code": text }]
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_item          JSONB;
  v_product_id    UUID;
  v_counted       INT;
  v_reason_code   TEXT;
  v_reason_label  TEXT;
  v_previous      INT;
  v_buying_price  NUMERIC;
  v_product_name  TEXT;
  v_adjusted      INT := 0;
  v_value_delta   NUMERIC := 0;
  v_details       JSONB := '[]'::JSONB;
BEGIN
  FOR v_item IN SELECT * FROM JSONB_ARRAY_ELEMENTS(p_items) LOOP
    v_product_id := NULLIF(v_item->>'product_id', '')::UUID;
    v_counted    := NULLIF(v_item->>'counted_qty', '')::INT;

    CONTINUE WHEN v_product_id IS NULL OR v_counted IS NULL OR v_counted < 0;

    SELECT quantity, buying_price, name INTO v_previous, v_buying_price, v_product_name
      FROM products
      WHERE id = v_product_id AND shop_id = p_shop_id
      FOR UPDATE;

    CONTINUE WHEN NOT FOUND OR v_previous = v_counted;

    v_reason_code := COALESCE(v_item->>'reason_code', 'correction');
    v_reason_label := CASE v_reason_code
      WHEN 'damage'  THEN 'Dommage'
      WHEN 'loss'    THEN 'Perte'
      WHEN 'theft'   THEN 'Vol'
      WHEN 'expiry'  THEN 'Expiration'
      WHEN 'other'   THEN 'Autre'
      ELSE 'Correction de stock'
    END;

    UPDATE products SET quantity = v_counted, updated_at = now()
      WHERE id = v_product_id;

    INSERT INTO stock_movements(
      shop_id, product_id, type, quantity, previous_qty, new_qty, reason, performed_by
    ) VALUES (
      p_shop_id, v_product_id, 'adjustment', v_counted - v_previous,
      v_previous, v_counted, 'Inventaire physique — ' || v_reason_label, p_performed_by
    );

    v_adjusted    := v_adjusted + 1;
    v_value_delta := v_value_delta + (v_counted - v_previous) * COALESCE(v_buying_price, 0);
    v_details := v_details || JSONB_BUILD_OBJECT(
      'product_id',   v_product_id,
      'product_name', v_product_name,
      'previous_qty', v_previous,
      'new_qty',      v_counted,
      'reason_code',  v_reason_code,
      'reason_label', v_reason_label
    );
  END LOOP;

  RETURN JSONB_BUILD_OBJECT(
    'adjusted_count', v_adjusted,
    'value_delta',    v_value_delta,
    'items',          v_details
  );
END;
$$;

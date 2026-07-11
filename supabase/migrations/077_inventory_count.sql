-- ============================================================
-- Migration 077 : Inventaire physique — apply_inventory_count()
-- ============================================================
-- Aucun moyen n'existait jusqu'ici de corriger le stock suite à une
-- casse, un vol ou une erreur de comptage : seules les ventes et les
-- restocks modifient products.quantity. Le type 'adjustment' existe
-- déjà dans la contrainte de stock_movements mais n'avait aucun
-- producteur. Cette fonction applique un lot de comptages (produit ->
-- quantité réelle) en une transaction atomique, ne touchant que les
-- produits dont la quantité comptée diffère du stock théorique.

CREATE OR REPLACE FUNCTION apply_inventory_count(
  p_shop_id       UUID,
  p_performed_by  UUID,
  p_items         JSONB   -- [{ "product_id": uuid, "counted_qty": int }]
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
  v_previous      INT;
  v_buying_price  NUMERIC;
  v_adjusted      INT := 0;
  v_value_delta   NUMERIC := 0;
BEGIN
  FOR v_item IN SELECT * FROM JSONB_ARRAY_ELEMENTS(p_items) LOOP
    v_product_id := NULLIF(v_item->>'product_id', '')::UUID;
    v_counted    := NULLIF(v_item->>'counted_qty', '')::INT;

    CONTINUE WHEN v_product_id IS NULL OR v_counted IS NULL OR v_counted < 0;

    SELECT quantity, buying_price INTO v_previous, v_buying_price
      FROM products
      WHERE id = v_product_id AND shop_id = p_shop_id
      FOR UPDATE;

    CONTINUE WHEN NOT FOUND OR v_previous = v_counted;

    UPDATE products SET quantity = v_counted, updated_at = now()
      WHERE id = v_product_id;

    INSERT INTO stock_movements(
      shop_id, product_id, type, quantity, previous_qty, new_qty, reason, performed_by
    ) VALUES (
      p_shop_id, v_product_id, 'adjustment', v_counted - v_previous,
      v_previous, v_counted, 'Inventaire physique', p_performed_by
    );

    v_adjusted    := v_adjusted + 1;
    v_value_delta := v_value_delta + (v_counted - v_previous) * COALESCE(v_buying_price, 0);
  END LOOP;

  RETURN JSONB_BUILD_OBJECT(
    'adjusted_count', v_adjusted,
    'value_delta',    v_value_delta
  );
END;
$$;

REVOKE ALL ON FUNCTION apply_inventory_count(UUID, UUID, JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION apply_inventory_count(UUID, UUID, JSONB) TO service_role;

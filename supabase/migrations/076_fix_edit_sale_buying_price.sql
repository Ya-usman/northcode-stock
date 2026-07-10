-- ============================================================
-- Migration 076 : corrige edit_sale() qui oubliait buying_price
-- ============================================================
-- edit_sale() supprimait puis réinsérait les sale_items sans jamais
-- reporter buying_price — toute vente modifiée retombait à un coût
-- d'achat de 0 pour ses articles, gonflant artificiellement la marge
-- brute calculée dans les Rapports (revenu correct, coût à tort nul).
--
-- Fix : capture le buying_price des anciens articles avant suppression
-- (par product_id) et le réapplique aux articles inchangés lors de la
-- réinsertion ; pour un article réellement ajouté pendant la
-- modification (absent des anciens), récupère le buying_price courant
-- depuis products.

CREATE OR REPLACE FUNCTION edit_sale(
  p_sale_id        UUID,
  p_edited_by      UUID,
  p_customer_id    UUID,          -- NULL for walk-in
  p_payment_method TEXT,
  p_notes          TEXT,
  p_items          JSONB          -- [{product_id, product_name, quantity, unit_price}]
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
BEGIN
  -- 1. Lock the sale
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

  -- 2. Reverse old customer debt (before any changes)
  IF v_sale.customer_id IS NOT NULL AND v_sale.balance > 0 THEN
    UPDATE customers
    SET total_debt = greatest(0, total_debt - v_sale.balance)
    WHERE id = v_sale.customer_id;
  END IF;

  -- 2.5. Capture historical cost basis (product_id -> buying_price) from the
  -- CURRENT items, before they get restored/deleted below — this is the only
  -- place the original cost is still known once we delete the rows.
  SELECT COALESCE(JSONB_OBJECT_AGG(product_id, buying_price), '{}'::JSONB)
    INTO v_old_prices
    FROM sale_items
    WHERE sale_id = p_sale_id AND product_id IS NOT NULL;

  -- 3. Restore stock for all current items + record movements
  FOR v_item IN SELECT * FROM sale_items WHERE sale_id = p_sale_id LOOP
    IF v_item.product_id IS NOT NULL THEN
      UPDATE products
        SET quantity = quantity + v_item.quantity, updated_at = now()
        WHERE id = v_item.product_id;
      INSERT INTO stock_movements(shop_id, product_id, type, quantity, reason, performed_by)
      VALUES (
        v_sale.shop_id, v_item.product_id, 'in', v_item.quantity,
        'Modification vente #' || v_sale.sale_number, p_edited_by
      );
    END IF;
  END LOOP;

  -- 4. Delete all current items
  DELETE FROM sale_items WHERE sale_id = p_sale_id;

  -- 5. Compute new subtotal, insert new items, deduct new stock
  FOR v_elem IN SELECT * FROM JSONB_ARRAY_ELEMENTS(p_items) LOOP
    v_new_sub := v_new_sub
      + (v_elem->>'quantity')::INT * (v_elem->>'unit_price')::NUMERIC;

    -- product_id is optional (could be a free-text item)
    v_prod_id := NULLIF(v_elem->>'product_id', '')::UUID;

    -- Preserve the item's original cost if it was already on this sale;
    -- otherwise (a product newly added during this edit) use its current
    -- buying_price. Free-text items (no product_id) have no cost basis.
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
    VALUES (
      p_sale_id,
      v_prod_id,
      v_elem->>'product_name',
      (v_elem->>'quantity')::INT,
      (v_elem->>'unit_price')::NUMERIC,
      COALESCE(v_buying_price, 0)
    );

    IF v_prod_id IS NOT NULL THEN
      UPDATE products
        SET quantity = quantity - (v_elem->>'quantity')::INT, updated_at = now()
        WHERE id = v_prod_id;
      INSERT INTO stock_movements(shop_id, product_id, type, quantity, reason, performed_by)
      VALUES (
        v_sale.shop_id, v_prod_id, 'sale', (v_elem->>'quantity')::INT,
        'Modification vente #' || v_sale.sale_number, p_edited_by
      );
    END IF;
  END LOOP;

  -- 6. New total (keep original discount and tax)
  v_new_total := v_new_sub - COALESCE(v_sale.discount, 0) + COALESCE(v_sale.tax, 0);
  IF v_new_total < 0 THEN v_new_total := 0; END IF;

  -- 7. Guard: amount already collected cannot exceed new total
  IF v_sale.amount_paid > v_new_total THEN
    RAISE EXCEPTION
      'Le montant déjà encaissé (%) dépasse le nouveau total (%)',
      v_sale.amount_paid, v_new_total
      USING ERRCODE = 'P0005';
  END IF;

  -- 8. New balance and payment status
  v_new_bal := v_new_total - v_sale.amount_paid;
  IF v_new_bal <= 0 THEN
    v_new_status := 'paid';
    v_new_bal    := 0;
  ELSIF v_sale.amount_paid > 0 THEN
    v_new_status := 'partial';
  ELSE
    v_new_status := 'pending';
  END IF;

  -- 9. Update the sale record (balance is generated: auto-updated via total)
  UPDATE sales SET
    customer_id    = p_customer_id,
    payment_method = p_payment_method,
    notes          = p_notes,
    subtotal       = v_new_sub,
    total          = v_new_total,
    payment_status = v_new_status
  WHERE id = p_sale_id;

  -- 10. Apply new customer debt
  IF p_customer_id IS NOT NULL AND v_new_bal > 0 THEN
    UPDATE customers
    SET total_debt = total_debt + v_new_bal
    WHERE id = p_customer_id;
  END IF;

  RETURN JSONB_BUILD_OBJECT(
    'new_total',   v_new_total,
    'new_balance', v_new_bal,
    'new_status',  v_new_status
  );
END;
$$;

REVOKE ALL ON FUNCTION edit_sale(UUID, UUID, UUID, TEXT, TEXT, JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION edit_sale(UUID, UUID, UUID, TEXT, TEXT, JSONB) TO service_role;

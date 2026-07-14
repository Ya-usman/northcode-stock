-- ============================================================
-- Migration 087 : Câblage FEFO dans la vente — Phase 1 (suite)
-- ============================================================
-- Câble deplete_product_batches()/restore_sale_item_batches() (migration
-- 086) dans les 4 fonctions qui touchent products.quantity côté vente :
-- le déclencheur de déduction, et les 3 RPC d'annulation/suppression/
-- modification. Dans chaque cas, l'UPDATE existant sur products.quantity
-- reste inchangé (il reste la source de vérité) — on ajoute seulement
-- l'écriture parallèle dans les lots.
--
-- Répare au passage un trou pré-existant dans edit_sale() : elle ne
-- verrouillait pas (FOR UPDATE) la ligne products avant de restaurer/
-- redéduire le stock, contrairement au déclencheur de vente (durci en
-- migration 057) — trou non introduit par ce travail, mais comme cette
-- fonction est réécrite de toute façon, on applique la même garde.

-- ---- deduct_stock_on_sale (déclencheur de vente) ---------------------------
CREATE OR REPLACE FUNCTION deduct_stock_on_sale()
RETURNS trigger AS $$
DECLARE
  v_shop_id uuid;
  v_cashier_id uuid;
  v_sale_number text;
  v_current_qty int;
BEGIN
  IF new.product_id IS NULL THEN
    RETURN new;
  END IF;

  -- Lock the product row before reading to prevent TOCTOU race condition:
  -- without FOR UPDATE, two concurrent transactions can both read the same
  -- quantity and both pass the stock check before either deducts.
  SELECT quantity INTO v_current_qty
  FROM products
  WHERE id = new.product_id
  FOR UPDATE;

  IF v_current_qty IS NULL THEN
    RETURN new;
  END IF;

  IF v_current_qty < new.quantity THEN
    RAISE EXCEPTION 'Stock insuffisant pour le produit % (disponible: %, demandé: %)',
      new.product_id, v_current_qty, new.quantity
      USING ERRCODE = 'P0001';
  END IF;

  UPDATE products
  SET quantity = quantity - new.quantity,
      updated_at = now()
  WHERE id = new.product_id;

  -- Suivi des lots (FEFO) — writes en parallèle, ne bloque jamais la vente
  -- (voir garantie dans deplete_product_batches, migration 086).
  PERFORM deplete_product_batches(new.product_id, new.quantity, new.id);

  SELECT s.shop_id, s.cashier_id, s.sale_number
  INTO v_shop_id, v_cashier_id, v_sale_number
  FROM sales s WHERE s.id = new.sale_id;

  INSERT INTO stock_movements (shop_id, product_id, type, quantity, reason, performed_by)
  VALUES (v_shop_id, new.product_id, 'sale', new.quantity, 'Sale ' || v_sale_number, v_cashier_id);

  RETURN new;
END;
$$ LANGUAGE plpgsql;


-- ---- cancel_sale -------------------------------------------------------------
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
BEGIN
  SELECT * INTO v_sale FROM sales WHERE id = p_sale_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Vente introuvable' USING ERRCODE = 'P0002';
  END IF;
  IF v_sale.sale_status = 'cancelled' THEN
    RAISE EXCEPTION 'Vente déjà annulée' USING ERRCODE = 'P0003';
  END IF;

  FOR v_item IN SELECT * FROM sale_items WHERE sale_id = p_sale_id LOOP
    IF v_item.product_id IS NOT NULL THEN
      PERFORM 1 FROM products WHERE id = v_item.product_id FOR UPDATE;

      UPDATE products
        SET quantity = quantity + v_item.quantity, updated_at = now()
        WHERE id = v_item.product_id;

      -- Restaure vers les lots exacts qui avaient couvert cette ligne,
      -- au lieu de deviner (voir migration 086).
      PERFORM restore_sale_item_batches(v_item.id);

      INSERT INTO stock_movements (shop_id, product_id, type, quantity, reason, notes, performed_by)
      VALUES (
        v_sale.shop_id, v_item.product_id, 'in', v_item.quantity,
        'Annulation vente #' || v_sale.sale_number,
        p_reason,
        p_cancelled_by
      );
    END IF;
  END LOOP;

  UPDATE sales SET
    sale_status  = 'cancelled',
    cancelled_by = p_cancelled_by,
    cancelled_at = now(),
    cancel_reason = p_reason
  WHERE id = p_sale_id;
END;
$$;

REVOKE ALL ON FUNCTION cancel_sale(uuid, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION cancel_sale(uuid, uuid, text) TO service_role;


-- ---- delete_sale ---------------------------------------------------------------
CREATE OR REPLACE FUNCTION delete_sale(
  p_sale_id uuid,
  p_user_id  uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sale record;
  v_item record;
BEGIN
  SELECT * INTO v_sale FROM sales WHERE id = p_sale_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Vente introuvable' USING ERRCODE = 'P0002';
  END IF;

  -- Restore stock only if sale was never cancelled
  IF v_sale.sale_status = 'active' THEN
    FOR v_item IN SELECT * FROM sale_items WHERE sale_id = p_sale_id LOOP
      IF v_item.product_id IS NOT NULL THEN
        PERFORM 1 FROM products WHERE id = v_item.product_id FOR UPDATE;

        UPDATE products
          SET quantity = quantity + v_item.quantity, updated_at = now()
          WHERE id = v_item.product_id;

        -- Lue avant que sale_items ne soit supprimé plus bas (qui cascade
        -- sale_item_batches) — voir migration 086.
        PERFORM restore_sale_item_batches(v_item.id);
      END IF;
    END LOOP;
  END IF;

  DELETE FROM sale_items WHERE sale_id = p_sale_id;
  DELETE FROM payments   WHERE sale_id = p_sale_id;
  DELETE FROM sales      WHERE id      = p_sale_id;
END;
$$;

REVOKE ALL ON FUNCTION delete_sale(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION delete_sale(uuid, uuid) TO service_role;


-- ---- edit_sale -------------------------------------------------------------
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
  v_new_item_id  UUID;
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
  -- FOR UPDATE ajouté ici (garde manquante auparavant, voir migration 086) —
  -- avant tout accès aux lots du produit (discipline anti-interblocage).
  FOR v_item IN SELECT * FROM sale_items WHERE sale_id = p_sale_id LOOP
    IF v_item.product_id IS NOT NULL THEN
      PERFORM 1 FROM products WHERE id = v_item.product_id FOR UPDATE;

      UPDATE products
        SET quantity = quantity + v_item.quantity, updated_at = now()
        WHERE id = v_item.product_id;

      PERFORM restore_sale_item_batches(v_item.id);

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
    )
    RETURNING id INTO v_new_item_id;

    IF v_prod_id IS NOT NULL THEN
      PERFORM 1 FROM products WHERE id = v_prod_id FOR UPDATE;

      UPDATE products
        SET quantity = quantity - (v_elem->>'quantity')::INT, updated_at = now()
        WHERE id = v_prod_id;

      PERFORM deplete_product_batches(v_prod_id, (v_elem->>'quantity')::INT, v_new_item_id);

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

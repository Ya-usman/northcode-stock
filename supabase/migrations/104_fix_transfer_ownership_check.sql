-- ============================================================
-- 104 — Corrige la vérification "même propriétaire" de send_stock_transfer
--
-- shops.owner_id n'est pas fiable dans cette base — de nombreuses boutiques
-- actives (dont "Boutique Alpha") ont owner_id à NULL alors qu'elles ont un
-- vrai owner actif dans shop_members, la source de vérité utilisée partout
-- ailleurs dans l'app pour l'appartenance. La vérification se fait donc
-- maintenant directement sur shop_members : l'appelant (p_performed_by) doit
-- être owner actif des DEUX boutiques — plus fiable (fonctionne même si
-- owner_id est vide) et plus strict (vérifie le vrai appelant, pas juste que
-- deux colonnes owner_id concordent).
-- ============================================================

CREATE OR REPLACE FUNCTION send_stock_transfer(
  p_source_shop_id       UUID,
  p_destination_shop_id  UUID,
  p_performed_by         UUID,
  p_notes                TEXT,
  p_items                JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_dest_name      TEXT;
  v_year           TEXT := to_char(now(), 'YYYY');
  v_seq            INT;
  v_reference      TEXT;
  v_transfer_id    UUID;
  v_item           JSONB;
  v_product_id     UUID;
  v_quantity       INT;
  v_previous_qty   INT;
  v_buying_price   NUMERIC;
  v_selling_price  NUMERIC;
  v_product_name   TEXT;
  v_product_unit   TEXT;
  v_new_qty        INT;
BEGIN
  IF p_source_shop_id = p_destination_shop_id THEN
    RAISE EXCEPTION 'La boutique destination doit être différente de la boutique source';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM shop_members
    WHERE shop_id = p_source_shop_id AND user_id = p_performed_by AND role = 'owner' AND is_active = true
  ) OR NOT EXISTS (
    SELECT 1 FROM shop_members
    WHERE shop_id = p_destination_shop_id AND user_id = p_performed_by AND role = 'owner' AND is_active = true
  ) THEN
    RAISE EXCEPTION 'Vous devez être propriétaire actif des deux boutiques pour créer un transfert';
  END IF;

  SELECT name INTO v_dest_name FROM shops WHERE id = p_destination_shop_id;

  SELECT COUNT(*) + 1 INTO v_seq
    FROM stock_transfers
    WHERE source_shop_id = p_source_shop_id
      AND created_at >= (v_year || '-01-01')::timestamptz;
  v_reference := 'TR-' || v_year || '-' || LPAD(v_seq::text, 4, '0');

  INSERT INTO stock_transfers (
    reference, source_shop_id, destination_shop_id, status, notes, created_by
  ) VALUES (
    v_reference, p_source_shop_id, p_destination_shop_id, 'sent', p_notes, p_performed_by
  ) RETURNING id INTO v_transfer_id;

  FOR v_item IN SELECT * FROM JSONB_ARRAY_ELEMENTS(p_items) LOOP
    v_product_id := NULLIF(v_item->>'product_id', '')::UUID;
    v_quantity   := NULLIF(v_item->>'quantity', '')::INT;
    CONTINUE WHEN v_product_id IS NULL OR v_quantity IS NULL OR v_quantity <= 0;

    SELECT quantity, buying_price, selling_price, name, unit
      INTO v_previous_qty, v_buying_price, v_selling_price, v_product_name, v_product_unit
      FROM products
      WHERE id = v_product_id AND shop_id = p_source_shop_id
      FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Produit introuvable dans la boutique source';
    END IF;
    IF v_previous_qty < v_quantity THEN
      RAISE EXCEPTION 'Stock insuffisant pour %  (disponible : %, demandé : %)', v_product_name, v_previous_qty, v_quantity;
    END IF;

    v_new_qty := v_previous_qty - v_quantity;
    UPDATE products SET quantity = v_new_qty, updated_at = now() WHERE id = v_product_id;

    INSERT INTO stock_movements (shop_id, product_id, type, quantity, previous_qty, new_qty, reason, performed_by)
      VALUES (p_source_shop_id, v_product_id, 'out', v_quantity, v_previous_qty, v_new_qty,
              'Transfert ' || v_reference || ' vers ' || v_dest_name, p_performed_by);

    INSERT INTO stock_transfer_items (
      stock_transfer_id, source_product_id, product_name, unit,
      buying_price, selling_price, quantity_sent
    ) VALUES (
      v_transfer_id, v_product_id, v_product_name, v_product_unit,
      v_buying_price, v_selling_price, v_quantity
    );
  END LOOP;

  RETURN JSONB_BUILD_OBJECT('id', v_transfer_id, 'reference', v_reference);
END;
$$;

REVOKE ALL ON FUNCTION send_stock_transfer(UUID, UUID, UUID, TEXT, JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION send_stock_transfer(UUID, UUID, UUID, TEXT, JSONB) TO service_role;

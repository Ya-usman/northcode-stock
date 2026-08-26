-- ============================================================
-- Migration 117 : Correction de quantité et suppression d'un lot
-- ============================================================
-- Deux manques identifiés sur product_batches (086) : seule la date de
-- péremption était corrigeable (087, .../expiry route), jamais la quantité
-- ni le lot lui-même (ex. mauvais comptage à la réception, doublon créé
-- par erreur). products.quantity reste la source de vérité pour le stock
-- total (voir 086) — toute correction au niveau du lot doit donc la
-- maintenir en phase, avec le même verrouillage FOR UPDATE (lot puis
-- produit, dans cet ordre) déjà utilisé par deplete_product_batches et
-- apply_inventory_count (089), pour éviter toute course avec une vente ou
-- un autre ajustement concurrent.

-- ── adjust_batch_quantity() ──────────────────────────────────────────────
-- Corrige la quantité restante d'un lot précis. Le delta (positif ou
-- négatif) est répercuté sur products.quantity, et journalisé dans
-- stock_movements exactement comme un ajustement d'inventaire (089) — donc
-- visible dans Mouvements sans UI supplémentaire.
CREATE OR REPLACE FUNCTION adjust_batch_quantity(
  p_batch_id      UUID,
  p_shop_id       UUID,
  p_new_quantity  INT,
  p_reason_code   TEXT,
  p_performed_by  UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_product_id    UUID;
  v_old_qty       INT;
  v_delta         INT;
  v_product_qty   INT;
  v_new_prod_qty  INT;
  v_reason_label  TEXT;
BEGIN
  IF p_new_quantity IS NULL OR p_new_quantity < 0 THEN
    RAISE EXCEPTION 'invalid_quantity';
  END IF;

  SELECT product_id, quantity INTO v_product_id, v_old_qty
    FROM product_batches
    WHERE id = p_batch_id AND shop_id = p_shop_id
    FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'batch_not_found';
  END IF;

  v_delta := p_new_quantity - v_old_qty;
  IF v_delta = 0 THEN
    RETURN JSONB_BUILD_OBJECT('batch_quantity', v_old_qty);
  END IF;

  SELECT quantity INTO v_product_qty
    FROM products
    WHERE id = v_product_id AND shop_id = p_shop_id
    FOR UPDATE;

  v_new_prod_qty := GREATEST(0, v_product_qty + v_delta);

  UPDATE product_batches SET quantity = p_new_quantity, updated_at = now()
    WHERE id = p_batch_id;

  UPDATE products SET quantity = v_new_prod_qty, updated_at = now()
    WHERE id = v_product_id;

  v_reason_label := CASE p_reason_code
    WHEN 'damage'  THEN 'Dommage'
    WHEN 'loss'    THEN 'Perte'
    WHEN 'theft'   THEN 'Vol'
    WHEN 'expiry'  THEN 'Expiration'
    WHEN 'other'   THEN 'Autre'
    ELSE 'Correction de stock'
  END;

  INSERT INTO stock_movements(
    shop_id, product_id, type, quantity, previous_qty, new_qty, reason, performed_by
  ) VALUES (
    p_shop_id, v_product_id, 'adjustment', v_delta,
    v_product_qty, v_new_prod_qty, 'Correction de lot — ' || v_reason_label, p_performed_by
  );

  RETURN JSONB_BUILD_OBJECT('batch_quantity', p_new_quantity, 'product_quantity', v_new_prod_qty);
END;
$$;

-- ── delete_product_batch() ───────────────────────────────────────────────
-- Supprime définitivement un lot — refusé si une vente en a déjà consommé
-- une partie (sale_item_batches), car cela casserait la restauration
-- précise du stock à l'annulation d'une vente (restore_sale_item_batches,
-- 086). Dans ce cas, seule adjust_batch_quantity() ci-dessus reste possible.
CREATE OR REPLACE FUNCTION delete_product_batch(
  p_batch_id      UUID,
  p_shop_id       UUID,
  p_reason_code   TEXT,
  p_performed_by  UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_product_id    UUID;
  v_batch_qty     INT;
  v_product_qty   INT;
  v_new_prod_qty  INT;
  v_reason_label  TEXT;
BEGIN
  SELECT product_id, quantity INTO v_product_id, v_batch_qty
    FROM product_batches
    WHERE id = p_batch_id AND shop_id = p_shop_id
    FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'batch_not_found';
  END IF;

  IF EXISTS (SELECT 1 FROM sale_item_batches WHERE batch_id = p_batch_id) THEN
    RAISE EXCEPTION 'batch_already_sold';
  END IF;

  SELECT quantity INTO v_product_qty
    FROM products
    WHERE id = v_product_id AND shop_id = p_shop_id
    FOR UPDATE;

  v_new_prod_qty := GREATEST(0, v_product_qty - v_batch_qty);

  UPDATE products SET quantity = v_new_prod_qty, updated_at = now()
    WHERE id = v_product_id;

  v_reason_label := CASE p_reason_code
    WHEN 'damage'  THEN 'Dommage'
    WHEN 'loss'    THEN 'Perte'
    WHEN 'theft'   THEN 'Vol'
    WHEN 'expiry'  THEN 'Expiration'
    WHEN 'other'   THEN 'Autre'
    ELSE 'Correction de stock'
  END;

  IF v_batch_qty > 0 THEN
    INSERT INTO stock_movements(
      shop_id, product_id, type, quantity, previous_qty, new_qty, reason, performed_by
    ) VALUES (
      p_shop_id, v_product_id, 'adjustment', -v_batch_qty,
      v_product_qty, v_new_prod_qty, 'Suppression de lot — ' || v_reason_label, p_performed_by
    );
  END IF;

  DELETE FROM product_batches WHERE id = p_batch_id;

  RETURN JSONB_BUILD_OBJECT('product_quantity', v_new_prod_qty);
END;
$$;

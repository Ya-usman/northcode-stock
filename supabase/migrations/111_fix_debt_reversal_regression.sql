-- ============================================================
-- 111 — Corrige la régression : annuler/supprimer une vente à crédit
--        ne remettait plus la dette du client à jour
-- ============================================================
-- La migration 022 avait ajouté à cancel_sale()/delete_sale() la logique
-- qui retire le solde de la vente de customers.total_debt à l'annulation
-- ou la suppression. La migration 087 a réécrit ces deux fonctions pour
-- brancher la restauration des lots FEFO (restore_sale_item_batches), en
-- partant d'une version antérieure au correctif 022 — la partie qui
-- annule la dette a été perdue dans cette réécriture. Le stock était donc
-- bien restauré, mais la dette du client restait figée indéfiniment.
--
-- Cette migration :
--   1. Recolle la logique de 022 sur la version actuelle (087) des deux
--      fonctions — tout le reste (verrous FOR UPDATE, restauration des
--      lots, journal des mouvements de stock) est inchangé.
--   2. Recalcule la dette de TOUS les clients à partir de leurs ventes
--      actives réelles, pour corriger la dérive accumulée depuis le
--      déploiement de 087 (pas seulement le cas remarqué manuellement) —
--      sales.balance est une colonne générée, donc toujours exacte pour
--      chaque vente individuellement, quelle que soit la dérive passée du
--      compteur total_debt.

-- ---- cancel_sale (corrigée) -------------------------------------------------
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

  -- Reverse customer debt if the sale had an outstanding balance (022, régressé par 087)
  IF v_sale.balance > 0 AND v_sale.customer_id IS NOT NULL THEN
    UPDATE customers
    SET total_debt = greatest(0, total_debt - v_sale.balance)
    WHERE id = v_sale.customer_id;
  END IF;

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


-- ---- delete_sale (corrigée) -------------------------------------------------
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

  -- Restore stock only if sale was never cancelled (cancellation already restored stock)
  IF v_sale.sale_status = 'active' THEN
    FOR v_item IN SELECT * FROM sale_items WHERE sale_id = p_sale_id LOOP
      IF v_item.product_id IS NOT NULL THEN
        PERFORM 1 FROM products WHERE id = v_item.product_id FOR UPDATE;

        UPDATE products
          SET quantity = quantity + v_item.quantity, updated_at = now()
          WHERE id = v_item.product_id;

        PERFORM restore_sale_item_batches(v_item.id);
      END IF;
    END LOOP;

    -- Reverse debt only for active sales — a cancelled sale already had its
    -- debt reversed by cancel_sale (022, régressé par 087)
    IF v_sale.balance > 0 AND v_sale.customer_id IS NOT NULL THEN
      UPDATE customers
      SET total_debt = greatest(0, total_debt - v_sale.balance)
      WHERE id = v_sale.customer_id;
    END IF;
  END IF;

  DELETE FROM sale_items WHERE sale_id = p_sale_id;
  DELETE FROM payments   WHERE sale_id = p_sale_id;
  DELETE FROM sales      WHERE id      = p_sale_id;
END;
$$;

REVOKE ALL ON FUNCTION delete_sale(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION delete_sale(uuid, uuid) TO service_role;


-- ---- Recalcul ponctuel de la dette de tous les clients ----------------------
-- Corrige la dérive accumulée par la régression ci-dessus (ventes annulées
-- ou supprimées entre le déploiement de 087 et ce correctif), pour tous les
-- clients concernés, pas seulement le cas remarqué manuellement.
UPDATE customers c
SET total_debt = COALESCE((
  SELECT SUM(s.balance) FROM sales s
  WHERE s.customer_id = c.id AND s.sale_status = 'active'
), 0)
WHERE c.total_debt IS DISTINCT FROM COALESCE((
  SELECT SUM(s.balance) FROM sales s
  WHERE s.customer_id = c.id AND s.sale_status = 'active'
), 0);

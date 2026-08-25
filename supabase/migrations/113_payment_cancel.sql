-- ============================================================
-- 113 — Annulation "soft" et modification d'un remboursement
-- ============================================================
-- Un remboursement de dette enregistré via POST /api/payments était jusqu'ici
-- définitif : aucune façon de le corriger ou de l'annuler s'il a été saisi
-- par erreur. L'annulation reste "soft" (la ligne payments n'est jamais
-- supprimée, seulement marquée) — traçable dans l'historique et l'audit,
-- contrairement à une suppression pure.
--
-- sales.amount_paid/customers.total_debt sont des compteurs maintenus par
-- le trigger update_customer_debt_on_payment, mais seulement à l'INSERT —
-- rien ne les recalcule si on annule un paiement après coup. cancel_payment()
-- fait l'inverse exact de ce trigger pour sales.amount_paid/payment_status,
-- et recalcule customers.total_debt depuis zéro (somme des soldes actifs,
-- sales.balance étant une colonne générée toujours exacte) plutôt qu'un
-- simple -= amount — même principe que le correctif 111, pour ne pas
-- réintroduire le même genre de dérive silencieuse.

ALTER TABLE payments ADD COLUMN IF NOT EXISTS is_cancelled boolean NOT NULL DEFAULT false;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS cancelled_at timestamptz;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS cancelled_by uuid REFERENCES profiles(id) ON DELETE SET NULL;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS cancel_reason text;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS edited_at timestamptz;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS edited_by uuid REFERENCES profiles(id) ON DELETE SET NULL;

CREATE OR REPLACE FUNCTION cancel_payment(
  p_payment_id   uuid,
  p_cancelled_by uuid,
  p_reason       text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_payment payments%ROWTYPE;
  v_sale    sales%ROWTYPE;
  v_new_debt numeric;
BEGIN
  SELECT * INTO v_payment FROM payments WHERE id = p_payment_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Paiement introuvable' USING ERRCODE = 'P0002';
  END IF;
  IF v_payment.is_cancelled THEN
    RAISE EXCEPTION 'Paiement déjà annulé' USING ERRCODE = 'P0003';
  END IF;

  SELECT * INTO v_sale FROM sales WHERE id = v_payment.sale_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Vente introuvable' USING ERRCODE = 'P0002';
  END IF;

  UPDATE payments SET
    is_cancelled  = true,
    cancelled_at  = now(),
    cancelled_by  = p_cancelled_by,
    cancel_reason = p_reason
  WHERE id = p_payment_id;

  UPDATE sales SET
    amount_paid = greatest(0, amount_paid - v_payment.amount),
    payment_status = CASE
      WHEN (amount_paid - v_payment.amount) >= total THEN 'paid'
      WHEN (amount_paid - v_payment.amount) > 0 THEN 'partial'
      ELSE 'pending'
    END
  WHERE id = v_sale.id;

  -- Recalcul complet de la dette du client (pas un simple += amount) — la
  -- somme des soldes actifs est toujours exacte, contrairement au compteur.
  IF v_sale.customer_id IS NOT NULL THEN
    SELECT COALESCE(SUM(balance), 0) INTO v_new_debt
    FROM sales WHERE customer_id = v_sale.customer_id AND sale_status = 'active';

    UPDATE customers SET total_debt = v_new_debt WHERE id = v_sale.customer_id;
  END IF;

  RETURN jsonb_build_object('sale_id', v_sale.id, 'sale_number', v_sale.sale_number, 'amount', v_payment.amount);
END;
$$;

REVOKE ALL ON FUNCTION cancel_payment(uuid, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION cancel_payment(uuid, uuid, text) TO service_role;

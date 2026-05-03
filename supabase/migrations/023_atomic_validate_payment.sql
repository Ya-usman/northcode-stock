-- ============================================================
-- Migration 023 : Atomic payment validation — fix race condition (BUG-12)
-- ============================================================
-- The validate-payment API route read sale.balance without a row lock,
-- allowing two simultaneous requests to each see the full balance and
-- together overpay a sale. This function uses FOR UPDATE so only one
-- payment can proceed at a time for a given sale.

CREATE OR REPLACE FUNCTION validate_payment(
  p_sale_id   uuid,
  p_amount    numeric,
  p_method    text,
  p_reference text DEFAULT NULL,
  p_user_id   uuid DEFAULT NULL
)
RETURNS TABLE(applied numeric, new_balance numeric, payment_status text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sale        record;
  v_applied     numeric;
BEGIN
  -- Lock the sale row so concurrent calls serialize
  SELECT * INTO v_sale FROM sales WHERE id = p_sale_id FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Vente introuvable' USING ERRCODE = 'P0002';
  END IF;
  IF v_sale.sale_status = 'cancelled' THEN
    RAISE EXCEPTION 'Vente annulée' USING ERRCODE = 'P0003';
  END IF;
  IF v_sale.balance <= 0 THEN
    RAISE EXCEPTION 'Solde déjà nul' USING ERRCODE = 'P0004';
  END IF;

  -- Cap at the actual live balance (prevents overpayment even under concurrency)
  v_applied := LEAST(p_amount, v_sale.balance);

  IF v_applied <= 0 THEN
    RAISE EXCEPTION 'Montant invalide' USING ERRCODE = 'P0005';
  END IF;

  -- Insert payment record — the after_payment_insert trigger updates
  -- sales.amount_paid, sales.payment_status, and customers.total_debt
  INSERT INTO payments (sale_id, amount, method, reference, received_by)
  VALUES (p_sale_id, v_applied, p_method, p_reference, p_user_id);

  -- Update payment_method on the sale (not handled by the trigger)
  UPDATE sales SET payment_method = p_method WHERE id = p_sale_id;

  -- Return the outcome (balance is recalculated by the generated column after trigger fires)
  RETURN QUERY
    SELECT v_applied,
           GREATEST(0, v_sale.balance - v_applied),
           CASE
             WHEN (v_sale.balance - v_applied) <= 0 THEN 'paid'
             ELSE 'partial'
           END;
END;
$$;

REVOKE ALL ON FUNCTION validate_payment(uuid, numeric, text, text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION validate_payment(uuid, numeric, text, text, uuid) TO service_role;

-- ============================================================
-- Migration 058 : validate_payment reads actual balance after trigger
-- ============================================================
-- The function was returning a computed new_balance (v_sale.balance - v_applied)
-- calculated from data read BEFORE the INSERT INTO payments triggered
-- after_payment_insert. While correct in the normal case, it diverges
-- if any concurrent modification touched amount_paid between the SELECT
-- and the INSERT. Reading from DB after INSERT guarantees the UI always
-- shows the value that is actually stored.

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
  v_new_balance numeric;
  v_new_status  text;
BEGIN
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

  v_applied := LEAST(p_amount, v_sale.balance);

  IF v_applied <= 0 THEN
    RAISE EXCEPTION 'Montant invalide' USING ERRCODE = 'P0005';
  END IF;

  INSERT INTO payments (sale_id, amount, method, reference, received_by, is_repayment)
  VALUES (p_sale_id, v_applied, p_method, p_reference, p_user_id, true);

  UPDATE sales SET payment_method = p_method WHERE id = p_sale_id;

  -- Read the actual balance and status from DB after all triggers have run
  -- instead of computing from pre-INSERT values.
  SELECT balance, payment_status
  INTO v_new_balance, v_new_status
  FROM sales WHERE id = p_sale_id;

  RETURN QUERY SELECT v_applied, v_new_balance, v_new_status;
END;
$$;

REVOKE ALL ON FUNCTION validate_payment(uuid, numeric, text, text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION validate_payment(uuid, numeric, text, text, uuid) TO service_role;

-- ============================================================
-- Migration 056 : Distinguish initial sale payments from debt repayments
-- ============================================================
-- The payments table stores both kinds of records without distinction,
-- causing the "Remboursements" history tab to show all sales as repayments.
-- Adding is_repayment flag so the UI can filter correctly.

ALTER TABLE payments
  ADD COLUMN IF NOT EXISTS is_repayment boolean NOT NULL DEFAULT false;

-- Backfill: payments made more than 5 minutes after the sale's creation
-- are almost certainly debt repayments, not the initial sale payment.
UPDATE payments p
SET is_repayment = true
FROM sales s
WHERE p.sale_id = s.id
  AND p.paid_at > s.created_at + interval '5 minutes';

-- Update validate_payment RPC to mark payments it creates as repayments
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

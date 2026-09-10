-- ============================================================
-- Migration 131 : demandes de retrait des gains de parrainage
-- ============================================================
-- V1 : demande self-service + validation 100% manuelle par l'admin.
-- Aucun paiement externe automatique (point 15 de la demande).
--
-- Les fonds sont RÉSERVÉS dès la demande — sortis de available_balance et
-- inscrits comme mouvement 'payout' status 'pending'. Ils ne peuvent donc
-- pas aussi servir de crédit d'abonnement pendant que la demande est en
-- cours d'examen. Si l'admin rejette, ils reviennent dans available_balance.

-- ── request_referral_payout ──────────────────────────────────────────────
CREATE OR REPLACE FUNCTION request_referral_payout(
  p_user_id uuid,
  p_amount numeric,
  p_method text,
  p_payment_details jsonb
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_config     referral_program_config%ROWTYPE;
  v_wallet     referral_wallets%ROWTYPE;
  v_min        numeric;
  v_request_id uuid;
BEGIN
  SELECT * INTO v_config FROM referral_program_config LIMIT 1;
  IF NOT FOUND OR NOT v_config.enabled THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'disabled');
  END IF;

  SELECT * INTO v_wallet FROM referral_wallets WHERE user_id = p_user_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'no_wallet');
  END IF;
  IF v_wallet.frozen THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'frozen');
  END IF;

  -- Une seule demande ouverte à la fois
  IF EXISTS (
    SELECT 1 FROM referral_payout_requests
    WHERE user_id = p_user_id AND status IN ('requested', 'under_review', 'approved')
  ) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'request_already_open');
  END IF;

  v_min := COALESCE((v_config.min_payout_by_currency ->> v_wallet.currency)::numeric, 0);
  IF p_amount < v_min THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'below_minimum', 'minimum', v_min);
  END IF;

  IF p_amount <= 0 OR p_amount > v_wallet.available_balance THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'insufficient_balance');
  END IF;

  UPDATE referral_wallets SET available_balance = available_balance - p_amount, updated_at = now()
  WHERE id = v_wallet.id;

  INSERT INTO referral_payout_requests (user_id, wallet_id, amount, currency, method, payment_details, status)
  VALUES (p_user_id, v_wallet.id, p_amount, v_wallet.currency, p_method, p_payment_details, 'requested')
  RETURNING id INTO v_request_id;

  INSERT INTO referral_wallet_transactions (
    wallet_id, type, amount, currency, reference_type, reference_id, status, description
  ) VALUES (
    v_wallet.id, 'payout', -p_amount, v_wallet.currency, 'payout_request', v_request_id, 'pending', 'Demande de retrait'
  );

  RETURN jsonb_build_object('ok', true, 'request_id', v_request_id, 'amount', p_amount, 'currency', v_wallet.currency);
END;
$$;

-- ── resolve_referral_payout ──────────────────────────────────────────────
-- Actions admin : under_review / approved / paid / rejected, et cancelled
-- (le commerçant peut annuler sa propre demande tant qu'elle n'est pas payée).
--   - rejected / cancelled → les fonds réservés reviennent dans available_balance,
--     le mouvement passe à 'reversed'.
--   - paid → le mouvement passe à 'completed' (les fonds sont partis pour de bon).
--   - under_review / approved → aucun mouvement d'argent, juste le statut.
CREATE OR REPLACE FUNCTION resolve_referral_payout(
  p_request_id uuid,
  p_new_status text,
  p_reviewer_id uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_req referral_payout_requests%ROWTYPE;
BEGIN
  IF p_new_status NOT IN ('under_review', 'approved', 'paid', 'rejected', 'cancelled') THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid_status');
  END IF;

  SELECT * INTO v_req FROM referral_payout_requests WHERE id = p_request_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_found');
  END IF;
  IF v_req.status IN ('paid', 'rejected', 'cancelled') THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'already_final');
  END IF;

  IF p_new_status IN ('rejected', 'cancelled') THEN
    UPDATE referral_wallets SET available_balance = available_balance + v_req.amount, updated_at = now()
    WHERE id = v_req.wallet_id;
    UPDATE referral_wallet_transactions
    SET status = 'reversed',
        description = CASE WHEN p_new_status = 'rejected' THEN 'Retrait rejeté — remboursé' ELSE 'Retrait annulé — remboursé' END
    WHERE reference_type = 'payout_request' AND reference_id = p_request_id AND type = 'payout' AND status = 'pending';
  ELSIF p_new_status = 'paid' THEN
    UPDATE referral_wallet_transactions
    SET status = 'completed', description = 'Retrait payé'
    WHERE reference_type = 'payout_request' AND reference_id = p_request_id AND type = 'payout' AND status = 'pending';
  END IF;

  UPDATE referral_payout_requests
  SET status = p_new_status,
      reviewed_by = p_reviewer_id,
      reviewed_at = now(),
      paid_at = CASE WHEN p_new_status = 'paid' THEN now() ELSE paid_at END,
      updated_at = now()
  WHERE id = p_request_id;

  RETURN jsonb_build_object('ok', true, 'status', p_new_status);
END;
$$;

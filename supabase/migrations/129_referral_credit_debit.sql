-- ============================================================
-- Migration 129 : débit atomique du crédit de parrainage sur un abonnement
-- ============================================================
-- Appelée par lib/referrals/apply-credit.ts depuis les 4 routes de
-- vérification de paiement (et directement depuis app/api/billing/subscribe
-- quand le crédit couvre 100% du prix — aucun passage par une passerelle).
--
-- Le montant réellement débité est toujours re-plafonné au solde RÉEL au
-- moment de l'appel (jamais celui calculé côté client ou même côté
-- app/api/billing/subscribe à l'initiation du paiement) — le solde a pu
-- changer entre l'initiation du paiement et sa confirmation (ex: deux
-- onglets, une demande de retrait entre-temps). Le paiement a déjà été
-- confirmé côté passerelle à ce stade : on ne bloque jamais l'activation
-- du plan pour un écart de solde, on débite simplement ce qui est
-- réellement disponible.
--
-- Idempotence : une seule ligne de crédit par souscription, garantie par
-- la vérification d'existence ci-dessous (rejeu de webhook sans danger).
CREATE OR REPLACE FUNCTION debit_referral_wallet_credit(
  p_user_id uuid,
  p_intended_amount numeric,
  p_currency text,
  p_subscription_id uuid,
  p_description text DEFAULT 'Crédit StockShop — abonnement'
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_wallet referral_wallets%ROWTYPE;
  v_amount numeric;
BEGIN
  IF p_intended_amount IS NULL OR p_intended_amount <= 0 THEN
    RETURN jsonb_build_object('debited', 0, 'reason', 'nothing_to_debit');
  END IF;

  SELECT * INTO v_wallet FROM referral_wallets WHERE user_id = p_user_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('debited', 0, 'reason', 'no_wallet');
  END IF;

  IF v_wallet.frozen THEN
    RETURN jsonb_build_object('debited', 0, 'reason', 'frozen');
  END IF;

  IF v_wallet.currency <> p_currency THEN
    RETURN jsonb_build_object('debited', 0, 'reason', 'currency_mismatch');
  END IF;

  IF EXISTS (
    SELECT 1 FROM referral_wallet_transactions
    WHERE wallet_id = v_wallet.id AND reference_type = 'subscription'
      AND reference_id = p_subscription_id AND type = 'subscription_credit'
  ) THEN
    RETURN jsonb_build_object('debited', 0, 'reason', 'already_applied');
  END IF;

  v_amount := LEAST(p_intended_amount, v_wallet.available_balance);
  IF v_amount <= 0 THEN
    RETURN jsonb_build_object('debited', 0, 'reason', 'insufficient_balance');
  END IF;

  UPDATE referral_wallets SET available_balance = available_balance - v_amount, updated_at = now()
  WHERE id = v_wallet.id;

  INSERT INTO referral_wallet_transactions (
    wallet_id, type, amount, currency, reference_type, reference_id, status, description
  ) VALUES (
    v_wallet.id, 'subscription_credit', -v_amount, p_currency, 'subscription', p_subscription_id, 'completed', p_description
  );

  RETURN jsonb_build_object('debited', v_amount);
END;
$$;

-- ============================================================
-- Migration 132 : modération admin du programme de parrainage
-- ============================================================

-- ── cancel_referral_reward ───────────────────────────────────────────────
-- Annule une récompense (fraude constatée, ou remboursement du paiement
-- source — point 18 de la demande).
--   - status 'pending'   → 'reversed', retiré de pending_balance.
--   - status 'available' → 'reversed', retiré de available_balance MAIS
--     plafonné au solde réel : si le parrain a déjà dépensé le crédit, on
--     ne descend jamais le portefeuille en négatif ; le manque est
--     enregistré dans la description du mouvement pour la compta.
--   - déjà 'reversed'/'rejected' → no-op.
CREATE OR REPLACE FUNCTION cancel_referral_reward(
  p_reward_id uuid,
  p_reviewer_id uuid,
  p_reason text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_reward  referral_rewards%ROWTYPE;
  v_wallet  referral_wallets%ROWTYPE;
  v_clawed  numeric;
  v_short   numeric;
BEGIN
  SELECT * INTO v_reward FROM referral_rewards WHERE id = p_reward_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_found');
  END IF;
  IF v_reward.status IN ('reversed', 'rejected') THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'already_final');
  END IF;

  SELECT * INTO v_wallet FROM referral_wallets WHERE user_id = v_reward.referrer_user_id FOR UPDATE;

  IF v_reward.status = 'pending' THEN
    IF FOUND THEN
      UPDATE referral_wallets
      SET pending_balance = GREATEST(pending_balance - v_reward.amount, 0), updated_at = now()
      WHERE id = v_wallet.id;
    END IF;
    UPDATE referral_wallet_transactions
    SET status = 'reversed', description = 'Récompense annulée (admin)'
    WHERE reference_type = 'referral_reward' AND reference_id = p_reward_id AND status = 'pending';
    v_clawed := v_reward.amount;

  ELSE  -- 'available'
    IF FOUND THEN
      v_clawed := LEAST(v_reward.amount, v_wallet.available_balance);
      v_short  := v_reward.amount - v_clawed;
      UPDATE referral_wallets SET available_balance = available_balance - v_clawed, updated_at = now()
      WHERE id = v_wallet.id;
      UPDATE referral_wallet_transactions
      SET status = 'reversed'
      WHERE reference_type = 'referral_reward' AND reference_id = p_reward_id;
      INSERT INTO referral_wallet_transactions (
        wallet_id, type, amount, currency, reference_type, reference_id, status, description
      ) VALUES (
        v_wallet.id, 'reversal', -v_clawed, v_reward.currency, 'referral_reward', p_reward_id, 'completed',
        CASE WHEN v_short > 0
          THEN 'Récompense annulée (admin) — manque ' || v_short::text || ' déjà dépensé'
          ELSE 'Récompense annulée (admin)' END
      );
    ELSE
      v_clawed := 0;
    END IF;
  END IF;

  UPDATE referral_rewards SET status = 'reversed', updated_at = now() WHERE id = p_reward_id;
  UPDATE referrals SET status = 'cancelled', updated_at = now() WHERE id = v_reward.referral_id;

  RETURN jsonb_build_object('ok', true, 'clawed_back', v_clawed);
END;
$$;

-- ── adjust_referral_wallet ───────────────────────────────────────────────
-- Ajustement manuel du solde disponible par l'admin (+ ou -). Un montant
-- négatif ne peut jamais descendre le solde sous 0.
CREATE OR REPLACE FUNCTION adjust_referral_wallet(
  p_user_id uuid,
  p_amount numeric,
  p_reason text,
  p_reviewer_id uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_wallet referral_wallets%ROWTYPE;
  v_applied numeric;
BEGIN
  IF p_amount = 0 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'zero_amount');
  END IF;

  SELECT * INTO v_wallet FROM referral_wallets WHERE user_id = p_user_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'no_wallet');
  END IF;

  IF p_amount < 0 THEN
    v_applied := -LEAST(-p_amount, v_wallet.available_balance);
  ELSE
    v_applied := p_amount;
  END IF;

  IF v_applied = 0 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'nothing_to_apply');
  END IF;

  UPDATE referral_wallets SET available_balance = available_balance + v_applied, updated_at = now()
  WHERE id = v_wallet.id;

  INSERT INTO referral_wallet_transactions (
    wallet_id, type, amount, currency, reference_type, reference_id, status, description
  ) VALUES (
    v_wallet.id, 'adjustment', v_applied, v_wallet.currency, 'admin', p_reviewer_id, 'completed',
    COALESCE('Ajustement admin — ' || p_reason, 'Ajustement admin')
  );

  RETURN jsonb_build_object('ok', true, 'applied', v_applied);
END;
$$;

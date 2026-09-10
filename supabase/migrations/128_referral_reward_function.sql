-- ============================================================
-- Migration 128 : création + maturation atomiques d'une récompense
-- ============================================================

-- Correctif : la contrainte posée en 127 sur referral_wallet_transactions
-- n'autorisait pas le statut 'pending', nécessaire pour qu'un mouvement de
-- récompense encore en attente de validation soit visible dans l'historique
-- avant de passer à 'completed' à maturation (même ligne, pas de doublon).
ALTER TABLE referral_wallet_transactions DROP CONSTRAINT IF EXISTS referral_wallet_transactions_status_check;
ALTER TABLE referral_wallet_transactions ADD CONSTRAINT referral_wallet_transactions_status_check
  CHECK (status IN ('pending', 'completed', 'reversed'));

-- ── create_referral_reward ────────────────────────────────────────────────
-- Appelée depuis lib/referrals/process-reward.ts, elle-même appelée par
-- chacune des 4 routes de vérification de paiement (Paystack/Flutterwave/
-- NotchPay/Wave) juste après l'insertion de la ligne subscriptions.
--
-- Tout se passe dans UNE transaction (comportement par défaut d'une
-- fonction Postgres appelée via .rpc()) : réclamation du parrainage,
-- création de la récompense, mise à jour du solde, écriture du mouvement.
-- Jamais d'état partiel (point 22 de la demande).
--
-- Sécurité anti-doublon à deux niveaux :
--  1. `UPDATE ... WHERE first_paid_subscription_id IS NULL` — un seul
--     appel peut "réclamer" ce parrainage, même en cas d'appels
--     concurrents (webhook + callback navigateur pour le même paiement).
--  2. `UNIQUE(source_payment_id)` sur referral_rewards — filet de sécurité
--     si jamais la réclamation passait deux fois (ne devrait pas arriver).
CREATE OR REPLACE FUNCTION create_referral_reward(
  p_owner_id uuid,
  p_subscription_id uuid,
  p_shop_currency text,
  p_plan_id text,
  p_amount numeric,
  p_country text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_config   referral_program_config%ROWTYPE;
  v_referral referrals%ROWTYPE;
  v_wallet   referral_wallets%ROWTYPE;
  v_reward_amount numeric;
  v_available_at  timestamptz;
  v_reward_id     uuid;
BEGIN
  SELECT * INTO v_config FROM referral_program_config LIMIT 1;
  IF NOT FOUND OR NOT v_config.enabled THEN
    RETURN jsonb_build_object('created', false, 'reason', 'disabled');
  END IF;

  IF p_plan_id IS NOT NULL AND NOT (p_plan_id = ANY(v_config.eligible_plans)) THEN
    RETURN jsonb_build_object('created', false, 'reason', 'plan_not_eligible');
  END IF;

  IF v_config.eligible_countries IS NOT NULL AND p_country IS NOT NULL
     AND NOT (p_country = ANY(v_config.eligible_countries)) THEN
    RETURN jsonb_build_object('created', false, 'reason', 'country_not_eligible');
  END IF;

  SELECT * INTO v_referral FROM referrals WHERE referred_user_id = p_owner_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('created', false, 'reason', 'not_referred');
  END IF;

  IF v_referral.status IN ('rejected', 'cancelled') THEN
    RETURN jsonb_build_object('created', false, 'reason', 'referral_inactive');
  END IF;

  -- Réclamation atomique du parrainage pour ce paiement
  UPDATE referrals
  SET first_paid_subscription_id = p_subscription_id, qualified_at = now(), status = 'reward_pending'
  WHERE id = v_referral.id AND first_paid_subscription_id IS NULL
  RETURNING * INTO v_referral;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('created', false, 'reason', 'already_qualified');
  END IF;

  -- Portefeuille du parrain — créé à la volée si besoin, devise figée à la
  -- création (première visite de Paramètres > Parrainage OU première
  -- récompense, selon ce qui arrive en premier).
  SELECT * INTO v_wallet FROM referral_wallets WHERE user_id = v_referral.referrer_user_id FOR UPDATE;
  IF NOT FOUND THEN
    INSERT INTO referral_wallets (user_id, currency) VALUES (v_referral.referrer_user_id, p_shop_currency)
    RETURNING * INTO v_wallet;
  END IF;

  -- V1 : aucune conversion de devise — pas de mélange dans un même solde
  -- sans mécanisme explicite (point 4 de la demande). Si la devise du
  -- paiement du filleul diffère de celle du portefeuille du parrain, la
  -- récompense n'est pas créée pour l'instant (à traiter en V2).
  IF v_wallet.currency <> p_shop_currency THEN
    RETURN jsonb_build_object('created', false, 'reason', 'currency_mismatch', 'referral_id', v_referral.id);
  END IF;

  v_reward_amount := round(p_amount * v_config.reward_percentage / 100.0, 2);
  v_available_at := now() + (v_config.validation_days || ' days')::interval;

  INSERT INTO referral_rewards (
    referral_id, referrer_user_id, amount, currency, percentage, status, source_payment_id, available_at
  ) VALUES (
    v_referral.id, v_referral.referrer_user_id, v_reward_amount, v_wallet.currency, v_config.reward_percentage,
    'pending', p_subscription_id, v_available_at
  )
  RETURNING id INTO v_reward_id;

  UPDATE referral_wallets SET pending_balance = pending_balance + v_reward_amount, updated_at = now()
  WHERE id = v_wallet.id;

  INSERT INTO referral_wallet_transactions (
    wallet_id, type, amount, currency, reference_type, reference_id, status, description
  ) VALUES (
    v_wallet.id, 'reward', v_reward_amount, v_wallet.currency, 'referral_reward', v_reward_id, 'pending',
    'Parrainage — récompense en attente'
  );

  RETURN jsonb_build_object('created', true, 'reward_id', v_reward_id, 'amount', v_reward_amount, 'currency', v_wallet.currency);
END;
$$;

-- ── mature_referral_rewards ─────────────────────────────────────────────
-- Appelée quotidiennement par app/api/cron/referral-maturity/route.ts.
-- Fait passer chaque récompense 'pending' dont la période de validation
-- est écoulée à 'available', et bascule son solde de pending_balance vers
-- available_balance — même ligne de mouvement mise à jour (pending →
-- completed), pas de doublon dans l'historique.
CREATE OR REPLACE FUNCTION mature_referral_rewards() RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_reward referral_rewards%ROWTYPE;
  v_count  integer := 0;
BEGIN
  FOR v_reward IN
    SELECT * FROM referral_rewards
    WHERE status = 'pending' AND available_at IS NOT NULL AND available_at <= now()
    ORDER BY created_at
    FOR UPDATE SKIP LOCKED
  LOOP
    UPDATE referral_rewards SET status = 'available', updated_at = now() WHERE id = v_reward.id;

    UPDATE referral_wallets
    SET pending_balance = pending_balance - v_reward.amount,
        available_balance = available_balance + v_reward.amount,
        updated_at = now()
    WHERE user_id = v_reward.referrer_user_id;

    UPDATE referral_wallet_transactions
    SET status = 'completed', description = 'Parrainage — récompense disponible'
    WHERE reference_type = 'referral_reward' AND reference_id = v_reward.id AND status = 'pending';

    UPDATE referrals SET status = 'reward_available', updated_at = now() WHERE id = v_reward.referral_id;

    v_count := v_count + 1;
  END LOOP;

  RETURN jsonb_build_object('matured', v_count);
END;
$$;

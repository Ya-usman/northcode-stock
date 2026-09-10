-- ============================================================
-- Migration 137 : le portefeuille du parrain est toujours dans SA devise
-- ============================================================
-- Jusqu'ici, si le portefeuille du parrain n'existait pas encore au moment
-- où un filleul payait, create_referral_reward le créait avec la devise du
-- FILLEUL (`p_shop_currency`). Contraire au point 4 de la demande : la
-- devise du portefeuille doit suivre celle du PARRAIN.
--
-- En pratique le portefeuille est presque toujours déjà créé (dès que le
-- parrain ouvre Paramètres > Parrainage), mais on ferme le cas limite.
--
-- + fonction utilitaire currency_code_for_country() réutilisable
--   (même table de correspondance que la migration 136, en un seul endroit).

-- ── Code ISO de devise pour un code pays ──────────────────────────────
CREATE OR REPLACE FUNCTION currency_code_for_country(p_country text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE p_country
    WHEN 'NG' THEN 'NGN'
    WHEN 'GH' THEN 'GHS'
    WHEN 'GN' THEN 'GNF'
    WHEN 'GM' THEN 'GMD'
    WHEN 'SL' THEN 'SLE'
    WHEN 'LR' THEN 'LRD'
    WHEN 'CV' THEN 'CVE'
    WHEN 'MR' THEN 'MRU'
    WHEN 'CD' THEN 'CDF'
    WHEN 'EU' THEN 'EUR'
    WHEN 'US' THEN 'USD'
    WHEN 'CA' THEN 'CAD'
    WHEN 'CM' THEN 'XAF' WHEN 'CG' THEN 'XAF' WHEN 'GA' THEN 'XAF'
    WHEN 'GQ' THEN 'XAF' WHEN 'CF' THEN 'XAF' WHEN 'TD' THEN 'XAF'
    WHEN 'CI' THEN 'XOF' WHEN 'ML' THEN 'XOF' WHEN 'NE' THEN 'XOF'
    WHEN 'SN' THEN 'XOF' WHEN 'BJ' THEN 'XOF' WHEN 'TG' THEN 'XOF'
    WHEN 'BF' THEN 'XOF' WHEN 'GW' THEN 'XOF'
    ELSE 'NGN'
  END
$$;

-- ── create_referral_reward : portefeuille dans la devise du PARRAIN ────
-- Identique à la migration 128 sauf le bloc « portefeuille du parrain » :
-- s'il faut le créer, la devise vient de la boutique principale du parrain
-- (profiles.shop_id), pas du paiement du filleul.
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
  v_referrer_currency text;
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

  UPDATE referrals
  SET first_paid_subscription_id = p_subscription_id, qualified_at = now(), status = 'reward_pending'
  WHERE id = v_referral.id AND first_paid_subscription_id IS NULL
  RETURNING * INTO v_referral;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('created', false, 'reason', 'already_qualified');
  END IF;

  -- Portefeuille du parrain — créé à la volée si besoin, DANS SA DEVISE
  -- (boutique principale du parrain), jamais celle du paiement du filleul.
  SELECT * INTO v_wallet FROM referral_wallets WHERE user_id = v_referral.referrer_user_id FOR UPDATE;
  IF NOT FOUND THEN
    SELECT currency_code_for_country(s.country) INTO v_referrer_currency
    FROM profiles p
    LEFT JOIN shops s ON s.id = p.shop_id
    WHERE p.id = v_referral.referrer_user_id;

    IF v_referrer_currency IS NULL THEN
      SELECT currency_code_for_country(s.country) INTO v_referrer_currency
      FROM shop_members sm
      JOIN shops s ON s.id = sm.shop_id
      WHERE sm.user_id = v_referral.referrer_user_id AND sm.role = 'owner' AND sm.is_active = true
      ORDER BY sm.created_at
      LIMIT 1;
    END IF;

    INSERT INTO referral_wallets (user_id, currency)
    VALUES (v_referral.referrer_user_id, COALESCE(v_referrer_currency, p_shop_currency))
    RETURNING * INTO v_wallet;
  END IF;

  -- V1 : aucune conversion de devise — si la devise du paiement du filleul
  -- diffère de celle du portefeuille du parrain, pas de récompense (à
  -- traiter en V2). Comportement documenté.
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

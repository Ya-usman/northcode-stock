-- ============================================================
-- Migration 134 : anti-fraude du programme de parrainage
-- ============================================================
-- Points 25-28 de la demande. Aucune règle ne repose sur la seule adresse
-- IP : le score combine plusieurs signaux (voir lib/referrals/fraud.ts).
-- Une association jugée risquée est marquée `needs_review = true` : sa
-- récompense est bien créée (visible en attente pour le parrain et l'admin)
-- mais NE MÛRIT PAS tant qu'un super_admin ne l'a pas approuvée.

-- ── Colonnes de revue sur referrals ─────────────────────────────────────
ALTER TABLE referrals ADD COLUMN IF NOT EXISTS needs_review boolean NOT NULL DEFAULT false;
ALTER TABLE referrals ADD COLUMN IF NOT EXISTS risk_flags   jsonb   NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE referrals ADD COLUMN IF NOT EXISTS reviewed_by  uuid    REFERENCES auth.users(id);
ALTER TABLE referrals ADD COLUMN IF NOT EXISTS reviewed_at  timestamptz;

CREATE INDEX IF NOT EXISTS idx_referrals_needs_review ON referrals(needs_review) WHERE needs_review = true;

-- ── Réglages anti-fraude dans la config centrale ────────────────────────
ALTER TABLE referral_program_config ADD COLUMN IF NOT EXISTS fraud_auto_hold       boolean NOT NULL DEFAULT true;
ALTER TABLE referral_program_config ADD COLUMN IF NOT EXISTS max_referrals_per_day integer NOT NULL DEFAULT 20;

-- ── mature_referral_rewards : saute les récompenses sous revue ──────────
-- Seule différence avec la version 133 : la jointure sur referrals + le
-- filtre `rf.needs_review = false`. Le reste (bascule de solde, mouvement
-- mis à jour sur place, détail renvoyé pour les notifications) est identique.
CREATE OR REPLACE FUNCTION mature_referral_rewards() RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_reward  referral_rewards%ROWTYPE;
  v_count   integer := 0;
  v_matured jsonb := '[]'::jsonb;
BEGIN
  FOR v_reward IN
    SELECT r.* FROM referral_rewards r
    JOIN referrals rf ON rf.id = r.referral_id
    WHERE r.status = 'pending'
      AND r.available_at IS NOT NULL AND r.available_at <= now()
      AND rf.needs_review = false
    ORDER BY r.created_at
    FOR UPDATE OF r SKIP LOCKED
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

    v_matured := v_matured || jsonb_build_object(
      'referrer_user_id', v_reward.referrer_user_id,
      'amount',           v_reward.amount,
      'currency',         v_reward.currency
    );
    v_count := v_count + 1;
  END LOOP;

  RETURN jsonb_build_object('matured', v_count, 'rewards', v_matured);
END;
$$;

-- ── review_referral : décision manuelle d'un super_admin ────────────────
--   'approve' → needs_review = false ; la récompense mûrira au prochain cron.
--   'reject'  → la référence passe 'rejected' ; toute récompense encore
--     active est annulée en réutilisant cancel_referral_reward (clawback
--     plafonné au solde réel, mouvement de reversal, jamais négatif).
CREATE OR REPLACE FUNCTION review_referral(
  p_referral_id uuid,
  p_decision    text,
  p_reviewer_id uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_referral  referrals%ROWTYPE;
  v_reward_id uuid;
BEGIN
  IF p_decision NOT IN ('approve', 'reject') THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid_decision');
  END IF;

  SELECT * INTO v_referral FROM referrals WHERE id = p_referral_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_found');
  END IF;
  IF NOT v_referral.needs_review THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_pending_review');
  END IF;

  IF p_decision = 'approve' THEN
    UPDATE referrals
    SET needs_review = false, reviewed_by = p_reviewer_id, reviewed_at = now()
    WHERE id = p_referral_id;
    RETURN jsonb_build_object('ok', true, 'decision', 'approve');
  END IF;

  -- reject
  SELECT id INTO v_reward_id FROM referral_rewards
  WHERE referral_id = p_referral_id AND status IN ('pending', 'available')
  ORDER BY created_at LIMIT 1;

  IF v_reward_id IS NOT NULL THEN
    PERFORM cancel_referral_reward(v_reward_id, p_reviewer_id, 'Parrainage rejeté — revue anti-fraude');
  END IF;

  UPDATE referrals
  SET status = 'rejected', needs_review = false, reviewed_by = p_reviewer_id, reviewed_at = now()
  WHERE id = p_referral_id;

  RETURN jsonb_build_object('ok', true, 'decision', 'reject', 'reward_reversed', v_reward_id IS NOT NULL);
END;
$$;

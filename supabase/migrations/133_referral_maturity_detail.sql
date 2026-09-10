-- ============================================================
-- Migration 133 : mature_referral_rewards renvoie le détail des
-- récompenses mûries
-- ============================================================
-- Le cron app/api/cron/referral-maturity/route.ts a besoin de savoir
-- QUELLES récompenses viennent de passer à 'available' pour envoyer une
-- notification in-app au parrain concerné (phase 7). La fonction ne
-- renvoyait qu'un compteur : on ajoute la liste des lignes mûries.
--
-- Logique transactionnelle inchangée — seul le jsonb de retour évolue
-- (ajout de la clé `rewards`, la clé `matured` est conservée).

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

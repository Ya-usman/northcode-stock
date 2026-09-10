-- Index manquant sur referral_rewards.referral_id — app/api/referrals/summary
-- filtre dessus (.in('referral_id', referralIds)) pour associer chaque
-- filleul à sa récompense éventuelle. Sans index, Postgres doit parcourir
-- la table entière à chaque visite de Paramètres > Parrainage.
CREATE INDEX IF NOT EXISTS idx_referral_rewards_referral ON referral_rewards(referral_id);

-- ============================================================
-- Migration 127 : Programme de parrainage utilisateur StockShop
-- ============================================================
-- Système de parrainage self-service pour les commerçants (distinct du
-- programme "Agents de terrain" existant — migration 052, agents/
-- agent_commissions — créé et géré manuellement par l'admin, qui touche à
-- CHAQUE paiement. Celui-ci est self-service, un code par utilisateur,
-- récompense limitée au PREMIER paiement du filleul. Les deux systèmes
-- restent séparés (tables distinctes) mais partagent la même philosophie
-- de wallet/transaction, réutilisable plus tard si les agents migrent
-- vers le même moteur.
--
-- Toutes les tables sont accessibles uniquement via le client admin
-- (service role) — RLS activée, aucune policy pour l'instant (comme
-- admin_notifications/shop_notes). Les lectures utilisateur passeront par
-- des routes API dédiées (comme le reste des données sensibles/financières
-- de l'app), pas par un accès direct client + RLS.

-- ── Configuration centrale (une seule ligne) ─────────────────────────────
CREATE TABLE IF NOT EXISTS referral_program_config (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  enabled                  boolean NOT NULL DEFAULT true,
  reward_percentage        numeric(5,2) NOT NULL DEFAULT 20.00,
  validation_days          integer NOT NULL DEFAULT 7,
  association_window_days  integer NOT NULL DEFAULT 14,
  min_payout_by_currency   jsonb NOT NULL DEFAULT '{"NGN": 10000, "XOF": 5000, "XAF": 5000, "GHS": 100, "EUR": 20, "USD": 20, "CAD": 25}'::jsonb,
  eligible_plans           text[] NOT NULL DEFAULT ARRAY['starter', 'pro', 'business'],
  eligible_countries       text[], -- NULL = tous les pays éligibles
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now()
);
INSERT INTO referral_program_config (id) VALUES ('00000000-0000-0000-0000-000000000001')
  ON CONFLICT (id) DO NOTHING;

-- ── Codes de parrainage — un par utilisateur ─────────────────────────────
CREATE TABLE IF NOT EXISTS referral_codes (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id  uuid NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  code           text NOT NULL UNIQUE,
  active         boolean NOT NULL DEFAULT true,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_referral_codes_code ON referral_codes(code);

-- ── Association filleul ↔ parrain ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS referrals (
  id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  referral_code_id            uuid NOT NULL REFERENCES referral_codes(id) ON DELETE RESTRICT,
  referrer_user_id             uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  referred_user_id             uuid NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  status                       text NOT NULL DEFAULT 'registered'
    CHECK (status IN ('invited', 'registered', 'trial', 'paid', 'reward_pending', 'reward_available', 'rejected', 'cancelled')),
  registered_at                timestamptz NOT NULL DEFAULT now(),
  qualified_at                 timestamptz, -- premier paiement confirmé
  first_paid_subscription_id   uuid REFERENCES subscriptions(id) ON DELETE SET NULL,
  created_at                   timestamptz NOT NULL DEFAULT now(),
  updated_at                   timestamptz NOT NULL DEFAULT now(),
  -- Impossible de se parrainer soi-même (point 17)
  CHECK (referrer_user_id <> referred_user_id)
);
CREATE INDEX IF NOT EXISTS idx_referrals_referrer ON referrals(referrer_user_id);
CREATE INDEX IF NOT EXISTS idx_referrals_status ON referrals(status);

-- ── Récompenses ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS referral_rewards (
  id                         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  referral_id                uuid NOT NULL REFERENCES referrals(id) ON DELETE CASCADE,
  referrer_user_id           uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  amount                     numeric(12,2) NOT NULL,
  currency                   text NOT NULL,
  percentage                 numeric(5,2) NOT NULL,
  status                     text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'available', 'reversed', 'rejected')),
  -- source_payment_id (pas la référence passerelle brute) = clé d'idempotence :
  -- un même paiement ne peut produire qu'une seule récompense, quel que soit
  -- le nombre de fois où un webhook/callback est rejoué (point 23).
  source_payment_id          uuid NOT NULL REFERENCES subscriptions(id) ON DELETE RESTRICT,
  available_at               timestamptz,
  created_at                 timestamptz NOT NULL DEFAULT now(),
  updated_at                 timestamptz NOT NULL DEFAULT now(),
  UNIQUE (source_payment_id)
);
CREATE INDEX IF NOT EXISTS idx_referral_rewards_referrer ON referral_rewards(referrer_user_id);
CREATE INDEX IF NOT EXISTS idx_referral_rewards_status ON referral_rewards(status);

-- ── Portefeuille — un par utilisateur, devise figée à la création ────────
CREATE TABLE IF NOT EXISTS referral_wallets (
  id                            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                       uuid NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  currency                      text NOT NULL,
  available_balance             numeric(12,2) NOT NULL DEFAULT 0,
  pending_balance                numeric(12,2) NOT NULL DEFAULT 0,
  frozen                        boolean NOT NULL DEFAULT false,
  auto_apply_to_subscription    boolean NOT NULL DEFAULT false,
  created_at                    timestamptz NOT NULL DEFAULT now(),
  updated_at                    timestamptz NOT NULL DEFAULT now()
);

-- ── Mouvements du portefeuille — historique complet ──────────────────────
CREATE TABLE IF NOT EXISTS referral_wallet_transactions (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  wallet_id       uuid NOT NULL REFERENCES referral_wallets(id) ON DELETE CASCADE,
  type            text NOT NULL CHECK (type IN ('reward', 'subscription_credit', 'payout', 'reversal', 'adjustment')),
  amount          numeric(12,2) NOT NULL, -- positif = crédit, négatif = débit
  currency        text NOT NULL,
  reference_type  text, -- 'referral_reward' | 'subscription' | 'payout_request' | 'admin'
  reference_id    uuid,
  status          text NOT NULL DEFAULT 'completed' CHECK (status IN ('completed', 'reversed')),
  description     text,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_referral_wallet_tx_wallet ON referral_wallet_transactions(wallet_id, created_at DESC);

-- ── Demandes de retrait ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS referral_payout_requests (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  wallet_id        uuid NOT NULL REFERENCES referral_wallets(id) ON DELETE CASCADE,
  amount           numeric(12,2) NOT NULL,
  currency         text NOT NULL,
  method           text,
  payment_details  jsonb,
  status           text NOT NULL DEFAULT 'requested'
    CHECK (status IN ('requested', 'under_review', 'approved', 'paid', 'rejected', 'cancelled')),
  reviewed_by      uuid REFERENCES auth.users(id),
  reviewed_at      timestamptz,
  paid_at          timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_referral_payout_user ON referral_payout_requests(user_id);
CREATE INDEX IF NOT EXISTS idx_referral_payout_status ON referral_payout_requests(status);

-- ── updated_at automatique (même pattern que agents, migration 052) ──────
CREATE OR REPLACE FUNCTION set_referral_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS referral_program_config_updated_at ON referral_program_config;
CREATE TRIGGER referral_program_config_updated_at BEFORE UPDATE ON referral_program_config FOR EACH ROW EXECUTE FUNCTION set_referral_updated_at();
DROP TRIGGER IF EXISTS referral_codes_updated_at ON referral_codes;
CREATE TRIGGER referral_codes_updated_at BEFORE UPDATE ON referral_codes FOR EACH ROW EXECUTE FUNCTION set_referral_updated_at();
DROP TRIGGER IF EXISTS referrals_updated_at ON referrals;
CREATE TRIGGER referrals_updated_at BEFORE UPDATE ON referrals FOR EACH ROW EXECUTE FUNCTION set_referral_updated_at();
DROP TRIGGER IF EXISTS referral_rewards_updated_at ON referral_rewards;
CREATE TRIGGER referral_rewards_updated_at BEFORE UPDATE ON referral_rewards FOR EACH ROW EXECUTE FUNCTION set_referral_updated_at();
DROP TRIGGER IF EXISTS referral_wallets_updated_at ON referral_wallets;
CREATE TRIGGER referral_wallets_updated_at BEFORE UPDATE ON referral_wallets FOR EACH ROW EXECUTE FUNCTION set_referral_updated_at();
DROP TRIGGER IF EXISTS referral_payout_requests_updated_at ON referral_payout_requests;
CREATE TRIGGER referral_payout_requests_updated_at BEFORE UPDATE ON referral_payout_requests FOR EACH ROW EXECUTE FUNCTION set_referral_updated_at();

-- ── RLS : service role uniquement (comme admin_notifications/shop_notes) ─
ALTER TABLE referral_program_config      ENABLE ROW LEVEL SECURITY;
ALTER TABLE referral_codes               ENABLE ROW LEVEL SECURITY;
ALTER TABLE referrals                    ENABLE ROW LEVEL SECURITY;
ALTER TABLE referral_rewards             ENABLE ROW LEVEL SECURITY;
ALTER TABLE referral_wallets             ENABLE ROW LEVEL SECURITY;
ALTER TABLE referral_wallet_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE referral_payout_requests     ENABLE ROW LEVEL SECURITY;

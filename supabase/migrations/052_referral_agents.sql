-- ============================================================
-- Système de parrainage : agents de terrain + commissions
-- ============================================================

-- Table des agents de terrain
CREATE TABLE IF NOT EXISTS agents (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name          TEXT NOT NULL,
  email         TEXT UNIQUE,
  phone         TEXT,
  city          TEXT,
  referral_code TEXT NOT NULL UNIQUE,
  commission_rate NUMERIC(5,2) NOT NULL DEFAULT 10.00, -- pourcentage ex: 10.00 = 10%
  is_active     BOOLEAN NOT NULL DEFAULT true,
  total_earned  NUMERIC(12,2) NOT NULL DEFAULT 0,
  total_paid    NUMERIC(12,2) NOT NULL DEFAULT 0,
  notes         TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Table des commissions par paiement
CREATE TABLE IF NOT EXISTS agent_commissions (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id            UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  shop_id             UUID NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  subscription_amount NUMERIC(12,2) NOT NULL, -- montant total payé par la boutique
  commission_amount   NUMERIC(12,2) NOT NULL, -- montant dû à l'agent
  plan_id             TEXT,
  billing_period      TEXT,
  paystack_reference  TEXT,
  status              TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'paid')),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  paid_at             TIMESTAMPTZ
);

-- Ajouter agent_id sur les boutiques
ALTER TABLE shops ADD COLUMN IF NOT EXISTS agent_id UUID REFERENCES agents(id) ON DELETE SET NULL;

-- Index pour les recherches fréquentes
CREATE INDEX IF NOT EXISTS agents_referral_code_idx ON agents(referral_code);
CREATE INDEX IF NOT EXISTS agent_commissions_agent_idx ON agent_commissions(agent_id);
CREATE INDEX IF NOT EXISTS agent_commissions_shop_idx ON agent_commissions(shop_id);
CREATE INDEX IF NOT EXISTS agent_commissions_status_idx ON agent_commissions(status);
CREATE INDEX IF NOT EXISTS shops_agent_id_idx ON shops(agent_id);

-- Trigger pour mettre à jour updated_at automatiquement
CREATE OR REPLACE FUNCTION update_agents_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS agents_updated_at ON agents;
CREATE TRIGGER agents_updated_at
  BEFORE UPDATE ON agents
  FOR EACH ROW EXECUTE FUNCTION update_agents_updated_at();

-- Trigger pour synchroniser total_earned quand une commission est créée
CREATE OR REPLACE FUNCTION sync_agent_totals()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE agents SET total_earned = total_earned + NEW.commission_amount WHERE id = NEW.agent_id;
  ELSIF TG_OP = 'UPDATE' AND OLD.status = 'pending' AND NEW.status = 'paid' THEN
    UPDATE agents SET total_paid = total_paid + NEW.commission_amount WHERE id = NEW.agent_id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS agent_commissions_sync ON agent_commissions;
CREATE TRIGGER agent_commissions_sync
  AFTER INSERT OR UPDATE ON agent_commissions
  FOR EACH ROW EXECUTE FUNCTION sync_agent_totals();

-- RLS : seul le super admin peut gérer les agents (via service role)
ALTER TABLE agents ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_commissions ENABLE ROW LEVEL SECURITY;

-- Policies : accès uniquement via service_role (API admin) — pas d'accès direct via anon/auth
CREATE POLICY "agents_service_role" ON agents FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "agent_commissions_service_role" ON agent_commissions FOR ALL USING (true) WITH CHECK (true);

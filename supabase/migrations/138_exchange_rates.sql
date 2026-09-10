-- ============================================================
-- Migration 138 : taux de change pour le reporting multi-devise
-- ============================================================
-- Sert UNIQUEMENT au reporting agrégé de l'administration (KPI du
-- programme de parrainage pour l'instant). Ne modifie JAMAIS un montant
-- financier stocké : chaque récompense / transaction / retrait conserve
-- son `amount` et sa `currency` d'origine. La conversion est cosmétique.
--
-- V1 : saisie manuelle par l'admin. Tous les taux sont exprimés vers un
-- pivot unique (USD) — n'importe quelle paire se dérive :
--   montant_cible = montant_source × taux(source→USD) ÷ taux(cible→USD)
-- Architecture prête pour une source automatique : il suffira d'insérer
-- des lignes avec source = 'ecb' / 'openexchange' / … et le code lira
-- toujours la ligne la plus récente (`as_of`) par paire.

CREATE TABLE IF NOT EXISTS exchange_rates (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  base_currency  text NOT NULL,                       -- 1 unité de cette devise (code ISO)
  quote_currency text NOT NULL,                       -- vaut `rate` unités de celle-ci (code ISO)
  rate           numeric(20,10) NOT NULL CHECK (rate > 0),
  as_of          timestamptz NOT NULL DEFAULT now(),  -- date/heure de validité du taux
  source         text NOT NULL DEFAULT 'manual',      -- 'manual' | 'manual_seed' | 'ecb' | …
  updated_by     uuid REFERENCES auth.users(id),
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT exchange_rates_diff CHECK (base_currency <> quote_currency),
  UNIQUE (base_currency, quote_currency, as_of)
);

CREATE INDEX IF NOT EXISTS idx_exchange_rates_pair
  ON exchange_rates (base_currency, quote_currency, as_of DESC);

DROP TRIGGER IF EXISTS exchange_rates_updated_at ON exchange_rates;
CREATE TRIGGER exchange_rates_updated_at BEFORE UPDATE ON exchange_rates
  FOR EACH ROW EXECUTE FUNCTION set_referral_updated_at();

ALTER TABLE exchange_rates ENABLE ROW LEVEL SECURITY;  -- service-role uniquement (comme le reste de /api/admin)

-- ── Seed : taux approximatifs (mi-2026) vers USD ─────────────────────────
-- source = 'manual_seed' + as_of daté : l'admin voit qu'ils doivent être
-- rafraîchis. Valeurs volontairement rondes — la mention « selon les taux
-- enregistrés » sous les KPI décharge de toute prétention d'exactitude.
INSERT INTO exchange_rates (base_currency, quote_currency, rate, as_of, source) VALUES
  ('EUR', 'USD', 1.08,        '2026-06-01T00:00:00Z', 'manual_seed'),
  ('CAD', 'USD', 0.73,        '2026-06-01T00:00:00Z', 'manual_seed'),
  ('NGN', 'USD', 0.00065,     '2026-06-01T00:00:00Z', 'manual_seed'),
  ('XOF', 'USD', 0.00166,     '2026-06-01T00:00:00Z', 'manual_seed'),
  ('XAF', 'USD', 0.00166,     '2026-06-01T00:00:00Z', 'manual_seed'),
  ('GHS', 'USD', 0.067,       '2026-06-01T00:00:00Z', 'manual_seed'),
  ('GNF', 'USD', 0.000116,    '2026-06-01T00:00:00Z', 'manual_seed'),
  ('GMD', 'USD', 0.0141,      '2026-06-01T00:00:00Z', 'manual_seed'),
  ('SLE', 'USD', 0.044,       '2026-06-01T00:00:00Z', 'manual_seed'),
  ('LRD', 'USD', 0.0052,      '2026-06-01T00:00:00Z', 'manual_seed'),
  ('CVE', 'USD', 0.0098,      '2026-06-01T00:00:00Z', 'manual_seed'),
  ('MRU', 'USD', 0.025,       '2026-06-01T00:00:00Z', 'manual_seed'),
  ('CDF', 'USD', 0.00035,     '2026-06-01T00:00:00Z', 'manual_seed')
ON CONFLICT (base_currency, quote_currency, as_of) DO NOTHING;

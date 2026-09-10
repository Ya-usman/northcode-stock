-- ============================================================
-- Migration 139 : taux de change — sources automatiques + override manuel
-- ============================================================
-- Étend exchange_rates (migration 138) pour :
--   - tracer le fournisseur de chaque taux (provider)
--   - distinguer la date de l'appel API (fetched_at) de la date de
--     validité du taux côté fournisseur (effective_date)
--   - marquer un taux comme override manuel (is_manual_override), qui
--     prend priorité sur les taux automatiques tant qu'il est actif
--
-- La conversion reste 100 % cosmétique : aucun montant de wallet /
-- paiement / retrait n'est jamais touché.

ALTER TABLE exchange_rates ADD COLUMN IF NOT EXISTS provider           text;
ALTER TABLE exchange_rates ADD COLUMN IF NOT EXISTS fetched_at         timestamptz;
ALTER TABLE exchange_rates ADD COLUMN IF NOT EXISTS effective_date     date;
ALTER TABLE exchange_rates ADD COLUMN IF NOT EXISTS is_manual_override boolean NOT NULL DEFAULT false;

-- Reprise des lignes existantes (seed de la migration 138)
UPDATE exchange_rates SET
  provider           = COALESCE(provider, source),
  fetched_at         = COALESCE(fetched_at, as_of),
  effective_date     = COALESCE(effective_date, as_of::date),
  is_manual_override = (source = 'manual')   -- seed ('manual_seed') = PAS un override
WHERE provider IS NULL;

CREATE INDEX IF NOT EXISTS idx_exchange_rates_override
  ON exchange_rates (base_currency, quote_currency, as_of DESC)
  WHERE is_manual_override = true;

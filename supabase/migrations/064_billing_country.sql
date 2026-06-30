-- ============================================================
-- 064 — BILLING_COUNTRY
--
-- Sépare le pays de facturation (gateway de paiement, immuable)
-- du pays opérationnel (affiché dans l'app, modifiable par l'owner).
--
-- billing_country est fixé à l'inscription et ne change jamais
-- côté owner — seul le super_admin peut le modifier.
-- ============================================================

ALTER TABLE shops
  ADD COLUMN IF NOT EXISTS billing_country TEXT DEFAULT NULL;

-- Backfill : utiliser le pays actuel pour toutes les boutiques existantes
UPDATE shops
  SET billing_country = COALESCE(country, 'NG')
  WHERE billing_country IS NULL;

-- ============================================================
-- Migration 141 : shops.currency — symbole d'affichage → code ISO
-- ============================================================
-- Phase B de la V3 des devises. NON DESTRUCTIVE :
--   - la valeur d'origine est sauvegardée dans shops.currency_legacy
--   - AUCUN montant n'est touché (sales, payments, expenses… n'ont pas de
--     colonne currency ; la devise est héritée de la boutique)
--   - la couche de compatibilité (Phase A : normalizeCurrency /
--     formatCurrency) tolère déjà les deux formats → aucun changement de
--     code nécessaire, l'app fonctionne en état hybride
--
-- ROLLBACK (si besoin — une seule instruction) :
--   UPDATE shops SET currency = currency_legacy WHERE currency_legacy IS NOT NULL;
--
-- Désambiguïsation « F CFA » : via currency_code_for_country(shops.country)
-- (fonction créée en migration 137) — jamais « tout F CFA → XAF ».

-- ── 1. Snapshot (idempotent) ────────────────────────────────────────────
ALTER TABLE shops ADD COLUMN IF NOT EXISTS currency_legacy text;
UPDATE shops SET currency_legacy = currency WHERE currency_legacy IS NULL;

-- ── 2. Journal de migration (traçabilité) ───────────────────────────────
CREATE TABLE IF NOT EXISTS currency_migration_log (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id    uuid REFERENCES shops(id) ON DELETE SET NULL,
  old_value  text,
  country    text,
  new_value  text,
  status     text NOT NULL,   -- 'migrated' | 'already_iso' | 'anomaly'
  note       text,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE currency_migration_log ENABLE ROW LEVEL SECURITY;  -- service-role only

-- ── 3. Symboles NON ambigus → code ISO ─────────────────────────────────
UPDATE shops SET currency = 'NGN' WHERE currency = '₦';
UPDATE shops SET currency = 'EUR' WHERE currency = '€';
UPDATE shops SET currency = 'USD' WHERE currency = '$';
UPDATE shops SET currency = 'CAD' WHERE currency IN ('CA$', 'C$');
UPDATE shops SET currency = 'GHS' WHERE currency = 'GH₵';
UPDATE shops SET currency = 'GNF' WHERE currency = 'FG';
UPDATE shops SET currency = 'GMD' WHERE currency = 'D';
UPDATE shops SET currency = 'SLE' WHERE currency = 'Le';
UPDATE shops SET currency = 'LRD' WHERE currency = 'L$';
UPDATE shops SET currency = 'CVE' WHERE currency = 'Esc';
UPDATE shops SET currency = 'MRU' WHERE currency = 'UM';
UPDATE shops SET currency = 'CDF' WHERE currency = 'FC';

-- ── 4. Franc CFA (ambigu) → départage par le pays ─────────────────────
UPDATE shops s
SET currency = currency_code_for_country(s.country)
WHERE s.currency IN ('F CFA', 'FCFA', 'CFA', 'FRS CFA', 'FR CFA', 'F.CFA')
  AND currency_code_for_country(s.country) IN ('XAF', 'XOF');

-- ── 5. Journalisation (une seule fois par boutique) ────────────────────
INSERT INTO currency_migration_log (shop_id, old_value, country, new_value, status, note)
SELECT
  s.id, s.currency_legacy, s.country, s.currency,
  CASE
    WHEN s.currency ~ '^[A-Z]{3}$' AND s.currency <> s.currency_legacy THEN 'migrated'
    WHEN s.currency ~ '^[A-Z]{3}$' AND s.currency  = s.currency_legacy THEN 'already_iso'
    ELSE 'anomaly'
  END,
  CASE
    WHEN s.currency !~ '^[A-Z]{3}$'
      THEN 'Valeur devise non résolue (' || COALESCE(s.currency_legacy, 'NULL')
           || ', pays=' || COALESCE(s.country, 'NULL') || ') — à traiter manuellement'
    ELSE NULL
  END
FROM shops s
WHERE s.currency_legacy IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM currency_migration_log l WHERE l.shop_id = s.id);

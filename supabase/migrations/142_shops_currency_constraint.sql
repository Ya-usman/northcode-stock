-- ============================================================
-- Migration 142 : shops.currency — verrouillage du schéma (Phase E, V3)
-- ============================================================
-- Toutes les boutiques sont en code ISO depuis la 141 (Phase B) et tous
-- les chemins d'écriture produisent un code ISO depuis la Phase C. On
-- verrouille désormais la colonne pour empêcher toute régression future
-- (retour d'un symbole d'affichage en base).
--
-- NON DESTRUCTIVE :
--   - aucun montant touché (les ventes/paiements/dépenses héritent de la
--     boutique, pas de colonne currency)
--   - currency_legacy et currency_migration_log CONSERVÉS (voie de retour
--     de la 141 — seront retirés dans un nettoyage ultérieur, une fois la
--     contrainte éprouvée en production)
--   - la couche de compat (normalizeCurrency / displayMetaFor) reste
--     tolérante aux symboles : des snapshots JSON de reçus stockés peuvent
--     encore en contenir. Seule l'ÉCRITURE en base est verrouillée ici.
--
-- ROLLBACK (si besoin) :
--   ALTER TABLE shops DROP CONSTRAINT IF EXISTS shops_currency_supported;
--   ALTER TABLE shops ALTER COLUMN currency DROP NOT NULL;
--   ALTER TABLE shops ALTER COLUMN currency SET DEFAULT '₦';

-- ── 1. Filet de sécurité : rien ne doit rester hors ISO ─────────────────
-- (attendu : 0 ligne — les 14 boutiques sont déjà migrées). Idempotent :
-- ne re-journalise pas une boutique déjà tracée par cette phase.
INSERT INTO currency_migration_log (shop_id, old_value, country, new_value, status, note)
SELECT s.id, s.currency, s.country, 'NGN', 'anomaly',
       'Phase E : valeur non-ISO détectée au verrouillage, forcée à NGN — à revoir'
FROM shops s
WHERE (s.currency IS NULL OR s.currency !~ '^[A-Z]{3}$')
  AND NOT EXISTS (
    SELECT 1 FROM currency_migration_log l
    WHERE l.shop_id = s.id AND l.note LIKE 'Phase E %'
  );

UPDATE shops
SET currency = 'NGN'
WHERE currency IS NULL OR currency !~ '^[A-Z]{3}$';

-- ── 2. Défaut de colonne : symbole « ₦ » (001_schema) → code ISO ────────
ALTER TABLE shops ALTER COLUMN currency SET DEFAULT 'NGN';

-- ── 3. NOT NULL — la devise est toujours renseignée (défaut + app) ──────
ALTER TABLE shops ALTER COLUMN currency SET NOT NULL;

-- ── 4. Contrainte : uniquement les 14 codes ISO supportés ──────────────
-- Miroir de SUPPORTED_CURRENCY_CODES (lib/saas/currencies.ts) — garder les
-- deux listes synchronisées si une devise est ajoutée.
ALTER TABLE shops DROP CONSTRAINT IF EXISTS shops_currency_supported;
ALTER TABLE shops ADD CONSTRAINT shops_currency_supported CHECK (
  currency IN (
    'NGN','XOF','XAF','GHS','GNF','GMD','SLE','LRD','CVE','MRU','CDF','EUR','USD','CAD'
  )
);

-- Migration 170 — Codes-barres (sku) propres : jamais vides, jamais entourés d'espaces
--
-- Constat (7 oct. 2026) : « Sucre 50kg » (Boutique Alpha) avait le code « 50 » suivi
-- d'un espace, créé avant que l'app nettoie les espaces ; un autre produit de la
-- boutique a « 50 ». L'espace avait laissé passer le doublon, et toute modification
-- du produit (même l'ajout d'une photo) était refusée. Seul cas sur la plateforme
-- (vérifié : 144 produits avec code-barres).
--
-- 1. Un code entouré d'espaces qui, nettoyé, serait celui d'un AUTRE produit de la
--    même boutique est retiré (l'autre produit garde le sien) — c'est le cas ci-dessus.
-- 2. Les autres codes sont nettoyés (espaces retirés ; vide → aucun code).
-- 3. La base refuse désormais un code vide ou entouré d'espaces.
-- + correction validée par le propriétaire : l'espace final du nom « Sucre 50kg ».

BEGIN;

-- 1. Conflits après nettoyage : le code « sale » est retiré
UPDATE products p
SET sku = NULL, updated_at = now()
WHERE p.sku IS NOT NULL
  AND p.sku <> btrim(p.sku)
  AND EXISTS (
    SELECT 1 FROM products o
    WHERE o.shop_id = p.shop_id AND o.id <> p.id AND o.sku IS NOT NULL AND btrim(o.sku) = btrim(p.sku)
  );

-- 2. Nettoyage des autres
UPDATE products
SET sku = NULLIF(btrim(sku), ''), updated_at = now()
WHERE sku IS NOT NULL AND (sku <> btrim(sku) OR btrim(sku) = '');

-- 3. Règle permanente
ALTER TABLE products DROP CONSTRAINT IF EXISTS products_sku_clean;
ALTER TABLE products ADD CONSTRAINT products_sku_clean CHECK (sku IS NULL OR (sku = btrim(sku) AND sku <> ''));

-- Correction validée : nom sans espace final (ce produit uniquement)
UPDATE products SET name = 'Sucre 50kg', updated_at = now()
WHERE id = '8ddc1f33-da13-4c2c-8afd-c552d1494b00' AND name = 'Sucre 50kg ';

COMMIT;

-- ── Vérification après exécution ───────────────────────────────────────────
-- Doit afficher 0 code « sale », la règle présente, et « Sucre 50kg » sans code.
SELECT
  (SELECT count(*) FROM products WHERE sku IS NOT NULL AND (sku <> btrim(sku) OR sku = '')) AS codes_sales,
  (SELECT count(*) FROM pg_constraint WHERE conname = 'products_sku_clean') AS regle,
  (SELECT name || ' | code : ' || coalesce(sku, 'aucun') FROM products WHERE id = '8ddc1f33-da13-4c2c-8afd-c552d1494b00') AS sucre_50kg;

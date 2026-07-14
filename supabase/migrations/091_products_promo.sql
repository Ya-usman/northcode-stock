-- ============================================================
-- Migration 091 : Promotions produit
-- ============================================================
-- Prix de vente temporaire, pour écouler du stock proche de péremption
-- ou dormant. Volontairement simple (un seul prix promo par produit, pas
-- par lot) — la vente au comptoir est déjà par produit, pas par lot
-- (voir product_supplier_prices, migration 082, pour le même raisonnement
-- appliqué au prix d'achat). Nul en dehors d'une promo active ; l'UI et le
-- POS comparent promo_until à now() à la volée, aucune tâche de
-- nettoyage n'est nécessaire — la promo cesse de s'appliquer toute seule.

ALTER TABLE products ADD COLUMN IF NOT EXISTS promo_price numeric CHECK (promo_price IS NULL OR promo_price > 0);
ALTER TABLE products ADD COLUMN IF NOT EXISTS promo_until timestamptz;

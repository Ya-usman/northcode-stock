-- ============================================================
-- Migration 148 : produits favoris / fréquents (accès rapide en caisse)
-- ============================================================
-- Curation MANUELLE et stable (pas un calcul automatique des "plus
-- vendus") : un vendeur mémorise la position d'un article favori pour
-- taper vite sans regarder — une liste qui se réorganise toute seule
-- casserait cette habitude. Voir discussion produit du 2026-10-03.
--
-- Affiché dans "Nouvelle vente" en rangée épinglée au-dessus de la grille,
-- indépendamment du filtre catégorie. Pas de notion de devise/montant ici,
-- aucun impact sur le reporting.

ALTER TABLE products ADD COLUMN IF NOT EXISTS is_favorite boolean NOT NULL DEFAULT false;

-- Filtré sur une seule boutique à chaque lecture (jamais besoin de la
-- parcourir toute entière) — index partiel, ne grossit qu'avec les vrais
-- favoris (généralement une poignée par boutique).
CREATE INDEX IF NOT EXISTS idx_products_favorite
  ON products (shop_id)
  WHERE is_favorite = true AND is_active = true;

COMMENT ON COLUMN products.is_favorite IS
  'Épinglé en accès rapide dans "Nouvelle vente" (rangée Favoris) — curation manuelle par un owner/stock_manager/cashier, jamais calculé automatiquement.';

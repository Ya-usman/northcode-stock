-- ============================================================
-- Migration 095 : Promotion par lot (FEFO-aware)
-- ============================================================
-- La promo produit (091) s'applique à tout le stock, même une fois le lot
-- qui la justifiait épuisé — perte de marge non voulue sur du stock frais
-- mélangé au même produit. On ajoute une promo posable sur un lot précis :
-- la caisse (voir sales/new/page.tsx effectivePrice) applique en priorité
-- le prix du lot FEFO en tête de file s'il est en promo, sinon retombe sur
-- la promo produit puis le prix catalogue. Comme le lot en promo est
-- toujours filtré sur quantity > 0 partout où on le lit, la promo cesse de
-- s'appliquer automatiquement dès que ce lot est épuisé — aucun nettoyage
-- à faire.

ALTER TABLE product_batches ADD COLUMN IF NOT EXISTS promo_price numeric
  CHECK (promo_price IS NULL OR promo_price > 0);
ALTER TABLE product_batches ADD COLUMN IF NOT EXISTS promo_until timestamptz;

-- ============================================================
-- Migration 119 : Date de début programmée pour une promotion
-- ============================================================
-- products.promo_until (091) et product_batches.promo_until (095) n'ont
-- jamais eu de date de début — une promo démarre toujours "maintenant".
-- Impossible de préparer une promo à l'avance (ex. programmer un week-end
-- promo). NULL = démarre immédiatement, comportement actuel inchangé par
-- défaut — cohérent avec le style optionnel déjà utilisé pour ce genre de
-- champ dans ce schéma.

ALTER TABLE products ADD COLUMN IF NOT EXISTS promo_start timestamptz;
ALTER TABLE product_batches ADD COLUMN IF NOT EXISTS promo_start timestamptz;

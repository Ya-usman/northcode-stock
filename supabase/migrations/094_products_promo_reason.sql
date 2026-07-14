-- ============================================================
-- Migration 094 : Motif de la promotion (péremption / vente lente)
-- ============================================================
-- La promo reste par produit, pas par lot (091) — mais on garde une trace
-- de POURQUOI elle a été posée quand elle vient d'une suggestion
-- automatique (voir suggestPromo côté client), pour pouvoir avertir si le
-- lot qui la justifiait est épuisé/n'est plus concerné, sans jamais la
-- retirer automatiquement (une promo manuelle reste sous contrôle total
-- de l'utilisateur).

ALTER TABLE products ADD COLUMN IF NOT EXISTS promo_reason text
  CHECK (promo_reason IS NULL OR promo_reason IN ('expiry', 'dormant'));

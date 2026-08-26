-- ============================================================
-- Migration 118 : Seuil d'alerte de péremption par catégorie
-- ============================================================
-- shops.expiry_alert_days (090) est un réglage unique pour toute la
-- boutique — trop grossier pour un commerce qui vend à la fois des
-- produits frais (alerte utile à 3 jours) et des produits secs (alerte à
-- 30 jours suffit). NULL = hérite du réglage boutique, même convention que
-- le reste du schéma pour les champs optionnels (ex. categories.color, 116).

ALTER TABLE categories ADD COLUMN IF NOT EXISTS expiry_alert_days int;

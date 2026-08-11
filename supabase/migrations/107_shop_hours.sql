-- ============================================================
-- 107 — Horaires d'ouverture de la boutique
--
-- Fenêtre unique par boutique (pas de shifts par employé) : en dehors de
-- opening_time/closing_time, l'application coupe l'accès aux employés
-- (tout rôle sauf owner/super_admin) via un mur plein écran côté client
-- (components/saas/shop-closed-wall.tsx), sur le même modèle que le mur de
-- facturation existant. Le owner n'est jamais bloqué.
--
-- hours_manual_override permet une dérogation manuelle qui prend le pas sur
-- le planning automatique ('open' = forcer ouvert, 'closed' = forcer fermé,
-- NULL = suivre opening_time/closing_time). Si des horaires par jour de
-- semaine sont ajoutés plus tard, cette dérogation doit continuer de
-- prendre le pas sur ce que le planning résout, quel qu'il soit.
--
-- hours_enabled=false par défaut : aucun effet sur les boutiques
-- existantes tant que le owner n'active pas la fonctionnalité.
-- ============================================================

ALTER TABLE shops ADD COLUMN IF NOT EXISTS hours_enabled boolean NOT NULL DEFAULT false;
ALTER TABLE shops ADD COLUMN IF NOT EXISTS opening_time time DEFAULT '08:00';
ALTER TABLE shops ADD COLUMN IF NOT EXISTS closing_time time DEFAULT '20:00';
ALTER TABLE shops ADD COLUMN IF NOT EXISTS hours_manual_override text
  CHECK (hours_manual_override IS NULL OR hours_manual_override IN ('open', 'closed'))
  DEFAULT NULL;

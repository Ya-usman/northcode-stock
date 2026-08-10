-- ============================================================
-- 100 — INTERNAL ACCOUNTS
--
-- Comptes internes (superadmins testant l'app) : accès illimité
-- sans jamais fausser les métriques de revenu/abonnements payants
-- (admin/analytics continue de les traiter comme non-payants).
--
-- profiles.is_internal est la source de vérité (au niveau owner) ;
-- shops.is_internal est une copie miroir pour lecture directe côté
-- shop, écrite uniquement par l'action admin set_internal.
-- ============================================================

ALTER TABLE profiles ADD COLUMN IF NOT EXISTS is_internal boolean NOT NULL DEFAULT false;
ALTER TABLE shops    ADD COLUMN IF NOT EXISTS is_internal boolean NOT NULL DEFAULT false;

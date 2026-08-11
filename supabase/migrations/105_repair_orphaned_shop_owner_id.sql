-- ============================================================
-- 105 — Répare les boutiques dont owner_id s'est vidé silencieusement
--
-- shops.owner_id référence auth.users avec ON DELETE SET NULL (migration
-- 001). À chaque suppression d'un compte auth (nettoyage d'un compte en
-- double, recréation d'un compte cassé — déjà fait plusieurs fois via ce
-- panel admin), toute boutique dont owner_id pointait vers ce compte se
-- retrouve avec owner_id = null, définitivement — même si un nouveau compte
-- devient ensuite le vrai propriétaire via shop_members (la table utilisée
-- partout ailleurs dans l'app pour l'accès).
--
-- Conséquence concrète : toute la synchronisation du plan (/api/billing/
-- verify, octroi de plan admin, renouvellement automatique) filtre sur
-- `WHERE owner_id = <owner>` — une boutique à owner_id null n'est plus
-- jamais mise à jour, même quand son propriétaire paie normalement.
-- ============================================================

-- 1. Recale owner_id sur le vrai propriétaire actif (shop_members), pour
--    toute boutique non supprimée qui l'a perdu.
UPDATE shops s
SET owner_id = sm.user_id
FROM shop_members sm
WHERE s.owner_id IS NULL
  AND s.deleted_at IS NULL
  AND sm.shop_id = s.id
  AND sm.role = 'owner'
  AND sm.is_active = true;

-- 2. Resynchronise plan/plan_expires_at/trial_ends_at depuis profiles (la
--    source de vérité) sur toutes les boutiques désormais correctement
--    liées — répare immédiatement les boutiques ci-dessus, et sert de filet
--    de sécurité pour toute autre désynchronisation silencieuse passée.
--    Ne touche que les lignes réellement différentes, et jamais si le profil
--    lui-même n'a pas de plan renseigné.
UPDATE shops s
SET plan = p.plan,
    plan_expires_at = p.plan_expires_at,
    trial_ends_at = p.trial_ends_at
FROM profiles p
WHERE s.owner_id = p.id
  AND s.deleted_at IS NULL
  AND p.plan IS NOT NULL
  AND (
    s.plan IS DISTINCT FROM p.plan
    OR s.plan_expires_at IS DISTINCT FROM p.plan_expires_at
    OR s.trial_ends_at IS DISTINCT FROM p.trial_ends_at
  );

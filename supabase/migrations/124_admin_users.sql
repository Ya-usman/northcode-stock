-- ============================================================
-- Migration 124 : Table admin_users (accès plateforme multi-niveaux)
-- ============================================================
-- Jusqu'ici, l'accès admin était un email dans SUPER_ADMIN_EMAILS
-- (variable d'environnement) OR profiles.role = 'super_admin' — vérifié
-- indépendamment ~10 fois à travers app/api/admin/*/route.ts, sans
-- granularité (tout ou rien) et sans pouvoir ajouter quelqu'un sans
-- redéployer. Cette table devient la source de vérité unique, avec deux
-- niveaux : 'super_admin' (tout, y compris gérer d'autres admins) et
-- 'support' (lecture seule — pas de suspension/suppression/attribution
-- de plan). Consultée uniquement via le client admin (service role),
-- jamais côté client — pas de RLS ouverte, comme les autres tables
-- réservées à /api/admin/*.
--
-- Séparée de `profiles` délibérément : "est-ce que cette personne est
-- admin de la plateforme" n'a rien à voir avec son statut de propriétaire
-- de boutique (plan, essai...) — les mélanger dans la même ligne aurait
-- perpétué exactement le genre de confusion que cette refonte corrige.

CREATE TABLE IF NOT EXISTS admin_users (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  email text not null,
  tier text not null check (tier in ('super_admin', 'support')),
  added_by uuid references auth.users(id),
  created_at timestamptz default now(),
  revoked_at timestamptz,
  revoked_by uuid references auth.users(id)
);

-- Un seul enregistrement actif par utilisateur
CREATE UNIQUE INDEX IF NOT EXISTS idx_admin_users_active_user
  ON admin_users(user_id) WHERE revoked_at IS NULL;

ALTER TABLE admin_users ENABLE ROW LEVEL SECURITY;
-- Aucune policy = inaccessible via la clé anon/authentifiée ; seul le
-- client admin (service role, qui contourne RLS) y accède, exactement
-- comme shop_notes/admin_notifications déjà utilisées par /api/admin/*.

-- ── Amorçage ────────────────────────────────────────────────────────────
-- Les 4 emails actuellement dans SUPER_ADMIN_EMAILS (.env.local), pour
-- qu'aucun accès existant ne soit perdu au déploiement de cette
-- migration. Résolus par email via auth.users ; silencieusement ignorés
-- si le compte n'existe pas encore.
INSERT INTO admin_users (user_id, email, tier)
SELECT u.id, u.email, 'super_admin'
FROM auth.users u
WHERE u.email IN (
  'yahaya.dev@gmail.com',
  'ghislainmboughue1@gmail.com',
  'admin@northcode.ng'
)
ON CONFLICT DO NOTHING;

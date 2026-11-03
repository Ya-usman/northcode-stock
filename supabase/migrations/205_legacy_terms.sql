-- ============================================================
-- 205 : conditions des clients actuels (nouvelle tarification) — 3 nov. 2026, décisions validées
-- ============================================================
-- Nouvelle tarification : Starter 1 boutique + 2 employés, Pro 2 + 5, Business 3 + 8 ; FCFA 5 000 / 10 000 / 15 000.
-- Décision A : les entreprises qui PAIENT au moment du changement gardent
--   • les limites de leur ancienne formule (ancien Business : 10 boutiques, 30 employés) jusqu'à la fin de leur période
--     payée + 3 mois, tant qu'elles restent sur la même formule ;
--   • leur ancien prix mensuel tant qu'elles renouvellent sans interruption (même formule, même devise), s'il est plus
--     bas que le nouveau (le client paie toujours le moins cher des deux).
-- entities.legacy_terms garde ces conditions ; la règle est dans lib/saas/legacy-terms (serveur et page Abonnement).
-- La colonne est protégée par le verrou existant de la table (migration 154 : entities écrite par le serveur seul).
-- Remplie ici une seule fois : formules payées en cours, comptes internes exclus, jamais écrasée (ré-exécutable).
--
-- Aussi : droits techniques par défaut (TRUNCATE, REFERENCES, TRIGGER) retirés aux comptes connectés sur
-- payment_intents (migration 204) — non accessibles par l'interface, retirés par propreté.
-- Retour arrière : supabase/rollbacks/205_legacy_terms_rollback.sql
-- ============================================================

SET LOCAL lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.valid_legacy_terms(t jsonb)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = pg_catalog
AS $$
  -- coalesce(…, false) : une clé absente donne NULL, ce qui laisserait passer la contrainte ; toute valeur incomplète
  -- est refusée
  SELECT t IS NULL OR coalesce((
    jsonb_typeof(t) = 'object'
    AND (t ->> 'plan') = ANY (ARRAY['starter', 'pro', 'business'])
    AND jsonb_typeof(t -> 'shops') = 'number' AND (t ->> 'shops')::numeric >= 1 AND (t ->> 'shops')::numeric = trunc((t ->> 'shops')::numeric)
    AND jsonb_typeof(t -> 'team_members') = 'number' AND (t ->> 'team_members')::numeric >= 0 AND (t ->> 'team_members')::numeric = trunc((t ->> 'team_members')::numeric)
    AND jsonb_typeof(t -> 'limits_until') = 'string'
    -- Prix garanti : absent (null) ou complet (devise ISO + montant > 0)
    AND (
      (coalesce(jsonb_typeof(t -> 'monthly_price'), 'null') = 'null' AND coalesce(jsonb_typeof(t -> 'currency'), 'null') = 'null')
      OR (jsonb_typeof(t -> 'monthly_price') = 'number' AND (t ->> 'monthly_price')::numeric > 0
          AND jsonb_typeof(t -> 'currency') = 'string' AND (t ->> 'currency') ~ '^[A-Z]{3}$')
    )
  ), false)
$$;
REVOKE ALL ON FUNCTION public.valid_legacy_terms(jsonb) FROM PUBLIC, anon;

ALTER TABLE public.entities ADD COLUMN IF NOT EXISTS legacy_terms jsonb;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'entities_legacy_terms_check' AND conrelid = 'public.entities'::regclass) THEN
    ALTER TABLE public.entities ADD CONSTRAINT entities_legacy_terms_check CHECK (public.valid_legacy_terms(legacy_terms));
  END IF;
END $$;

-- Remplissage : entreprises qui paient aujourd'hui (formule payée non échue), hors comptes internes, une seule fois.
-- Anciens prix du catalogue (avant le 3 nov. 2026) : NGN 4 999 / 9 999 / 19 999 ; FCFA 4 999 / 7 999 / 14 999.
-- Autres pays : limites gardées, pas de prix garanti (aucune entreprise payante concernée au 3 nov. 2026).
UPDATE public.entities e
SET legacy_terms = jsonb_build_object(
  'plan', e.plan,
  'shops', CASE e.plan WHEN 'starter' THEN 1 WHEN 'pro' THEN 2 ELSE 10 END,
  'team_members', CASE e.plan WHEN 'starter' THEN 2 WHEN 'pro' THEN 5 ELSE 30 END,
  -- En temps universel : le fuseau de la session ne doit jamais décaler la date
  'limits_until', to_char((e.plan_expires_at AT TIME ZONE 'UTC') + interval '3 months', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
  'currency', c.currency,
  'monthly_price', CASE
    WHEN c.currency = 'NGN' THEN (CASE e.plan WHEN 'starter' THEN 4999 WHEN 'pro' THEN 9999 ELSE 19999 END)
    WHEN c.currency IN ('XOF', 'XAF') THEN (CASE e.plan WHEN 'starter' THEN 4999 WHEN 'pro' THEN 7999 ELSE 14999 END)
  END,
  'set_at', to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
)
FROM (
  SELECT e2.id,
    CASE
      WHEN coalesce(e2.billing_country, e2.country) = 'NG' THEN 'NGN'
      WHEN coalesce(e2.billing_country, e2.country) IN ('CI', 'ML', 'NE', 'SN', 'BJ', 'TG', 'BF', 'GW') THEN 'XOF'
      WHEN coalesce(e2.billing_country, e2.country) IN ('CM', 'CG', 'GA', 'GQ', 'CF', 'TD') THEN 'XAF'
    END AS currency
  FROM public.entities e2
) c
WHERE c.id = e.id
  AND e.legacy_terms IS NULL
  AND e.plan IN ('starter', 'pro', 'business')
  AND e.plan_expires_at > now()
  AND NOT coalesce(e.is_internal, false);

-- SOFAR BONKANEY (décision de l'utilisateur du 3 nov. 2026) : passe aux nouveaux prix à la fin de son abonnement.
-- Ses limites restent gardées jusqu'à leur date ; aucun prix garanti.
UPDATE public.entities
SET legacy_terms = legacy_terms || '{"monthly_price": null, "currency": null}'::jsonb
WHERE id = '4a8d9624-509f-40cc-ab4d-5119a4e6a456' AND legacy_terms ->> 'monthly_price' IS NOT NULL;

-- Paiements préparés (204) : droits techniques par défaut retirés aux comptes connectés
REVOKE TRUNCATE, REFERENCES, TRIGGER ON public.payment_intents FROM authenticated;

-- ── Vérification après exécution ───────────────────────────────────────────
-- SELECT name, plan, legacy_terms FROM entities WHERE legacy_terms IS NOT NULL;   -- entreprises qui paient aujourd'hui
-- SELECT string_agg(privilege_type, ',') FROM information_schema.table_privileges
--   WHERE table_name = 'payment_intents' AND grantee = 'authenticated';             -- SELECT

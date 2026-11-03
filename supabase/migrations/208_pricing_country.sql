-- ============================================================
-- 208 : pays de tarification protégé contre le contournement — 3 nov. 2026, règles validées
-- ============================================================
-- Le prix suit le pays où la boutique FONCTIONNE, pas celui que le client déclare ni celui de la personne qui paie
-- (diaspora : un Camerounais en France qui paie la boutique de Douala garde le prix camerounais).
--   1. entity_activity_countries : activité OPÉRATIONNELLE par entreprise, jour et pays (ventes, entrées de stock,
--      inventaires ; connexions comptées à part, moins de poids). Seul le CODE PAYS est gardé (fourni par
--      l'hébergeur à chaque requête), jamais l'adresse IP. Écrite par le serveur seul via bump_entity_activity.
--   2. entities.pricing_country : pays de tarification fixé à la main par l'administration (motif obligatoire,
--      journal), qui l'emporte sur tout le reste.
--   3. payment_intents.request_country / payer_country / pricing_country : pays de la demande, du moyen de paiement
--      et de tarification, pour repérer les écarts (jamais un refus automatique).
-- La règle (majorité d'au moins 70 % de l'activité sur 30 jours, zone plus chère seulement) est dans
-- lib/saas/pricing-country. Ré-exécutable. Retour arrière : supabase/rollbacks/208_pricing_country_rollback.sql
-- ============================================================

SET LOCAL lock_timeout = '5s';

-- ── 1. Activité par pays ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.entity_activity_countries (
  entity_id uuid NOT NULL REFERENCES public.entities(id) ON DELETE CASCADE,
  day       date NOT NULL,
  country   text NOT NULL CHECK (country ~ '^[A-Z]{2}$'),
  ops       integer NOT NULL DEFAULT 0 CHECK (ops >= 0),
  logins    integer NOT NULL DEFAULT 0 CHECK (logins >= 0),
  PRIMARY KEY (entity_id, day, country)
);
CREATE INDEX IF NOT EXISTS idx_entity_activity_countries_day ON public.entity_activity_countries(day);

ALTER TABLE public.entity_activity_countries ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS entity_activity_countries_select ON public.entity_activity_countries;
CREATE POLICY entity_activity_countries_select ON public.entity_activity_countries FOR SELECT USING (is_super_admin());
REVOKE ALL ON public.entity_activity_countries FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.entity_activity_countries FROM authenticated;
DROP TRIGGER IF EXISTS trg_entity_activity_countries_guard ON public.entity_activity_countries;
CREATE TRIGGER trg_entity_activity_countries_guard BEFORE INSERT OR UPDATE OR DELETE ON public.entity_activity_countries
  FOR EACH ROW EXECUTE FUNCTION guard_server_only_columns('*');

-- Ajout atomique (une ligne par entreprise, jour et pays) ; serveur seul. Jours de plus de 120 jours effacés au passage
-- (la règle ne regarde que 30 jours).
CREATE OR REPLACE FUNCTION public.bump_entity_activity(p_entity uuid, p_country text, p_ops integer, p_logins integer)
RETURNS void
LANGUAGE sql
SET search_path = public
AS $$
  INSERT INTO entity_activity_countries (entity_id, day, country, ops, logins)
  VALUES (p_entity, (now() AT TIME ZONE 'UTC')::date, upper(p_country), greatest(p_ops, 0), greatest(p_logins, 0))
  ON CONFLICT (entity_id, day, country)
  DO UPDATE SET ops = entity_activity_countries.ops + EXCLUDED.ops, logins = entity_activity_countries.logins + EXCLUDED.logins;
  DELETE FROM entity_activity_countries WHERE entity_id = p_entity AND day < (now() AT TIME ZONE 'UTC')::date - 120;
$$;
REVOKE ALL ON FUNCTION public.bump_entity_activity(uuid, text, integer, integer) FROM PUBLIC, anon, authenticated;

-- ── 2. Pays de tarification fixé par l'administration ─────────────────────
ALTER TABLE public.entities ADD COLUMN IF NOT EXISTS pricing_country text;
ALTER TABLE public.entities ADD COLUMN IF NOT EXISTS pricing_country_reason text;
ALTER TABLE public.entities ADD COLUMN IF NOT EXISTS pricing_country_set_at timestamptz;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'entities_pricing_country_check' AND conrelid = 'public.entities'::regclass) THEN
    ALTER TABLE public.entities ADD CONSTRAINT entities_pricing_country_check CHECK (
      (pricing_country IS NULL AND pricing_country_reason IS NULL)
      OR (pricing_country ~ '^[A-Z]{2}$' AND char_length(btrim(coalesce(pricing_country_reason, ''))) BETWEEN 3 AND 300)
    );
  END IF;
END $$;

-- ── 3. Pays de la demande et du moyen de paiement ─────────────────────────
ALTER TABLE public.payment_intents ADD COLUMN IF NOT EXISTS request_country text;
ALTER TABLE public.payment_intents ADD COLUMN IF NOT EXISTS payer_country text;
ALTER TABLE public.payment_intents ADD COLUMN IF NOT EXISTS pricing_reason text;
ALTER TABLE public.payment_intents ADD COLUMN IF NOT EXISTS pricing_country text;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'payment_intents_countries_check' AND conrelid = 'public.payment_intents'::regclass) THEN
    ALTER TABLE public.payment_intents ADD CONSTRAINT payment_intents_countries_check CHECK (
      (request_country IS NULL OR request_country ~ '^[A-Z]{2}$') AND (payer_country IS NULL OR payer_country ~ '^[A-Z]{2}$')
      AND (pricing_country IS NULL OR pricing_country ~ '^[A-Z]{2}$')
      AND (pricing_reason IS NULL OR pricing_reason IN ('declared', 'activity', 'override'))
    );
  END IF;
END $$;

-- ── Vérification après exécution ───────────────────────────────────────────
-- SELECT count(*) FROM entity_activity_countries;                                    -- 0
-- SELECT has_function_privilege('authenticated', 'public.bump_entity_activity(uuid,text,integer,integer)', 'EXECUTE');  -- false

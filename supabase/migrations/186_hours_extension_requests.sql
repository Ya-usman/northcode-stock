-- 186 — Prolongation des horaires « à partir de maintenant » et demandes de prolongation (décisions du 29 oct. 2026).
--
-- 1. grant_hours_extension (remplace la version de la 108) :
--    • à l'heure de la BOUTIQUE (shops.timezone, migration 178), comme la règle d'ouverture de l'écran et du serveur,
--      au lieu du décalage fixe par pays ;
--    • boutique DÉJÀ fermée : la prolongation part de MAINTENANT (avant : de l'heure de fermeture, donc inutile après
--      la fermeture) ; avant la fermeture, rien ne change (part de la fermeture ou de la prolongation en cours) ;
--    • durées 15, 30, 45, 60 et 120 minutes ; plafonnée à minuit (heure de la boutique) au lieu d'échouer ;
--    • limite de 2 prolongations par jour conservée ; erreurs codées P0050 à P0054 (messages traduits par l'application).
-- 2. hours_extension_requests : demandes des employés (30 min, 1 h, 2 h), réservées au SERVEUR (aucun accès navigateur).
--    Une seule demande en attente par personne et par boutique ; expiration 30 minutes.
-- 3. approve_hours_extension_request : accepter = accorder la prolongation ET clore la demande, en une transaction.
-- p_now (paramètre final, défaut now()) sert aux tests ; fonctions exécutables par le serveur seulement.
-- Retour arrière : supabase/rollbacks/186_hours_extension_requests_rollback.sql
-- Appliquée par « supabase db push » (transaction de la CLI) : pas de BEGIN / COMMIT dans ce fichier.

SET LOCAL lock_timeout = '5s';

-- ── 1. Prolongation ─────────────────────────────────────────────────────────────────────────────────────────────
DROP FUNCTION public.grant_hours_extension(uuid, int);

CREATE FUNCTION public.grant_hours_extension(p_shop_id uuid, p_minutes int, p_now timestamptz DEFAULT now())
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $f$
DECLARE
  v_shop shops%ROWTYPE;
  v_tz text;
  v_today date;
  v_close_instant timestamptz;
  v_midnight timestamptz;
  v_base timestamptz;
  v_new_until timestamptz;
  v_new_count int;
BEGIN
  IF p_minutes NOT IN (15, 30, 45, 60, 120) THEN
    RAISE EXCEPTION 'Durée de prolongation invalide' USING ERRCODE = 'P0050';
  END IF;

  SELECT * INTO v_shop FROM shops WHERE id = p_shop_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Boutique introuvable' USING ERRCODE = 'P0051'; END IF;
  IF NOT v_shop.hours_enabled OR v_shop.opening_time IS NULL OR v_shop.closing_time IS NULL
     OR v_shop.closing_time <= v_shop.opening_time THEN
    RAISE EXCEPTION 'Horaires non configurés' USING ERRCODE = 'P0051';
  END IF;
  IF v_shop.hours_manual_override IS NOT NULL THEN
    RAISE EXCEPTION 'Une dérogation manuelle est active' USING ERRCODE = 'P0052';
  END IF;

  v_tz := coalesce(nullif(v_shop.timezone, ''), 'UTC');
  v_today := (p_now AT TIME ZONE v_tz)::date;

  v_new_count := CASE WHEN v_shop.hours_extension_count_date IS DISTINCT FROM v_today THEN 0 ELSE v_shop.hours_extension_count END;
  IF v_new_count >= 2 THEN
    RAISE EXCEPTION 'Limite de 2 prolongations par jour atteinte' USING ERRCODE = 'P0053';
  END IF;

  -- Fermeture du jour et minuit, à l'heure de la boutique
  v_close_instant := (v_today + v_shop.closing_time) AT TIME ZONE v_tz;
  v_midnight := (v_today + 1)::timestamp AT TIME ZONE v_tz;

  -- Point de départ : la plus tardive entre la fermeture du jour, la prolongation en cours et MAINTENANT
  v_base := greatest(v_close_instant, coalesce(v_shop.hours_extension_until, v_close_instant), p_now);
  IF v_base >= v_midnight - interval '1 minute' THEN
    RAISE EXCEPTION 'Plus de prolongation possible aujourd''hui' USING ERRCODE = 'P0054';
  END IF;
  v_new_until := least(v_base + make_interval(mins => p_minutes), v_midnight - interval '1 minute');

  UPDATE shops SET
    hours_extension_until = v_new_until,
    hours_extension_count = v_new_count + 1,
    hours_extension_count_date = v_today
  WHERE id = p_shop_id;

  RETURN jsonb_build_object('hours_extension_until', v_new_until, 'hours_extension_count', v_new_count + 1,
                            'capped', v_new_until < v_base + make_interval(mins => p_minutes));
END $f$;

REVOKE ALL ON FUNCTION public.grant_hours_extension(uuid, int, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.grant_hours_extension(uuid, int, timestamptz) TO service_role;

-- ── 2. Demandes de prolongation ─────────────────────────────────────────────────────────────────────────────────
CREATE TABLE public.hours_extension_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id uuid NOT NULL REFERENCES public.shops(id) ON DELETE CASCADE,
  requested_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  minutes int NOT NULL CHECK (minutes IN (30, 60, 120)),
  message text CHECK (message IS NULL OR char_length(message) <= 200),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'refused', 'cancelled', 'expired')),
  decided_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  decided_at timestamptz,
  granted_until timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT now() + interval '30 minutes'
);
CREATE UNIQUE INDEX hours_extension_requests_one_pending ON public.hours_extension_requests (shop_id, requested_by) WHERE status = 'pending';
CREATE INDEX hours_extension_requests_shop_status ON public.hours_extension_requests (shop_id, status, created_at DESC);
ALTER TABLE public.hours_extension_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.hours_extension_requests FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.hours_extension_requests TO service_role;

-- ── 3. Accepter une demande : prolongation accordée ET demande close, ensemble ──────────────────────────────────
CREATE FUNCTION public.approve_hours_extension_request(p_request_id uuid, p_decided_by uuid, p_minutes int DEFAULT NULL, p_now timestamptz DEFAULT now())
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $f$
DECLARE
  v_req hours_extension_requests%ROWTYPE;
  v_grant jsonb;
BEGIN
  SELECT * INTO v_req FROM hours_extension_requests WHERE id = p_request_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Demande introuvable' USING ERRCODE = 'P0055'; END IF;
  IF v_req.status <> 'pending' OR v_req.expires_at <= p_now THEN
    RAISE EXCEPTION 'Demande déjà traitée ou expirée' USING ERRCODE = 'P0055';
  END IF;
  v_grant := grant_hours_extension(v_req.shop_id, coalesce(p_minutes, v_req.minutes), p_now);
  UPDATE hours_extension_requests
     SET status = 'approved', decided_by = p_decided_by, decided_at = p_now,
         granted_until = (v_grant ->> 'hours_extension_until')::timestamptz
   WHERE id = p_request_id;
  RETURN v_grant || jsonb_build_object('request_id', p_request_id, 'shop_id', v_req.shop_id, 'requested_by', v_req.requested_by);
END $f$;

REVOKE ALL ON FUNCTION public.approve_hours_extension_request(uuid, uuid, int, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.approve_hours_extension_request(uuid, uuid, int, timestamptz) TO service_role;

-- Garde-fou : état effectif attendu, sinon tout est annulé
DO $$
BEGIN
  IF has_table_privilege('authenticated', 'public.hours_extension_requests', 'SELECT')
     OR has_table_privilege('anon', 'public.hours_extension_requests', 'SELECT')
     OR NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.hours_extension_requests'::regclass) THEN
    RAISE EXCEPTION '186 : la table des demandes est lisible hors du serveur, annulé';
  END IF;
  IF has_function_privilege('authenticated', 'public.grant_hours_extension(uuid, int, timestamptz)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.grant_hours_extension(uuid, int, timestamptz)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.approve_hours_extension_request(uuid, uuid, int, timestamptz)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.approve_hours_extension_request(uuid, uuid, int, timestamptz)', 'EXECUTE')
     OR NOT has_function_privilege('service_role', 'public.grant_hours_extension(uuid, int, timestamptz)', 'EXECUTE') THEN
    RAISE EXCEPTION '186 : droits d''exécution inattendus, annulé';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'grant_hours_extension' AND pronamespace = 'public'::regnamespace
             AND pg_get_function_identity_arguments(oid) = 'p_shop_id uuid, p_minutes integer') THEN
    RAISE EXCEPTION '186 : ancienne version de grant_hours_extension encore présente, annulé';
  END IF;
  RAISE NOTICE '186 : prolongation à partir de maintenant (fuseau de la boutique) et demandes de prolongation';
END $$;

NOTIFY pgrst, 'reload schema';

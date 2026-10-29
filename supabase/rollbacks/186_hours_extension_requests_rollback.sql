-- Retour arrière de 186_hours_extension_requests.sql — immédiat, sans redéploiement, à lancer seulement sur décision
-- explicite (éditeur SQL en urgence). Supprime la fonction d'acceptation et la table des demandes (les demandes sont
-- PERDUES), puis recrée grant_hours_extension EXACTEMENT comme la 108 (texte repris tel quel de la migration 108 ;
-- droits : postgres et service_role, comme en production le 29 oct. 2026).
-- Ne touche pas supabase_migrations : enregistrer ensuite l'état (« supabase migration repair --status reverted 186 »).
BEGIN;
SET LOCAL lock_timeout = '5s';

DROP FUNCTION IF EXISTS public.approve_hours_extension_request(uuid, uuid, int, timestamptz);
DROP TABLE IF EXISTS public.hours_extension_requests;
DROP FUNCTION IF EXISTS public.grant_hours_extension(uuid, int, timestamptz);

CREATE FUNCTION public.grant_hours_extension(
  p_shop_id uuid,
  p_minutes int
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_shop shops%ROWTYPE;
  v_offset int;
  v_today date;
  v_close_instant timestamptz;
  v_base timestamptz;
  v_new_until timestamptz;
  v_new_count int;
BEGIN
  IF p_minutes NOT IN (15, 30, 45, 60) THEN
    RAISE EXCEPTION 'Durée de prolongation invalide';
  END IF;

  SELECT * INTO v_shop FROM shops WHERE id = p_shop_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Boutique introuvable'; END IF;
  IF NOT v_shop.hours_enabled OR v_shop.opening_time IS NULL OR v_shop.closing_time IS NULL THEN
    RAISE EXCEPTION 'Horaires désactivés';
  END IF;
  IF v_shop.closing_time <= v_shop.opening_time THEN
    RAISE EXCEPTION 'Configuration horaire invalide';
  END IF;
  IF v_shop.hours_manual_override IS NOT NULL THEN
    RAISE EXCEPTION 'Une dérogation manuelle est active';
  END IF;

  v_offset := shop_utc_offset_minutes(v_shop.country);
  v_today := (now() + (v_offset || ' minutes')::interval)::date;

  v_new_count := CASE WHEN v_shop.hours_extension_count_date IS DISTINCT FROM v_today
                       THEN 0 ELSE v_shop.hours_extension_count END;
  IF v_new_count >= 2 THEN
    RAISE EXCEPTION 'Limite de 2 prolongations par jour atteinte';
  END IF;

  -- Heure de fermeture du jour, ancrée sur le fuseau réel de la boutique
  v_close_instant := (v_today + v_shop.closing_time) - (v_offset || ' minutes')::interval;

  v_base := CASE WHEN v_shop.hours_extension_until IS NOT NULL
                   AND v_shop.hours_extension_until > v_close_instant
                  THEN v_shop.hours_extension_until
                  ELSE v_close_instant END;
  v_new_until := v_base + (p_minutes || ' minutes')::interval;

  IF ((v_new_until + (v_offset || ' minutes')::interval)::date) > v_today THEN
    RAISE EXCEPTION 'La prolongation dépasserait minuit — non supporté';
  END IF;

  UPDATE shops SET
    hours_extension_until = v_new_until,
    hours_extension_count = v_new_count + 1,
    hours_extension_count_date = v_today
  WHERE id = p_shop_id;

  RETURN jsonb_build_object(
    'hours_extension_until', v_new_until,
    'hours_extension_count', v_new_count + 1
  );
END;
$$;

REVOKE ALL ON FUNCTION public.grant_hours_extension(uuid, int) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.grant_hours_extension(uuid, int) TO service_role;

NOTIFY pgrst, 'reload schema';
COMMIT;

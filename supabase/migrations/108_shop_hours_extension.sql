-- ============================================================
-- 108 — Prolongation déléguée de l'heure de fermeture
--
-- Permet à un rôle habilité (role_permissions.extend_hours — owner/
-- super_admin toujours implicites) de repousser la fermeture du jour même,
-- par incréments fixes (15/30/45/60 min), plafonné à 2 fois par jour.
--
-- hours_extension_until est un instant absolu (timestamptz), pas une heure
-- seule : il s'expire tout seul, sans job de nettoyage, contrairement à
-- opening_time/closing_time qui sont réinterprétés chaque jour.
--
-- Le calcul de "l'heure de fermeture d'aujourd'hui" doit se faire ici, pas
-- en JS côté serveur : Date.setHours() côté serveur (Vercel, ~UTC) ancre
-- silencieusement l'heure sur le fuseau du serveur, pas celui de la
-- boutique. shop_utc_offset_minutes() dérive le bon décalage depuis
-- shops.country (déjà stocké), plutôt qu'un fuseau unique codé en dur qui
-- serait faux pour la moitié des pays desservis (répartis UTC+0/UTC+1).
-- ============================================================

ALTER TABLE shops ADD COLUMN IF NOT EXISTS hours_extension_until timestamptz DEFAULT NULL;
ALTER TABLE shops ADD COLUMN IF NOT EXISTS hours_extension_count int NOT NULL DEFAULT 0;
ALTER TABLE shops ADD COLUMN IF NOT EXISTS hours_extension_count_date date DEFAULT NULL;

CREATE OR REPLACE FUNCTION shop_utc_offset_minutes(p_country text)
RETURNS int LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE p_country
    WHEN 'NG' THEN 60 WHEN 'CM' THEN 60 WHEN 'NE' THEN 60 WHEN 'BJ' THEN 60
    WHEN 'CD' THEN 60 WHEN 'CG' THEN 60 WHEN 'GA' THEN 60 WHEN 'GQ' THEN 60
    WHEN 'CF' THEN 60 WHEN 'TD' THEN 60
    WHEN 'CI' THEN 0  WHEN 'ML' THEN 0  WHEN 'SN' THEN 0  WHEN 'TG' THEN 0
    WHEN 'GH' THEN 0  WHEN 'BF' THEN 0  WHEN 'GN' THEN 0  WHEN 'GW' THEN 0
    WHEN 'GM' THEN 0  WHEN 'SL' THEN 0  WHEN 'LR' THEN 0  WHEN 'MR' THEN 0
    WHEN 'CV' THEN -60
    ELSE 60 -- EU/US/CA (multi-fuseaux, DST) : pas de décalage fixe correct
            -- possible, repli sur le Nigeria (marché principal). Imprécision
            -- documentée, acceptée pour ces marchés hors cœur de cible.
  END
$$;

CREATE OR REPLACE FUNCTION grant_hours_extension(
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

REVOKE ALL ON FUNCTION grant_hours_extension(uuid, int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION grant_hours_extension(uuid, int) TO service_role;

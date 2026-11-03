CREATE OR REPLACE FUNCTION public.shop_utc_offset_minutes(p_country text)
 RETURNS integer
 LANGUAGE sql
 IMMUTABLE
AS $function$
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
$function$
;

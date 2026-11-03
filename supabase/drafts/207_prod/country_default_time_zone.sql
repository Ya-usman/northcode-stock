CREATE OR REPLACE FUNCTION public.country_default_time_zone(p_country text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
  SELECT CASE upper(coalesce(p_country, ''))
    WHEN 'AT' THEN 'Europe/Vienna'       WHEN 'BE' THEN 'Europe/Brussels'     WHEN 'BF' THEN 'Africa/Ouagadougou'
    WHEN 'BG' THEN 'Europe/Sofia'        WHEN 'BJ' THEN 'Africa/Porto-Novo'   WHEN 'CF' THEN 'Africa/Bangui'
    WHEN 'CG' THEN 'Africa/Brazzaville'  WHEN 'CI' THEN 'Africa/Abidjan'      WHEN 'CM' THEN 'Africa/Douala'
    WHEN 'CV' THEN 'Atlantic/Cape_Verde' WHEN 'CY' THEN 'Asia/Nicosia'        WHEN 'CZ' THEN 'Europe/Prague'
    WHEN 'DE' THEN 'Europe/Berlin'       WHEN 'DK' THEN 'Europe/Copenhagen'   WHEN 'EE' THEN 'Europe/Tallinn'
    WHEN 'FI' THEN 'Europe/Helsinki'     WHEN 'FR' THEN 'Europe/Paris'        WHEN 'GA' THEN 'Africa/Libreville'
    WHEN 'GB' THEN 'Europe/London'       WHEN 'GH' THEN 'Africa/Accra'        WHEN 'GM' THEN 'Africa/Banjul'
    WHEN 'GN' THEN 'Africa/Conakry'      WHEN 'GQ' THEN 'Africa/Malabo'       WHEN 'GR' THEN 'Europe/Athens'
    WHEN 'GW' THEN 'Africa/Bissau'       WHEN 'HR' THEN 'Europe/Zagreb'       WHEN 'HU' THEN 'Europe/Budapest'
    WHEN 'IE' THEN 'Europe/Dublin'       WHEN 'IT' THEN 'Europe/Rome'         WHEN 'LR' THEN 'Africa/Monrovia'
    WHEN 'LT' THEN 'Europe/Vilnius'      WHEN 'LU' THEN 'Europe/Luxembourg'   WHEN 'LV' THEN 'Europe/Riga'
    WHEN 'ML' THEN 'Africa/Bamako'       WHEN 'MR' THEN 'Africa/Nouakchott'   WHEN 'MT' THEN 'Europe/Malta'
    WHEN 'NE' THEN 'Africa/Niamey'       WHEN 'NG' THEN 'Africa/Lagos'        WHEN 'NL' THEN 'Europe/Amsterdam'
    WHEN 'PL' THEN 'Europe/Warsaw'       WHEN 'RO' THEN 'Europe/Bucharest'    WHEN 'SE' THEN 'Europe/Stockholm'
    WHEN 'SI' THEN 'Europe/Ljubljana'    WHEN 'SK' THEN 'Europe/Bratislava'   WHEN 'SL' THEN 'Africa/Freetown'
    WHEN 'SN' THEN 'Africa/Dakar'        WHEN 'TD' THEN 'Africa/Ndjamena'     WHEN 'TG' THEN 'Africa/Lome'
    ELSE NULL   -- US, CA, CD, ES, PT (plusieurs fuseaux) et pays inconnus : aucune déduction depuis le pays
  END
$function$
;

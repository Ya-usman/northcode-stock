CREATE OR REPLACE FUNCTION public.country_time_zones(p_country text)
 RETURNS text[]
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
  SELECT CASE upper(coalesce(p_country, ''))
    WHEN 'US' THEN ARRAY['America/New_York','America/Detroit','America/Kentucky/Louisville','America/Kentucky/Monticello',
      'America/Indiana/Indianapolis','America/Indiana/Vincennes','America/Indiana/Winamac','America/Indiana/Marengo',
      'America/Indiana/Petersburg','America/Indiana/Vevay','America/Chicago','America/Indiana/Tell_City','America/Indiana/Knox',
      'America/Menominee','America/North_Dakota/Center','America/North_Dakota/New_Salem','America/North_Dakota/Beulah',
      'America/Denver','America/Boise','America/Phoenix','America/Los_Angeles','America/Anchorage','America/Juneau',
      'America/Sitka','America/Metlakatla','America/Yakutat','America/Nome','America/Adak','Pacific/Honolulu']
    WHEN 'CA' THEN ARRAY['America/St_Johns','America/Halifax','America/Glace_Bay','America/Moncton','America/Goose_Bay',
      'America/Toronto','America/Iqaluit','America/Winnipeg','America/Resolute','America/Rankin_Inlet','America/Regina',
      'America/Swift_Current','America/Edmonton','America/Cambridge_Bay','America/Inuvik','America/Dawson_Creek',
      'America/Fort_Nelson','America/Whitehorse','America/Dawson','America/Vancouver','America/Atikokan',
      'America/Blanc-Sablon','America/Creston']
    WHEN 'CD' THEN ARRAY['Africa/Kinshasa','Africa/Lubumbashi']
    WHEN 'ES' THEN ARRAY['Europe/Madrid','Africa/Ceuta','Atlantic/Canary']
    WHEN 'PT' THEN ARRAY['Europe/Lisbon','Atlantic/Madeira','Atlantic/Azores']
    ELSE CASE WHEN country_default_time_zone(p_country) IS NULL THEN NULL
              ELSE ARRAY[country_default_time_zone(p_country)] END
  END
$function$
;

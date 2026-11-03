-- Retour arrière de la 207 (nouveaux pays). À n'exécuter qu'APRÈS avoir remis en ligne le code d'avant, et seulement si
-- AUCUNE boutique, commission ou entreprise n'utilise une des nouvelles monnaies (sinon les contraintes échouent) :
--   SELECT currency, count(*) FROM shops WHERE currency NOT IN ('NGN', 'XOF', 'XAF', 'GHS', 'GNF', 'GMD', 'SLE', 'LRD', 'CVE', 'MRU', 'CDF', 'EUR', 'USD', 'CAD', 'CZK', 'DKK', 'HUF', 'PLN', 'RON', 'SEK') GROUP BY 1;
SET LOCAL lock_timeout = '5s';
ALTER TABLE public.shops DROP CONSTRAINT IF EXISTS shops_currency_supported;
ALTER TABLE public.shops ADD CONSTRAINT shops_currency_supported CHECK (currency IN ('NGN', 'XOF', 'XAF', 'GHS', 'GNF', 'GMD', 'SLE', 'LRD', 'CVE', 'MRU', 'CDF', 'EUR', 'USD', 'CAD', 'CZK', 'DKK', 'HUF', 'PLN', 'RON', 'SEK'));
ALTER TABLE public.agent_commissions DROP CONSTRAINT IF EXISTS agent_commissions_currency_supported;
ALTER TABLE public.agent_commissions ADD CONSTRAINT agent_commissions_currency_supported CHECK (currency IN ('NGN', 'XOF', 'XAF', 'GHS', 'GNF', 'GMD', 'SLE', 'LRD', 'CVE', 'MRU', 'CDF', 'EUR', 'USD', 'CAD', 'CZK', 'DKK', 'HUF', 'PLN', 'RON', 'SEK'));
ALTER TABLE public.entities DROP CONSTRAINT IF EXISTS entities_consolidation_currency_supported;
ALTER TABLE public.entities ADD CONSTRAINT entities_consolidation_currency_supported CHECK (consolidation_currency IN ('NGN', 'XOF', 'XAF', 'GHS', 'GNF', 'GMD', 'SLE', 'LRD', 'CVE', 'MRU', 'CDF', 'EUR', 'USD', 'CAD', 'CZK', 'DKK', 'HUF', 'PLN', 'RON', 'SEK'));
CREATE OR REPLACE FUNCTION public.currency_code_for_country(p_country text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
AS $function$
  SELECT CASE p_country
    WHEN 'NG' THEN 'NGN'
    WHEN 'GH' THEN 'GHS'
    WHEN 'GN' THEN 'GNF'
    WHEN 'GM' THEN 'GMD'
    WHEN 'SL' THEN 'SLE'
    WHEN 'LR' THEN 'LRD'
    WHEN 'CV' THEN 'CVE'
    WHEN 'MR' THEN 'MRU'
    WHEN 'CD' THEN 'CDF'
    WHEN 'US' THEN 'USD'
    WHEN 'CA' THEN 'CAD'
    WHEN 'CM' THEN 'XAF' WHEN 'CG' THEN 'XAF' WHEN 'GA' THEN 'XAF'
    WHEN 'GQ' THEN 'XAF' WHEN 'CF' THEN 'XAF' WHEN 'TD' THEN 'XAF'
    WHEN 'CI' THEN 'XOF' WHEN 'ML' THEN 'XOF' WHEN 'NE' THEN 'XOF'
    WHEN 'SN' THEN 'XOF' WHEN 'BJ' THEN 'XOF' WHEN 'TG' THEN 'XOF'
    WHEN 'BF' THEN 'XOF' WHEN 'GW' THEN 'XOF'
    -- Union européenne — 21 pays en euro
    WHEN 'DE' THEN 'EUR' WHEN 'AT' THEN 'EUR' WHEN 'BE' THEN 'EUR'
    WHEN 'BG' THEN 'EUR' WHEN 'HR' THEN 'EUR' WHEN 'CY' THEN 'EUR'
    WHEN 'ES' THEN 'EUR' WHEN 'EE' THEN 'EUR' WHEN 'FI' THEN 'EUR'
    WHEN 'FR' THEN 'EUR' WHEN 'GR' THEN 'EUR' WHEN 'IE' THEN 'EUR'
    WHEN 'IT' THEN 'EUR' WHEN 'LV' THEN 'EUR' WHEN 'LT' THEN 'EUR'
    WHEN 'LU' THEN 'EUR' WHEN 'MT' THEN 'EUR' WHEN 'NL' THEN 'EUR'
    WHEN 'PT' THEN 'EUR' WHEN 'SK' THEN 'EUR' WHEN 'SI' THEN 'EUR'
    -- Union européenne — 6 pays hors zone euro (jamais EUR)
    WHEN 'CZ' THEN 'CZK'
    WHEN 'DK' THEN 'DKK'
    WHEN 'HU' THEN 'HUF'
    WHEN 'PL' THEN 'PLN'
    WHEN 'RO' THEN 'RON'
    WHEN 'SE' THEN 'SEK'
    ELSE 'NGN'
  END
$function$
;
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

-- ============================================================
-- 207 : nouveaux pays et monnaies (tarification du 3 nov. 2026, tableau validé)
-- ============================================================
-- 46 pays ajoutés à l'application (Afrique de l'Est et du Nord, Asie, Amériques, Royaume-Uni, Suisse),
-- 43 monnaies nouvelles. La base doit les accepter aux mêmes endroits que les monnaies déjà connues :
--   • shops_currency_supported, agent_commissions_currency_supported, entities_consolidation_currency_supported
--     (listes fermées, miroir de lib/saas/currencies.ts) ;
--   • currency_code_for_country (monnaie par défaut d'un pays) ;
--   • country_default_time_zone / country_time_zones (fuseaux autorisés, miroir de lib/time/time-zones.ts).
-- Les fonctions sont la version EN PRODUCTION (supabase/drafts/207_prod) avec les nouveaux pays ajoutés avant le cas
-- par défaut : aucun pays existant ne change. Ré-exécutable. Retour arrière : supabase/rollbacks/207_new_countries_rollback.sql
-- ============================================================

SET LOCAL lock_timeout = '5s';

-- ── 1. Monnaies acceptées ─────────────────────────────────────────────────
ALTER TABLE public.shops DROP CONSTRAINT IF EXISTS shops_currency_supported;
ALTER TABLE public.shops ADD CONSTRAINT shops_currency_supported CHECK (currency IN ('NGN', 'XOF', 'XAF', 'GHS', 'GNF', 'GMD', 'SLE', 'LRD', 'CVE', 'MRU', 'CDF', 'EUR', 'USD', 'CAD', 'CZK', 'DKK', 'HUF', 'PLN', 'RON', 'SEK', 'KES', 'UGX', 'TZS', 'RWF', 'ETB', 'MAD', 'TND', 'DZD', 'EGP', 'ZAR', 'INR', 'PKR', 'BDT', 'PHP', 'IDR', 'VND', 'NPR', 'LKR', 'KHR', 'MMK', 'CNY', 'MYR', 'THB', 'JPY', 'KRW', 'SGD', 'AED', 'SAR', 'BRL', 'MXN', 'CLP', 'COP', 'PEN', 'ARS', 'UYU', 'CRC', 'BOB', 'GTQ', 'HNL', 'HTG', 'VES', 'GBP', 'CHF'));

ALTER TABLE public.agent_commissions DROP CONSTRAINT IF EXISTS agent_commissions_currency_supported;
ALTER TABLE public.agent_commissions ADD CONSTRAINT agent_commissions_currency_supported CHECK (currency IN ('NGN', 'XOF', 'XAF', 'GHS', 'GNF', 'GMD', 'SLE', 'LRD', 'CVE', 'MRU', 'CDF', 'EUR', 'USD', 'CAD', 'CZK', 'DKK', 'HUF', 'PLN', 'RON', 'SEK', 'KES', 'UGX', 'TZS', 'RWF', 'ETB', 'MAD', 'TND', 'DZD', 'EGP', 'ZAR', 'INR', 'PKR', 'BDT', 'PHP', 'IDR', 'VND', 'NPR', 'LKR', 'KHR', 'MMK', 'CNY', 'MYR', 'THB', 'JPY', 'KRW', 'SGD', 'AED', 'SAR', 'BRL', 'MXN', 'CLP', 'COP', 'PEN', 'ARS', 'UYU', 'CRC', 'BOB', 'GTQ', 'HNL', 'HTG', 'VES', 'GBP', 'CHF'));

ALTER TABLE public.entities DROP CONSTRAINT IF EXISTS entities_consolidation_currency_supported;
ALTER TABLE public.entities ADD CONSTRAINT entities_consolidation_currency_supported CHECK (consolidation_currency IN ('NGN', 'XOF', 'XAF', 'GHS', 'GNF', 'GMD', 'SLE', 'LRD', 'CVE', 'MRU', 'CDF', 'EUR', 'USD', 'CAD', 'CZK', 'DKK', 'HUF', 'PLN', 'RON', 'SEK', 'KES', 'UGX', 'TZS', 'RWF', 'ETB', 'MAD', 'TND', 'DZD', 'EGP', 'ZAR', 'INR', 'PKR', 'BDT', 'PHP', 'IDR', 'VND', 'NPR', 'LKR', 'KHR', 'MMK', 'CNY', 'MYR', 'THB', 'JPY', 'KRW', 'SGD', 'AED', 'SAR', 'BRL', 'MXN', 'CLP', 'COP', 'PEN', 'ARS', 'UYU', 'CRC', 'BOB', 'GTQ', 'HNL', 'HTG', 'VES', 'GBP', 'CHF'));

-- ── 2. Monnaie par défaut d'un pays ───────────────────────────────────────
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
    -- Nouveaux pays (tarification du 3 nov. 2026)
    WHEN 'KE' THEN 'KES'
    WHEN 'UG' THEN 'UGX'
    WHEN 'TZ' THEN 'TZS'
    WHEN 'RW' THEN 'RWF'
    WHEN 'ET' THEN 'ETB'
    WHEN 'MA' THEN 'MAD'
    WHEN 'TN' THEN 'TND'
    WHEN 'DZ' THEN 'DZD'
    WHEN 'EG' THEN 'EGP'
    WHEN 'ZA' THEN 'ZAR'
    WHEN 'IN' THEN 'INR'
    WHEN 'PK' THEN 'PKR'
    WHEN 'BD' THEN 'BDT'
    WHEN 'PH' THEN 'PHP'
    WHEN 'ID' THEN 'IDR'
    WHEN 'VN' THEN 'VND'
    WHEN 'NP' THEN 'NPR'
    WHEN 'LK' THEN 'LKR'
    WHEN 'KH' THEN 'KHR'
    WHEN 'MM' THEN 'MMK'
    WHEN 'CN' THEN 'CNY'
    WHEN 'MY' THEN 'MYR'
    WHEN 'TH' THEN 'THB'
    WHEN 'JP' THEN 'JPY'
    WHEN 'KR' THEN 'KRW'
    WHEN 'SG' THEN 'SGD'
    WHEN 'AE' THEN 'AED'
    WHEN 'SA' THEN 'SAR'
    WHEN 'BR' THEN 'BRL'
    WHEN 'MX' THEN 'MXN'
    WHEN 'CL' THEN 'CLP'
    WHEN 'CO' THEN 'COP'
    WHEN 'PE' THEN 'PEN'
    WHEN 'AR' THEN 'ARS'
    WHEN 'UY' THEN 'UYU'
    WHEN 'EC' THEN 'USD'
    WHEN 'PA' THEN 'USD'
    WHEN 'CR' THEN 'CRC'
    WHEN 'BO' THEN 'BOB'
    WHEN 'GT' THEN 'GTQ'
    WHEN 'HN' THEN 'HNL'
    WHEN 'HT' THEN 'HTG'
    WHEN 'SV' THEN 'USD'
    WHEN 'VE' THEN 'VES'
    WHEN 'GB' THEN 'GBP'
    WHEN 'CH' THEN 'CHF'
    ELSE 'NGN'
  END
$function$
;

-- ── 3. Fuseaux horaires ───────────────────────────────────────────────────
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
    -- Nouveaux pays à fuseau unique (3 nov. 2026)
    WHEN 'KE' THEN 'Africa/Nairobi'
    WHEN 'UG' THEN 'Africa/Kampala'
    WHEN 'TZ' THEN 'Africa/Dar_es_Salaam'
    WHEN 'RW' THEN 'Africa/Kigali'
    WHEN 'ET' THEN 'Africa/Addis_Ababa'
    WHEN 'MA' THEN 'Africa/Casablanca'
    WHEN 'TN' THEN 'Africa/Tunis'
    WHEN 'DZ' THEN 'Africa/Algiers'
    WHEN 'EG' THEN 'Africa/Cairo'
    WHEN 'ZA' THEN 'Africa/Johannesburg'
    WHEN 'IN' THEN 'Asia/Kolkata'
    WHEN 'PK' THEN 'Asia/Karachi'
    WHEN 'BD' THEN 'Asia/Dhaka'
    WHEN 'PH' THEN 'Asia/Manila'
    WHEN 'VN' THEN 'Asia/Ho_Chi_Minh'
    WHEN 'NP' THEN 'Asia/Kathmandu'
    WHEN 'LK' THEN 'Asia/Colombo'
    WHEN 'KH' THEN 'Asia/Phnom_Penh'
    WHEN 'MM' THEN 'Asia/Yangon'
    WHEN 'CN' THEN 'Asia/Shanghai'
    WHEN 'TH' THEN 'Asia/Bangkok'
    WHEN 'JP' THEN 'Asia/Tokyo'
    WHEN 'KR' THEN 'Asia/Seoul'
    WHEN 'SG' THEN 'Asia/Singapore'
    WHEN 'AE' THEN 'Asia/Dubai'
    WHEN 'SA' THEN 'Asia/Riyadh'
    WHEN 'CO' THEN 'America/Bogota'
    WHEN 'PE' THEN 'America/Lima'
    WHEN 'AR' THEN 'America/Argentina/Buenos_Aires'
    WHEN 'UY' THEN 'America/Montevideo'
    WHEN 'PA' THEN 'America/Panama'
    WHEN 'CR' THEN 'America/Costa_Rica'
    WHEN 'BO' THEN 'America/La_Paz'
    WHEN 'GT' THEN 'America/Guatemala'
    WHEN 'HN' THEN 'America/Tegucigalpa'
    WHEN 'HT' THEN 'America/Port-au-Prince'
    WHEN 'SV' THEN 'America/El_Salvador'
    WHEN 'VE' THEN 'America/Caracas'
    WHEN 'CH' THEN 'Europe/Zurich'
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
    -- Nouveaux pays à plusieurs fuseaux (3 nov. 2026)
    WHEN 'ID' THEN ARRAY['Asia/Jakarta','Asia/Pontianak','Asia/Makassar','Asia/Jayapura']
    WHEN 'MY' THEN ARRAY['Asia/Kuala_Lumpur','Asia/Kuching']
    WHEN 'BR' THEN ARRAY['America/Sao_Paulo','America/Noronha','America/Belem','America/Fortaleza','America/Recife','America/Araguaina','America/Maceio','America/Bahia','America/Campo_Grande','America/Cuiaba','America/Santarem','America/Porto_Velho','America/Boa_Vista','America/Manaus','America/Eirunepe','America/Rio_Branco']
    WHEN 'MX' THEN ARRAY['America/Mexico_City','America/Cancun','America/Merida','America/Monterrey','America/Matamoros','America/Chihuahua','America/Ciudad_Juarez','America/Ojinaga','America/Mazatlan','America/Bahia_Banderas','America/Hermosillo','America/Tijuana']
    WHEN 'CL' THEN ARRAY['America/Santiago','America/Punta_Arenas','Pacific/Easter']
    WHEN 'EC' THEN ARRAY['America/Guayaquil','Pacific/Galapagos']
    ELSE CASE WHEN country_default_time_zone(p_country) IS NULL THEN NULL
              ELSE ARRAY[country_default_time_zone(p_country)] END
  END
$function$
;

-- ── Vérification après exécution ───────────────────────────────────────────
-- SELECT currency_code_for_country('KE'), currency_code_for_country('IN'), currency_code_for_country('NG');  -- KES, INR, NGN
-- SELECT country_default_time_zone('KE'), country_time_zones('BR')[1], country_default_time_zone('NG');      -- Africa/Nairobi, America/Sao_Paulo, Africa/Lagos

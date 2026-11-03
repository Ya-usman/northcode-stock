-- Retour arrière de la 208 (pays de tarification). À n'exécuter qu'APRÈS avoir remis en ligne le code d'avant (les routes
-- de paiement écrivent request_country / pricing_country). Données perdues (activité par pays, pays fixés) : exporter
--   SELECT * FROM entity_activity_countries;
--   SELECT id, name, pricing_country, pricing_country_reason FROM entities WHERE pricing_country IS NOT NULL;
SET LOCAL lock_timeout = '5s';
DROP FUNCTION IF EXISTS public.bump_entity_activity(uuid, text, integer, integer);
DROP TABLE IF EXISTS public.entity_activity_countries;
ALTER TABLE public.entities DROP CONSTRAINT IF EXISTS entities_pricing_country_check;
ALTER TABLE public.entities DROP COLUMN IF EXISTS pricing_country, DROP COLUMN IF EXISTS pricing_country_reason, DROP COLUMN IF EXISTS pricing_country_set_at;
ALTER TABLE public.payment_intents DROP CONSTRAINT IF EXISTS payment_intents_countries_check;
ALTER TABLE public.payment_intents DROP COLUMN IF EXISTS request_country, DROP COLUMN IF EXISTS payer_country, DROP COLUMN IF EXISTS pricing_reason, DROP COLUMN IF EXISTS pricing_country;

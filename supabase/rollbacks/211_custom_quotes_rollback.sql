-- Retour arrière de la 211 (offre sur mesure). À n'exécuter qu'APRÈS avoir remis en ligne le code d'avant. Données
-- perdues (demandes, devis, limites sur mesure) : exporter d'abord
--   SELECT * FROM custom_quotes;
--   SELECT id, name, custom_shops, custom_seats, custom_quote_id FROM entities WHERE custom_quote_id IS NOT NULL;
-- Les paiements « devis » déjà préparés empêchent de remettre l'ancienne contrainte : vérifier d'abord
--   SELECT count(*) FROM payment_intents WHERE kind = 'custom';   -- doit valoir 0
SET LOCAL lock_timeout = '5s';
ALTER TABLE public.payment_intents DROP CONSTRAINT IF EXISTS payment_intents_addons_check;
ALTER TABLE public.payment_intents ADD CONSTRAINT payment_intents_addons_check CHECK (
  kind IN ('plan', 'addon')
  AND addon_seats BETWEEN 0 AND 20 AND addon_shops BETWEEN 0 AND 2
  AND (kind = 'plan' OR (addon_seats + addon_shops > 0 AND period_end IS NOT NULL)));
ALTER TABLE public.payment_intents DROP COLUMN IF EXISTS quote_id;
ALTER TABLE public.entities DROP CONSTRAINT IF EXISTS entities_custom_limits_check;
ALTER TABLE public.entities DROP COLUMN IF EXISTS custom_quote_id, DROP COLUMN IF EXISTS custom_shops, DROP COLUMN IF EXISTS custom_seats;
DROP TABLE IF EXISTS public.custom_quotes;

-- Retour arrière de la 204 (paiements préparés par le serveur). À n'exécuter qu'APRÈS avoir remis en ligne le code
-- d'avant (les routes /api/billing/* liraient sinon une table absente). Les lignes sont perdues : exporter d'abord
--   SELECT * FROM payment_intents;
SET LOCAL lock_timeout = '5s';
DROP TRIGGER IF EXISTS trg_payment_intents_guard ON public.payment_intents;
DROP TABLE IF EXISTS public.payment_intents;

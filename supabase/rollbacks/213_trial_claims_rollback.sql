-- Retour arrière de la 213 (protection de l'essai). À n'exécuter qu'APRÈS avoir remis en ligne le code d'avant.
-- Données perdues (registre des essais : sans lui, un numéro déjà utilisé pourrait reprendre un essai) : exporter d'abord
--   SELECT * FROM trial_claims;
--   SELECT id, name, trial_status FROM entities WHERE trial_status IS NOT NULL;
-- Comptes Google en attente du téléphone : sans la 213, ils restent sans essai ; à traiter avant (accorder l'essai).
--   SELECT id, name FROM entities WHERE trial_status = 'pending_phone';
SET LOCAL lock_timeout = '5s';
ALTER TABLE public.entities DROP CONSTRAINT IF EXISTS entities_trial_status_check;
ALTER TABLE public.entities DROP COLUMN IF EXISTS trial_status;
DROP TABLE IF EXISTS public.trial_claims;

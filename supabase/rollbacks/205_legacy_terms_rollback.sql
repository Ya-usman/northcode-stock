-- Retour arrière de la 205 (conditions des clients actuels). À n'exécuter qu'APRÈS avoir remis en ligne le code d'avant
-- (lib/saas/legacy-terms lit la colonne ; sans elle, il ne garantit simplement plus rien). Conditions perdues : exporter
--   SELECT id, name, legacy_terms FROM entities WHERE legacy_terms IS NOT NULL;
SET LOCAL lock_timeout = '5s';
ALTER TABLE public.entities DROP CONSTRAINT IF EXISTS entities_legacy_terms_check;
ALTER TABLE public.entities DROP COLUMN IF EXISTS legacy_terms;
DROP FUNCTION IF EXISTS public.valid_legacy_terms(jsonb);
-- Les droits techniques retirés sur payment_intents ne sont pas rendus (aucun usage)

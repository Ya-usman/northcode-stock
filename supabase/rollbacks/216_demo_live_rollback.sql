-- Retour arrière de 216 (compte de démonstration vivant) : arrête la tâche planifiée et retire la fonction, le
-- journal des créneaux et le marquage « démo ». Les ventes, réassorts et dépenses déjà générés RESTENT (ce sont
-- des données ordinaires du compte de démonstration, interne) : jamais d'effacement d'historique.

SET LOCAL lock_timeout = '5s';

DO $$ BEGIN
  PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'demo-live-sales';
END $$;
DROP FUNCTION IF EXISTS public.demo_live_tick(timestamptz);
DROP TABLE IF EXISTS public.demo_live_runs;
ALTER TABLE public.entities DROP CONSTRAINT IF EXISTS entities_demo_internal_check;
ALTER TABLE public.entities DROP COLUMN IF EXISTS is_demo;

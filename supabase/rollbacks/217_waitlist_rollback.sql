-- Retour arrière de 217 (liste d'attente des métiers). ATTENTION : supprime les inscriptions. Exporter d'abord la liste
-- (Admin → Liste d'attente → Exporter) si elle contient des contacts à garder.
SET LOCAL lock_timeout = '5s';
DROP TRIGGER IF EXISTS trg_waitlist_guard ON public.waitlist;
DROP TABLE IF EXISTS public.waitlist;

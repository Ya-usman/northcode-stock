-- ════════════════════════════════════════════════════════════════════════════════════════════════════════════
-- Retour arrière de 180 — retire UNIQUEMENT les quatre objets créés par la 180
-- ════════════════════════════════════════════════════════════════════════════════════════════════════════════
-- Ramène notes à son état d'avant la 180 (= 046 partielle). Ne touche jamais à la table notes, à ses colonnes,
-- à ses données, à sa RLS ni à ses politiques. Les updated_at écrits par le déclencheur entre-temps restent tels
-- quels (aucune donnée n'est modifiée).

BEGIN;

DROP TRIGGER IF EXISTS notes_updated_at ON public.notes;
DROP FUNCTION IF EXISTS public.touch_notes_updated_at();
DROP INDEX IF EXISTS public.idx_notes_shop_id;
DROP INDEX IF EXISTS public.idx_notes_owner_id;

COMMIT;

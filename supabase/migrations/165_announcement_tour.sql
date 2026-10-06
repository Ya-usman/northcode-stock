-- ============================================================
-- 165 — Nouveautés : lancer un tour guidé (onboarding lot C1)
--
-- Une nouveauté peut proposer « Me montrer » : le tour guidé qui montre
-- comment s'en servir (mêmes tours que la page Aide). Le bouton n'apparaît
-- qu'aux personnes qui peuvent suivre ce tour ; sinon « Essayer » reste.
-- Colonne facultative : les annonces existantes ne changent pas.
-- Liste fermée = lib/onboarding/tours.ts (TOUR_IDS). Ré-exécutable.
-- ============================================================

ALTER TABLE announcements ADD COLUMN IF NOT EXISTS tour_id text;

ALTER TABLE announcements DROP CONSTRAINT IF EXISTS announcements_tour_check;
ALTER TABLE announcements ADD CONSTRAINT announcements_tour_check
  CHECK (tour_id IS NULL OR tour_id IN ('quick_tour', 'add_product', 'first_sale', 'add_category', 'invite_member', 'customize_receipt'));

NOTIFY pgrst, 'reload schema';

-- ── Vérification après exécution ───────────────────────────────────────────
-- SELECT column_name, data_type, is_nullable FROM information_schema.columns
--   WHERE table_name = 'announcements' AND column_name = 'tour_id';
-- Attendu : 1 ligne (tour_id, text, YES).
-- SELECT count(*) FROM announcements WHERE tour_id IS NOT NULL;  -- attendu : 0

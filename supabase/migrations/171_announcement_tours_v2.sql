-- ============================================================
-- 171 — Nouveautés : 3 nouveaux tours guidés (7 oct. 2026)
--
-- Une nouveauté peut lancer « Me montrer » sur les nouveaux tours :
--   opening_balance   — reprendre une dette existante (Crédits)
--   import_customers  — importer ses clients depuis Excel
--   import_products   — importer ses produits depuis Excel
-- Liste fermée = lib/onboarding/tours.ts (TOUR_IDS). Ré-exécutable ; les
-- annonces existantes ne changent pas.
-- ============================================================

ALTER TABLE announcements DROP CONSTRAINT IF EXISTS announcements_tour_check;
ALTER TABLE announcements ADD CONSTRAINT announcements_tour_check
  CHECK (tour_id IS NULL OR tour_id IN (
    'quick_tour', 'add_product', 'first_sale', 'add_category', 'invite_member', 'customize_receipt',
    'opening_balance', 'import_customers', 'import_products'
  ));

NOTIFY pgrst, 'reload schema';

-- ── Vérification après exécution ───────────────────────────────────────────
-- Doit afficher une ligne contenant 'opening_balance', 'import_customers', 'import_products'
SELECT pg_get_constraintdef(oid) AS regle FROM pg_constraint WHERE conname = 'announcements_tour_check';

-- ============================================================
-- 116 — Couleur de catégorie
-- ============================================================
-- Une couleur par catégorie, choisie dans une palette fixe côté client
-- (lib/constants/category-colors.ts) plutôt que libre — stockée en hex pour
-- pouvoir être appliquée directement en style inline (border-top des cartes
-- produit, pastilles de filtre) sans dépendre de classes Tailwind générées
-- dynamiquement, que la purge de build ne peut pas détecter.
-- NULL = catégorie existante pas encore recolorée (pas de trait affiché).

ALTER TABLE categories ADD COLUMN IF NOT EXISTS color text;

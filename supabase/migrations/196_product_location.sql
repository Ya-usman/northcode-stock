-- ============================================================
-- 196 : emplacement d'un produit (étape 10 du Stock, 1er nov. 2026)
-- ============================================================
-- Où trouver le produit dans la boutique : « Rayon 3, étagère B », « Réserve », « Vitrine »… Texte libre, facultatif,
-- UN emplacement par produit (le produit appartient déjà à une boutique). Sert à retrouver un produit, à le chercher
-- et à compter l'inventaire dans l'ordre du magasin. Le stock n'est PAS réparti entre plusieurs emplacements.
-- Lecture : comme les autres colonnes publiques du produit (droits par colonne depuis la 181 : GRANT explicite).
-- Écriture : par la route serveur des produits seulement (droit Stock en modification), comme les autres champs.
-- Additive, ré-exécutable. Retour arrière : supabase/rollbacks/196_product_location_rollback.sql
-- ============================================================

SET LOCAL lock_timeout = '5s';

ALTER TABLE public.products ADD COLUMN IF NOT EXISTS location text;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'products_location_check' AND conrelid = 'public.products'::regclass) THEN
    ALTER TABLE public.products ADD CONSTRAINT products_location_check
      CHECK (location IS NULL OR char_length(btrim(location)) BETWEEN 1 AND 60);
  END IF;
END $$;

GRANT SELECT (location) ON public.products TO authenticated;

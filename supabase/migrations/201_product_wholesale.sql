-- ============================================================
-- 201 : prix de gros d'un produit (vente en gros, étape 1, 1er nov. 2026)
-- ============================================================
-- « Prix de gros : 450 F la pièce, à partir de 24 pièces » : dès que la quantité d'une ligne de vente atteint le
-- minimum, TOUTE la ligne passe au prix de gros (vente par paliers). Deux colonnes facultatives, toujours ensemble :
--   wholesale_price    prix de gros À LA PIÈCE (unité de base du produit), > 0
--   wholesale_min_qty  quantité à partir de laquelle il s'applique, entier de 2 à 100 000
-- Règles tenues par le serveur (lib/sales/pricing + lib/api/sale-validation) : la caisse applique le prix de gros,
-- le serveur l'accepte seulement si la quantité est atteinte ; prix de gros inférieur au prix de détail (contrôle des
-- routes produits, pas ici : le prix de détail peut changer dans la même requête). Les ventes passées ne changent pas.
-- Lecture : comme les autres colonnes publiques du produit (droits par colonne depuis la 181 : GRANT explicite).
-- Écriture : par les routes serveur des produits seulement (droit Stock en modification).
-- Additive, ré-exécutable. Retour arrière : supabase/rollbacks/201_product_wholesale_rollback.sql
-- ============================================================

SET LOCAL lock_timeout = '5s';

ALTER TABLE public.products ADD COLUMN IF NOT EXISTS wholesale_price numeric(14,2);
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS wholesale_min_qty integer;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'products_wholesale_check' AND conrelid = 'public.products'::regclass) THEN
    ALTER TABLE public.products ADD CONSTRAINT products_wholesale_check CHECK (
      -- IS NOT NULL explicites : une comparaison avec NULL ne refuserait rien (prix sans quantité accepté sinon)
      (wholesale_price IS NULL AND wholesale_min_qty IS NULL)
      OR (wholesale_price IS NOT NULL AND wholesale_min_qty IS NOT NULL AND wholesale_price > 0 AND wholesale_min_qty BETWEEN 2 AND 100000)
    );
  END IF;
END $$;

GRANT SELECT (wholesale_price, wholesale_min_qty) ON public.products TO authenticated;

-- ============================================================
-- 202 : prix de gros PAR PALIERS (jusqu'à 3), à la place du palier unique de la 201 (2 nov. 2026)
-- ============================================================
-- « Dès 12 : 470 F · dès 24 : 450 F » : la ligne de vente prend le MEILLEUR palier atteint par sa quantité (toute la
-- ligne), et le client paie toujours le moins cher entre ce palier et une promotion. Décision de l'utilisateur du
-- 2 nov. 2026 (« Palier »), avant toute saisie : aucun produit n'a de prix de gros (0 ligne à convertir ; la
-- conversion est quand même faite par sécurité).
--   products.price_tiers jsonb : NULL (pas de prix de gros) ou tableau de 1 à 3 objets { "min_qty": entier, "price": nombre }
--   quantités entières de 2 à 100 000, STRICTEMENT croissantes ; prix > 0, STRICTEMENT décroissants.
--   Le premier prix est inférieur au prix de détail : contrôlé par les routes produits (le détail peut changer dans la
--   même requête), pas ici.
-- Les colonnes de la 201 (wholesale_price, wholesale_min_qty) sont retirées : aucun code en ligne ne les lit (le prix
-- de gros n'a jamais été poussé) et elles sont vides.
-- Lecture : colonne publique du produit (GRANT explicite, droits par colonne depuis la 181) ; la caisse, hors ligne
-- comprise, la reçoit avec le produit. Écriture : routes serveur des produits seulement (Stock en modification).
-- Ventes passées : inchangées (chaque ligne garde son prix et le prix catalogue du moment, original_price).
-- Ré-exécutable. Retour arrière : supabase/rollbacks/202_product_price_tiers_rollback.sql
-- ============================================================

SET LOCAL lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.valid_price_tiers(t jsonb)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = pg_catalog
AS $$
  SELECT t IS NULL OR (
    jsonb_typeof(t) = 'array'
    AND jsonb_array_length(t) BETWEEN 1 AND 3
    -- chaque palier : objet { min_qty entier 2..100000, price > 0 }
    AND NOT EXISTS (
      SELECT 1 FROM jsonb_array_elements(t) e
      WHERE jsonb_typeof(e) <> 'object'
         OR jsonb_typeof(e -> 'min_qty') IS DISTINCT FROM 'number'
         OR jsonb_typeof(e -> 'price') IS DISTINCT FROM 'number'
         OR (e ->> 'min_qty')::numeric <> trunc((e ->> 'min_qty')::numeric)
         OR (e ->> 'min_qty')::numeric < 2 OR (e ->> 'min_qty')::numeric > 100000
         OR (e ->> 'price')::numeric <= 0
    )
    -- d'un palier au suivant : quantité plus grande, prix plus bas
    AND NOT EXISTS (
      SELECT 1
      FROM jsonb_array_elements(t) WITH ORDINALITY a(e, i)
      JOIN jsonb_array_elements(t) WITH ORDINALITY b(e, i) ON b.i = a.i + 1
      WHERE (b.e ->> 'min_qty')::numeric <= (a.e ->> 'min_qty')::numeric
         OR (b.e ->> 'price')::numeric >= (a.e ->> 'price')::numeric
    )
  )
$$;

ALTER TABLE public.products ADD COLUMN IF NOT EXISTS price_tiers jsonb;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'products_price_tiers_check' AND conrelid = 'public.products'::regclass) THEN
    ALTER TABLE public.products ADD CONSTRAINT products_price_tiers_check CHECK (public.valid_price_tiers(price_tiers));
  END IF;
END $$;

-- Conversion du palier unique de la 201 (s'il en existe), puis retrait de ses colonnes
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'products' AND column_name = 'wholesale_price') THEN
    EXECUTE $q$
      UPDATE public.products
         SET price_tiers = jsonb_build_array(jsonb_build_object('min_qty', wholesale_min_qty, 'price', wholesale_price))
       WHERE wholesale_price IS NOT NULL AND wholesale_min_qty IS NOT NULL AND price_tiers IS NULL
    $q$;
    ALTER TABLE public.products DROP CONSTRAINT IF EXISTS products_wholesale_check;
    REVOKE SELECT (wholesale_price, wholesale_min_qty) ON public.products FROM authenticated;
    ALTER TABLE public.products DROP COLUMN IF EXISTS wholesale_min_qty;
    ALTER TABLE public.products DROP COLUMN IF EXISTS wholesale_price;
  END IF;
END $$;

GRANT SELECT (price_tiers) ON public.products TO authenticated;
-- Fonction de contrôle pure (aucune donnée lue) : inutile aux appels directs
REVOKE ALL ON FUNCTION public.valid_price_tiers(jsonb) FROM PUBLIC, anon;

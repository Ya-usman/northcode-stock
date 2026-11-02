-- Retour arrière de la 202 (paliers) : rétablit le palier unique de la 201 avec le PREMIER palier de chaque produit,
-- puis retire la colonne price_tiers, sa contrainte et sa fonction. Les paliers 2 et 3 sont perdus.
SET LOCAL lock_timeout = '5s';
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS wholesale_price numeric(14,2);
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS wholesale_min_qty integer;
UPDATE public.products
   SET wholesale_price = (price_tiers -> 0 ->> 'price')::numeric, wholesale_min_qty = (price_tiers -> 0 ->> 'min_qty')::integer
 WHERE price_tiers IS NOT NULL;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'products_wholesale_check' AND conrelid = 'public.products'::regclass) THEN
    ALTER TABLE public.products ADD CONSTRAINT products_wholesale_check CHECK (
      (wholesale_price IS NULL AND wholesale_min_qty IS NULL)
      OR (wholesale_price IS NOT NULL AND wholesale_min_qty IS NOT NULL AND wholesale_price > 0 AND wholesale_min_qty BETWEEN 2 AND 100000)
    );
  END IF;
END $$;
GRANT SELECT (wholesale_price, wholesale_min_qty) ON public.products TO authenticated;
ALTER TABLE public.products DROP CONSTRAINT IF EXISTS products_price_tiers_check;
REVOKE SELECT (price_tiers) ON public.products FROM authenticated;
ALTER TABLE public.products DROP COLUMN IF EXISTS price_tiers;
DROP FUNCTION IF EXISTS public.valid_price_tiers(jsonb);

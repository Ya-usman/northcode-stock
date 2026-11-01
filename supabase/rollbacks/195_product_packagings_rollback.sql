-- Retour arrière de la 195 : refusé si des conditionnements ou des lignes de bon en conditionnement existent.
SET LOCAL lock_timeout = '5s';
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM public.product_packagings) OR EXISTS (SELECT 1 FROM public.purchase_order_items WHERE pack_qty IS NOT NULL) THEN
    RAISE EXCEPTION 'retour arrière refusé : des conditionnements sont utilisés';
  END IF;
END $$;
ALTER TABLE public.purchase_order_items DROP CONSTRAINT IF EXISTS purchase_order_items_pack_consistent;
ALTER TABLE public.purchase_order_items DROP COLUMN IF EXISTS pack_qty;
ALTER TABLE public.purchase_order_items DROP COLUMN IF EXISTS units_per_pack;
ALTER TABLE public.purchase_order_items DROP COLUMN IF EXISTS pack_unit;
DROP TABLE IF EXISTS public.product_packagings;
NOTIFY pgrst, 'reload schema';

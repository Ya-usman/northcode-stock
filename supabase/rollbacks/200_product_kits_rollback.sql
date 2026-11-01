-- Retour arrière de 200 (kits assemblés). Les compositions sont PERDUES (les exporter avant si besoin) ; le stock des
-- kits et des composants reste tel qu'il est (les assemblages déjà faits ne sont pas défaits). La contrainte de source des
-- lots ne peut revenir à sa liste d'avant que s'il n'existe plus de lot 'assembly' : sinon elle est laissée telle quelle.
SET LOCAL lock_timeout = '5s';
DROP FUNCTION IF EXISTS public.disassemble_kit(uuid, uuid, uuid, int, text);
DROP FUNCTION IF EXISTS public.assemble_kit(uuid, uuid, uuid, int, text);
DROP TABLE IF EXISTS public.product_kit_components;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.product_batches WHERE source = 'assembly') THEN
    ALTER TABLE public.product_batches DROP CONSTRAINT IF EXISTS product_batches_source_check;
    ALTER TABLE public.product_batches ADD CONSTRAINT product_batches_source_check
      CHECK (source = ANY (ARRAY['backfill', 'restock', 'purchase_order', 'adjustment', 'transfer', 'inventory']));
  END IF;
END $$;
REVOKE SELECT (is_kit) ON public.products FROM authenticated;
ALTER TABLE public.products DROP COLUMN IF EXISTS is_kit;

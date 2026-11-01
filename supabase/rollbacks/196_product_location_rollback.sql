-- Retour arrière de 196 (emplacement d'un produit). Les emplacements saisis sont PERDUS : les exporter avant si besoin
--   select id, shop_id, name, location from public.products where location is not null;
SET LOCAL lock_timeout = '5s';
REVOKE SELECT (location) ON public.products FROM authenticated;
ALTER TABLE public.products DROP CONSTRAINT IF EXISTS products_location_check;
ALTER TABLE public.products DROP COLUMN IF EXISTS location;

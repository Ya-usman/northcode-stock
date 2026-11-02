-- Retour arrière de la 201 (prix de gros) : retire la contrainte, le droit de lecture et les deux colonnes.
-- ATTENTION : les prix de gros saisis sont perdus. Les ventes passées ne sont pas touchées (prix enregistrés par ligne).
SET LOCAL lock_timeout = '5s';
ALTER TABLE public.products DROP CONSTRAINT IF EXISTS products_wholesale_check;
REVOKE SELECT (wholesale_price, wholesale_min_qty) ON public.products FROM authenticated;
ALTER TABLE public.products DROP COLUMN IF EXISTS wholesale_min_qty;
ALTER TABLE public.products DROP COLUMN IF EXISTS wholesale_price;

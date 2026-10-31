-- Retour arrière de la migration 191 (nom court et couleur des boutiques).
-- Supprime le déclencheur, la fonction, l'index, les contraintes et les deux colonnes (les noms courts et couleurs
-- choisis sont perdus ; l'application revient à la règle automatique et n'affiche plus de couleur).
SET LOCAL lock_timeout = '5s';
DROP TRIGGER IF EXISTS trg_shops_set_color ON public.shops;
DROP FUNCTION IF EXISTS public.shops_set_color();
DROP INDEX IF EXISTS public.shops_entity_short_name_uq;
ALTER TABLE public.shops DROP CONSTRAINT IF EXISTS shops_short_name_len;
ALTER TABLE public.shops DROP CONSTRAINT IF EXISTS shops_color_palette;
ALTER TABLE public.shops DROP COLUMN IF EXISTS short_name;
ALTER TABLE public.shops DROP COLUMN IF EXISTS color;
NOTIFY pgrst, 'reload schema';

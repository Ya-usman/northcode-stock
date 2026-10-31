-- ============================================================
-- 191 : nom court et couleur de chaque boutique (validé le 31 oct. 2026)
-- ============================================================
-- Pour reconnaître une boutique d'un coup d'œil là où la place manque (barre du haut du téléphone, pastille de
-- contexte, listes en « Toutes les boutiques », transferts) :
--
-- 1. shops.short_name : nom court FACULTATIF choisi par le propriétaire (« Akwa », « Lagos centre »), 1 à 20
--    caractères. Unique dans une entreprise (sans tenir compte des majuscules ni des espaces autour), boutiques
--    supprimées exclues. Vide : l'application garde la règle actuelle (nom de l'entreprise retiré en tête), puis le
--    nom complet.
-- 2. shops.color : couleur de la boutique, parmi 8 teintes (jamais le rouge ni le vert, réservés aux alertes).
--    Boutiques existantes : couleur attribuée dans l'ordre de création, au sein de chaque entreprise.
--    Nouvelle boutique sans couleur : première teinte libre de son entreprise (déclencheur, après le rattachement à
--    l'entreprise par trg_shops_assign_entity) ; toutes prises : on recommence la palette.
--
-- Additive, ré-exécutable. Retour arrière : supabase/rollbacks/191_shop_short_name_color_rollback.sql
-- ============================================================

SET LOCAL lock_timeout = '5s';

ALTER TABLE public.shops ADD COLUMN IF NOT EXISTS short_name text;
ALTER TABLE public.shops ADD COLUMN IF NOT EXISTS color text;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'shops_short_name_len') THEN
    ALTER TABLE public.shops ADD CONSTRAINT shops_short_name_len
      CHECK (short_name IS NULL OR char_length(btrim(short_name)) BETWEEN 1 AND 20);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'shops_color_palette') THEN
    ALTER TABLE public.shops ADD CONSTRAINT shops_color_palette
      CHECK (color IS NULL OR color IN ('blue', 'violet', 'teal', 'pink', 'indigo', 'cyan', 'amber', 'slate'));
  END IF;
END $$;

COMMENT ON COLUMN public.shops.short_name IS 'Nom court affiché là où la place manque (migration 191) ; NULL = règle automatique';
COMMENT ON COLUMN public.shops.color IS 'Couleur de la boutique parmi 8 teintes (migration 191)';

-- Nom court unique dans une entreprise (boutiques non supprimées)
CREATE UNIQUE INDEX IF NOT EXISTS shops_entity_short_name_uq
  ON public.shops (entity_id, lower(btrim(short_name)))
  WHERE short_name IS NOT NULL AND deleted_at IS NULL;

-- Couleur d'une nouvelle boutique : première teinte libre de son entreprise
CREATE OR REPLACE FUNCTION public.shops_set_color()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  palette text[] := ARRAY['blue', 'violet', 'teal', 'pink', 'indigo', 'cyan', 'amber', 'slate'];
  used text[];
  c text;
  n integer;
BEGIN
  IF NEW.color IS NOT NULL THEN RETURN NEW; END IF;
  SELECT coalesce(array_agg(s.color), ARRAY[]::text[]), count(*)
    INTO used, n
    FROM public.shops s
   WHERE s.entity_id IS NOT DISTINCT FROM NEW.entity_id AND NEW.entity_id IS NOT NULL
     AND s.deleted_at IS NULL AND s.id <> NEW.id AND s.color IS NOT NULL;
  FOREACH c IN ARRAY palette LOOP
    IF NOT (c = ANY (used)) THEN NEW.color := c; RETURN NEW; END IF;
  END LOOP;
  NEW.color := palette[(coalesce(n, 0) % array_length(palette, 1)) + 1];
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_shops_set_color ON public.shops;
CREATE TRIGGER trg_shops_set_color
  BEFORE INSERT ON public.shops
  FOR EACH ROW EXECUTE FUNCTION public.shops_set_color();

-- Boutiques existantes : couleur dans l'ordre de création, par entreprise
WITH ranked AS (
  SELECT id, (row_number() OVER (PARTITION BY entity_id ORDER BY created_at, id) - 1) AS rn
    FROM public.shops
   WHERE color IS NULL
)
UPDATE public.shops s
   SET color = (ARRAY['blue', 'violet', 'teal', 'pink', 'indigo', 'cyan', 'amber', 'slate'])[(r.rn % 8) + 1]
  FROM ranked r
 WHERE s.id = r.id;

-- Vérifications
DO $$
DECLARE missing integer;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'shops' AND column_name = 'short_name') THEN
    RAISE EXCEPTION '191 : colonne short_name absente';
  END IF;
  SELECT count(*) INTO missing FROM public.shops WHERE color IS NULL;
  IF missing > 0 THEN RAISE EXCEPTION '191 : % boutique(s) sans couleur', missing; END IF;
END $$;

NOTIFY pgrst, 'reload schema';

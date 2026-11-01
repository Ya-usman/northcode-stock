-- ============================================================
-- 195 : conditionnements d'achat (étape 9 du Stock, 1er nov. 2026)
-- ============================================================
-- Un produit vendu à la pièce s'achète souvent par carton de 24, paquet de 6, sac de 50 kg… Le stock, les ventes,
-- les transferts et les inventaires restent comptés en UNITÉ DE BASE (products.unit) : un conditionnement ne sert
-- qu'à SAISIR une entrée de stock (réapprovisionnement, bon de commande) et à l'écrire au fournisseur.
-- 1. product_packagings : conditionnements d'un produit (unité du colis, nombre d'unités de base par colis, code-barres
--    du colis facultatif, conditionnement par défaut). Un seul par défaut par produit ; code-barres unique par boutique.
-- 2. purchase_order_items : pack_unit, units_per_pack, pack_qty FIGÉS au moment de la commande (le conditionnement
--    peut changer ensuite) ; quantity_ordered reste en unité de base et vaut alors pack_qty × units_per_pack.
-- Serveur seulement (comme les tables d'achat depuis la 173). Additive, ré-exécutable.
-- Retour arrière : supabase/rollbacks/195_product_packagings_rollback.sql
-- ============================================================

SET LOCAL lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS public.product_packagings (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id        uuid        NOT NULL REFERENCES public.shops(id) ON DELETE CASCADE,
  product_id     uuid        NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  unit           text        NOT NULL CHECK (char_length(btrim(unit)) BETWEEN 1 AND 30),   -- carton, pack, bag… (libellé traduit)
  units_per_pack int         NOT NULL CHECK (units_per_pack BETWEEN 2 AND 100000),
  barcode        text        CHECK (barcode IS NULL OR char_length(btrim(barcode)) BETWEEN 4 AND 32),
  is_default     boolean     NOT NULL DEFAULT false,
  created_by     uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT product_packagings_unique UNIQUE (product_id, unit, units_per_pack)
);
CREATE INDEX IF NOT EXISTS idx_product_packagings_product ON public.product_packagings(product_id);
CREATE UNIQUE INDEX IF NOT EXISTS product_packagings_one_default ON public.product_packagings(product_id) WHERE is_default;
CREATE UNIQUE INDEX IF NOT EXISTS product_packagings_barcode ON public.product_packagings(shop_id, barcode) WHERE barcode IS NOT NULL;

ALTER TABLE public.product_packagings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.product_packagings FROM anon, authenticated;

ALTER TABLE public.purchase_order_items ADD COLUMN IF NOT EXISTS pack_unit text;
ALTER TABLE public.purchase_order_items ADD COLUMN IF NOT EXISTS units_per_pack int;
ALTER TABLE public.purchase_order_items ADD COLUMN IF NOT EXISTS pack_qty int;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'purchase_order_items_pack_consistent') THEN
    ALTER TABLE public.purchase_order_items ADD CONSTRAINT purchase_order_items_pack_consistent CHECK (
      (pack_unit IS NULL AND units_per_pack IS NULL AND pack_qty IS NULL)
      -- IS NOT NULL explicites : une comparaison avec NULL donnerait « inconnu », qu'un CHECK accepte
      OR (pack_unit IS NOT NULL AND units_per_pack IS NOT NULL AND pack_qty IS NOT NULL
          AND units_per_pack >= 2 AND pack_qty > 0 AND quantity_ordered = pack_qty * units_per_pack)
    );
  END IF;
END $$;
-- Les nouvelles colonnes restent hors de portée du navigateur (table d'achat, 173)
REVOKE SELECT ON TABLE public.purchase_order_items FROM anon, authenticated;

DO $$
BEGIN
  IF has_table_privilege('authenticated', 'public.product_packagings', 'SELECT')
     OR has_table_privilege('anon', 'public.product_packagings', 'SELECT')
     OR has_table_privilege('authenticated', 'public.purchase_order_items', 'SELECT') THEN
    RAISE EXCEPTION '195 : table lisible depuis le navigateur';
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';

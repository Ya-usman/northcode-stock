-- ============================================================
-- 200 : kits assemblés (étape 16 du Stock, 1er nov. 2026)
-- ============================================================
-- Un KIT (panier cadeau, pack promo, coffret…) est un produit composé d'autres produits de la même boutique, chacun
-- en quantité fixe. On ASSEMBLE N kits : les composants sortent du stock (lots les plus proches de la péremption
-- d'abord, jamais un lot périmé, comme une vente), le kit entre en stock avec un lot au coût des composants. On peut
-- DÉSASSEMBLER (opération inverse). Le kit se vend ensuite comme n'importe quel produit : la caisse et complete_sale
-- ne changent pas (le « kit virtuel » vendu directement depuis les composants n'est PAS fait).
-- 1. products.is_kit (lisible par les connectés) ; product_kit_components (serveur seulement).
-- 2. product_batches.source accepte 'assembly'.
-- 3. assemble_kit / disassemble_kit : une transaction chacune ; stock insuffisant d'un composant = refus, rien écrit.
-- Codes : P0090 quantité invalide, P0091 stock insuffisant (détail JSON), P0092 kit invalide (pas un kit, sans
-- composants, numéro de série), P0093 produit introuvable.
-- Additive, ré-exécutable. Retour arrière : supabase/rollbacks/200_product_kits_rollback.sql
-- ============================================================

SET LOCAL lock_timeout = '5s';

ALTER TABLE public.products ADD COLUMN IF NOT EXISTS is_kit boolean NOT NULL DEFAULT false;
GRANT SELECT (is_kit) ON public.products TO authenticated;

CREATE TABLE IF NOT EXISTS public.product_kit_components (
  id                   uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id              uuid        NOT NULL REFERENCES public.shops(id) ON DELETE CASCADE,
  kit_product_id       uuid        NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  component_product_id uuid        NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  quantity             int         NOT NULL CHECK (quantity BETWEEN 1 AND 10000),
  created_by           uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at           timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT product_kit_components_unique UNIQUE (kit_product_id, component_product_id),
  CONSTRAINT product_kit_components_not_self CHECK (kit_product_id <> component_product_id)
);
CREATE INDEX IF NOT EXISTS idx_kit_components_kit ON public.product_kit_components(kit_product_id);
CREATE INDEX IF NOT EXISTS idx_kit_components_component ON public.product_kit_components(component_product_id);
ALTER TABLE public.product_kit_components ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.product_kit_components FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.product_kit_components TO service_role;

ALTER TABLE public.product_batches DROP CONSTRAINT IF EXISTS product_batches_source_check;
ALTER TABLE public.product_batches ADD CONSTRAINT product_batches_source_check
  CHECK (source = ANY (ARRAY['backfill', 'restock', 'purchase_order', 'adjustment', 'transfer', 'inventory', 'assembly']));

-- Assemblage -------------------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.assemble_kit(p_shop uuid, p_kit uuid, p_user uuid, p_qty int, p_notes text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_kit   record;
  v_c     record;
  v_asof  date;
  v_need  int;
  v_sell  int;
  v_cost  numeric := 0;
  v_unit  numeric;
  v_newp  numeric;
  v_n     int := 0;
BEGIN
  IF p_qty IS NULL OR p_qty < 1 OR p_qty > 10000 THEN RAISE EXCEPTION 'kit_invalid_quantity' USING ERRCODE = 'P0090'; END IF;
  SELECT id, name, quantity, buying_price, is_kit, track_serials INTO v_kit FROM products WHERE id = p_kit AND shop_id = p_shop FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'kit_not_found' USING ERRCODE = 'P0093'; END IF;
  IF NOT v_kit.is_kit OR v_kit.track_serials THEN RAISE EXCEPTION 'kit_invalid' USING ERRCODE = 'P0092', DETAIL = v_kit.name; END IF;
  v_asof := shop_business_date(p_shop);
  -- Composants verrouillés dans un ordre fixe, puis contrôle de TOUT le stock avant la moindre écriture
  PERFORM 1 FROM products WHERE id IN (SELECT component_product_id FROM product_kit_components WHERE kit_product_id = p_kit) ORDER BY id FOR UPDATE;
  FOR v_c IN SELECT k.component_product_id AS id, k.quantity AS per, p.name, p.track_serials, p.shop_id
               FROM product_kit_components k JOIN products p ON p.id = k.component_product_id WHERE k.kit_product_id = p_kit ORDER BY p.id LOOP
    v_n := v_n + 1;
    IF v_c.track_serials OR v_c.shop_id <> p_shop THEN RAISE EXCEPTION 'kit_invalid' USING ERRCODE = 'P0092', DETAIL = v_c.name; END IF;
    v_need := p_qty * v_c.per;
    SELECT sellable INTO v_sell FROM sellable_stock(v_c.id, v_asof);
    IF COALESCE(v_sell, 0) < v_need THEN
      RAISE EXCEPTION 'kit_component_short' USING ERRCODE = 'P0091',
        DETAIL = jsonb_build_object('product', v_c.name, 'needed', v_need, 'available', COALESCE(v_sell, 0))::text;
    END IF;
  END LOOP;
  IF v_n = 0 THEN RAISE EXCEPTION 'kit_invalid' USING ERRCODE = 'P0092', DETAIL = v_kit.name; END IF;

  FOR v_c IN SELECT k.component_product_id AS id, k.quantity AS per, p.name, p.quantity AS prev, p.buying_price
               FROM product_kit_components k JOIN products p ON p.id = k.component_product_id WHERE k.kit_product_id = p_kit ORDER BY p.id LOOP
    v_need := p_qty * v_c.per;
    UPDATE products SET quantity = v_c.prev - v_need, updated_at = now() WHERE id = v_c.id;
    PERFORM allocate_sale_batches(v_c.id, v_need, v_asof);
    v_cost := v_cost + v_need * COALESCE(v_c.buying_price, 0);
    INSERT INTO stock_movements (shop_id, product_id, type, quantity, previous_qty, new_qty, reason, notes, performed_by)
      VALUES (p_shop, v_c.id, 'out', v_need, v_c.prev, v_c.prev - v_need, 'Assemblage ' || v_kit.name, p_notes, p_user);
  END LOOP;

  -- Kit : coût unitaire = composants ; coût moyen du kit selon la règle du réassort (193)
  v_unit := round(v_cost / p_qty, 2);
  v_newp := CASE WHEN COALESCE(v_kit.buying_price, 0) <= 0 OR v_kit.quantity <= 0 THEN v_unit
                 ELSE round((v_kit.quantity * v_kit.buying_price + p_qty * v_unit) / (v_kit.quantity + p_qty), 2) END;
  UPDATE products SET quantity = v_kit.quantity + p_qty, buying_price = v_newp, updated_at = now() WHERE id = p_kit;
  INSERT INTO stock_movements (shop_id, product_id, type, quantity, previous_qty, new_qty, reason, notes, performed_by)
    VALUES (p_shop, p_kit, 'in', p_qty, v_kit.quantity, v_kit.quantity + p_qty, 'Assemblage', p_notes, p_user);
  INSERT INTO product_batches (shop_id, product_id, quantity, initial_quantity, buying_price, source)
    VALUES (p_shop, p_kit, p_qty, p_qty, v_unit, 'assembly');
  RETURN jsonb_build_object('assembled', p_qty, 'previous_qty', v_kit.quantity, 'new_qty', v_kit.quantity + p_qty, 'unit_cost', v_unit);
END $$;

-- Désassemblage ----------------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.disassemble_kit(p_shop uuid, p_kit uuid, p_user uuid, p_qty int, p_notes text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_kit  record;
  v_c    record;
  v_asof date;
  v_sell int;
  v_back int;
  v_n    int := 0;
BEGIN
  IF p_qty IS NULL OR p_qty < 1 OR p_qty > 10000 THEN RAISE EXCEPTION 'kit_invalid_quantity' USING ERRCODE = 'P0090'; END IF;
  SELECT id, name, quantity, is_kit INTO v_kit FROM products WHERE id = p_kit AND shop_id = p_shop FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'kit_not_found' USING ERRCODE = 'P0093'; END IF;
  IF NOT v_kit.is_kit THEN RAISE EXCEPTION 'kit_invalid' USING ERRCODE = 'P0092', DETAIL = v_kit.name; END IF;
  v_asof := shop_business_date(p_shop);
  SELECT sellable INTO v_sell FROM sellable_stock(p_kit, v_asof);
  IF COALESCE(v_sell, 0) < p_qty THEN
    RAISE EXCEPTION 'kit_component_short' USING ERRCODE = 'P0091',
      DETAIL = jsonb_build_object('product', v_kit.name, 'needed', p_qty, 'available', COALESCE(v_sell, 0))::text;
  END IF;
  PERFORM 1 FROM products WHERE id IN (SELECT component_product_id FROM product_kit_components WHERE kit_product_id = p_kit) ORDER BY id FOR UPDATE;

  UPDATE products SET quantity = v_kit.quantity - p_qty, updated_at = now() WHERE id = p_kit;
  PERFORM allocate_sale_batches(p_kit, p_qty, v_asof);
  INSERT INTO stock_movements (shop_id, product_id, type, quantity, previous_qty, new_qty, reason, notes, performed_by)
    VALUES (p_shop, p_kit, 'out', p_qty, v_kit.quantity, v_kit.quantity - p_qty, 'Désassemblage', p_notes, p_user);
  -- Composants rendus selon la composition ACTUELLE du kit, chacun dans un nouveau lot à son coût actuel
  FOR v_c IN SELECT k.component_product_id AS id, k.quantity AS per, p.quantity AS prev, p.buying_price
               FROM product_kit_components k JOIN products p ON p.id = k.component_product_id WHERE k.kit_product_id = p_kit ORDER BY p.id LOOP
    v_n := v_n + 1;
    v_back := p_qty * v_c.per;
    UPDATE products SET quantity = v_c.prev + v_back, updated_at = now() WHERE id = v_c.id;
    INSERT INTO stock_movements (shop_id, product_id, type, quantity, previous_qty, new_qty, reason, notes, performed_by)
      VALUES (p_shop, v_c.id, 'in', v_back, v_c.prev, v_c.prev + v_back, 'Désassemblage ' || v_kit.name, p_notes, p_user);
    INSERT INTO product_batches (shop_id, product_id, quantity, initial_quantity, buying_price, source)
      VALUES (p_shop, v_c.id, v_back, v_back, COALESCE(v_c.buying_price, 0), 'assembly');
  END LOOP;
  IF v_n = 0 THEN RAISE EXCEPTION 'kit_invalid' USING ERRCODE = 'P0092', DETAIL = v_kit.name; END IF;
  RETURN jsonb_build_object('disassembled', p_qty, 'previous_qty', v_kit.quantity, 'new_qty', v_kit.quantity - p_qty);
END $$;

REVOKE ALL ON FUNCTION public.assemble_kit(uuid, uuid, uuid, int, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.assemble_kit(uuid, uuid, uuid, int, text) TO service_role;
REVOKE ALL ON FUNCTION public.disassemble_kit(uuid, uuid, uuid, int, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.disassemble_kit(uuid, uuid, uuid, int, text) TO service_role;

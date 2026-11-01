-- ============================================================
-- 197 : numéros de série, lot A (étape 11 du Stock, 1er nov. 2026)
-- ============================================================
-- Téléphones (IMEI), appareils, électroménager… : chaque unité d'un produit SUIVI porte un numéro unique dans la
-- boutique. Lot A : suivi par produit, registre des numéros, saisie aux ENTRÉES de stock (réassort, réception d'un
-- bon de commande), numérotation du stock déjà présent, correction d'une saisie. La vente avec numéros (complete_sale),
-- le retour en stock à l'annulation / suppression d'une vente et les transferts viennent avec les lots B et C ; le code
-- de l'application n'active le suivi qu'avec le lot B (jamais une unité vendue restée « en stock »).
-- 1. products.track_serials (lisible par les connectés, comme les autres colonnes publiques du produit).
-- 2. product_serials : un numéro = une unité ; statut in_stock | sold | in_transit | removed ; unique par boutique
--    (sans tenir compte de la casse ni des espaces autour) ; réservée au serveur.
-- 3. register_product_serials (interne) : contrôle et enregistre une liste de numéros (doublons, numéro d'un autre
--    produit, longueur) ; un numéro sorti (vendu, retiré) du MÊME produit qui revient est remis en stock.
-- 4. restock_serial_units : réassort d'un produit suivi en UNE transaction (stock, coût moyen, mouvement, lot,
--    numéros) ; autant de numéros que d'unités.
-- 5. add_existing_serials : numéroter le stock déjà présent (jamais plus de numéros en stock que d'unités).
-- 6. correct_product_serial : corriger un numéro mal saisi (en stock seulement).
-- 7. apply_purchase_order_receipt : définition de production (193, drafts/197_prod) + numéros par ligne pour un
--    produit suivi (autant que d'unités reçues, contrôlés dans la même transaction).
-- Codes d'erreur : P0041 nombre de numéros ≠ unités, P0042 numéro déjà pris, P0043 numéro invalide, P0044 numéro en
-- double dans la saisie, P0045 plus de numéros que d'unités en stock, P0046 numéro introuvable / pas en stock,
-- P0047 produit non suivi.
-- Additive, ré-exécutable. Retour arrière : supabase/rollbacks/197_product_serials_rollback.sql
-- ============================================================

SET LOCAL lock_timeout = '5s';

-- 1. Suivi par produit ------------------------------------------------------------------------------------------
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS track_serials boolean NOT NULL DEFAULT false;
GRANT SELECT (track_serials) ON public.products TO authenticated;

-- 2. Registre ---------------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.product_serials (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id      uuid        NOT NULL REFERENCES public.shops(id) ON DELETE CASCADE,
  product_id   uuid        NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  serial       text        NOT NULL CHECK (char_length(btrim(serial)) BETWEEN 1 AND 64 AND serial = btrim(serial)),
  status       text        NOT NULL DEFAULT 'in_stock' CHECK (status IN ('in_stock', 'sold', 'in_transit', 'removed')),
  source       text        NOT NULL DEFAULT 'manual' CHECK (source IN ('restock', 'purchase_order', 'manual', 'transfer', 'return')),
  batch_id     uuid        REFERENCES public.product_batches(id) ON DELETE SET NULL,
  sale_item_id uuid        REFERENCES public.sale_items(id) ON DELETE SET NULL,
  sold_at      timestamptz,
  transfer_id  uuid        REFERENCES public.stock_transfers(id) ON DELETE SET NULL,
  received_at  timestamptz NOT NULL DEFAULT now(),
  removed_reason text      CHECK (removed_reason IS NULL OR char_length(removed_reason) <= 200),
  created_by   uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS product_serials_shop_serial ON public.product_serials(shop_id, upper(serial));
CREATE INDEX IF NOT EXISTS idx_product_serials_product ON public.product_serials(product_id, status);
CREATE INDEX IF NOT EXISTS idx_product_serials_sale_item ON public.product_serials(sale_item_id) WHERE sale_item_id IS NOT NULL;

ALTER TABLE public.product_serials ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.product_serials FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.product_serials TO service_role;

-- 3. Enregistrement commun ----------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.register_product_serials(
  p_shop uuid, p_product uuid, p_batch uuid, p_serials text[], p_source text, p_user uuid
) RETURNS int
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_serial text;
  v_seen   text[] := '{}';
  v_row    record;
  v_count  int := 0;
BEGIN
  FOREACH v_serial IN ARRAY COALESCE(p_serials, '{}'::text[]) LOOP
    v_serial := btrim(v_serial);
    IF v_serial IS NULL OR v_serial = '' OR char_length(v_serial) > 64 THEN
      RAISE EXCEPTION 'serial_invalid' USING ERRCODE = 'P0043', DETAIL = COALESCE(v_serial, '');
    END IF;
    IF upper(v_serial) = ANY (v_seen) THEN
      RAISE EXCEPTION 'serial_duplicate_input' USING ERRCODE = 'P0044', DETAIL = v_serial;
    END IF;
    v_seen := v_seen || upper(v_serial);

    SELECT id, product_id, status INTO v_row FROM product_serials
      WHERE shop_id = p_shop AND upper(serial) = upper(v_serial) FOR UPDATE;
    IF FOUND THEN
      -- Un numéro sorti du MÊME produit (vendu puis repris, retiré par erreur) revient en stock ; sinon : déjà pris
      IF v_row.product_id <> p_product OR v_row.status IN ('in_stock', 'in_transit') THEN
        RAISE EXCEPTION 'serial_taken' USING ERRCODE = 'P0042', DETAIL = v_serial;
      END IF;
      UPDATE product_serials SET status = 'in_stock', source = p_source, batch_id = p_batch, sale_item_id = NULL,
        sold_at = NULL, transfer_id = NULL, removed_reason = NULL, received_at = now(), updated_at = now()
        WHERE id = v_row.id;
    ELSE
      INSERT INTO product_serials (shop_id, product_id, serial, status, source, batch_id, created_by)
        VALUES (p_shop, p_product, v_serial, 'in_stock', p_source, p_batch, p_user);
    END IF;
    v_count := v_count + 1;
  END LOOP;
  RETURN v_count;
END $$;

-- 4. Réassort d'un produit suivi : une seule transaction --------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.restock_serial_units(
  p_shop uuid, p_product uuid, p_user uuid, p_serials text[],
  p_unit_price numeric DEFAULT NULL, p_expiry date DEFAULT NULL, p_supplier uuid DEFAULT NULL,
  p_notes text DEFAULT NULL, p_reason text DEFAULT 'Restock'
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_qty   int; v_price numeric; v_track boolean;
  v_add   int := COALESCE(array_length(p_serials, 1), 0);
  v_new   int; v_new_price numeric; v_batch uuid;
BEGIN
  SELECT quantity, buying_price, track_serials INTO v_qty, v_price, v_track
    FROM products WHERE id = p_product AND shop_id = p_shop FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'product_not_found' USING ERRCODE = 'P0046'; END IF;
  IF NOT v_track THEN RAISE EXCEPTION 'product_not_tracked' USING ERRCODE = 'P0047'; END IF;
  IF v_add <= 0 THEN RAISE EXCEPTION 'serial_count_mismatch' USING ERRCODE = 'P0041'; END IF;

  v_new := v_qty + v_add;
  -- Même règle de coût que le réassort et la réception de bon (193)
  IF p_unit_price IS NOT NULL AND p_unit_price > 0 THEN
    v_new_price := CASE WHEN COALESCE(v_price, 0) <= 0 OR v_qty <= 0 THEN p_unit_price
      ELSE ROUND((v_qty * v_price + v_add * p_unit_price) / v_new, 2) END;
    UPDATE products SET quantity = v_new, buying_price = v_new_price, updated_at = now() WHERE id = p_product;
  ELSE
    v_new_price := v_price;
    UPDATE products SET quantity = v_new, updated_at = now() WHERE id = p_product;
  END IF;

  INSERT INTO stock_movements (shop_id, product_id, type, quantity, previous_qty, new_qty, reason, notes, performed_by)
    VALUES (p_shop, p_product, 'in', v_add, v_qty, v_new, COALESCE(p_reason, 'Restock'), p_notes, p_user);
  INSERT INTO product_batches (shop_id, product_id, supplier_id, quantity, initial_quantity, buying_price, expiry_date, source)
    VALUES (p_shop, p_product, p_supplier, v_add, v_add, COALESCE(NULLIF(p_unit_price, 0), v_price, 0), p_expiry, 'restock')
    RETURNING id INTO v_batch;
  PERFORM register_product_serials(p_shop, p_product, v_batch, p_serials, 'restock', p_user);

  RETURN jsonb_build_object('batch_id', v_batch, 'previous_qty', v_qty, 'new_qty', v_new,
    'price_from', v_price, 'price_to', v_new_price, 'added', v_add);
END $$;

-- 5. Numéroter le stock déjà présent -------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.add_existing_serials(p_shop uuid, p_product uuid, p_user uuid, p_serials text[])
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_qty int; v_track boolean; v_in int; v_added int;
BEGIN
  SELECT quantity, track_serials INTO v_qty, v_track FROM products WHERE id = p_product AND shop_id = p_shop FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'product_not_found' USING ERRCODE = 'P0046'; END IF;
  IF NOT v_track THEN RAISE EXCEPTION 'product_not_tracked' USING ERRCODE = 'P0047'; END IF;
  v_added := register_product_serials(p_shop, p_product, NULL, p_serials, 'manual', p_user);
  SELECT count(*) INTO v_in FROM product_serials WHERE product_id = p_product AND status = 'in_stock';
  IF v_in > GREATEST(v_qty, 0) THEN
    RAISE EXCEPTION 'serial_exceeds_stock' USING ERRCODE = 'P0045', DETAIL = v_in || '/' || v_qty;
  END IF;
  RETURN jsonb_build_object('added', v_added, 'in_stock', v_in, 'quantity', v_qty);
END $$;

-- 6. Corriger un numéro mal saisi (en stock seulement) ------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.correct_product_serial(p_shop uuid, p_serial_id uuid, p_new text, p_user uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_row record; v_new text := btrim(p_new);
BEGIN
  SELECT id, serial, status INTO v_row FROM product_serials WHERE id = p_serial_id AND shop_id = p_shop FOR UPDATE;
  IF NOT FOUND OR v_row.status <> 'in_stock' THEN RAISE EXCEPTION 'serial_not_in_stock' USING ERRCODE = 'P0046'; END IF;
  IF v_new IS NULL OR v_new = '' OR char_length(v_new) > 64 THEN RAISE EXCEPTION 'serial_invalid' USING ERRCODE = 'P0043', DETAIL = COALESCE(v_new, ''); END IF;
  IF EXISTS (SELECT 1 FROM product_serials WHERE shop_id = p_shop AND upper(serial) = upper(v_new) AND id <> p_serial_id) THEN
    RAISE EXCEPTION 'serial_taken' USING ERRCODE = 'P0042', DETAIL = v_new;
  END IF;
  UPDATE product_serials SET serial = v_new, updated_at = now() WHERE id = p_serial_id;
  RETURN jsonb_build_object('from', v_row.serial, 'to', v_new);
END $$;

-- 7. Réception d'un bon de commande : production (193) + numéros pour un produit suivi ------------------------------------
CREATE OR REPLACE FUNCTION public.apply_purchase_order_receipt(p_shop_id uuid, p_po_id uuid, p_performed_by uuid, p_items jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_po_status      TEXT;
  v_reference      TEXT;
  v_po_supplier_id UUID;
  v_item           JSONB;
  v_item_id        UUID;
  v_product_id     UUID;
  v_received       INT;
  v_unit_price     NUMERIC;
  v_expiry_date    DATE;
  v_receipt_note   TEXT;
  v_ordered_qty    INT;
  v_previous_qty   INT;
  v_previous_price NUMERIC;
  v_new_price      NUMERIC;
  v_product_name   TEXT;
  v_new_qty        INT;
  v_any_shortfall  BOOLEAN := false;
  v_po_total       NUMERIC := 0;
  v_details        JSONB := '[]'::JSONB;
  -- 197 : numéros de série
  v_track          BOOLEAN;
  v_batch_id       UUID;
  v_serials        TEXT[];
BEGIN
  SELECT status, reference, supplier_id INTO v_po_status, v_reference, v_po_supplier_id
    FROM purchase_orders
    WHERE id = p_po_id AND shop_id = p_shop_id
    FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Bon de commande introuvable';
  END IF;
  IF v_po_status NOT IN ('draft', 'sent') THEN
    RAISE EXCEPTION 'Ce bon de commande a déjà été reçu ou annulé';
  END IF;

  FOR v_item IN SELECT * FROM JSONB_ARRAY_ELEMENTS(p_items) LOOP
    v_item_id     := NULLIF(v_item->>'item_id', '')::UUID;
    v_product_id  := NULLIF(v_item->>'product_id', '')::UUID;
    v_received    := NULLIF(v_item->>'quantity_received', '')::INT;
    v_unit_price  := NULLIF(v_item->>'unit_price', '')::NUMERIC;
    v_expiry_date := NULLIF(v_item->>'expiry_date', '')::DATE;
    v_receipt_note := NULLIF(v_item->>'receipt_note', '');

    CONTINUE WHEN v_item_id IS NULL;
    v_received := COALESCE(v_received, 0);

    UPDATE purchase_order_items SET quantity_received = v_received, receipt_note = v_receipt_note
      WHERE id = v_item_id AND purchase_order_id = p_po_id
      RETURNING quantity_ordered INTO v_ordered_qty;

    IF v_ordered_qty IS NOT NULL AND v_received < v_ordered_qty THEN
      v_any_shortfall := true;
    END IF;

    CONTINUE WHEN v_product_id IS NULL OR v_received <= 0;

    SELECT quantity, buying_price, name, track_serials INTO v_previous_qty, v_previous_price, v_product_name, v_track
      FROM products
      WHERE id = v_product_id AND shop_id = p_shop_id
      FOR UPDATE;

    CONTINUE WHEN NOT FOUND;

    -- 197 : produit suivi = autant de numéros que d'unités reçues (sinon toute la réception est refusée)
    IF v_track THEN
      SELECT COALESCE(array_agg(x), '{}') INTO v_serials FROM jsonb_array_elements_text(COALESCE(v_item->'serials', '[]'::jsonb)) AS x;
      IF COALESCE(array_length(v_serials, 1), 0) <> v_received THEN
        RAISE EXCEPTION 'serial_count_mismatch' USING ERRCODE = 'P0041', DETAIL = v_product_name;
      END IF;
    END IF;

    v_po_total := v_po_total + COALESCE(v_unit_price, v_previous_price, 0) * v_received;

    v_new_qty := v_previous_qty + v_received;

    IF v_unit_price IS NOT NULL AND v_unit_price > 0 THEN
      -- 193 : un coût inconnu (0 ou NULL) ou un stock précédent nul / négatif ne dilue plus la moyenne :
      -- le prix reçu devient le coût. Sinon : moyenne pondérée, comme avant.
      v_new_price := CASE
        WHEN COALESCE(v_previous_price, 0) <= 0 OR v_previous_qty <= 0 THEN v_unit_price
        ELSE ROUND((v_previous_qty * v_previous_price + v_received * v_unit_price) / v_new_qty, 2)
      END;
      UPDATE products SET quantity = v_new_qty, buying_price = v_new_price, updated_at = now()
        WHERE id = v_product_id;
    ELSE
      v_new_price := v_previous_price;
      UPDATE products SET quantity = v_new_qty, updated_at = now()
        WHERE id = v_product_id;
    END IF;

    INSERT INTO stock_movements(
      shop_id, product_id, type, quantity, previous_qty, new_qty, reason, performed_by
    ) VALUES (
      p_shop_id, v_product_id, 'in', v_received,
      v_previous_qty, v_new_qty, 'Réception ' || v_reference, p_performed_by
    );

    INSERT INTO product_batches (
      shop_id, product_id, supplier_id, quantity, initial_quantity,
      buying_price, expiry_date, source, received_at
    ) VALUES (
      p_shop_id, v_product_id, v_po_supplier_id, v_received, v_received,
      COALESCE(v_unit_price, v_previous_price, 0), v_expiry_date, 'purchase_order', now()
    ) RETURNING id INTO v_batch_id;

    IF v_track THEN
      PERFORM register_product_serials(p_shop_id, v_product_id, v_batch_id, v_serials, 'purchase_order', p_performed_by);
    END IF;

    v_details := v_details || JSONB_BUILD_OBJECT(
      'product_id',   v_product_id,
      'product_name', v_product_name,
      'previous_qty', v_previous_qty,
      'new_qty',      v_new_qty,
      'price_from',   v_previous_price,
      'price_to',     COALESCE(v_new_price, v_previous_price)
    );
  END LOOP;

  UPDATE purchase_orders SET
    status = CASE WHEN v_any_shortfall THEN 'partial' ELSE 'received' END,
    total_amount = v_po_total,
    payment_status = CASE WHEN v_po_total <= 0 THEN 'paid' ELSE 'unpaid' END,
    received_at = now(),
    received_by = p_performed_by,
    updated_at = now()
    WHERE id = p_po_id;

  IF v_po_total > 0 AND v_po_supplier_id IS NOT NULL THEN
    UPDATE suppliers SET total_owed = total_owed + v_po_total WHERE id = v_po_supplier_id;
  END IF;

  RETURN JSONB_BUILD_OBJECT('items', v_details);
END;
$function$;

-- Fonctions réservées au serveur
REVOKE ALL ON FUNCTION public.apply_purchase_order_receipt(UUID, UUID, UUID, JSONB) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_purchase_order_receipt(UUID, UUID, UUID, JSONB) TO service_role;
REVOKE ALL ON FUNCTION public.register_product_serials(uuid, uuid, uuid, text[], text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.register_product_serials(uuid, uuid, uuid, text[], text, uuid) TO service_role;
REVOKE ALL ON FUNCTION public.restock_serial_units(uuid, uuid, uuid, text[], numeric, date, uuid, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.restock_serial_units(uuid, uuid, uuid, text[], numeric, date, uuid, text, text) TO service_role;
REVOKE ALL ON FUNCTION public.add_existing_serials(uuid, uuid, uuid, text[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.add_existing_serials(uuid, uuid, uuid, text[]) TO service_role;
REVOKE ALL ON FUNCTION public.correct_product_serial(uuid, uuid, text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.correct_product_serial(uuid, uuid, text, uuid) TO service_role;

-- Retour arrière de 197 (numéros de série, lot A). Les numéros enregistrés sont PERDUS : les exporter avant si besoin
--   select s.serial, s.status, p.name, s.shop_id from public.product_serials s join public.products p on p.id = s.product_id;
-- apply_purchase_order_receipt reprend sa définition de production d'avant la 197 (193, drafts/197_prod).
SET LOCAL lock_timeout = '5s';

DROP FUNCTION IF EXISTS public.correct_product_serial(uuid, uuid, text, uuid);
DROP FUNCTION IF EXISTS public.add_existing_serials(uuid, uuid, uuid, text[]);
DROP FUNCTION IF EXISTS public.restock_serial_units(uuid, uuid, uuid, text[], numeric, date, uuid, text, text);

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

    SELECT quantity, buying_price, name INTO v_previous_qty, v_previous_price, v_product_name
      FROM products
      WHERE id = v_product_id AND shop_id = p_shop_id
      FOR UPDATE;

    CONTINUE WHEN NOT FOUND;

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
    );

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
REVOKE ALL ON FUNCTION public.apply_purchase_order_receipt(UUID, UUID, UUID, JSONB) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_purchase_order_receipt(UUID, UUID, UUID, JSONB) TO service_role;

DROP FUNCTION IF EXISTS public.register_product_serials(uuid, uuid, uuid, text[], text, uuid);
DROP TABLE IF EXISTS public.product_serials;
REVOKE SELECT (track_serials) ON public.products FROM authenticated;
ALTER TABLE public.products DROP COLUMN IF EXISTS track_serials;

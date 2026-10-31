-- ============================================================
-- 193 : valorisation du stock (étape 7 du Stock, 31 oct. 2026)
-- ============================================================
-- 1. Stock « avant / après » des mouvements écrits par la caisse. Les trois seules fonctions qui écrivent des
--    mouvements sans ces deux colonnes sont celles des ventes : deduct_stock_on_sale (vente), cancel_sale
--    (annulation), edit_sale (modification). Toutes mettent d'abord à jour products.quantity, PUIS écrivent le
--    mouvement, dans la même transaction (ligne du produit verrouillée). Un déclencheur AVANT insertion lit donc le
--    stock déjà mis à jour (= après) et en déduit l'avant, sans toucher aux fonctions de vente :
--      vente (type 'sale')  : avant = après + quantité ;   entrée (type 'in') : avant = après − quantité.
--    Seulement quand les DEUX colonnes arrivent vides : un mouvement qui les renseigne (réceptions, inventaires,
--    transferts…) n'est jamais modifié ; 'transit_loss' et les autres types restent tels quels. L'historique
--    n'est pas reconstruit (seuls les nouveaux mouvements sont complétés).
-- 2. Coût moyen à la réception d'un bon de commande (apply_purchase_order_receipt, texte de PRODUCTION identique à
--    la 097) : un coût précédent inconnu (0) ou un stock précédent nul / négatif ne dilue plus la moyenne ; seul ce
--    calcul change.
--
-- Additive, ré-exécutable. Retour arrière : supabase/rollbacks/193_stock_valuation_rollback.sql
-- ============================================================

SET LOCAL lock_timeout = '5s';

-- ── 1. Stock avant / après ──────────────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fill_stock_movement_balances()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
DECLARE
  v_qty integer;
BEGIN
  IF NEW.previous_qty IS NOT NULL OR NEW.new_qty IS NOT NULL OR NEW.product_id IS NULL OR NEW.type NOT IN ('sale', 'in') THEN
    RETURN NEW;
  END IF;
  SELECT quantity INTO v_qty FROM products WHERE id = NEW.product_id;
  IF NOT FOUND THEN
    RETURN NEW;
  END IF;
  NEW.new_qty := v_qty;
  NEW.previous_qty := CASE WHEN NEW.type = 'sale' THEN v_qty + NEW.quantity ELSE v_qty - NEW.quantity END;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.fill_stock_movement_balances() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_stock_movements_fill_balances ON public.stock_movements;
CREATE TRIGGER trg_stock_movements_fill_balances
  BEFORE INSERT ON public.stock_movements
  FOR EACH ROW EXECUTE FUNCTION public.fill_stock_movement_balances();

-- ── 2. Coût moyen à la réception d'un bon de commande ───────────────────────────────────────────────────────────
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

-- ── Contrôle : sans ces objets, la migration est annulée ────────────────────────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_stock_movements_fill_balances' AND tgrelid = 'public.stock_movements'::regclass) THEN
    RAISE EXCEPTION '193 : déclencheur absent';
  END IF;
  IF position('v_previous_qty <= 0 THEN v_unit_price' IN pg_get_functiondef('public.apply_purchase_order_receipt(uuid,uuid,uuid,jsonb)'::regprocedure)) = 0 THEN
    RAISE EXCEPTION '193 : nouveau calcul du coût moyen absent';
  END IF;
  IF has_function_privilege('anon', 'public.apply_purchase_order_receipt(uuid,uuid,uuid,jsonb)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.apply_purchase_order_receipt(uuid,uuid,uuid,jsonb)', 'EXECUTE') THEN
    RAISE EXCEPTION '193 : réception de bon exécutable depuis le navigateur';
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';

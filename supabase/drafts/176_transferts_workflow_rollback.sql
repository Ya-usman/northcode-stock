-- Retour arrière de la migration « Transferts : traçabilité lot par lot ».
-- (Ce dossier n'est pas un dossier de migrations : rien ici n'est appliqué automatiquement.)
--
-- RETOUR ARRIÈRE IMMÉDIAT, sans perte, TANT QU'AUCUN TRANSFERT N'A ÉTÉ ENVOYÉ OU RÉCEPTIONNÉ AVEC LE
-- NOUVEAU MODÈLE. Ensuite, l'ancien modèle ne sait plus représenter des lots décomptés à l'envoi, une
-- réception partielle ou une perte réglée : le script s'arrête de lui-même (aucune modification) et dit
-- pourquoi. Dans ce cas on corrige en avant plutôt que de revenir en arrière.
-- Un brouillon (qui ne touche à aucun stock) est simplement passé en « annulé ».

begin;

do $$
begin
  if exists (select 1 from public.stock_transfer_allocations where coverage <> 'legacy') then
    raise exception 'Retour arrière refusé : des transferts ont été envoyés avec le nouveau modèle (lots décomptés). Aucune modification faite.';
  end if;
  if exists (select 1 from public.stock_transfer_receipts r join public.stock_transfer_allocations a on a.transfer_id = r.transfer_id
              where a.coverage = 'legacy' and r.received_at > (select min(created_at) from public.stock_transfer_allocations)) then
    raise exception 'Retour arrière refusé : un ancien transfert a été réceptionné avec le nouveau modèle. Aucune modification faite.';
  end if;
  if exists (select 1 from public.stock_transfer_settlements where reason <> 'cancelled')
     or exists (select 1 from public.stock_transfers where status = 'partially_received')
     or exists (select 1 from public.stock_movements where type = 'transit_loss') then
    raise exception 'Retour arrière refusé : réception partielle ou écart réglé avec le nouveau modèle. Aucune modification faite.';
  end if;
end $$;

-- Brouillons : aucun stock n'en dépend
update public.stock_transfers set status = 'cancelled', cancelled_at = coalesce(cancelled_at, now()) where status = 'draft';

-- Nouvelles fonctions
drop function if exists public.receive_stock_transfer_lines(uuid, uuid, uuid, uuid, jsonb, text);
drop function if exists public.settle_stock_transfer_item(uuid, uuid, uuid, uuid, text, text, uuid);
drop function if exists public.send_stock_transfer_draft(uuid, uuid, uuid);
drop function if exists public.update_stock_transfer_draft(uuid, uuid, uuid, uuid, text, jsonb, timestamptz);
drop function if exists public.create_stock_transfer(uuid, uuid, uuid, text, jsonb, boolean);
drop function if exists public._transfer_refresh_status(uuid, uuid);
drop function if exists public._transfer_settle_item(uuid, text, text, uuid, uuid);
drop function if exists public._transfer_replace_items(uuid, uuid, jsonb);
drop function if exists public._transfer_check_shops(uuid, uuid);

-- Anciennes fonctions, telles qu'elles étaient (migrations 104 et 102)
CREATE OR REPLACE FUNCTION send_stock_transfer(
  p_source_shop_id       UUID,
  p_destination_shop_id  UUID,
  p_performed_by         UUID,
  p_notes                TEXT,
  p_items                JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_dest_name      TEXT;
  v_year           TEXT := to_char(now(), 'YYYY');
  v_seq            INT;
  v_reference      TEXT;
  v_transfer_id    UUID;
  v_item           JSONB;
  v_product_id     UUID;
  v_quantity       INT;
  v_previous_qty   INT;
  v_buying_price   NUMERIC;
  v_selling_price  NUMERIC;
  v_product_name   TEXT;
  v_product_unit   TEXT;
  v_new_qty        INT;
BEGIN
  IF p_source_shop_id = p_destination_shop_id THEN
    RAISE EXCEPTION 'La boutique destination doit être différente de la boutique source';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM shop_members
    WHERE shop_id = p_source_shop_id AND user_id = p_performed_by AND role = 'owner' AND is_active = true
  ) OR NOT EXISTS (
    SELECT 1 FROM shop_members
    WHERE shop_id = p_destination_shop_id AND user_id = p_performed_by AND role = 'owner' AND is_active = true
  ) THEN
    RAISE EXCEPTION 'Vous devez être propriétaire actif des deux boutiques pour créer un transfert';
  END IF;

  SELECT name INTO v_dest_name FROM shops WHERE id = p_destination_shop_id;

  SELECT COUNT(*) + 1 INTO v_seq
    FROM stock_transfers
    WHERE source_shop_id = p_source_shop_id
      AND created_at >= (v_year || '-01-01')::timestamptz;
  v_reference := 'TR-' || v_year || '-' || LPAD(v_seq::text, 4, '0');

  INSERT INTO stock_transfers (
    reference, source_shop_id, destination_shop_id, status, notes, created_by
  ) VALUES (
    v_reference, p_source_shop_id, p_destination_shop_id, 'sent', p_notes, p_performed_by
  ) RETURNING id INTO v_transfer_id;

  FOR v_item IN SELECT * FROM JSONB_ARRAY_ELEMENTS(p_items) LOOP
    v_product_id := NULLIF(v_item->>'product_id', '')::UUID;
    v_quantity   := NULLIF(v_item->>'quantity', '')::INT;
    CONTINUE WHEN v_product_id IS NULL OR v_quantity IS NULL OR v_quantity <= 0;

    SELECT quantity, buying_price, selling_price, name, unit
      INTO v_previous_qty, v_buying_price, v_selling_price, v_product_name, v_product_unit
      FROM products
      WHERE id = v_product_id AND shop_id = p_source_shop_id
      FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Produit introuvable dans la boutique source';
    END IF;
    IF v_previous_qty < v_quantity THEN
      RAISE EXCEPTION 'Stock insuffisant pour %  (disponible : %, demandé : %)', v_product_name, v_previous_qty, v_quantity;
    END IF;

    v_new_qty := v_previous_qty - v_quantity;
    UPDATE products SET quantity = v_new_qty, updated_at = now() WHERE id = v_product_id;

    INSERT INTO stock_movements (shop_id, product_id, type, quantity, previous_qty, new_qty, reason, performed_by)
      VALUES (p_source_shop_id, v_product_id, 'out', v_quantity, v_previous_qty, v_new_qty,
              'Transfert ' || v_reference || ' vers ' || v_dest_name, p_performed_by);

    INSERT INTO stock_transfer_items (
      stock_transfer_id, source_product_id, product_name, unit,
      buying_price, selling_price, quantity_sent
    ) VALUES (
      v_transfer_id, v_product_id, v_product_name, v_product_unit,
      v_buying_price, v_selling_price, v_quantity
    );
  END LOOP;

  RETURN JSONB_BUILD_OBJECT('id', v_transfer_id, 'reference', v_reference);
END;
$$;

CREATE OR REPLACE FUNCTION receive_stock_transfer(
  p_transfer_id          UUID,
  p_destination_shop_id  UUID,
  p_performed_by         UUID,
  p_items                JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_status         TEXT;
  v_dest_shop_id   UUID;
  v_source_shop_id UUID;
  v_reference      TEXT;
  v_source_name    TEXT;
  v_item           JSONB;
  v_item_id        UUID;
  v_dest_product_id UUID;
  v_received       INT;
  v_category       TEXT;
  v_detail         TEXT;
  v_snapshot_name  TEXT;
  v_snapshot_unit  TEXT;
  v_snapshot_buy   NUMERIC;
  v_snapshot_sell  NUMERIC;
  v_previous_qty   INT;
  v_new_qty        INT;
BEGIN
  SELECT status, destination_shop_id, source_shop_id, reference
    INTO v_status, v_dest_shop_id, v_source_shop_id, v_reference
    FROM stock_transfers WHERE id = p_transfer_id FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Transfert introuvable';
  END IF;
  IF v_dest_shop_id IS DISTINCT FROM p_destination_shop_id THEN
    RAISE EXCEPTION 'Ce transfert ne concerne pas cette boutique';
  END IF;
  IF v_status <> 'sent' THEN
    RAISE EXCEPTION 'Ce transfert a déjà été réceptionné ou annulé';
  END IF;

  SELECT name INTO v_source_name FROM shops WHERE id = v_source_shop_id;

  FOR v_item IN SELECT * FROM JSONB_ARRAY_ELEMENTS(p_items) LOOP
    v_item_id         := NULLIF(v_item->>'transfer_item_id', '')::UUID;
    v_dest_product_id := NULLIF(v_item->>'destination_product_id', '')::UUID;
    v_received        := NULLIF(v_item->>'quantity_received', '')::INT;
    v_category        := NULLIF(v_item->>'discrepancy_category', '');
    v_detail          := NULLIF(v_item->>'discrepancy_detail', '');
    CONTINUE WHEN v_item_id IS NULL;
    v_received := COALESCE(v_received, 0);

    SELECT product_name, unit, buying_price, selling_price
      INTO v_snapshot_name, v_snapshot_unit, v_snapshot_buy, v_snapshot_sell
      FROM stock_transfer_items
      WHERE id = v_item_id AND stock_transfer_id = p_transfer_id;
    CONTINUE WHEN NOT FOUND;

    IF v_received > 0 THEN
      IF v_dest_product_id IS NOT NULL THEN
        SELECT quantity INTO v_previous_qty FROM products
          WHERE id = v_dest_product_id AND shop_id = p_destination_shop_id FOR UPDATE;
        IF NOT FOUND THEN
          RAISE EXCEPTION 'Produit destination introuvable dans cette boutique';
        END IF;
      ELSE
        INSERT INTO products (shop_id, name, unit, buying_price, selling_price, quantity, is_active)
          VALUES (p_destination_shop_id, v_snapshot_name, v_snapshot_unit,
                  COALESCE(v_snapshot_buy, 0), COALESCE(v_snapshot_sell, v_snapshot_buy, 0), 0, true)
          RETURNING id, quantity INTO v_dest_product_id, v_previous_qty;
      END IF;

      v_new_qty := v_previous_qty + v_received;
      UPDATE products SET quantity = v_new_qty, updated_at = now() WHERE id = v_dest_product_id;

      INSERT INTO stock_movements (shop_id, product_id, type, quantity, previous_qty, new_qty, reason, performed_by)
        VALUES (p_destination_shop_id, v_dest_product_id, 'in', v_received, v_previous_qty, v_new_qty,
                'Transfert ' || v_reference || ' depuis ' || v_source_name, p_performed_by);

      INSERT INTO product_batches (shop_id, product_id, quantity, initial_quantity, buying_price, source, received_at)
        VALUES (p_destination_shop_id, v_dest_product_id, v_received, v_received,
                COALESCE(v_snapshot_buy, 0), 'transfer', now());
    END IF;

    UPDATE stock_transfer_items SET
      quantity_received = v_received,
      destination_product_id = v_dest_product_id,
      discrepancy_category = CASE WHEN v_received <> quantity_sent THEN v_category ELSE NULL END,
      discrepancy_detail = CASE WHEN v_received <> quantity_sent THEN v_detail ELSE NULL END
      WHERE id = v_item_id;
  END LOOP;

  UPDATE stock_transfers SET
    status = 'received', received_at = now(), received_by = p_performed_by
    WHERE id = p_transfer_id;

  RETURN JSONB_BUILD_OBJECT('id', p_transfer_id);
END;
$$;

CREATE OR REPLACE FUNCTION cancel_stock_transfer(
  p_transfer_id     UUID,
  p_source_shop_id  UUID,
  p_performed_by    UUID
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_status  TEXT;
  v_src     UUID;
  v_reference TEXT;
  v_item    RECORD;
  v_previous_qty INT;
  v_new_qty INT;
BEGIN
  SELECT status, source_shop_id, reference INTO v_status, v_src, v_reference
    FROM stock_transfers WHERE id = p_transfer_id FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Transfert introuvable';
  END IF;
  IF v_src IS DISTINCT FROM p_source_shop_id THEN
    RAISE EXCEPTION 'Ce transfert ne concerne pas cette boutique';
  END IF;
  IF v_status <> 'sent' THEN
    RAISE EXCEPTION 'Seul un transfert envoyé et pas encore reçu peut être annulé';
  END IF;

  FOR v_item IN
    SELECT source_product_id, quantity_sent FROM stock_transfer_items
    WHERE stock_transfer_id = p_transfer_id AND source_product_id IS NOT NULL
  LOOP
    SELECT quantity INTO v_previous_qty FROM products
      WHERE id = v_item.source_product_id AND shop_id = p_source_shop_id FOR UPDATE;
    CONTINUE WHEN NOT FOUND;

    v_new_qty := v_previous_qty + v_item.quantity_sent;
    UPDATE products SET quantity = v_new_qty, updated_at = now() WHERE id = v_item.source_product_id;

    INSERT INTO stock_movements (shop_id, product_id, type, quantity, previous_qty, new_qty, reason, performed_by)
      VALUES (p_source_shop_id, v_item.source_product_id, 'in', v_item.quantity_sent, v_previous_qty, v_new_qty,
              'Annulation transfert ' || v_reference, p_performed_by);
  END LOOP;

  UPDATE stock_transfers SET
    status = 'cancelled', cancelled_at = now(), cancelled_by = p_performed_by
    WHERE id = p_transfer_id;
END;
$$;

revoke all on function public.send_stock_transfer(uuid, uuid, uuid, text, jsonb) from public, anon, authenticated;
revoke all on function public.receive_stock_transfer(uuid, uuid, uuid, jsonb) from public, anon, authenticated;
revoke all on function public.cancel_stock_transfer(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.send_stock_transfer(uuid, uuid, uuid, text, jsonb) to service_role;
grant execute on function public.receive_stock_transfer(uuid, uuid, uuid, jsonb) to service_role;
grant execute on function public.cancel_stock_transfer(uuid, uuid, uuid) to service_role;

-- Tables et colonnes ajoutées
drop table if exists public.stock_transfer_settlements;
drop table if exists public.stock_transfer_receipt_lines;
drop table if exists public.stock_transfer_receipts;
drop table if exists public.stock_transfer_allocations;

alter table public.stock_movements drop constraint if exists stock_movements_type_check;
alter table public.stock_movements add constraint stock_movements_type_check check (type in ('in', 'out', 'adjustment', 'sale'));
alter table public.stock_movements drop column if exists batch_id, drop column if exists transfer_id;
alter table public.product_batches drop column if exists origin_batch_id, drop column if exists origin_transfer_id;
alter table public.stock_transfer_items drop column if exists surplus_status, drop column if exists quantity_surplus;

drop index if exists public.stock_transfers_open_destination;
drop index if exists public.stock_transfers_source_reference;
alter table public.stock_transfers drop column if exists updated_at, drop column if exists has_discrepancy,
  drop column if exists sent_by, drop column if exists sent_at;
alter table public.stock_transfers drop constraint if exists stock_transfers_status_check;
alter table public.stock_transfers add constraint stock_transfers_status_check check (status in ('sent', 'received', 'cancelled'));

commit;

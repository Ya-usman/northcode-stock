-- ============================================================
-- 102 — TRANSFERTS DE STOCK ENTRE BOUTIQUES (bons de sortie)
--
-- Flux volontairement simple : créer = envoyer immédiatement (le stock
-- source diminue tout de suite, pas d'état "brouillon"), pas de recalcul de
-- coût moyen pondéré (c'est le même stock qui se déplace, pas un achat).
-- La boutique destination retrouve le transfert par référence, valide les
-- quantités reçues (peuvent différer de ce qui a été envoyé) et fait
-- correspondre chaque produit à son propre catalogue (chaque boutique a ses
-- propres lignes `products`, même pour un article physiquement identique).
-- ============================================================

-- product_batches.source (migration 086) n'autorisait pas 'transfer' —
-- receive_stock_transfer en a besoin pour enregistrer le lot reçu. Même
-- pattern que la migration 092 (recherche dynamique du nom de contrainte
-- inline auto-généré, plutôt que de deviner son nom).
DO $$
DECLARE
  con_name text;
BEGIN
  SELECT conname INTO con_name
  FROM pg_constraint
  WHERE conrelid = 'product_batches'::regclass
    AND contype = 'c'
    AND pg_get_constraintdef(oid) LIKE '%source%backfill%restock%purchase_order%adjustment%';
  IF con_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE product_batches DROP CONSTRAINT %I', con_name);
  END IF;
END $$;

ALTER TABLE product_batches ADD CONSTRAINT product_batches_source_check
  CHECK (source IN ('backfill', 'restock', 'purchase_order', 'adjustment', 'transfer'));

CREATE TABLE IF NOT EXISTS stock_transfers (
  id                    uuid primary key default gen_random_uuid(),
  reference             text not null,
  source_shop_id        uuid references shops(id) on delete cascade,
  destination_shop_id   uuid references shops(id) on delete cascade,
  status                text not null default 'sent' check (status in ('sent', 'received', 'cancelled')),
  notes                 text,
  created_by            uuid references auth.users on delete set null,
  created_at            timestamptz default now(),
  received_at           timestamptz,
  received_by           uuid references auth.users on delete set null,
  cancelled_at          timestamptz,
  cancelled_by          uuid references auth.users on delete set null
);

CREATE TABLE IF NOT EXISTS stock_transfer_items (
  id                      uuid primary key default gen_random_uuid(),
  stock_transfer_id       uuid references stock_transfers(id) on delete cascade,
  source_product_id       uuid references products(id) on delete set null,
  -- Snapshot : la réception ne doit jamais dépendre de l'état courant du
  -- produit source (renommé/archivé entre l'envoi et la réception).
  product_name            text not null,
  unit                    text,
  buying_price            numeric,
  selling_price           numeric,
  quantity_sent           int not null check (quantity_sent > 0),
  quantity_received       int,
  destination_product_id  uuid references products(id) on delete set null,
  discrepancy_category    text check (discrepancy_category in ('transport_loss', 'theft', 'breakage', 'count_error', 'other')),
  discrepancy_detail      text,
  created_at              timestamptz default now()
);

CREATE INDEX IF NOT EXISTS idx_stock_transfers_source ON stock_transfers(source_shop_id);
CREATE INDEX IF NOT EXISTS idx_stock_transfers_destination ON stock_transfers(destination_shop_id);
CREATE INDEX IF NOT EXISTS idx_stock_transfers_reference ON stock_transfers(reference);
CREATE INDEX IF NOT EXISTS idx_stock_transfer_items_transfer ON stock_transfer_items(stock_transfer_id);

ALTER TABLE stock_transfers ENABLE ROW LEVEL SECURITY;
ALTER TABLE stock_transfer_items ENABLE ROW LEVEL SECURITY;

-- Lecture : boutique source OU destination. Aucune policy INSERT/UPDATE —
-- les écritures passent exclusivement par les fonctions SECURITY DEFINER
-- ci-dessous, appelées via service_role depuis les routes API (mêmes
-- vérifications de rôle qu'ailleurs, faites côté serveur avant l'appel RPC).
CREATE POLICY stock_transfers_select ON stock_transfers
  FOR SELECT USING (is_shop_member(source_shop_id) OR is_shop_member(destination_shop_id));

CREATE POLICY stock_transfer_items_select ON stock_transfer_items
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM stock_transfers st
      WHERE st.id = stock_transfer_items.stock_transfer_id
        AND (is_shop_member(st.source_shop_id) OR is_shop_member(st.destination_shop_id))
    )
  );

-- ============================================================
-- send_stock_transfer — création + envoi atomique
-- ============================================================
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
  v_source_owner   UUID;
  v_dest_owner     UUID;
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

  SELECT owner_id INTO v_source_owner FROM shops WHERE id = p_source_shop_id;
  SELECT owner_id, name INTO v_dest_owner, v_dest_name FROM shops WHERE id = p_destination_shop_id;
  IF v_source_owner IS NULL OR v_dest_owner IS NULL OR v_source_owner IS DISTINCT FROM v_dest_owner THEN
    RAISE EXCEPTION 'Les deux boutiques doivent appartenir au même propriétaire';
  END IF;

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

-- ============================================================
-- receive_stock_transfer — validation des quantités reçues + écarts
-- ============================================================
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

-- ============================================================
-- cancel_stock_transfer — uniquement avant réception, réversible
-- ============================================================
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

REVOKE ALL ON FUNCTION send_stock_transfer(UUID, UUID, UUID, TEXT, JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION send_stock_transfer(UUID, UUID, UUID, TEXT, JSONB) TO service_role;

REVOKE ALL ON FUNCTION receive_stock_transfer(UUID, UUID, UUID, JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION receive_stock_transfer(UUID, UUID, UUID, JSONB) TO service_role;

REVOKE ALL ON FUNCTION cancel_stock_transfer(UUID, UUID, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION cancel_stock_transfer(UUID, UUID, UUID) TO service_role;

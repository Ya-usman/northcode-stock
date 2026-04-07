-- ============================================================
-- Migration 007 — Entrepôt + Bons de livraison
-- ============================================================

-- 1. Marquer une boutique comme entrepôt
ALTER TABLE shops
  ADD COLUMN IF NOT EXISTS is_warehouse boolean NOT NULL DEFAULT false;

-- 2. DELIVERY_ORDERS — Bons de livraison (bordereau)
CREATE TABLE IF NOT EXISTS delivery_orders (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bordereau_number text UNIQUE NOT NULL,        -- BL-0001 auto-généré
  warehouse_id     uuid NOT NULL REFERENCES shops(id) ON DELETE RESTRICT,
  destination_id   uuid NOT NULL REFERENCES shops(id) ON DELETE RESTRICT,
  status           text NOT NULL DEFAULT 'draft'
                   CHECK (status IN ('draft','dispatched','received','cancelled')),
  notes            text,
  created_by       uuid REFERENCES auth.users ON DELETE SET NULL,
  dispatched_by    uuid REFERENCES auth.users ON DELETE SET NULL,
  received_by      uuid REFERENCES auth.users ON DELETE SET NULL,
  dispatched_at    timestamptz,
  received_at      timestamptz,
  cancelled_at     timestamptz,
  cancelled_by     uuid REFERENCES auth.users ON DELETE SET NULL,
  created_at       timestamptz DEFAULT now(),
  CONSTRAINT delivery_different_shops CHECK (warehouse_id <> destination_id)
);

-- 3. DELIVERY_ORDER_ITEMS — Lignes produits du bon
CREATE TABLE IF NOT EXISTS delivery_order_items (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  delivery_order_id   uuid NOT NULL REFERENCES delivery_orders(id) ON DELETE CASCADE,
  product_id          uuid NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  product_name        text NOT NULL,
  quantity            int  NOT NULL CHECK (quantity > 0),
  unit_cost           numeric NOT NULL DEFAULT 0,
  created_at          timestamptz DEFAULT now()
);

-- 4. Séquence pour numéros de bordereau auto
CREATE SEQUENCE IF NOT EXISTS delivery_order_seq START 1;

-- 5. Trigger : auto-générer le numéro de bordereau
CREATE OR REPLACE FUNCTION set_bordereau_number()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.bordereau_number IS NULL OR NEW.bordereau_number = '' THEN
    NEW.bordereau_number := 'BL-' || LPAD(nextval('delivery_order_seq')::text, 4, '0');
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_set_bordereau_number ON delivery_orders;
CREATE TRIGGER trg_set_bordereau_number
  BEFORE INSERT ON delivery_orders
  FOR EACH ROW EXECUTE FUNCTION set_bordereau_number();

-- 6. Trigger : lors du DISPATCH → déduire du stock entrepôt
CREATE OR REPLACE FUNCTION process_delivery_dispatch()
RETURNS TRIGGER AS $$
BEGIN
  -- Seulement au passage en 'dispatched'
  IF NEW.status = 'dispatched' AND OLD.status != 'dispatched' THEN
    NEW.dispatched_at := now();

    -- Déduire chaque ligne du stock entrepôt
    UPDATE products p
    SET quantity = p.quantity - doi.quantity,
        updated_at = now()
    FROM delivery_order_items doi
    WHERE doi.delivery_order_id = NEW.id
      AND doi.product_id = p.id;

    -- Log mouvements sortants dans l'entrepôt
    INSERT INTO stock_movements (shop_id, product_id, type, quantity, reason, performed_by)
    SELECT
      NEW.warehouse_id,
      doi.product_id,
      'out',
      doi.quantity,
      'Bon de livraison ' || NEW.bordereau_number || ' → ' || (SELECT name FROM shops WHERE id = NEW.destination_id),
      NEW.dispatched_by
    FROM delivery_order_items doi
    WHERE doi.delivery_order_id = NEW.id;
  END IF;

  -- Annulation (seulement depuis draft ou dispatched)
  IF NEW.status = 'cancelled' AND OLD.status != 'cancelled' THEN
    NEW.cancelled_at := now();

    -- Si on annule après dispatch → remettre le stock dans l'entrepôt
    IF OLD.status = 'dispatched' THEN
      UPDATE products p
      SET quantity = p.quantity + doi.quantity,
          updated_at = now()
      FROM delivery_order_items doi
      WHERE doi.delivery_order_id = NEW.id
        AND doi.product_id = p.id;

      INSERT INTO stock_movements (shop_id, product_id, type, quantity, reason, performed_by)
      SELECT
        NEW.warehouse_id,
        doi.product_id,
        'in',
        doi.quantity,
        'Annulation bon ' || NEW.bordereau_number,
        NEW.cancelled_by
      FROM delivery_order_items doi
      WHERE doi.delivery_order_id = NEW.id;
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_process_delivery_dispatch ON delivery_orders;
CREATE TRIGGER trg_process_delivery_dispatch
  BEFORE UPDATE OF status ON delivery_orders
  FOR EACH ROW EXECUTE FUNCTION process_delivery_dispatch();

-- 7. Trigger : lors de la RÉCEPTION → ajouter au stock boutique destination
CREATE OR REPLACE FUNCTION process_delivery_reception()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.status = 'received' AND OLD.status != 'received' THEN
    NEW.received_at := now();

    -- Ajouter chaque ligne au stock de la boutique destination
    -- Si le produit n'existe pas dans la boutique, l'insérer
    INSERT INTO products (shop_id, name, sku, buying_price, selling_price, quantity, unit, is_active)
    SELECT
      NEW.destination_id,
      doi.product_name,
      p.sku,
      doi.unit_cost,
      p.selling_price,
      doi.quantity,
      p.unit,
      true
    FROM delivery_order_items doi
    JOIN products p ON p.id = doi.product_id
    WHERE doi.delivery_order_id = NEW.id
      AND NOT EXISTS (
        SELECT 1 FROM products dest
        WHERE dest.shop_id = NEW.destination_id
          AND dest.id = doi.product_id
      )
    ON CONFLICT DO NOTHING;

    -- Mettre à jour la quantité si le produit existe déjà
    UPDATE products dest
    SET quantity = dest.quantity + doi.quantity,
        updated_at = now()
    FROM delivery_order_items doi
    WHERE doi.delivery_order_id = NEW.id
      AND dest.id = doi.product_id
      AND dest.shop_id = NEW.destination_id;

    -- Log mouvements entrants dans la boutique destination
    INSERT INTO stock_movements (shop_id, product_id, type, quantity, reason, performed_by)
    SELECT
      NEW.destination_id,
      doi.product_id,
      'in',
      doi.quantity,
      'Réception bordereau ' || NEW.bordereau_number || ' ← Entrepôt',
      NEW.received_by
    FROM delivery_order_items doi
    WHERE doi.delivery_order_id = NEW.id;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_process_delivery_reception ON delivery_orders;
CREATE TRIGGER trg_process_delivery_reception
  BEFORE UPDATE OF status ON delivery_orders
  FOR EACH ROW EXECUTE FUNCTION process_delivery_reception();

-- ============================================================
-- RLS
-- ============================================================

ALTER TABLE delivery_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE delivery_order_items ENABLE ROW LEVEL SECURITY;

-- delivery_orders : visible par les membres de l'entrepôt OU boutique destination
DROP POLICY IF EXISTS "delivery_orders_select" ON delivery_orders;
CREATE POLICY "delivery_orders_select" ON delivery_orders
  FOR SELECT USING (
    is_super_admin() OR
    is_shop_member(warehouse_id) OR
    is_shop_member(destination_id)
  );

DROP POLICY IF EXISTS "delivery_orders_manage" ON delivery_orders;
CREATE POLICY "delivery_orders_manage" ON delivery_orders
  FOR ALL USING (
    is_super_admin() OR
    get_role_in_shop(warehouse_id) IN ('owner','stock_manager')
  );

-- Réception : la boutique destination peut mettre à jour le statut
DROP POLICY IF EXISTS "delivery_orders_receive" ON delivery_orders;
CREATE POLICY "delivery_orders_receive" ON delivery_orders
  FOR UPDATE USING (
    is_super_admin() OR
    get_role_in_shop(warehouse_id) IN ('owner','stock_manager') OR
    get_role_in_shop(destination_id) IN ('owner','stock_manager')
  );

-- delivery_order_items : visibles si on voit le bon
DROP POLICY IF EXISTS "delivery_items_select" ON delivery_order_items;
CREATE POLICY "delivery_items_select" ON delivery_order_items
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM delivery_orders d
      WHERE d.id = delivery_order_id
        AND (is_super_admin() OR is_shop_member(d.warehouse_id) OR is_shop_member(d.destination_id))
    )
  );

DROP POLICY IF EXISTS "delivery_items_manage" ON delivery_order_items;
CREATE POLICY "delivery_items_manage" ON delivery_order_items
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM delivery_orders d
      WHERE d.id = delivery_order_id
        AND (is_super_admin() OR get_role_in_shop(d.warehouse_id) IN ('owner','stock_manager'))
    )
  );

-- ============================================================
-- INDEXES
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_delivery_orders_warehouse ON delivery_orders(warehouse_id);
CREATE INDEX IF NOT EXISTS idx_delivery_orders_destination ON delivery_orders(destination_id);
CREATE INDEX IF NOT EXISTS idx_delivery_orders_status ON delivery_orders(status);
CREATE INDEX IF NOT EXISTS idx_delivery_orders_bordereau ON delivery_orders(bordereau_number);
CREATE INDEX IF NOT EXISTS idx_delivery_items_order ON delivery_order_items(delivery_order_id);
CREATE INDEX IF NOT EXISTS idx_delivery_items_product ON delivery_order_items(product_id);
CREATE INDEX IF NOT EXISTS idx_shops_warehouse ON shops(is_warehouse) WHERE is_warehouse = true;

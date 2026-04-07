-- ============================================================
-- Migration 005 — Multi-boutique + Rôles par boutique
--                + Transferts de stock inter-boutiques
--                + Périodes de facturation (quarterly/annual)
-- ============================================================

-- 1. SHOP_MEMBERS : table pivot user <-> shop avec rôle dédié
CREATE TABLE IF NOT EXISTS shop_members (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id    uuid NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  user_id    uuid NOT NULL REFERENCES auth.users ON DELETE CASCADE,
  role       text NOT NULL CHECK (role IN ('owner','cashier','stock_manager','viewer')),
  is_active  boolean NOT NULL DEFAULT true,
  invited_by uuid REFERENCES auth.users ON DELETE SET NULL,
  joined_at  timestamptz DEFAULT now(),
  created_at timestamptz DEFAULT now(),
  CONSTRAINT shop_members_unique UNIQUE (shop_id, user_id)
);

-- 2. STOCK_TRANSFERS : transferts inter-boutiques
CREATE TABLE IF NOT EXISTS stock_transfers (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  from_shop_id  uuid NOT NULL REFERENCES shops(id) ON DELETE RESTRICT,
  to_shop_id    uuid NOT NULL REFERENCES shops(id) ON DELETE RESTRICT,
  product_id    uuid NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  product_name  text NOT NULL,
  quantity      int  NOT NULL CHECK (quantity > 0),
  unit_cost     numeric NOT NULL DEFAULT 0,
  to_product_id uuid REFERENCES products(id) ON DELETE SET NULL,
  status        text NOT NULL DEFAULT 'pending'
                CHECK (status IN ('pending','in_transit','received','cancelled')),
  initiated_by  uuid REFERENCES auth.users ON DELETE SET NULL,
  received_by   uuid REFERENCES auth.users ON DELETE SET NULL,
  notes         text,
  initiated_at  timestamptz DEFAULT now(),
  received_at   timestamptz,
  cancelled_at  timestamptz,
  cancelled_by  uuid REFERENCES auth.users ON DELETE SET NULL,
  created_at    timestamptz DEFAULT now(),
  CONSTRAINT transfers_different_shops CHECK (from_shop_id <> to_shop_id)
);

-- 3. Champ billing_period sur subscriptions
ALTER TABLE subscriptions
  ADD COLUMN IF NOT EXISTS billing_period text DEFAULT 'monthly'
    CHECK (billing_period IN ('monthly','quarterly','annual'));

-- 4. Backfill shop_members depuis profiles existants
INSERT INTO shop_members (shop_id, user_id, role, is_active, joined_at)
SELECT
  p.shop_id,
  p.id,
  p.role,
  p.is_active,
  p.created_at
FROM profiles p
WHERE p.shop_id IS NOT NULL
ON CONFLICT (shop_id, user_id) DO NOTHING;

-- ============================================================
-- FONCTIONS HELPER pour les RLS multi-boutique
-- ============================================================

CREATE OR REPLACE FUNCTION is_shop_member(p_shop_id uuid)
RETURNS boolean AS $$
  SELECT EXISTS (
    SELECT 1 FROM shop_members
    WHERE shop_id = p_shop_id
      AND user_id = auth.uid()
      AND is_active = true
  );
$$ LANGUAGE sql SECURITY DEFINER STABLE;

CREATE OR REPLACE FUNCTION get_role_in_shop(p_shop_id uuid)
RETURNS text AS $$
  SELECT role FROM shop_members
  WHERE shop_id = p_shop_id
    AND user_id = auth.uid()
    AND is_active = true
  LIMIT 1;
$$ LANGUAGE sql SECURITY DEFINER STABLE;

CREATE OR REPLACE FUNCTION get_user_shop_ids()
RETURNS SETOF uuid AS $$
  SELECT shop_id FROM shop_members
  WHERE user_id = auth.uid() AND is_active = true;
$$ LANGUAGE sql SECURITY DEFINER STABLE ROWS 10;

-- ============================================================
-- RLS — SHOP_MEMBERS
-- ============================================================
ALTER TABLE shop_members ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "shop_members_select" ON shop_members;
CREATE POLICY "shop_members_select" ON shop_members
  FOR SELECT USING (shop_id IN (SELECT get_user_shop_ids()));

DROP POLICY IF EXISTS "shop_members_owner_manage" ON shop_members;
CREATE POLICY "shop_members_owner_manage" ON shop_members
  FOR ALL USING (get_role_in_shop(shop_id) = 'owner');

DROP POLICY IF EXISTS "shop_members_self_delete" ON shop_members;
CREATE POLICY "shop_members_self_delete" ON shop_members
  FOR DELETE USING (user_id = auth.uid());

-- ============================================================
-- RLS — STOCK_TRANSFERS
-- ============================================================
ALTER TABLE stock_transfers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "transfers_member_select" ON stock_transfers;
CREATE POLICY "transfers_member_select" ON stock_transfers
  FOR SELECT USING (
    is_shop_member(from_shop_id) OR is_shop_member(to_shop_id)
  );

DROP POLICY IF EXISTS "transfers_initiate" ON stock_transfers;
CREATE POLICY "transfers_initiate" ON stock_transfers
  FOR INSERT WITH CHECK (
    get_role_in_shop(from_shop_id) IN ('owner', 'stock_manager')
  );

DROP POLICY IF EXISTS "transfers_update" ON stock_transfers;
CREATE POLICY "transfers_update" ON stock_transfers
  FOR UPDATE USING (
    get_role_in_shop(from_shop_id) IN ('owner', 'stock_manager') OR
    get_role_in_shop(to_shop_id)   IN ('owner', 'stock_manager')
  );

-- ============================================================
-- TRIGGER : déduction/ajout de stock lors de la réception
-- ============================================================
CREATE OR REPLACE FUNCTION process_stock_transfer()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.status = 'received' AND OLD.status != 'received' THEN
    -- Déduire du stock source
    UPDATE products SET quantity = quantity - NEW.quantity, updated_at = now()
    WHERE id = NEW.product_id;

    -- Ajouter au stock destination
    UPDATE products SET quantity = quantity + NEW.quantity, updated_at = now()
    WHERE id = COALESCE(NEW.to_product_id, NEW.product_id);

    -- Movement source (out)
    INSERT INTO stock_movements (shop_id, product_id, type, quantity, reason, performed_by)
    VALUES (NEW.from_shop_id, NEW.product_id, 'out', NEW.quantity,
            'Transfert vers boutique ' || NEW.to_shop_id::text, NEW.received_by);

    -- Movement destination (in)
    INSERT INTO stock_movements (shop_id, product_id, type, quantity, reason, performed_by)
    VALUES (NEW.to_shop_id, COALESCE(NEW.to_product_id, NEW.product_id), 'in', NEW.quantity,
            'Transfert depuis boutique ' || NEW.from_shop_id::text, NEW.received_by);

    NEW.received_at = now();
  END IF;

  IF NEW.status = 'cancelled' AND OLD.status = 'pending' THEN
    NEW.cancelled_at = now();
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_process_stock_transfer ON stock_transfers;
CREATE TRIGGER trg_process_stock_transfer
  BEFORE UPDATE OF status ON stock_transfers
  FOR EACH ROW EXECUTE FUNCTION process_stock_transfer();

-- ============================================================
-- INDEXES DE PERFORMANCE
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_shop_members_user_active
  ON shop_members(user_id, is_active) WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_shop_members_shop_role
  ON shop_members(shop_id, role) WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_shops_owner_id
  ON shops(owner_id);
CREATE INDEX IF NOT EXISTS idx_products_shop_active
  ON products(shop_id, is_active) WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_products_low_stock
  ON products(shop_id, quantity) WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_sales_shop_created
  ON sales(shop_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_movements_shop_date
  ON stock_movements(shop_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_transfers_from_status
  ON stock_transfers(from_shop_id, status);
CREATE INDEX IF NOT EXISTS idx_transfers_to_status
  ON stock_transfers(to_shop_id, status);
CREATE INDEX IF NOT EXISTS idx_subscriptions_shop_status
  ON subscriptions(shop_id, status);

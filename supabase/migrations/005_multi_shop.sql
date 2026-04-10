-- ============================================================
-- Migration 005 — Multi-boutique + Rôles par boutique
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

-- 2. Champ billing_period sur subscriptions
ALTER TABLE subscriptions
  ADD COLUMN IF NOT EXISTS billing_period text DEFAULT 'monthly'
    CHECK (billing_period IN ('monthly','quarterly','annual'));

-- 3. Backfill shop_members depuis profiles existants
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
CREATE INDEX IF NOT EXISTS idx_subscriptions_shop_status
  ON subscriptions(shop_id, status);

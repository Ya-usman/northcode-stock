-- ============================================================
-- Migration 002 — SaaS: Plans + Subscriptions
-- ============================================================

-- Add plan fields to shops
ALTER TABLE shops
  ADD COLUMN IF NOT EXISTS plan text DEFAULT 'free' CHECK (plan IN ('free', 'pro', 'enterprise')),
  ADD COLUMN IF NOT EXISTS plan_expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS trial_ends_at timestamptz DEFAULT (now() + interval '14 days'),
  ADD COLUMN IF NOT EXISTS paystack_customer_code text,
  ADD COLUMN IF NOT EXISTS paystack_subscription_code text,
  ADD COLUMN IF NOT EXISTS products_count int DEFAULT 0,
  ADD COLUMN IF NOT EXISTS users_count int DEFAULT 1;

-- Subscriptions history table
CREATE TABLE IF NOT EXISTS subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id uuid REFERENCES shops(id) ON DELETE CASCADE,
  plan text NOT NULL,
  status text DEFAULT 'active' CHECK (status IN ('active', 'cancelled', 'expired', 'trial')),
  amount numeric NOT NULL,
  paystack_reference text,
  starts_at timestamptz DEFAULT now(),
  ends_at timestamptz,
  created_at timestamptz DEFAULT now()
);

-- Plan limits table
CREATE TABLE IF NOT EXISTS plan_limits (
  plan text PRIMARY KEY,
  max_products int NOT NULL,
  max_users int NOT NULL,
  has_reports boolean DEFAULT false,
  has_export boolean DEFAULT false,
  has_whatsapp boolean DEFAULT false,
  price_monthly numeric NOT NULL
);

-- Insert plan limits
INSERT INTO plan_limits (plan, max_products, max_users, has_reports, has_export, has_whatsapp, price_monthly) VALUES
  ('free',       20,   2,  false, false, false, 0),
  ('pro',        500,  10, true,  true,  true,  5000),
  ('enterprise', 9999, 50, true,  true,  true,  15000)
ON CONFLICT (plan) DO UPDATE SET
  max_products = EXCLUDED.max_products,
  max_users = EXCLUDED.max_users,
  has_reports = EXCLUDED.has_reports,
  has_export = EXCLUDED.has_export,
  has_whatsapp = EXCLUDED.has_whatsapp,
  price_monthly = EXCLUDED.price_monthly;

-- RLS
ALTER TABLE subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE plan_limits ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "subscriptions_shop" ON subscriptions;
CREATE POLICY "subscriptions_shop" ON subscriptions
  FOR ALL USING (shop_id = (SELECT shop_id FROM profiles WHERE id = auth.uid()));

DROP POLICY IF EXISTS "plan_limits_read" ON plan_limits;
CREATE POLICY "plan_limits_read" ON plan_limits
  FOR SELECT USING (true);

-- Auto-update products_count on insert/delete
CREATE OR REPLACE FUNCTION update_shop_counts()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_TABLE_NAME = 'products' THEN
    UPDATE shops SET products_count = (
      SELECT COUNT(*) FROM products WHERE shop_id = COALESCE(NEW.shop_id, OLD.shop_id) AND is_active = true
    ) WHERE id = COALESCE(NEW.shop_id, OLD.shop_id);
  END IF;
  IF TG_TABLE_NAME = 'profiles' THEN
    UPDATE shops SET users_count = (
      SELECT COUNT(*) FROM profiles WHERE shop_id = COALESCE(NEW.shop_id, OLD.shop_id) AND is_active = true
    ) WHERE id = COALESCE(NEW.shop_id, OLD.shop_id);
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_update_product_count ON products;
CREATE TRIGGER trg_update_product_count
  AFTER INSERT OR DELETE OR UPDATE OF is_active ON products
  FOR EACH ROW EXECUTE FUNCTION update_shop_counts();

DROP TRIGGER IF EXISTS trg_update_user_count ON profiles;
CREATE TRIGGER trg_update_user_count
  AFTER INSERT OR DELETE OR UPDATE OF is_active ON profiles
  FOR EACH ROW EXECUTE FUNCTION update_shop_counts();

-- Update existing shop to pro (your current shop)
UPDATE shops SET plan = 'pro', plan_expires_at = now() + interval '1 year'
WHERE id = 'a0000000-0000-0000-0000-000000000001';

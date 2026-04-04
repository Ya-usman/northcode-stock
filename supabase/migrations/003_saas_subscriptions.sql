-- ============================================================
-- Migration 003 — SaaS Subscriptions
-- Run this in Supabase SQL Editor
-- ============================================================

-- Add SaaS columns to shops (safe if already exists)
ALTER TABLE shops
  ADD COLUMN IF NOT EXISTS plan TEXT DEFAULT 'trial' CHECK (plan IN ('trial','free','starter','pro','business')),
  ADD COLUMN IF NOT EXISTS trial_ends_at TIMESTAMPTZ DEFAULT (NOW() + INTERVAL '14 days'),
  ADD COLUMN IF NOT EXISTS plan_expires_at TIMESTAMPTZ;

-- Subscriptions history table
CREATE TABLE IF NOT EXISTS subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id UUID NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  plan TEXT NOT NULL,
  amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  paystack_reference TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','cancelled','expired')),
  starts_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index for fast lookup
CREATE INDEX IF NOT EXISTS idx_subscriptions_shop_id ON subscriptions(shop_id);
CREATE INDEX IF NOT EXISTS idx_subscriptions_status ON subscriptions(status);
CREATE INDEX IF NOT EXISTS idx_shops_plan ON shops(plan);

-- RLS
ALTER TABLE subscriptions ENABLE ROW LEVEL SECURITY;

-- Drop and recreate policy (IF NOT EXISTS not supported for policies)
DROP POLICY IF EXISTS "subscriptions_owner_select" ON subscriptions;

-- Owners can read their own subscriptions
CREATE POLICY "subscriptions_owner_select"
  ON subscriptions FOR SELECT
  USING (
    shop_id IN (
      SELECT shop_id FROM profiles WHERE id = auth.uid()
    )
  );

-- Only service role can insert/update subscriptions
-- (done via admin client from API routes)

-- Set all existing shops to trial plan if not already set
UPDATE shops
SET
  plan = COALESCE(plan, 'trial'),
  trial_ends_at = COALESCE(trial_ends_at, created_at + INTERVAL '14 days')
WHERE plan IS NULL OR plan = '';

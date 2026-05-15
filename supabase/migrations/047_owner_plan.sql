-- Migration 047: Move subscriptions to owner level (profiles table)
-- Shops still keep plan columns for backward compat (read by client components)
-- profiles becomes the single source of truth for billing

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS plan TEXT DEFAULT 'trial',
  ADD COLUMN IF NOT EXISTS plan_expires_at TIMESTAMPTZ DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS trial_ends_at TIMESTAMPTZ DEFAULT NULL;

-- Migrate existing data: copy plan from each user's primary shop
-- 'free' is a legacy value — normalize it to 'trial'
UPDATE profiles p
SET
  plan            = CASE WHEN COALESCE(s.plan, 'trial') IN ('free', '') THEN 'trial' ELSE COALESCE(s.plan, 'trial') END,
  plan_expires_at = CASE WHEN s.plan IN ('free', 'trial') THEN NULL ELSE s.plan_expires_at END,
  trial_ends_at   = s.trial_ends_at
FROM shops s
WHERE s.id = p.shop_id
  AND s.deleted_at IS NULL;

-- For profiles whose primary shop is deleted or NULL, set a default trial
UPDATE profiles p
SET
  plan          = 'trial',
  trial_ends_at = NOW() + INTERVAL '30 days'
WHERE p.plan IS NULL OR p.plan = '';

-- Also normalize any 'free' values in the shops table
UPDATE shops SET plan = 'trial' WHERE plan = 'free';

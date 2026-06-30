-- ============================================================
-- Migration 069 : Plan-based suspension tracking
-- ============================================================
-- When a subscription downgrade reduces the allowed number of
-- shops or team members, the excess (newest first) are suspended.
-- suspended_by_plan=true marks those rows so they can be
-- automatically reactivated if the owner upgrades again.

ALTER TABLE shops
  ADD COLUMN IF NOT EXISTS suspended_by_plan boolean NOT NULL DEFAULT false;

ALTER TABLE shop_members
  ADD COLUMN IF NOT EXISTS suspended_by_plan boolean NOT NULL DEFAULT false;

-- Add grace_ends_at to profiles so we can track the 7-day
-- grace period after a paid plan expires before the upgrade
-- wall appears.
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS plan_grace_ends_at timestamptz;

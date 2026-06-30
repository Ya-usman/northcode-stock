-- ============================================================
-- Migration 066 : Add shop_manager to role CHECK constraints
-- ============================================================
-- The shop_members_role_check and profiles_role_check constraints
-- don't include 'shop_manager', causing INSERT/UPDATE to fail
-- when assigning the new Manager role to a team member.

ALTER TABLE shop_members
  DROP CONSTRAINT IF EXISTS shop_members_role_check;

ALTER TABLE shop_members
  ADD CONSTRAINT shop_members_role_check
  CHECK (role IN ('owner', 'manager', 'shop_manager', 'cashier', 'stock_manager', 'viewer'));

ALTER TABLE profiles
  DROP CONSTRAINT IF EXISTS profiles_role_check;

ALTER TABLE profiles
  ADD CONSTRAINT profiles_role_check
  CHECK (role IN ('super_admin', 'owner', 'manager', 'shop_manager', 'cashier', 'stock_manager', 'viewer'));

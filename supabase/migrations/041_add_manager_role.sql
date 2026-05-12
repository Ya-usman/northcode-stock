-- Add 'manager' role to shop_members (shop responsable, visible in admin panel)
ALTER TABLE shop_members DROP CONSTRAINT IF EXISTS shop_members_role_check;
ALTER TABLE shop_members
  ADD CONSTRAINT shop_members_role_check
  CHECK (role IN ('owner', 'manager', 'cashier', 'stock_manager', 'viewer'));

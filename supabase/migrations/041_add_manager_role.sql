-- Add 'manager' role to shop_members and profiles
-- shop_members: the inline CHECK from 005_multi_shop.sql has no name,
-- so we must find and drop it by finding all check constraints on the column.
DO $$
DECLARE
  cname text;
BEGIN
  FOR cname IN
    SELECT con.conname
    FROM pg_constraint con
    JOIN pg_class rel ON rel.oid = con.conrelid
    JOIN pg_attribute att ON att.attrelid = rel.oid AND att.attnum = ANY(con.conkey)
    WHERE rel.relname = 'shop_members'
      AND con.contype = 'c'
      AND att.attname = 'role'
  LOOP
    EXECUTE format('ALTER TABLE shop_members DROP CONSTRAINT %I', cname);
  END LOOP;
END $$;

ALTER TABLE shop_members
  ADD CONSTRAINT shop_members_role_check
  CHECK (role IN ('owner', 'manager', 'cashier', 'stock_manager', 'viewer'));

-- profiles: also needs 'manager'
ALTER TABLE profiles DROP CONSTRAINT IF EXISTS profiles_role_check;
ALTER TABLE profiles
  ADD CONSTRAINT profiles_role_check
  CHECK (role IN ('super_admin', 'owner', 'manager', 'cashier', 'stock_manager', 'viewer'));

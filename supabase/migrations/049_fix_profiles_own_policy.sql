-- Migration 049 — Fix profiles_own policy
-- Migration 001 created "profiles_own" with USING (true) — all authenticated users
-- could read ALL profiles in the DB.
-- Migration 009 added "profiles_read_own" (correct) but never dropped "profiles_own".
-- PostgreSQL combines permissive policies with OR, so (true OR anything) = true.
-- This migration drops the insecure policy, keeping only the correct one.

DROP POLICY IF EXISTS "profiles_own" ON profiles;

-- Ensure the correct policy exists (idempotent)
DROP POLICY IF EXISTS "profiles_read_own" ON profiles;
CREATE POLICY "profiles_read_own" ON profiles
  FOR SELECT USING (
    id = auth.uid()
    OR id IN (
      SELECT sm.user_id FROM shop_members sm
      WHERE sm.shop_id IN (SELECT get_user_shop_ids())
    )
  );

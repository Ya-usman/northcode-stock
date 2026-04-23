-- ============================================================
-- Migration 013 — Security hardening
-- ============================================================

-- 1. Unique constraint on subscriptions.paystack_reference to enforce idempotency
--    (prevents replayed payment references from being processed twice)
ALTER TABLE subscriptions
  ADD CONSTRAINT IF NOT EXISTS subscriptions_reference_unique UNIQUE (paystack_reference);

-- 2. Tighten profiles RLS: ensure no "read all" policy exists
--    Migration 009 already sets the correct policy, but drop any legacy open policy just in case
DROP POLICY IF EXISTS "profiles_select_all" ON profiles;
DROP POLICY IF EXISTS "allow_read_profiles" ON profiles;
DROP POLICY IF EXISTS "profiles_public_read" ON profiles;

-- 3. Ensure payments table RLS only allows shop members to read payments
--    (payments are linked to sales which belong to shops)
ALTER TABLE payments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "payments_shop_member_read" ON payments;
CREATE POLICY "payments_shop_member_read" ON payments
  FOR SELECT USING (
    sale_id IN (
      SELECT id FROM sales
      WHERE shop_id IN (SELECT get_user_shop_ids())
    )
  );

DROP POLICY IF EXISTS "payments_shop_member_insert" ON payments;
CREATE POLICY "payments_shop_member_insert" ON payments
  FOR INSERT WITH CHECK (
    sale_id IN (
      SELECT id FROM sales
      WHERE shop_id IN (SELECT get_user_shop_ids())
    )
  );

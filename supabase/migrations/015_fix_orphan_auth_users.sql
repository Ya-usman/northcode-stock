-- ============================================================
-- Migration 015 — Fix orphan auth users (profile missing)
-- Run this in Supabase SQL Editor to fix users who completed
-- Supabase signUp but whose profile/shop was never created.
-- ============================================================

-- Step 1: Create missing shop_members for profiles that have shop_id but no membership
-- (same as 011, run again in case 011 was not applied)
INSERT INTO shop_members (shop_id, user_id, role, is_active)
SELECT
  p.shop_id,
  p.id AS user_id,
  COALESCE(p.role, 'owner'),
  true
FROM profiles p
WHERE
  p.shop_id IS NOT NULL
  AND p.is_active = true
  AND NOT EXISTS (
    SELECT 1 FROM shop_members sm
    WHERE sm.shop_id = p.shop_id AND sm.user_id = p.id
  )
ON CONFLICT (shop_id, user_id) DO NOTHING;

-- Step 2: For auth users with no profile at all, you must run the block below
-- MANUALLY after replacing the placeholder values.
--
-- HOW TO USE:
--   1. Go to Supabase → Authentication → Users
--   2. Find the user by email (e.g. toblisandraayivi@gmail.com)
--   3. Copy their User UID
--   4. Replace 'PASTE_USER_UUID_HERE' below with that UID
--   5. Replace 'Nom de la boutique' and 'Ville' with their info
--   6. Run this block
--
-- DO $$
-- DECLARE
--   v_user_id uuid := 'PASTE_USER_UUID_HERE';
--   v_shop_id uuid;
-- BEGIN
--   -- Create the shop
--   INSERT INTO shops (name, owner_id, city, currency, plan, trial_ends_at)
--   VALUES ('Nom de la boutique', v_user_id, 'Ville', 'FCFA', 'trial',
--           now() + interval '7 days')
--   RETURNING id INTO v_shop_id;
--
--   -- Create the profile
--   INSERT INTO profiles (id, full_name, shop_id, role, is_active)
--   VALUES (v_user_id, 'Nom Complet', v_shop_id, 'owner', true)
--   ON CONFLICT (id) DO UPDATE
--     SET shop_id = v_shop_id, role = 'owner', is_active = true;
--
--   -- Create the shop membership
--   INSERT INTO shop_members (shop_id, user_id, role, is_active)
--   VALUES (v_shop_id, v_user_id, 'owner', true)
--   ON CONFLICT (shop_id, user_id) DO NOTHING;
-- END $$;

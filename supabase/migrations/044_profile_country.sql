-- Add country field to profiles so owner's country is stored directly
-- (previously had to infer it from profile.shop_id → shops.country which is unstable)
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS country text DEFAULT 'NG';

-- Backfill from each profile's primary shop (profiles.shop_id = their registration shop)
UPDATE profiles p
SET country = s.country
FROM shops s
WHERE p.shop_id = s.id
  AND s.country IS NOT NULL;

-- ============================================================
-- Migration 014 — Storage RLS for shop-logos bucket
-- ============================================================

-- Create the bucket if it doesn't exist (public = readable by anyone)
INSERT INTO storage.buckets (id, name, public)
VALUES ('shop-logos', 'shop-logos', true)
ON CONFLICT (id) DO UPDATE SET public = true;

-- Allow shop owners/members to upload their shop logo
-- Path format: {shop_id}/logo.{ext}
DROP POLICY IF EXISTS "shop_logos_insert" ON storage.objects;
CREATE POLICY "shop_logos_insert" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'shop-logos'
    AND (storage.foldername(name))[1] IN (
      SELECT shop_id::text FROM shop_members
      WHERE user_id = auth.uid() AND is_active = true
        AND role IN ('owner', 'super_admin')
    )
  );

DROP POLICY IF EXISTS "shop_logos_update" ON storage.objects;
CREATE POLICY "shop_logos_update" ON storage.objects
  FOR UPDATE TO authenticated
  USING (
    bucket_id = 'shop-logos'
    AND (storage.foldername(name))[1] IN (
      SELECT shop_id::text FROM shop_members
      WHERE user_id = auth.uid() AND is_active = true
        AND role IN ('owner', 'super_admin')
    )
  );

DROP POLICY IF EXISTS "shop_logos_select" ON storage.objects;
CREATE POLICY "shop_logos_select" ON storage.objects
  FOR SELECT TO public
  USING (bucket_id = 'shop-logos');

DROP POLICY IF EXISTS "shop_logos_delete" ON storage.objects;
CREATE POLICY "shop_logos_delete" ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'shop-logos'
    AND (storage.foldername(name))[1] IN (
      SELECT shop_id::text FROM shop_members
      WHERE user_id = auth.uid() AND is_active = true
        AND role IN ('owner', 'super_admin')
    )
  );

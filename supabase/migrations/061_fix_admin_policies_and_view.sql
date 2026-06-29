-- ============================================================
-- Migration 061 : Fix admin policies and super_admin_shop_stats view
-- ============================================================

-- ── shop_notes + admin_notifications : use is_super_admin() ─
-- The inline EXISTS reads profiles.role directly; is_super_admin()
-- does the same but is the canonical function for this check.
DROP POLICY IF EXISTS "notes_super_admin_all" ON shop_notes;
CREATE POLICY "notes_super_admin_all" ON shop_notes
  FOR ALL USING (is_super_admin());

DROP POLICY IF EXISTS "notifs_super_admin_all" ON admin_notifications;
CREATE POLICY "notifs_super_admin_all" ON admin_notifications
  FOR ALL USING (is_super_admin());

-- ── super_admin_shop_stats view : exclude cancelled sales ───
CREATE OR REPLACE VIEW super_admin_shop_stats AS
SELECT
  s.id AS shop_id,
  s.name AS shop_name,
  s.city,
  s.plan,
  s.country,
  COUNT(DISTINCT p.id) FILTER (WHERE p.is_active) AS product_count,
  COALESCE(SUM(p.quantity * p.selling_price) FILTER (WHERE p.is_active), 0) AS stock_value,
  COALESCE(SUM(p.quantity) FILTER (WHERE p.is_active), 0) AS total_units,
  COUNT(DISTINCT sa.id) FILTER (
    WHERE sa.created_at >= now() - interval '30 days'
      AND sa.sale_status = 'active'
  ) AS sales_30d,
  COALESCE(SUM(sa.total) FILTER (
    WHERE sa.created_at >= now() - interval '30 days'
      AND sa.sale_status = 'active'
  ), 0) AS revenue_30d
FROM shops s
LEFT JOIN products p ON p.shop_id = s.id
LEFT JOIN sales sa ON sa.shop_id = s.id
GROUP BY s.id, s.name, s.city, s.plan, s.country;

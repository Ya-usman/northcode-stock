-- ============================================================
-- 106 — Supprime la duplication shops.plan / plan_expires_at / trial_ends_at
--
-- Depuis la migration 047, `profiles` est la source de vérité du plan
-- (facturation au niveau owner). `shops` gardait une copie de ces 3 colonnes
-- "pour compat" — en pratique, ça obligeait chaque point d'écriture du plan
-- (paiement Paystack/Flutterwave/Wave/NotchPay, actions admin, renouvellement
-- cron) à se souvenir de resynchroniser les deux tables. Un seul oubli, ou
-- une résolution d'owner_id foireuse (voir migration 105), et `shops.plan`
-- se figeait pendant que `profiles.plan` avançait — désynchro par
-- construction, pas un accident isolé.
--
-- Tout le code applicatif a été migré pour lire/écrire exclusivement
-- `profiles.plan/plan_expires_at/trial_ends_at`, et pour résoudre le plan
-- d'une boutique via son owner (lib/saas/resolve-owner-plan.ts) plutôt que
-- via une colonne dupliquée. Cette migration supprime les colonnes devenues
-- mortes, rendant la désynchro structurellement impossible.
-- ============================================================

-- 1. La vue super_admin_shop_stats dépend de shops.plan — la recréer en
--    résolvant le plan via le owner (shop_members) avant de pouvoir DROP.
CREATE OR REPLACE VIEW super_admin_shop_stats
WITH (security_invoker = true) AS
SELECT
  s.id AS shop_id,
  s.name AS shop_name,
  s.city,
  owner_profile.plan,
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
LEFT JOIN LATERAL (
  SELECT sm.user_id
  FROM shop_members sm
  WHERE sm.shop_id = s.id AND sm.role = 'owner' AND sm.is_active = true
  ORDER BY sm.created_at ASC
  LIMIT 1
) owner_member ON true
LEFT JOIN profiles owner_profile ON owner_profile.id = owner_member.user_id
LEFT JOIN products p ON p.shop_id = s.id
LEFT JOIN sales sa ON sa.shop_id = s.id
GROUP BY s.id, s.name, s.city, owner_profile.plan, s.country;

-- 2. Plus aucune écriture ni lecture applicative sur ces colonnes — on peut
--    les supprimer. Les contraintes CHECK et l'index idx_shops_plan
--    (migration 003) sont attachés à la colonne et disparaissent avec elle.
ALTER TABLE shops DROP COLUMN IF EXISTS plan;
ALTER TABLE shops DROP COLUMN IF EXISTS plan_expires_at;
ALTER TABLE shops DROP COLUMN IF EXISTS trial_ends_at;

-- Retour arrière de la 214 (rôle Comptable). À n'exécuter qu'APRÈS avoir remis en ligne le code d'avant.
-- Refusé tant qu'un membre ou un profil porte le rôle « accountant » : changer d'abord leur rôle (Équipe), après export
--   SELECT id, shop_id, user_id FROM shop_members WHERE role = 'accountant';
--   SELECT id FROM profiles WHERE role = 'accountant';
-- Les réglages « accountant » éventuels de shops.role_permissions restent en place, sans effet (rôle inconnu = rien).
SET LOCAL lock_timeout = '5s';

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM public.shop_members WHERE role = 'accountant')
     OR EXISTS (SELECT 1 FROM public.profiles WHERE role = 'accountant') THEN
    RAISE EXCEPTION 'Retour arrière 214 refusé : des membres ont encore le rôle Comptable';
  END IF;
END $$;

-- Ventes : règle de la 209
DROP POLICY IF EXISTS sales_read_all ON public.sales;
CREATE POLICY sales_read_all ON public.sales FOR SELECT TO authenticated
  USING (shop_id IN (SELECT public.shop_ids_with_any_feature(ARRAY['sales_history', 'caisse'], ARRAY['owner', 'manager', 'shop_manager', 'viewer']))
         AND public.sale_in_history(id, shop_id, created_at, balance));

-- Règle des droits : version de la 184
CREATE OR REPLACE FUNCTION public.role_can_view_feature(p_stored jsonb, p_role text, p_feature text) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE SET search_path = pg_catalog, pg_temp AS $f$
DECLARE
  known CONSTANT text[] := ARRAY[
    'sales_history', 'payments', 'customers', 'stock', 'movements', 'categories', 'suppliers', 'transfers', 'expenses',
    'new_sale', 'discount', 'reports', 'expiry_list', 'revenue_chart', 'notes', 'delete_products', 'delete_expenses',
    'caisse', 'inventory_count', 'extend_hours', 'view_purchase_cost',
    'widget_today_revenue', 'widget_sales_count', 'widget_stock_alerts_card', 'widget_outstanding_debt',
    'widget_net_result', 'widget_stock_alerts_list', 'widget_dashboard_revenue_chart', 'widget_top_products_chart',
    'widget_recent_sales', 'widget_rep_encaisse', 'widget_rep_depenses', 'widget_rep_transactions',
    'widget_rep_marge_brute', 'widget_rep_benefice_net', 'widget_rep_credits', 'widget_rep_payment_chart',
    'widget_rep_top_products', 'widget_rep_cashier_perf'];
  off CONSTANT jsonb := '{
    "shop_manager": ["revenue_chart", "delete_products", "extend_hours", "widget_dashboard_revenue_chart", "widget_top_products_chart"],
    "manager": ["revenue_chart", "delete_products", "extend_hours", "widget_dashboard_revenue_chart", "widget_top_products_chart"],
    "cashier": ["stock", "movements", "categories", "suppliers", "transfers", "expenses", "reports", "expiry_list",
                "revenue_chart", "notes", "delete_products", "delete_expenses", "caisse", "inventory_count", "extend_hours",
                "view_purchase_cost"],
    "viewer": ["expenses", "new_sale", "discount", "revenue_chart", "notes", "delete_products", "delete_expenses", "caisse",
               "inventory_count", "extend_hours", "view_purchase_cost", "widget_outstanding_debt",
               "widget_dashboard_revenue_chart", "widget_top_products_chart"],
    "stock_manager": ["sales_history", "payments", "customers", "expenses", "new_sale", "discount", "reports", "revenue_chart",
                      "notes", "delete_products", "delete_expenses", "caisse", "extend_hours", "view_purchase_cost",
                      "widget_dashboard_revenue_chart", "widget_top_products_chart"]
  }';
  viewer_locked CONSTANT text[] := ARRAY['new_sale', 'discount', 'delete_products', 'delete_expenses', 'inventory_count', 'extend_hours', 'caisse'];
  general_exempt CONSTANT text[] := ARRAY['view_purchase_cost'];
  g jsonb; own jsonb; general boolean; view boolean;
BEGIN
  IF p_role IN ('owner', 'super_admin') THEN RETURN true; END IF;
  IF p_role IS NULL OR NOT (off ? p_role) THEN RETURN false; END IF;
  IF p_feature = ANY (general_exempt) THEN
    general := true;
  ELSE
    g := CASE WHEN jsonb_typeof(p_stored -> 'general') = 'object' THEN p_stored -> 'general' END;
    general := CASE WHEN g ? p_feature THEN public.perm_jsonb_truthy(g -> p_feature) ELSE p_feature = ANY (known) END;
  END IF;
  IF NOT general THEN RETURN false; END IF;
  own := CASE WHEN jsonb_typeof(p_stored -> p_role) = 'object' THEN p_stored -> p_role END;
  view := CASE WHEN own ? p_feature THEN public.perm_jsonb_truthy(own -> p_feature)
               ELSE p_feature = ANY (known) AND NOT ((off -> p_role) ? p_feature) END;
  IF p_role = 'viewer' AND p_feature = ANY (viewer_locked) THEN RETURN false; END IF;
  RETURN coalesce(view, false);
END $f$;

-- Rôles autorisés : listes de la 066
ALTER TABLE public.shop_members DROP CONSTRAINT IF EXISTS shop_members_role_check;
ALTER TABLE public.shop_members ADD CONSTRAINT shop_members_role_check
  CHECK (role IN ('owner', 'manager', 'shop_manager', 'cashier', 'stock_manager', 'viewer'));
ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_role_check;
ALTER TABLE public.profiles ADD CONSTRAINT profiles_role_check
  CHECK (role IN ('super_admin', 'owner', 'manager', 'shop_manager', 'cashier', 'stock_manager', 'viewer'));

NOTIFY pgrst, 'reload schema';

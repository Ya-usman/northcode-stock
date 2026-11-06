-- Retour arrière de la 215 : règle de la 214 (Comptable sans « Chiffre d'affaires de la boutique » par défaut).
-- À n'exécuter qu'APRÈS avoir remis en ligne le code d'avant (lib/permissions : accountant.revenue_chart = false).
SET LOCAL lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.role_can_view_feature(p_stored jsonb, p_role text, p_feature text) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE SET search_path = pg_catalog, pg_temp AS $f$
DECLARE
  -- lib/permissions : LEVEL_FEATURES, SWITCH_FEATURES, WIDGET_FEATURES (toutes « oui » dans DEFAULT_GENERAL)
  known CONSTANT text[] := ARRAY[
    'sales_history', 'payments', 'customers', 'stock', 'movements', 'categories', 'suppliers', 'transfers', 'expenses',
    'new_sale', 'discount', 'reports', 'expiry_list', 'revenue_chart', 'notes', 'delete_products', 'delete_expenses',
    'caisse', 'inventory_count', 'extend_hours', 'view_purchase_cost',
    'widget_today_revenue', 'widget_sales_count', 'widget_stock_alerts_card', 'widget_outstanding_debt',
    'widget_net_result', 'widget_stock_alerts_list', 'widget_dashboard_revenue_chart', 'widget_top_products_chart',
    'widget_recent_sales', 'widget_rep_encaisse', 'widget_rep_depenses', 'widget_rep_transactions',
    'widget_rep_marge_brute', 'widget_rep_benefice_net', 'widget_rep_credits', 'widget_rep_payment_chart',
    'widget_rep_top_products', 'widget_rep_cashier_perf'];
  -- lib/permissions : DEFAULT_PERMISSIONS — par rôle configurable, les fonctions à « non » par défaut (le reste : « oui »)
  off CONSTANT jsonb := '{
    "shop_manager": ["revenue_chart", "delete_products", "extend_hours", "widget_dashboard_revenue_chart", "widget_top_products_chart"],
    "manager": ["revenue_chart", "delete_products", "extend_hours", "widget_dashboard_revenue_chart", "widget_top_products_chart"],
    "accountant": ["new_sale", "discount", "revenue_chart", "notes", "delete_products", "delete_expenses", "caisse",
                   "inventory_count", "extend_hours", "widget_dashboard_revenue_chart", "widget_top_products_chart"],
    "cashier": ["stock", "movements", "categories", "suppliers", "transfers", "expenses", "reports", "expiry_list",
                "revenue_chart", "notes", "delete_products", "delete_expenses", "caisse", "inventory_count", "extend_hours",
                "view_purchase_cost"],
    "stock_manager": ["sales_history", "payments", "customers", "expenses", "new_sale", "discount", "reports", "revenue_chart",
                      "notes", "delete_products", "delete_expenses", "caisse", "extend_hours", "view_purchase_cost",
                      "widget_dashboard_revenue_chart", "widget_top_products_chart"],
    "viewer": ["expenses", "new_sale", "discount", "revenue_chart", "notes", "delete_products", "delete_expenses", "caisse",
               "inventory_count", "extend_hours", "view_purchase_cost", "widget_outstanding_debt",
               "widget_dashboard_revenue_chart", "widget_top_products_chart"]
  }';
  -- lib/permissions : READ_ONLY_ROLES, READ_ONLY_LOCKED, GENERAL_EXEMPT
  read_only_roles CONSTANT text[] := ARRAY['viewer', 'accountant'];
  read_only_locked CONSTANT text[] := ARRAY['new_sale', 'discount', 'delete_products', 'delete_expenses', 'inventory_count', 'extend_hours', 'caisse'];
  general_exempt CONSTANT text[] := ARRAY['view_purchase_cost'];
  g jsonb; own jsonb; general boolean; view boolean;
BEGIN
  -- Décision 1 (25 oct. 2026) : le propriétaire lit toujours ; super_admin : tout (comme l'application)
  IF p_role IN ('owner', 'super_admin') THEN RETURN true; END IF;
  -- Rôle inconnu (ou absent) : rien
  IF p_role IS NULL OR NOT (off ? p_role) THEN RETURN false; END IF;
  -- Onglet « Général » : une fonction à « non » est masquée pour tout le monde
  IF p_feature = ANY (general_exempt) THEN
    general := true;
  ELSE
    g := CASE WHEN jsonb_typeof(p_stored -> 'general') = 'object' THEN p_stored -> 'general' END;
    general := CASE WHEN g ? p_feature THEN public.perm_jsonb_truthy(g -> p_feature) ELSE p_feature = ANY (known) END;
  END IF;
  IF NOT general THEN RETURN false; END IF;
  -- Réglage du rôle dans la boutique, sinon valeur par défaut
  own := CASE WHEN jsonb_typeof(p_stored -> p_role) = 'object' THEN p_stored -> p_role END;
  view := CASE WHEN own ? p_feature THEN public.perm_jsonb_truthy(own -> p_feature)
               ELSE p_feature = ANY (known) AND NOT ((off -> p_role) ? p_feature) END;
  -- Rôle en lecture seule (Observateur, Comptable) : jamais d'action d'écriture
  IF p_role = ANY (read_only_roles) AND p_feature = ANY (read_only_locked) THEN RETURN false; END IF;
  RETURN coalesce(view, false);
END $f$;

NOTIFY pgrst, 'reload schema';

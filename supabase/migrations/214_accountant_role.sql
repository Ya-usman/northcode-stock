-- 214 — Rôle Comptable (accountant), lot Rôles partie B (décisions du 6 nov. 2026) :
--   • nouveau rôle en LECTURE SEULE, comme l'Observateur : aucune modification, aucune action d'écriture (vente,
--     remise, caisse, inventaire, suppressions, prolongation d'horaires), quel que soit le réglage de la boutique ;
--   • voit par défaut : ventes, encaissements et crédits, clients, dépenses, rapports, fournisseurs, stock, transferts,
--     et les prix d'achat (droit view_purchase_cost à « oui », réglable rôle par rôle comme pour le Responsable) ;
--   • lit les ventes de TOUTE la boutique (règle sales_read_all), comme le propriétaire, l'Administrateur, le
--     Responsable et l'Observateur ; il ne vend pas, il n'a donc pas de « propres ventes ».
-- Contenu : 1. listes de rôles autorisés (shop_members, profiles) ; 2. role_can_view_feature (règle de la 184 + le
-- Comptable + verrou commun « lecture seule ») ; 3. règle sales_read_all (209 + accountant). Rien d'autre ne change :
-- aucune donnée modifiée, aucune autre table. Les écritures restent réservées au serveur (aucune fonction d'écriture
-- appelable par un compte connecté, audit du 6 nov. 2026), qui applique lib/permissions (READ_ONLY_ROLES).
-- Les constantes de la règle DOIVENT rester égales à lib/permissions : tests/e2e/rls-feature-pure.mjs lit ce fichier.
-- Retour arrière : supabase/rollbacks/214_accountant_role_rollback.sql
-- Appliquée par « supabase db push » (transaction de la CLI) : pas de BEGIN / COMMIT dans ce fichier.

SET LOCAL lock_timeout = '5s';

-- ── 1. Rôles autorisés ──────────────────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.shop_members DROP CONSTRAINT IF EXISTS shop_members_role_check;
ALTER TABLE public.shop_members ADD CONSTRAINT shop_members_role_check
  CHECK (role IN ('owner', 'manager', 'shop_manager', 'cashier', 'stock_manager', 'viewer', 'accountant'));
ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_role_check;
ALTER TABLE public.profiles ADD CONSTRAINT profiles_role_check
  CHECK (role IN ('super_admin', 'owner', 'manager', 'shop_manager', 'cashier', 'stock_manager', 'viewer', 'accountant'));

-- ── 2. Droit « voir » d'un rôle (même signature : droits d'exécution conservés) ───────────────────────────────
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

-- ── 3. Ventes de toute la boutique : + Comptable (règle de la 209 inchangée par ailleurs) ─────────────────────
DROP POLICY IF EXISTS sales_read_all ON public.sales;
CREATE POLICY sales_read_all ON public.sales FOR SELECT TO authenticated
  USING (shop_id IN (SELECT public.shop_ids_with_any_feature(ARRAY['sales_history', 'caisse'], ARRAY['owner', 'manager', 'shop_manager', 'viewer', 'accountant']))
         AND public.sale_in_history(id, shop_id, created_at, balance));

-- Garde-fou : état EFFECTIF attendu — sinon tout est annulé
DO $$
DECLARE n int;
BEGIN
  -- Rôles autorisés
  SELECT count(*) INTO n FROM pg_constraint
   WHERE contype = 'c' AND conname IN ('shop_members_role_check', 'profiles_role_check')
     AND pg_get_constraintdef(oid) LIKE '%accountant%';
  IF n <> 2 THEN RAISE EXCEPTION '214 : listes de rôles sans « accountant » (% sur 2)', n; END IF;

  -- Règle de lecture des ventes : une seule « toute la boutique », avec le Comptable et la durée d'historique
  SELECT count(*) INTO n FROM pg_policies
   WHERE schemaname = 'public' AND tablename = 'sales' AND policyname = 'sales_read_all' AND cmd = 'SELECT'
     AND qual LIKE '%accountant%' AND qual LIKE '%sale_in_history%';
  IF n <> 1 THEN RAISE EXCEPTION '214 : règle sales_read_all inattendue'; END IF;
  SELECT count(*) INTO n FROM pg_policies WHERE schemaname = 'public' AND tablename = 'sales' AND cmd IN ('SELECT', 'ALL');
  IF n <> 2 THEN RAISE EXCEPTION '214 : % règles de lecture sur les ventes (2 attendues)', n; END IF;

  -- Droits d'exécution inchangés (fonction pure réservée au serveur)
  IF has_function_privilege('anon', 'public.role_can_view_feature(jsonb, text, text)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.role_can_view_feature(jsonb, text, text)', 'EXECUTE') THEN
    RAISE EXCEPTION '214 : droits d''exécution inattendus sur role_can_view_feature';
  END IF;

  -- Contrôles de la règle : cas de la 184 (inchangés) + Comptable
  IF public.role_can_view_feature(NULL, 'cashier', 'expenses')
     OR NOT public.role_can_view_feature(NULL, 'manager', 'expenses')
     OR NOT public.role_can_view_feature('{"general": {"expenses": false}}', 'owner', 'expenses')
     OR public.role_can_view_feature('{"general": {"expenses": false}}', 'manager', 'expenses')
     OR NOT public.role_can_view_feature('{"stock_manager": {"expenses": true}}', 'stock_manager', 'expenses')
     OR public.role_can_view_feature('{"manager": {"expenses": false}}', 'manager', 'expenses')
     OR public.role_can_view_feature('{"viewer": {"new_sale": true}}', 'viewer', 'new_sale')
     OR public.role_can_view_feature(NULL, 'viewer', 'expenses')
     OR public.role_can_view_feature(NULL, 'inconnu', 'expenses')
     -- Comptable : voit dépenses, ventes, rapports et prix d'achat ; jamais une action d'écriture, même ouverte
     OR NOT public.role_can_view_feature(NULL, 'accountant', 'expenses')
     OR NOT public.role_can_view_feature(NULL, 'accountant', 'sales_history')
     OR NOT public.role_can_view_feature(NULL, 'accountant', 'reports')
     OR NOT public.role_can_view_feature(NULL, 'accountant', 'view_purchase_cost')
     OR public.role_can_view_feature(NULL, 'accountant', 'new_sale')
     OR public.role_can_view_feature(NULL, 'accountant', 'caisse')
     OR public.role_can_view_feature('{"accountant": {"new_sale": true, "caisse": true, "inventory_count": true}}', 'accountant', 'new_sale')
     OR public.role_can_view_feature('{"accountant": {"new_sale": true, "caisse": true, "inventory_count": true}}', 'accountant', 'caisse')
     OR public.role_can_view_feature('{"accountant": {"new_sale": true, "caisse": true, "inventory_count": true}}', 'accountant', 'inventory_count')
     OR public.role_can_view_feature('{"accountant": {"expenses": false}}', 'accountant', 'expenses')
     OR public.role_can_view_feature('{"general": {"reports": false}}', 'accountant', 'reports') THEN
    RAISE EXCEPTION '214 : la règle ne donne pas les résultats attendus — annulé';
  END IF;

  RAISE NOTICE '214 : rôle Comptable (lecture seule) ajouté ; règle des droits et lecture des ventes mises à jour';
END $$;

NOTIFY pgrst, 'reload schema';

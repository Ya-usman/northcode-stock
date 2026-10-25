-- 184 — Étape D, point 2 (lot 2A) : la base applique AUSSI le droit « voir » du rôle, et plus seulement l'appartenance
-- à la boutique, pour les lectures directes du navigateur (authenticated).
--   expenses, expense_budgets : lisibles seulement dans les boutiques où le rôle a « Dépenses » en lecture.
--   stock_movements, stock_transfers, stock_transfer_items, sale_item_batches : plus aucune lecture directe
--     (aucun écran ne les lit depuis le navigateur ni ne les suit en temps réel ; tout passe par /api).
-- Écritures : inchangées (déjà refusées par la RLS, aucune règle d'écriture sur ces tables). service_role (serveur) :
-- inchangé, il contourne la RLS — toutes les routes lisent ces tables avec la clé de service (audit du 25 oct. 2026).
--
-- RÈGLE reproduite : resolvePermission(...).view de lib/permissions/index.ts (réglages shops.role_permissions, valeurs
-- par défaut par rôle, onglet « Général », Observateur sans action d'écriture), avec la décision 1 du 25 oct. 2026 :
-- le PROPRIÉTAIRE lit toujours les données de ses boutiques, même si une fonction est masquée dans « Général »
-- (l'application, elle, lui cache l'écran). Les constantes ci-dessous DOIVENT rester égales à lib/permissions :
-- tests/e2e/rls-feature-pure.mjs échoue sinon ; toute évolution des valeurs par défaut = nouvelle migration.
--
-- Décisions du 25 oct. 2026 pour la suite (lot 2B, migration à venir, après déplacement côté serveur des lectures du
-- tableau de bord et de la fiche boutique) : ventes, lignes, paiements, clients (clients aussi lisibles avec le droit
-- de vendre) ; produits, catégories et lots restent lisibles par les membres (coûts déjà protégés par la 182).
-- Retour arrière : supabase/rollbacks/184_d2_feature_read_rls_rollback.sql
-- Appliquée par « supabase db push » (transaction de la CLI) : pas de BEGIN / COMMIT dans ce fichier.

SET LOCAL lock_timeout = '5s';

-- Valeur de vérité d'un réglage stocké, comme « !!valeur » en JavaScript
CREATE FUNCTION public.perm_jsonb_truthy(v jsonb) RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path = pg_catalog, pg_temp AS $f$
  SELECT CASE jsonb_typeof(v)
    WHEN 'boolean' THEN v = 'true'::jsonb
    WHEN 'number' THEN (v #>> '{}')::numeric <> 0
    WHEN 'string' THEN (v #>> '{}') <> ''
    WHEN 'object' THEN true
    WHEN 'array' THEN true
    ELSE false
  END
$f$;

-- Droit « voir » d'un rôle sur une fonction, d'après les réglages d'une boutique (fonction pure, sans lecture)
CREATE FUNCTION public.role_can_view_feature(p_stored jsonb, p_role text, p_feature text) RETURNS boolean
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
  -- lib/permissions : VIEWER_LOCKED, GENERAL_EXEMPT
  viewer_locked CONSTANT text[] := ARRAY['new_sale', 'discount', 'delete_products', 'delete_expenses', 'inventory_count', 'extend_hours', 'caisse'];
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
  -- Observateur : jamais d'action d'écriture
  IF p_role = 'viewer' AND p_feature = ANY (viewer_locked) THEN RETURN false; END IF;
  RETURN coalesce(view, false);
END $f$;

-- Boutiques où l'utilisateur connecté (adhésion ACTIVE, comme is_shop_member) peut « voir » la fonction
CREATE FUNCTION public.shop_ids_with_feature(p_feature text) RETURNS SETOF uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $f$
  SELECT sm.shop_id
    FROM public.shop_members sm
    JOIN public.shops s ON s.id = sm.shop_id
   WHERE sm.user_id = auth.uid() AND sm.is_active = true
     AND public.role_can_view_feature(s.role_permissions, sm.role, p_feature)
$f$;

REVOKE ALL ON FUNCTION public.perm_jsonb_truthy(jsonb), public.role_can_view_feature(jsonb, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.shop_ids_with_feature(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.shop_ids_with_feature(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.perm_jsonb_truthy(jsonb), public.role_can_view_feature(jsonb, text, text), public.shop_ids_with_feature(text) TO service_role;

-- Dépenses et budgets : appartenance ET droit « Dépenses » (sous-requête non corrélée : évaluée une fois par requête)
DROP POLICY expenses_member_select ON public.expenses;
CREATE POLICY expenses_feature_select ON public.expenses FOR SELECT TO authenticated
  USING (shop_id IN (SELECT public.shop_ids_with_feature('expenses')));
DROP POLICY expense_budgets_member_select ON public.expense_budgets;
CREATE POLICY expense_budgets_feature_select ON public.expense_budgets FOR SELECT TO authenticated
  USING (shop_id IN (SELECT public.shop_ids_with_feature('expenses')));

-- Mouvements, transferts, affectations de lots : plus aucune lecture directe (RLS active, aucune règle de lecture)
DROP POLICY stock_movements_member_select ON public.stock_movements;
DROP POLICY stock_movements_select ON public.stock_movements;
DROP POLICY stock_transfers_select ON public.stock_transfers;
DROP POLICY stock_transfer_items_select ON public.stock_transfer_items;
DROP POLICY sale_item_batches_select ON public.sale_item_batches;

-- Garde-fou : état EFFECTIF attendu — sinon tout est annulé
DO $$
DECLARE bad text;
BEGIN
  -- RLS active partout
  SELECT string_agg(c.relname, ', ') INTO bad FROM pg_class c
   WHERE c.relnamespace = 'public'::regnamespace AND c.relkind = 'r' AND NOT c.relrowsecurity
     AND c.relname IN ('expenses', 'expense_budgets', 'stock_movements', 'stock_transfers', 'stock_transfer_items', 'sale_item_batches');
  IF bad IS NOT NULL THEN RAISE EXCEPTION '184 : RLS inactive sur % — annulé', bad; END IF;

  -- Plus aucune règle de lecture sur les 4 tables réservées au serveur
  SELECT string_agg(tablename || '.' || policyname, ', ') INTO bad FROM pg_policies
   WHERE schemaname = 'public' AND cmd IN ('SELECT', 'ALL')
     AND tablename IN ('stock_movements', 'stock_transfers', 'stock_transfer_items', 'sale_item_batches');
  IF bad IS NOT NULL THEN RAISE EXCEPTION '184 : règle de lecture restante : % — annulé', bad; END IF;

  -- Dépenses / budgets : UNE seule règle de lecture chacune, celle du droit
  SELECT string_agg(tablename || '.' || policyname, ', ') INTO bad FROM pg_policies
   WHERE schemaname = 'public' AND cmd IN ('SELECT', 'ALL') AND tablename IN ('expenses', 'expense_budgets')
     AND policyname NOT IN ('expenses_feature_select', 'expense_budgets_feature_select');
  IF bad IS NOT NULL THEN RAISE EXCEPTION '184 : autre règle de lecture sur les dépenses : % — annulé', bad; END IF;

  -- Droits d'exécution effectifs (PUBLIC et héritage compris)
  IF has_function_privilege('anon', 'public.shop_ids_with_feature(text)', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.shop_ids_with_feature(text)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.role_can_view_feature(jsonb, text, text)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.role_can_view_feature(jsonb, text, text)', 'EXECUTE') THEN
    RAISE EXCEPTION '184 : droits d''exécution inattendus sur les fonctions de droits — annulé';
  END IF;

  -- Contrôles de la règle (cas connus)
  IF public.role_can_view_feature(NULL, 'cashier', 'expenses')
     OR NOT public.role_can_view_feature(NULL, 'manager', 'expenses')
     OR NOT public.role_can_view_feature('{"general": {"expenses": false}}', 'owner', 'expenses')
     OR public.role_can_view_feature('{"general": {"expenses": false}}', 'manager', 'expenses')
     OR NOT public.role_can_view_feature('{"stock_manager": {"expenses": true}}', 'stock_manager', 'expenses')
     OR public.role_can_view_feature('{"manager": {"expenses": false}}', 'manager', 'expenses')
     OR public.role_can_view_feature('{"viewer": {"new_sale": true}}', 'viewer', 'new_sale')
     OR public.role_can_view_feature(NULL, 'inconnu', 'expenses') THEN
    RAISE EXCEPTION '184 : la règle ne donne pas les résultats attendus — annulé';
  END IF;

  RAISE NOTICE '184 : dépenses et budgets lus selon le droit « Dépenses » ; mouvements, transferts et affectations de lots réservés au serveur';
END $$;

NOTIFY pgrst, 'reload schema';

-- 209 — Historique par formule (tarification du 3 nov. 2026, lot B) : la base applique aux lectures DIRECTES du
-- navigateur (authenticated) la même durée que le serveur (lib/saas/plan-features, lot A) :
--   Starter : 3 derniers mois (now() - 93 jours) · Pro et essai : 1 an (now() - 367 jours) · Business, comptes internes
--   et clients actuels dont les anciennes conditions courent encore (entities.legacy_terms) : sans limite.
-- Jamais cachée, quelle que soit sa date :
--   • une vente encore due (balance > 0) — crédits ;
--   • une vente qui a reçu un paiement dans la période (remboursement d'aujourd'hui sur un vieux crédit : la caisse du
--     jour le montre) ;
--   • une dépense modèle (récurrente).
-- Paiements et lignes de vente suivent la vente (leurs règles lisent `sales` sous la RLS, inchangées).
-- Rien n'est effacé ; la clé de service (routes du serveur) n'est pas concernée par la RLS.
-- Conditions des règles d'avant reprises À L'IDENTIQUE (pg_policies du 3 nov. 2026, migrations 184 / 185), la durée
-- est AJOUTÉE (AND). Retour arrière : supabase/rollbacks/209_history_by_plan_rollback.sql
-- Appliquée par « supabase db push » (transaction de la CLI) : pas de BEGIN / COMMIT dans ce fichier.

SET LOCAL lock_timeout = '5s';

-- Instant le plus ancien lisible pour une boutique ; NULL = sans limite. Même règle que lib/saas/plan-features
-- (featuresFor + historyDays + historyFloor : 92 + 1 et 366 + 1 jours).
CREATE OR REPLACE FUNCTION public.shop_history_floor(p_shop uuid) RETURNS timestamptz
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $f$
DECLARE
  v_entity uuid; v_plan text; v_internal boolean; v_terms jsonb; v_until timestamptz;
BEGIN
  SELECT s.entity_id INTO v_entity FROM public.shops s WHERE s.id = p_shop;
  IF v_entity IS NULL THEN RETURN now() - interval '367 days'; END IF;  -- sans entreprise : comme l'essai
  SELECT coalesce(nullif(e.plan, ''), 'trial'), coalesce(e.is_internal, false), e.legacy_terms
    INTO v_plan, v_internal, v_terms FROM public.entities e WHERE e.id = v_entity;
  IF NOT FOUND THEN RETURN now() - interval '367 days'; END IF;
  IF v_internal THEN RETURN NULL; END IF;
  -- Anciennes conditions : même formule, date de fin encore à venir (date illisible = ignorée, jamais une erreur)
  IF v_terms IS NOT NULL AND v_terms->>'plan' = v_plan AND coalesce(v_terms->>'limits_until', '') ~ '^\d{4}-\d{2}-\d{2}' THEN
    BEGIN
      v_until := (v_terms->>'limits_until')::timestamptz;
    EXCEPTION WHEN others THEN v_until := NULL;
    END;
    IF v_until IS NOT NULL AND now() < v_until THEN RETURN NULL; END IF;
  END IF;
  IF v_plan = 'business' THEN RETURN NULL; END IF;
  IF v_plan = 'starter' THEN RETURN now() - interval '93 days'; END IF;
  RETURN now() - interval '367 days';  -- Pro, essai, formule inconnue
END
$f$;

-- Vente lisible au regard de la durée (les droits du rôle restent vérifiés par la règle elle-même)
CREATE OR REPLACE FUNCTION public.sale_in_history(p_sale uuid, p_shop uuid, p_created timestamptz, p_balance numeric) RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $f$
DECLARE v_floor timestamptz;
BEGIN
  -- Rapide : les 3 derniers mois sont lisibles par toutes les formules ; une vente encore due aussi
  IF p_created >= now() - interval '93 days' OR coalesce(p_balance, 0) > 0 THEN RETURN true; END IF;
  v_floor := public.shop_history_floor(p_shop);
  IF v_floor IS NULL OR p_created >= v_floor THEN RETURN true; END IF;
  -- Paiement reçu dans la période (lu ici sans RLS : pas de boucle ventes ↔ paiements)
  RETURN EXISTS (SELECT 1 FROM public.payments p WHERE p.sale_id = p_sale AND p.paid_at >= v_floor);
END
$f$;

-- Dépense lisible au regard de la durée (modèles récurrents toujours)
CREATE OR REPLACE FUNCTION public.expense_in_history(p_shop uuid, p_date date, p_recurring boolean) RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $f$
DECLARE v_floor timestamptz;
BEGIN
  IF coalesce(p_recurring, false) OR p_date >= (now() - interval '93 days')::date THEN RETURN true; END IF;
  v_floor := public.shop_history_floor(p_shop);
  RETURN v_floor IS NULL OR p_date >= v_floor::date;
END
$f$;

REVOKE ALL ON FUNCTION public.shop_history_floor(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.sale_in_history(uuid, uuid, timestamptz, numeric) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.expense_in_history(uuid, date, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.shop_history_floor(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.sale_in_history(uuid, uuid, timestamptz, numeric) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.expense_in_history(uuid, date, boolean) TO authenticated, service_role;

-- ── Ventes : règles de la 185 + durée ───────────────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS sales_read_all ON public.sales;
DROP POLICY IF EXISTS sales_read_own ON public.sales;
CREATE POLICY sales_read_all ON public.sales FOR SELECT TO authenticated
  USING (shop_id IN (SELECT public.shop_ids_with_any_feature(ARRAY['sales_history', 'caisse'], ARRAY['owner', 'manager', 'shop_manager', 'viewer']))
         AND public.sale_in_history(id, shop_id, created_at, balance));
CREATE POLICY sales_read_own ON public.sales FOR SELECT TO authenticated
  USING (cashier_id = auth.uid() AND shop_id IN (SELECT public.shop_ids_with_any_feature(ARRAY['new_sale', 'sales_history', 'caisse']))
         AND public.sale_in_history(id, shop_id, created_at, balance));

-- ── Dépenses : règle de la 184 + durée ──────────────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS expenses_feature_select ON public.expenses;
CREATE POLICY expenses_feature_select ON public.expenses FOR SELECT TO authenticated
  USING (shop_id IN (SELECT public.shop_ids_with_feature('expenses')) AND public.expense_in_history(shop_id, date, is_recurring));

-- Garde-fou : état EFFECTIF attendu — sinon tout est annulé
DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM pg_policies
   WHERE schemaname = 'public' AND cmd = 'SELECT' AND (
     (tablename = 'sales' AND policyname IN ('sales_read_all', 'sales_read_own') AND qual LIKE '%sale_in_history%')
     OR (tablename = 'expenses' AND policyname = 'expenses_feature_select' AND qual LIKE '%expense_in_history%'));
  IF n <> 3 THEN RAISE EXCEPTION '209 : règles de lecture attendues absentes (% sur 3)', n; END IF;
  SELECT count(*) INTO n FROM pg_policies WHERE schemaname = 'public' AND tablename IN ('sales', 'expenses') AND cmd IN ('SELECT', 'ALL');
  IF n <> 3 THEN RAISE EXCEPTION '209 : règles de lecture inattendues sur sales / expenses (% au lieu de 3)', n; END IF;
END $$;

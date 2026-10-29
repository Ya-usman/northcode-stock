-- 185 — Étape D, point 2 (lot 2B, B2) : ventes, lignes de vente, paiements, clients et réservations de stock lus par
-- le navigateur (authenticated) selon le DROIT du rôle, et plus seulement selon l'appartenance à la boutique.
-- Préalable déployé : B1 (a32fa01, 26 oct. 2026) — tableau de bord, fiche boutique, Catégories, journal produit et
-- fusion de clients lisent ces tables par le serveur (clé de service, non concernée par la RLS).
--
-- Règles validées le 25 oct. 2026 (décisions 1 à 3 + plan du lot 2B) et le 26 oct. (option 1) :
--   sales              • TOUTES les ventes de la boutique : propriétaire, Manager, Responsable, Observateur, avec
--                        « Historique des ventes » OU « Contrôle de caisse » ;
--                      • ses PROPRES ventes (cashier_id = soi) : avec « Vendre », « Historique » OU « Contrôle de
--                        caisse » — caissier et magasinier n'ont JAMAIS plus que les leurs (comme avant) ;
--   payments           paiement d'une vente lisible ci-dessus, avec « Historique » OU « Contrôle de caisse » ;
--   sale_items         ligne d'une vente lisible ci-dessus, avec « Historique » OU « Vendre » ;
--   customers          fiches non supprimées, avec « Clients », « Vendre », « Historique » OU « Crédits » ;
--   stock_reservations avec « Stock » OU « Vendre ».
-- Le propriétaire lit toujours (décision 1). Droit « voir » = role_can_view_feature (184, constantes contrôlées par
-- tests/e2e/rls-feature-pure.mjs). Écritures : inchangées (aucune règle d'écriture sur ces tables).
-- Temps réel : ventes et paiements sont diffusés ; un événement n'est plus livré à qui ne peut pas le lire (décision 3
-- du lot 2B : sans droit sur les ventes, le tableau de bord se rafraîchit au retour sur la page).
-- Mesure préalable (supabase/drafts/185_impact_from_prod.js, 26 oct.) : 44 adhésions, 3 perdent une lecture directe,
-- aucun écran auquel elles ont droit n'est concerné, 0 gain.
-- Retour arrière : supabase/rollbacks/185_d2_sales_read_rls_rollback.sql
-- Appliquée par « supabase db push » (transaction de la CLI) : pas de BEGIN / COMMIT dans ce fichier.

SET LOCAL lock_timeout = '5s';

-- Boutiques où l'utilisateur connecté (adhésion ACTIVE) peut « voir » AU MOINS UNE des fonctions, éventuellement
-- limitées à certains rôles (p_roles NULL = tous les rôles)
CREATE FUNCTION public.shop_ids_with_any_feature(p_features text[], p_roles text[] DEFAULT NULL) RETURNS SETOF uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $f$
  SELECT sm.shop_id
    FROM public.shop_members sm
    JOIN public.shops s ON s.id = sm.shop_id
   WHERE sm.user_id = auth.uid() AND sm.is_active = true
     AND (p_roles IS NULL OR sm.role = ANY (p_roles))
     AND EXISTS (SELECT 1 FROM unnest(p_features) f WHERE public.role_can_view_feature(s.role_permissions, sm.role, f))
$f$;

REVOKE ALL ON FUNCTION public.shop_ids_with_any_feature(text[], text[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.shop_ids_with_any_feature(text[], text[]) TO authenticated, service_role;

-- ── Ventes ──────────────────────────────────────────────────────────────────────────────────────────────────────
DROP POLICY sales_owner_all_read ON public.sales;
DROP POLICY sales_viewer_select ON public.sales;
DROP POLICY sales_cashier_own ON public.sales;
DROP POLICY sales_stock_manager_own ON public.sales;
CREATE POLICY sales_read_all ON public.sales FOR SELECT TO authenticated
  USING (shop_id IN (SELECT public.shop_ids_with_any_feature(ARRAY['sales_history', 'caisse'], ARRAY['owner', 'manager', 'shop_manager', 'viewer'])));
CREATE POLICY sales_read_own ON public.sales FOR SELECT TO authenticated
  USING (cashier_id = auth.uid() AND shop_id IN (SELECT public.shop_ids_with_any_feature(ARRAY['new_sale', 'sales_history', 'caisse'])));

-- ── Paiements : ceux d'une vente lisible (la RLS des ventes s'applique dans la sous-requête) ─────────────────────
DROP POLICY payments_member_select ON public.payments;
DROP POLICY payments_owner_all_read ON public.payments;
CREATE POLICY payments_read ON public.payments FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.sales s WHERE s.id = payments.sale_id
                 AND s.shop_id IN (SELECT public.shop_ids_with_any_feature(ARRAY['sales_history', 'caisse']))));

-- ── Lignes de vente : celles d'une vente lisible ────────────────────────────────────────────────────────────────
DROP POLICY sale_items_member_select ON public.sale_items;
DROP POLICY sale_items_owner_all_read ON public.sale_items;
DROP POLICY sale_items_owner_write_read ON public.sale_items;
CREATE POLICY sale_items_read ON public.sale_items FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.sales s WHERE s.id = sale_items.sale_id
                 AND s.shop_id IN (SELECT public.shop_ids_with_any_feature(ARRAY['sales_history', 'new_sale']))));

-- ── Clients (fiches non supprimées) ─────────────────────────────────────────────────────────────────────────────
DROP POLICY customers_shop_select ON public.customers;
CREATE POLICY customers_read ON public.customers FOR SELECT TO authenticated
  USING (deleted_at IS NULL AND shop_id IN (SELECT public.shop_ids_with_any_feature(ARRAY['customers', 'new_sale', 'sales_history', 'payments'])));

-- ── Réservations de stock ───────────────────────────────────────────────────────────────────────────────────────
DROP POLICY stock_reservations_select ON public.stock_reservations;
CREATE POLICY stock_reservations_read ON public.stock_reservations FOR SELECT TO authenticated
  USING (shop_id IN (SELECT public.shop_ids_with_any_feature(ARRAY['stock', 'new_sale'])));

-- Garde-fou : état EFFECTIF attendu — sinon tout est annulé
DO $$
DECLARE bad text;
BEGIN
  SELECT string_agg(c.relname, ', ') INTO bad FROM pg_class c
   WHERE c.relnamespace = 'public'::regnamespace AND c.relkind = 'r' AND NOT c.relrowsecurity
     AND c.relname IN ('sales', 'payments', 'sale_items', 'customers', 'stock_reservations');
  IF bad IS NOT NULL THEN RAISE EXCEPTION '185 : RLS inactive sur % — annulé', bad; END IF;

  -- Exactement les nouvelles règles de lecture, aucune autre
  SELECT string_agg(tablename || '.' || policyname, ', ') INTO bad FROM pg_policies
   WHERE schemaname = 'public' AND cmd IN ('SELECT', 'ALL')
     AND tablename IN ('sales', 'payments', 'sale_items', 'customers', 'stock_reservations')
     AND policyname NOT IN ('sales_read_all', 'sales_read_own', 'payments_read', 'sale_items_read', 'customers_read', 'stock_reservations_read');
  IF bad IS NOT NULL THEN RAISE EXCEPTION '185 : autre règle de lecture restante : % — annulé', bad; END IF;
  IF (SELECT count(*) FROM pg_policies WHERE schemaname = 'public' AND policyname IN
       ('sales_read_all', 'sales_read_own', 'payments_read', 'sale_items_read', 'customers_read', 'stock_reservations_read')) <> 6 THEN
    RAISE EXCEPTION '185 : règles de lecture attendues absentes — annulé';
  END IF;

  -- Aucune règle d'écriture n'est apparue sur ces tables (toutes les écritures passent par le serveur)
  SELECT string_agg(tablename || '.' || policyname, ', ') INTO bad FROM pg_policies
   WHERE schemaname = 'public' AND cmd IN ('INSERT', 'UPDATE', 'DELETE')
     AND tablename IN ('sales', 'payments', 'sale_items', 'customers', 'stock_reservations');
  IF bad IS NOT NULL THEN RAISE EXCEPTION '185 : règle d''écriture inattendue : % — annulé', bad; END IF;

  IF has_function_privilege('anon', 'public.shop_ids_with_any_feature(text[], text[])', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.shop_ids_with_any_feature(text[], text[])', 'EXECUTE') THEN
    RAISE EXCEPTION '185 : droits d''exécution inattendus sur shop_ids_with_any_feature — annulé';
  END IF;

  RAISE NOTICE '185 : ventes, paiements, lignes de vente, clients et réservations lus selon le droit du rôle';
END $$;

NOTIFY pgrst, 'reload schema';

-- 183 — Étape C3 du « prix d'achat protégé » : les DETTES fournisseurs réservées au serveur (service_role).
--   suppliers         : lisible par le navigateur (authenticated) SAUF total_owed (solde dû) ; anon : rien.
--   purchase_orders   : plus aucune lecture directe (anon / authenticated) — montants, payé, solde, statut.
--   supplier_payments : plus aucune lecture directe (anon / authenticated).
-- Le serveur lit tout et applique les règles (lib/api/supplier-access) : voir une dette = Crédits + Fournisseurs en
-- lecture (canViewSupplierDebt), payer = Crédits en modification + Fournisseurs en lecture (canPaySupplierDebt).
--
-- Pourquoi par colonne pour suppliers : un REVOKE de colonne est sans effet tant que le droit de TABLE existe. On retire
-- le SELECT de table, puis on redonne explicitement chaque colonne permise. Rien d'autre ne change : écritures (déjà
-- refusées par la RLS : aucune règle d'écriture sur ces tables depuis la 160), règles RLS de lecture, fonctions et
-- déclencheur (SECURITY DEFINER), service_role. Aucune de ces tables n'est diffusée en temps réel.
-- La règle RLS de purchase_order_items lit purchase_orders : sans effet, purchase_order_items est déjà réservée au
-- serveur (173).
--
-- RÈGLE « fail-closed » : toute colonne AJOUTÉE plus tard à suppliers est illisible par le navigateur tant que sa
-- migration ne lui donne pas « GRANT SELECT (colonne) ON public.suppliers TO authenticated » (lib/suppliers/columns.ts).
--
-- Audit préalable (25 oct. 2026, lecture seule) : navigateur = suppliers avec la liste fixe sans total_owed, ou
-- suppliers(name) imbriqué ; aucune lecture navigateur de purchase_orders / supplier_payments ; toutes les routes
-- serveur lisent ces tables avec la clé de service ; aucune lecture anonyme réelle (préliminaires CORS seulement).
-- Retour arrière : supabase/rollbacks/183_c3_supplier_debts_server_only_rollback.sql
-- Appliquée par « supabase db push » (transaction de la CLI) : pas de BEGIN / COMMIT dans ce fichier.

SET LOCAL lock_timeout = '5s';

REVOKE SELECT ON public.suppliers, public.purchase_orders, public.supplier_payments FROM anon, authenticated;

GRANT SELECT (id, shop_id, name, phone, city, created_at, deleted_at, email) ON public.suppliers TO authenticated;

-- Garde-fou : droits EFFECTIFS (PUBLIC, héritage et rôles membres compris) — sinon tout est annulé.
DO $$
DECLARE bad text;
BEGIN
  -- suppliers : authenticated lit chaque colonne sauf total_owed ; anon aucune
  SELECT string_agg(c.column_name, ', ' ORDER BY c.column_name) INTO bad
    FROM information_schema.columns c
   WHERE c.table_schema = 'public' AND c.table_name = 'suppliers'
     AND (has_column_privilege('authenticated', 'public.suppliers', c.column_name, 'SELECT') IS DISTINCT FROM (c.column_name <> 'total_owed')
          OR has_column_privilege('anon', 'public.suppliers', c.column_name, 'SELECT'));
  IF bad IS NOT NULL THEN RAISE EXCEPTION '183 : droits de colonne inattendus sur suppliers (%) — annulé', bad; END IF;

  -- purchase_orders, supplier_payments : aucune colonne lisible par anon / authenticated
  SELECT string_agg(r || ' ' || t, ', ') INTO bad
    FROM unnest(ARRAY['authenticated', 'anon']) r, unnest(ARRAY['public.purchase_orders', 'public.supplier_payments']) t
   WHERE has_any_column_privilege(r, t, 'SELECT');
  IF bad IS NOT NULL THEN RAISE EXCEPTION '183 : lecture encore possible : % — annulé', bad; END IF;

  -- Aucun SELECT de TABLE pour authenticated / anon sur suppliers (il contournerait le contrôle par colonne)
  SELECT string_agg(r, ', ') INTO bad FROM unnest(ARRAY['authenticated', 'anon']) r WHERE has_table_privilege(r, 'public.suppliers', 'SELECT');
  IF bad IS NOT NULL THEN RAISE EXCEPTION '183 : SELECT de table encore accordé sur suppliers à % — annulé', bad; END IF;

  -- Le serveur garde tout
  SELECT string_agg(t, ', ') INTO bad
    FROM unnest(ARRAY['public.suppliers', 'public.purchase_orders', 'public.supplier_payments']) t
   WHERE NOT has_table_privilege('service_role', t, 'SELECT');
  IF bad IS NOT NULL OR NOT has_column_privilege('service_role', 'public.suppliers', 'total_owed', 'SELECT') THEN
    RAISE EXCEPTION '183 : service_role a perdu une lecture (%) — annulé', coalesce(bad, 'suppliers.total_owed');
  END IF;

  RAISE NOTICE '183 : dettes fournisseurs réservées au serveur (suppliers.total_owed, purchase_orders, supplier_payments)';
END $$;

NOTIFY pgrst, 'reload schema';

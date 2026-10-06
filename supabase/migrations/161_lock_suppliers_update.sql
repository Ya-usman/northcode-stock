-- ============================================================
-- 161 — Complément de la 160 : modification des fournisseurs
--
-- L'export pg_policies du 5 oct. ayant servi à générer la 160 était tronqué
-- à 100 lignes par l'éditeur SQL : la règle « suppliers_write_update »
-- (migration 081) n'y figurait pas et est restée en place. Le navigateur
-- pouvait donc encore modifier directement un fournisseur. L'application
-- passe par le serveur (/api/suppliers) : la règle est retirée.
--
-- Lecture inchangée (suppliers_member_select et suppliers_shop_select
-- conservées). Aucune donnée modifiée. Ré-exécutable.
--
-- Retour arrière :
--   CREATE POLICY suppliers_write_update ON suppliers FOR UPDATE
--     USING (is_shop_member(shop_id) AND get_role_in_shop(shop_id) IN ('owner', 'manager', 'shop_manager', 'stock_manager'))
--     WITH CHECK (is_shop_member(shop_id) AND get_role_in_shop(shop_id) IN ('owner', 'manager', 'shop_manager', 'stock_manager'));
-- ============================================================

DROP POLICY IF EXISTS suppliers_write_update ON suppliers;

NOTIFY pgrst, 'reload schema';

-- ── Vérification après exécution ───────────────────────────────────────────
-- SELECT tablename, policyname, cmd FROM pg_policies WHERE schemaname = 'public' AND cmd <> 'SELECT' ORDER BY 1, 2;
-- Attendu (6 lignes) : admin_notifications notifs_owner_mark_read UPDATE ; notes notes_delete / notes_insert /
-- notes_update ; profiles profiles_update_own UPDATE ; push_subscriptions push_sub_own ALL

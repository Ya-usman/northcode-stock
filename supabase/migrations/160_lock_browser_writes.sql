-- ============================================================
-- 160 — Plus d'écriture directe du navigateur en base (lot 4 permissions)
--
-- Les lots 1 à 3 font passer toutes les écritures métier par le serveur
-- (routes /api, contrôles de droits et de prix, journal d'audit). Les règles
-- RLS qui autorisaient encore le navigateur à écrire directement (ventes,
-- paiements, produits, stock, clients, dépenses, équipe…) ne servent plus
-- qu'à contourner ces contrôles : elles sont retirées.
--
-- Généré depuis l'export pg_policies du 5 oct. 2026 (aucune condition
-- recopiée à la main). Retour arrière : 160_rollback (scratchpad, recrée à
-- l'identique les 58 règles retirées).
--
-- Conservé (écritures navigateur légitimes, inventaire du code du 6 oct.) :
--   profiles_update_own (son profil ; colonnes sensibles verrouillées, 154/155),
--   notes_* (page Notes), notifs_owner_mark_read (case « lu » seulement — voir
--   le verrou ci-dessous), push_sub_own (ses abonnements aux notifications).
-- Lecture : INCHANGÉE. Chaque règle « ALL » retirée est remplacée par une
-- règle de LECTURE de même condition (13 au total).
-- Aucune donnée modifiée. Ré-exécutable.
-- ============================================================

-- admin_notifications
DROP POLICY IF EXISTS "notifs_super_admin_all" ON public."admin_notifications";  -- ALL
DROP POLICY IF EXISTS "notifs_super_admin_all_read" ON public."admin_notifications";
CREATE POLICY "notifs_super_admin_all_read" ON public."admin_notifications" AS PERMISSIVE FOR SELECT TO public USING (is_super_admin());

-- agent_commissions
DROP POLICY IF EXISTS "agent_commissions_service_role" ON public."agent_commissions";  -- ALL

-- agents
DROP POLICY IF EXISTS "agents_service_role" ON public."agents";  -- ALL

-- audit_logs
DROP POLICY IF EXISTS "audit_super_admin" ON public."audit_logs";  -- ALL
DROP POLICY IF EXISTS "audit_super_admin_read" ON public."audit_logs";
CREATE POLICY "audit_super_admin_read" ON public."audit_logs" AS PERMISSIVE FOR SELECT TO public USING ((EXISTS ( SELECT 1
   FROM profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.role = 'super_admin'::text)))));

-- categories
DROP POLICY IF EXISTS "categories_member_all" ON public."categories";  -- ALL
DROP POLICY IF EXISTS "categories_member_all_read" ON public."categories";
CREATE POLICY "categories_member_all_read" ON public."categories" AS PERMISSIVE FOR SELECT TO public USING (is_shop_member(shop_id));

-- customers
DROP POLICY IF EXISTS "customers_member_insert" ON public."customers";  -- INSERT
DROP POLICY IF EXISTS "customers_owner_delete_v2" ON public."customers";  -- DELETE
DROP POLICY IF EXISTS "customers_owner_update_v2" ON public."customers";  -- UPDATE

-- deleted_records_log
DROP POLICY IF EXISTS "deleted_log_super_admin" ON public."deleted_records_log";  -- ALL
DROP POLICY IF EXISTS "deleted_log_super_admin_read" ON public."deleted_records_log";
CREATE POLICY "deleted_log_super_admin_read" ON public."deleted_records_log" AS PERMISSIVE FOR SELECT TO public USING (is_super_admin());

-- entities
DROP POLICY IF EXISTS "entities_super_admin" ON public."entities";  -- ALL
DROP POLICY IF EXISTS "entities_super_admin_read" ON public."entities";
CREATE POLICY "entities_super_admin_read" ON public."entities" AS PERMISSIVE FOR SELECT TO public USING (is_super_admin());

-- expense_budgets
DROP POLICY IF EXISTS "expense_budgets_member_insert" ON public."expense_budgets";  -- INSERT
DROP POLICY IF EXISTS "expense_budgets_owner_delete" ON public."expense_budgets";  -- DELETE
DROP POLICY IF EXISTS "expense_budgets_owner_modify" ON public."expense_budgets";  -- UPDATE

-- expenses
DROP POLICY IF EXISTS "expenses_member_insert" ON public."expenses";  -- INSERT
DROP POLICY IF EXISTS "expenses_owner_delete" ON public."expenses";  -- DELETE
DROP POLICY IF EXISTS "expenses_owner_modify" ON public."expenses";  -- UPDATE

-- payments
DROP POLICY IF EXISTS "payments_member_write" ON public."payments";  -- INSERT
DROP POLICY IF EXISTS "payments_owner_all" ON public."payments";  -- ALL
DROP POLICY IF EXISTS "payments_owner_all_read" ON public."payments";
CREATE POLICY "payments_owner_all_read" ON public."payments" AS PERMISSIVE FOR SELECT TO public USING ((EXISTS ( SELECT 1
   FROM sales s
  WHERE ((s.id = payments.sale_id) AND is_shop_member(s.shop_id) AND (get_role_in_shop(s.shop_id) = ANY (ARRAY['owner'::text, 'manager'::text, 'shop_manager'::text]))))));

-- product_batches
DROP POLICY IF EXISTS "product_batches_delete" ON public."product_batches";  -- DELETE
DROP POLICY IF EXISTS "product_batches_insert" ON public."product_batches";  -- INSERT
DROP POLICY IF EXISTS "product_batches_update" ON public."product_batches";  -- UPDATE

-- product_supplier_prices
DROP POLICY IF EXISTS "product_supplier_prices_delete" ON public."product_supplier_prices";  -- DELETE
DROP POLICY IF EXISTS "product_supplier_prices_insert" ON public."product_supplier_prices";  -- INSERT
DROP POLICY IF EXISTS "product_supplier_prices_update" ON public."product_supplier_prices";  -- UPDATE

-- products
DROP POLICY IF EXISTS "products_member_update" ON public."products";  -- UPDATE
DROP POLICY IF EXISTS "products_member_write" ON public."products";  -- INSERT
DROP POLICY IF EXISTS "products_owner_delete" ON public."products";  -- DELETE
DROP POLICY IF EXISTS "products_owner_insert" ON public."products";  -- INSERT
DROP POLICY IF EXISTS "products_owner_update" ON public."products";  -- UPDATE

-- profiles
DROP POLICY IF EXISTS "profiles_insert" ON public."profiles";  -- INSERT
DROP POLICY IF EXISTS "profiles_owner_manage" ON public."profiles";  -- ALL
DROP POLICY IF EXISTS "profiles_owner_manage_read" ON public."profiles";
CREATE POLICY "profiles_owner_manage_read" ON public."profiles" AS PERMISSIVE FOR SELECT TO public USING ((get_role_in_shop(shop_id) = 'owner'::text));

-- purchase_order_items
DROP POLICY IF EXISTS "purchase_order_items_delete" ON public."purchase_order_items";  -- DELETE
DROP POLICY IF EXISTS "purchase_order_items_insert" ON public."purchase_order_items";  -- INSERT
DROP POLICY IF EXISTS "purchase_order_items_update" ON public."purchase_order_items";  -- UPDATE

-- purchase_orders
DROP POLICY IF EXISTS "purchase_orders_delete" ON public."purchase_orders";  -- DELETE
DROP POLICY IF EXISTS "purchase_orders_insert" ON public."purchase_orders";  -- INSERT
DROP POLICY IF EXISTS "purchase_orders_update" ON public."purchase_orders";  -- UPDATE

-- sale_item_batches
DROP POLICY IF EXISTS "sale_item_batches_delete" ON public."sale_item_batches";  -- DELETE
DROP POLICY IF EXISTS "sale_item_batches_insert" ON public."sale_item_batches";  -- INSERT

-- sale_items
DROP POLICY IF EXISTS "sale_items_member_write" ON public."sale_items";  -- INSERT
DROP POLICY IF EXISTS "sale_items_owner_all" ON public."sale_items";  -- ALL
DROP POLICY IF EXISTS "sale_items_owner_write" ON public."sale_items";  -- ALL
DROP POLICY IF EXISTS "sale_items_owner_all_read" ON public."sale_items";
CREATE POLICY "sale_items_owner_all_read" ON public."sale_items" AS PERMISSIVE FOR SELECT TO public USING ((EXISTS ( SELECT 1
   FROM sales s
  WHERE ((s.id = sale_items.sale_id) AND is_shop_member(s.shop_id) AND (get_role_in_shop(s.shop_id) = ANY (ARRAY['owner'::text, 'manager'::text, 'shop_manager'::text]))))));
DROP POLICY IF EXISTS "sale_items_owner_write_read" ON public."sale_items";
CREATE POLICY "sale_items_owner_write_read" ON public."sale_items" AS PERMISSIVE FOR SELECT TO public USING ((EXISTS ( SELECT 1
   FROM sales s
  WHERE ((s.id = sale_items.sale_id) AND (get_role_in_shop(s.shop_id) = 'owner'::text)))));

-- sales
DROP POLICY IF EXISTS "cashier_cancel_own_sale" ON public."sales";  -- UPDATE
DROP POLICY IF EXISTS "sales_member_insert" ON public."sales";  -- INSERT
DROP POLICY IF EXISTS "sales_owner_all" ON public."sales";  -- ALL
DROP POLICY IF EXISTS "sales_owner_all_read" ON public."sales";
CREATE POLICY "sales_owner_all_read" ON public."sales" AS PERMISSIVE FOR SELECT TO public USING ((is_shop_member(shop_id) AND (get_role_in_shop(shop_id) = ANY (ARRAY['owner'::text, 'manager'::text, 'shop_manager'::text]))));

-- shop_members
DROP POLICY IF EXISTS "shop_members_manager_update_subordinates" ON public."shop_members";  -- UPDATE
DROP POLICY IF EXISTS "shop_members_owner_manage" ON public."shop_members";  -- ALL
DROP POLICY IF EXISTS "shop_members_self_delete" ON public."shop_members";  -- DELETE
DROP POLICY IF EXISTS "shop_members_owner_manage_read" ON public."shop_members";
CREATE POLICY "shop_members_owner_manage_read" ON public."shop_members" AS PERMISSIVE FOR SELECT TO public USING ((get_role_in_shop(shop_id) = 'owner'::text));

-- shop_notes
DROP POLICY IF EXISTS "notes_super_admin_all" ON public."shop_notes";  -- ALL
DROP POLICY IF EXISTS "notes_super_admin_all_read" ON public."shop_notes";
CREATE POLICY "notes_super_admin_all_read" ON public."shop_notes" AS PERMISSIVE FOR SELECT TO public USING (is_super_admin());

-- shops
DROP POLICY IF EXISTS "shops_no_hard_delete" ON public."shops";  -- DELETE
DROP POLICY IF EXISTS "shops_owner_insert" ON public."shops";  -- INSERT
DROP POLICY IF EXISTS "shops_owner_update" ON public."shops";  -- UPDATE
DROP POLICY IF EXISTS "shops_super_admin_all" ON public."shops";  -- ALL
DROP POLICY IF EXISTS "shops_super_admin_all_read" ON public."shops";
CREATE POLICY "shops_super_admin_all_read" ON public."shops" AS PERMISSIVE FOR SELECT TO public USING (is_super_admin());

-- stock_movements
DROP POLICY IF EXISTS "stock_movements_member_insert" ON public."stock_movements";  -- INSERT
DROP POLICY IF EXISTS "stock_movements_owner_delete" ON public."stock_movements";  -- DELETE
DROP POLICY IF EXISTS "stock_movements_owner_modify" ON public."stock_movements";  -- UPDATE

-- supplier_payments
DROP POLICY IF EXISTS "supplier_payments_insert" ON public."supplier_payments";  -- INSERT

-- suppliers
DROP POLICY IF EXISTS "suppliers_member_insert" ON public."suppliers";  -- INSERT

-- Notifications de l'équipe StockShop : depuis le navigateur, seule la case
-- « lu » peut changer (ni création, ni suppression, ni réécriture du texte).
DROP TRIGGER IF EXISTS trg_admin_notifications_guard ON admin_notifications;
CREATE TRIGGER trg_admin_notifications_guard BEFORE INSERT OR UPDATE OR DELETE ON admin_notifications
  FOR EACH ROW EXECUTE FUNCTION guard_server_only_columns('id', 'shop_id', 'type', 'title', 'message', 'created_at');

NOTIFY pgrst, 'reload schema';

-- ── Vérification après exécution ───────────────────────────────────────────
-- SELECT tablename, policyname, cmd FROM pg_policies WHERE schemaname = 'public' AND cmd <> 'SELECT' ORDER BY 1, 2;
-- Attendu (6 lignes) : admin_notifications notifs_owner_mark_read UPDATE ; notes notes_delete / notes_insert /
-- notes_update ; profiles profiles_update_own UPDATE ; push_subscriptions push_sub_own ALL

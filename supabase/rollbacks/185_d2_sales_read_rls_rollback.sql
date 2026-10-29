-- Retour arrière de 185_d2_sales_read_rls.sql — immédiat, sans redéploiement, à lancer seulement sur décision
-- explicite (éditeur SQL en urgence). Rétablit EXACTEMENT les règles de lecture d'avant (pg_policies du 29 oct. 2026)
-- et retire la fonction ajoutée. Ne touche pas supabase_migrations : enregistrer ensuite l'état
-- (« supabase migration repair --status reverted 185 », ou une nouvelle migration) sur décision.
BEGIN;
SET LOCAL lock_timeout = '5s';

DROP POLICY IF EXISTS sales_read_all ON public.sales;
DROP POLICY IF EXISTS sales_read_own ON public.sales;
DROP POLICY IF EXISTS payments_read ON public.payments;
DROP POLICY IF EXISTS sale_items_read ON public.sale_items;
DROP POLICY IF EXISTS customers_read ON public.customers;
DROP POLICY IF EXISTS stock_reservations_read ON public.stock_reservations;

CREATE POLICY sales_owner_all_read ON public.sales FOR SELECT
  USING (is_shop_member(shop_id) AND get_role_in_shop(shop_id) = ANY (ARRAY['owner'::text, 'manager'::text, 'shop_manager'::text]));
CREATE POLICY sales_viewer_select ON public.sales FOR SELECT
  USING (is_shop_member(shop_id) AND get_role_in_shop(shop_id) = 'viewer'::text);
CREATE POLICY sales_cashier_own ON public.sales FOR SELECT
  USING (is_shop_member(shop_id) AND get_role_in_shop(shop_id) = 'cashier'::text AND cashier_id = auth.uid());
CREATE POLICY sales_stock_manager_own ON public.sales FOR SELECT
  USING (is_shop_member(shop_id) AND get_role_in_shop(shop_id) = 'stock_manager'::text AND cashier_id = auth.uid());

CREATE POLICY payments_member_select ON public.payments FOR SELECT
  USING (EXISTS (SELECT 1 FROM sales s WHERE s.id = payments.sale_id AND is_shop_member(s.shop_id)));
CREATE POLICY payments_owner_all_read ON public.payments FOR SELECT
  USING (EXISTS (SELECT 1 FROM sales s WHERE s.id = payments.sale_id AND is_shop_member(s.shop_id)
                 AND get_role_in_shop(s.shop_id) = ANY (ARRAY['owner'::text, 'manager'::text, 'shop_manager'::text])));

CREATE POLICY sale_items_member_select ON public.sale_items FOR SELECT
  USING (EXISTS (SELECT 1 FROM sales s WHERE s.id = sale_items.sale_id AND is_shop_member(s.shop_id)));
CREATE POLICY sale_items_owner_all_read ON public.sale_items FOR SELECT
  USING (EXISTS (SELECT 1 FROM sales s WHERE s.id = sale_items.sale_id AND is_shop_member(s.shop_id)
                 AND get_role_in_shop(s.shop_id) = ANY (ARRAY['owner'::text, 'manager'::text, 'shop_manager'::text])));
CREATE POLICY sale_items_owner_write_read ON public.sale_items FOR SELECT
  USING (EXISTS (SELECT 1 FROM sales s WHERE s.id = sale_items.sale_id AND get_role_in_shop(s.shop_id) = 'owner'::text));

CREATE POLICY customers_shop_select ON public.customers FOR SELECT
  USING (is_shop_member(shop_id) AND deleted_at IS NULL);

CREATE POLICY stock_reservations_select ON public.stock_reservations FOR SELECT
  USING (is_shop_member(shop_id));

DROP FUNCTION IF EXISTS public.shop_ids_with_any_feature(text[], text[]);

NOTIFY pgrst, 'reload schema';
COMMIT;

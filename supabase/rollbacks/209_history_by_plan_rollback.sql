-- Retour arrière de la 209 (historique par formule dans la base) : remet les règles de lecture de la 185 (ventes) et
-- de la 184 (dépenses) À L'IDENTIQUE, puis retire les fonctions. Aucune donnée touchée.
SET LOCAL lock_timeout = '5s';
DROP POLICY IF EXISTS sales_read_all ON public.sales;
DROP POLICY IF EXISTS sales_read_own ON public.sales;
CREATE POLICY sales_read_all ON public.sales FOR SELECT TO authenticated
  USING (shop_id IN (SELECT public.shop_ids_with_any_feature(ARRAY['sales_history', 'caisse'], ARRAY['owner', 'manager', 'shop_manager', 'viewer'])));
CREATE POLICY sales_read_own ON public.sales FOR SELECT TO authenticated
  USING (cashier_id = auth.uid() AND shop_id IN (SELECT public.shop_ids_with_any_feature(ARRAY['new_sale', 'sales_history', 'caisse'])));
DROP POLICY IF EXISTS expenses_feature_select ON public.expenses;
CREATE POLICY expenses_feature_select ON public.expenses FOR SELECT TO authenticated
  USING (shop_id IN (SELECT public.shop_ids_with_feature('expenses')));
DROP FUNCTION IF EXISTS public.sale_in_history(uuid, uuid, timestamptz, numeric);
DROP FUNCTION IF EXISTS public.expense_in_history(uuid, date, boolean);
DROP FUNCTION IF EXISTS public.shop_history_floor(uuid);

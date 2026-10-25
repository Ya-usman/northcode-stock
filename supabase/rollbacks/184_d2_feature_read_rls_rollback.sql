-- Retour arrière de 184_d2_feature_read_rls.sql — immédiat, sans redéploiement, à lancer seulement sur décision
-- explicite (éditeur SQL en urgence). Rétablit EXACTEMENT les règles de lecture d'avant (appartenance à la boutique,
-- pour PUBLIC) et retire les fonctions de droits. Ne touche pas supabase_migrations : enregistrer ensuite l'état
-- (« supabase migration repair --status reverted 184 », ou une nouvelle migration) sur décision.
BEGIN;
SET LOCAL lock_timeout = '5s';

DROP POLICY IF EXISTS expenses_feature_select ON public.expenses;
DROP POLICY IF EXISTS expense_budgets_feature_select ON public.expense_budgets;

CREATE POLICY expenses_member_select ON public.expenses FOR SELECT USING (is_shop_member(shop_id));
CREATE POLICY expense_budgets_member_select ON public.expense_budgets FOR SELECT USING (is_shop_member(shop_id));
CREATE POLICY stock_movements_member_select ON public.stock_movements FOR SELECT USING (is_shop_member(shop_id));
CREATE POLICY stock_movements_select ON public.stock_movements FOR SELECT USING (is_shop_member(shop_id));
CREATE POLICY stock_transfers_select ON public.stock_transfers FOR SELECT
  USING (is_shop_member(source_shop_id) OR is_shop_member(destination_shop_id));
CREATE POLICY stock_transfer_items_select ON public.stock_transfer_items FOR SELECT
  USING (EXISTS (SELECT 1 FROM stock_transfers st WHERE st.id = stock_transfer_items.stock_transfer_id
                 AND (is_shop_member(st.source_shop_id) OR is_shop_member(st.destination_shop_id))));
CREATE POLICY sale_item_batches_select ON public.sale_item_batches FOR SELECT
  USING (EXISTS (SELECT 1 FROM sale_items si JOIN sales s ON s.id = si.sale_id
                 WHERE si.id = sale_item_batches.sale_item_id AND is_shop_member(s.shop_id)));

DROP FUNCTION IF EXISTS public.shop_ids_with_feature(text);
DROP FUNCTION IF EXISTS public.role_can_view_feature(jsonb, text, text);
DROP FUNCTION IF EXISTS public.perm_jsonb_truthy(jsonb);

NOTIFY pgrst, 'reload schema';
COMMIT;

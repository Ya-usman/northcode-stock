-- Retour arrière de 182_c2_cost_columns_server_only.sql — immédiat, sans redéploiement, à lancer seulement sur décision
-- explicite (éditeur SQL en urgence). Rétablit EXACTEMENT les droits d'avant : SELECT de table pour anon et
-- authenticated, aucun droit par colonne. Ne touche pas supabase_migrations : enregistrer ensuite l'état
-- (« supabase migration repair --status reverted 182 », ou une nouvelle migration) sur décision.
BEGIN;
SET LOCAL lock_timeout = '5s';

REVOKE SELECT (id, shop_id, name, name_hausa, sku, category_id, supplier_id, selling_price, quantity, unit,
               low_stock_threshold, image_url, is_active, created_at, updated_at, promo_price, promo_until,
               promo_reason, promo_start, is_favorite)
  ON public.products FROM authenticated;
REVOKE SELECT (id, shop_id, product_id, supplier_id, quantity, initial_quantity, expiry_date, source, received_at,
               created_at, updated_at, promo_price, promo_until, promo_start, origin_inventory_session_id)
  ON public.product_batches FROM authenticated;
REVOKE SELECT (id, sale_id, product_id, product_name, quantity, unit_price, subtotal, original_price,
               stock_shortfall, batch_unallocated)
  ON public.sale_items FROM authenticated;

GRANT SELECT ON public.products, public.product_batches, public.sale_items TO anon, authenticated;

NOTIFY pgrst, 'reload schema';
COMMIT;

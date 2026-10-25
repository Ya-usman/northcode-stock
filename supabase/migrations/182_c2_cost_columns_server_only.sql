-- 182 — Étape C2 du « prix d'achat protégé » : buying_price de products, product_batches et sale_items réservé au
-- serveur (service_role). Le navigateur (authenticated) lit toutes les autres colonnes ; anon ne lit rien.
--
-- Pourquoi par colonne : un REVOKE de colonne est sans effet tant que le droit de TABLE existe. On retire donc le
-- SELECT de table, puis on redonne explicitement chaque colonne permise. Rien d'autre ne change : écritures (déjà
-- refusées par la RLS : aucune règle d'écriture sur ces tables), RLS, fonctions (SECURITY DEFINER), service_role.
-- Temps réel : realtime.apply_rls filtre chaque colonne par has_column_privilege → buying_price disparaît des
-- messages envoyés au navigateur ; la clé id reste lisible (sinon l'événement entier serait refusé).
--
-- RÈGLE « fail-closed » pour la suite : toute colonne AJOUTÉE plus tard à ces 3 tables est illisible par le
-- navigateur tant que sa migration ne lui donne pas « GRANT SELECT (colonne) … TO authenticated ».
-- La permission métier view_purchase_cost (181) ne donne AUCUN droit SQL : le coût passe toujours par le serveur.
--
-- Audit préalable (25 oct. 2026, lecture seule) : aucune lecture navigateur avec buying_price, « * » ou sans liste de
-- colonnes sur ces tables ; aucune lecture anon ; aucune fonction lisant le coût exécutable par le navigateur.
-- Retour arrière : supabase/rollbacks/182_c2_cost_columns_server_only_rollback.sql
-- Appliquée par « supabase db push » (transaction de la CLI) : pas de BEGIN / COMMIT dans ce fichier.

SET LOCAL lock_timeout = '5s';

REVOKE SELECT ON public.products, public.product_batches, public.sale_items FROM anon, authenticated;

GRANT SELECT (id, shop_id, name, name_hausa, sku, category_id, supplier_id, selling_price, quantity, unit,
              low_stock_threshold, image_url, is_active, created_at, updated_at, promo_price, promo_until,
              promo_reason, promo_start, is_favorite)
  ON public.products TO authenticated;
GRANT SELECT (id, shop_id, product_id, supplier_id, quantity, initial_quantity, expiry_date, source, received_at,
              created_at, updated_at, promo_price, promo_until, promo_start, origin_inventory_session_id)
  ON public.product_batches TO authenticated;
GRANT SELECT (id, sale_id, product_id, product_name, quantity, unit_price, subtotal, original_price,
              stock_shortfall, batch_unallocated)
  ON public.sale_items TO authenticated;

-- Garde-fou : droits EFFECTIFS (PUBLIC, héritage et rôles membres compris) — sinon tout est annulé.
DO $$
DECLARE bad text;
BEGIN
  -- authenticated : chaque colonne lisible sauf buying_price ; anon : aucune colonne
  SELECT string_agg(c.table_name || '.' || c.column_name, ', ' ORDER BY c.table_name, c.column_name) INTO bad
    FROM information_schema.columns c
   WHERE c.table_schema = 'public' AND c.table_name IN ('products', 'product_batches', 'sale_items')
     AND (has_column_privilege('authenticated', format('public.%I', c.table_name), c.column_name, 'SELECT')
            IS DISTINCT FROM (c.column_name <> 'buying_price')
          OR has_column_privilege('anon', format('public.%I', c.table_name), c.column_name, 'SELECT'));
  IF bad IS NOT NULL THEN RAISE EXCEPTION '182 : droits de colonne inattendus sur % — annulé', bad; END IF;

  -- Aucun SELECT de TABLE pour authenticated / anon (il contournerait le contrôle par colonne)
  SELECT string_agg(r || ' ' || t, ', ') INTO bad
    FROM unnest(ARRAY['authenticated', 'anon']) r, unnest(ARRAY['public.products', 'public.product_batches', 'public.sale_items']) t
   WHERE has_table_privilege(r, t, 'SELECT');
  IF bad IS NOT NULL THEN RAISE EXCEPTION '182 : SELECT de table encore accordé : % — annulé', bad; END IF;

  -- Le serveur garde tout
  SELECT string_agg(t, ', ') INTO bad
    FROM unnest(ARRAY['public.products', 'public.product_batches', 'public.sale_items']) t
   WHERE NOT has_table_privilege('service_role', t, 'SELECT') OR NOT has_column_privilege('service_role', t, 'buying_price', 'SELECT');
  IF bad IS NOT NULL THEN RAISE EXCEPTION '182 : service_role a perdu la lecture de % — annulé', bad; END IF;

  RAISE NOTICE '182 : buying_price réservé au serveur (products, product_batches, sale_items) ; anon sans lecture';
END $$;

NOTIFY pgrst, 'reload schema';

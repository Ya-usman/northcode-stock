-- Retour arrière de la migration 173 (étape C1).
-- À n'exécuter QUE si un écran ou une fonction casse après la 173.
-- Effet immédiat ; aucune donnée n'est modifiée ; aucun redéploiement nécessaire.
-- (Ce dossier n'est pas un dossier de migrations : rien ici n'est appliqué automatiquement.)

begin;

grant select on table public.purchase_order_items    to anon, authenticated;
grant select on table public.product_supplier_prices to anon, authenticated;
grant select on table public.stock_transfer_items    to anon, authenticated;

-- La vue telle qu'elle existait avant la 173 (migration 001, security_invoker activé depuis)
create or replace view public.products_public with (security_invoker = on) as
select
  id, shop_id, name, name_hausa, sku, category_id, supplier_id,
  case when get_user_role() = 'owner' then buying_price else null::numeric end as buying_price,
  selling_price, quantity, unit, low_stock_threshold,
  image_url, is_active, created_at, updated_at
from public.products;
grant select on public.products_public to anon, authenticated;

commit;

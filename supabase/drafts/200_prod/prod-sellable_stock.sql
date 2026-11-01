CREATE OR REPLACE FUNCTION public.sellable_stock(p_product_id uuid, p_as_of date)
 RETURNS TABLE(physical integer, fresh integer, expired integer, untracked integer, sellable integer, non_sellable integer)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH p AS (SELECT greatest(quantity, 0) AS physical FROM products WHERE id = p_product_id),
  l AS (
    SELECT coalesce(sum(quantity) FILTER (WHERE NOT coalesce(expiry_date < p_as_of, false)), 0)::int AS fresh,
           coalesce(sum(quantity) FILTER (WHERE coalesce(expiry_date < p_as_of, false)), 0)::int AS expired
    FROM product_batches WHERE product_id = p_product_id AND quantity > 0)
  SELECT p.physical, l.fresh, l.expired,
         greatest(p.physical - (l.fresh + l.expired), 0) AS untracked,
         least(p.physical, l.fresh + greatest(p.physical - (l.fresh + l.expired), 0)) AS sellable,
         p.physical - least(p.physical, l.fresh + greatest(p.physical - (l.fresh + l.expired), 0)) AS non_sellable
  FROM p CROSS JOIN l
$function$

CREATE OR REPLACE FUNCTION public.start_inventory_session(p_shop_id uuid, p_user uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_id    uuid;
  v_ref   text;
  v_year  text := to_char(now(), 'YYYY');
  v_seq   int;
  v_total int;
begin
  perform pg_advisory_xact_lock(hashtextextended('inventory:' || p_shop_id::text, 0));

  select id, reference into v_id, v_ref from inventory_sessions where shop_id = p_shop_id and status = 'in_progress';
  if found then
    return jsonb_build_object('id', v_id, 'reference', v_ref, 'resumed', true);
  end if;

  select coalesce(max(nullif(split_part(reference, '-', 3), '')::int), 0) + 1 into v_seq
    from inventory_sessions where shop_id = p_shop_id and reference like 'INV-' || v_year || '-%';
  v_ref := 'INV-' || v_year || '-' || lpad(v_seq::text, 4, '0');
  select count(*)::int into v_total from products where shop_id = p_shop_id and is_active;

  insert into inventory_sessions (shop_id, reference, status, started_by, products_total)
    values (p_shop_id, v_ref, 'in_progress', p_user, v_total)
    returning id into v_id;
  perform _inventory_audit(p_shop_id, p_user, 'inventory.start', v_id, jsonb_build_object('reference', v_ref, 'products_total', v_total));
  return jsonb_build_object('id', v_id, 'reference', v_ref, 'resumed', false);
end;
$function$

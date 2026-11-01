CREATE OR REPLACE FUNCTION public.record_inventory_count(p_session_id uuid, p_shop_id uuid, p_product_id uuid, p_counted_qty integer, p_user uuid, p_expected_count_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_status  text;
  v_shop    uuid;
  v_cur_id  uuid;
  v_cur_qty int;
  v_cur_by  uuid;
  v_cur_at  timestamptz;
  v_qty     int;
  v_name    text;
  v_unit    text;
  v_new     uuid;
begin
  if p_counted_qty is null or p_counted_qty < 0 then raise exception 'invalid_quantity'; end if;

  select status, shop_id into v_status, v_shop from inventory_sessions where id = p_session_id for share;
  if not found or v_shop <> p_shop_id then raise exception 'session_not_found'; end if;
  if v_status <> 'in_progress' then raise exception 'session_closed'; end if;

  perform pg_advisory_xact_lock(hashtextextended(p_session_id::text || ':' || p_product_id::text, 0));

  select id, counted_qty, counted_by, counted_at into v_cur_id, v_cur_qty, v_cur_by, v_cur_at
    from inventory_counts where session_id = p_session_id and product_id = p_product_id and superseded_at is null;

  if v_cur_id is distinct from p_expected_count_id then
    return jsonb_build_object('conflict', true, 'current', case when v_cur_id is null then null else
      jsonb_build_object('id', v_cur_id, 'counted_qty', v_cur_qty, 'counted_by', v_cur_by, 'counted_at', v_cur_at) end);
  end if;

  select quantity, name, unit into v_qty, v_name, v_unit from products where id = p_product_id and shop_id = p_shop_id;
  if not found then raise exception 'product_not_found'; end if;

  if v_cur_id is not null then
    update inventory_counts set superseded_at = now(), superseded_by = p_user where id = v_cur_id;
  end if;
  insert into inventory_counts (session_id, shop_id, product_id, product_name, unit, theoretical_qty, counted_qty, counted_by)
    values (p_session_id, p_shop_id, p_product_id, v_name, v_unit, v_qty, p_counted_qty, p_user)
    returning id into v_new;
  update inventory_sessions set updated_at = now() where id = p_session_id;

  return jsonb_build_object('conflict', false, 'id', v_new, 'theoretical_qty', v_qty,
                            'counted_qty', p_counted_qty, 'delta', p_counted_qty - v_qty, 'replaced', v_cur_id is not null);
end;
$function$

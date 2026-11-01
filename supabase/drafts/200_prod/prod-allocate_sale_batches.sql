CREATE OR REPLACE FUNCTION public.allocate_sale_batches(p_product_id uuid, p_qty integer, p_as_of date)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_batch     RECORD;
  v_remaining int := p_qty;
  v_take      int;
  v_out       jsonb := '[]'::jsonb;
BEGIN
  IF p_qty IS NULL OR p_qty <= 0 THEN
    RETURN v_out;
  END IF;
  FOR v_batch IN
    SELECT id, quantity
    FROM product_batches
    WHERE product_id = p_product_id AND quantity > 0
      AND NOT coalesce(expiry_date < p_as_of, false)
    ORDER BY expiry_date ASC NULLS LAST, received_at ASC
    FOR UPDATE
  LOOP
    EXIT WHEN v_remaining <= 0;
    v_take := LEAST(v_batch.quantity, v_remaining);
    UPDATE product_batches SET quantity = quantity - v_take, updated_at = now() WHERE id = v_batch.id;
    v_out := v_out || jsonb_build_object('batch_id', v_batch.id, 'quantity', v_take);
    v_remaining := v_remaining - v_take;
  END LOOP;
  RETURN v_out;
END;
$function$

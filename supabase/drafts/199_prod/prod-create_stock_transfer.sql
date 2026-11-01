CREATE OR REPLACE FUNCTION public.create_stock_transfer(p_source uuid, p_dest uuid, p_user uuid, p_notes text, p_items jsonb, p_send boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_id   uuid;
  v_year text := to_char(now(), 'YYYY');
  v_seq  int;
  v_ref  text;
BEGIN
  PERFORM _transfer_check_shops(p_source, p_dest);
  PERFORM pg_advisory_xact_lock(hashtextextended('transfer-ref:' || p_source::text, 0));
  SELECT coalesce(max(nullif(regexp_replace(split_part(reference, '-', 3), '\D', '', 'g'), '')::int), 0) + 1 INTO v_seq
    FROM stock_transfers WHERE source_shop_id = p_source AND reference LIKE 'TR-' || v_year || '-%';
  v_ref := 'TR-' || v_year || '-' || lpad(v_seq::text, 4, '0');
  INSERT INTO stock_transfers (reference, source_shop_id, destination_shop_id, status, notes, created_by)
    VALUES (v_ref, p_source, p_dest, 'draft', nullif(btrim(p_notes), ''), p_user)
    RETURNING id INTO v_id;
  IF _transfer_replace_items(v_id, p_source, p_items) = 0 THEN RAISE EXCEPTION 'transfer_empty' USING ERRCODE = 'P0062'; END IF;
  IF p_send THEN RETURN send_stock_transfer_draft(v_id, p_source, p_user); END IF;
  PERFORM _transfer_audit(p_source, p_user, 'stock_transfer.draft', v_id, jsonb_build_object('reference', v_ref, 'destination_shop_id', p_dest));
  RETURN jsonb_build_object('id', v_id, 'reference', v_ref, 'status', 'draft');
END;
$function$

CREATE OR REPLACE FUNCTION public.shop_business_date(p_shop_id uuid, p_at timestamp with time zone DEFAULT now())
 RETURNS date
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_tz text;
BEGIN
  SELECT timezone INTO v_tz FROM shops WHERE id = p_shop_id;
  IF v_tz IS NULL THEN
    RAISE EXCEPTION 'shop_timezone_required' USING ERRCODE = 'P0032',
      DETAIL = json_build_object('shop_id', p_shop_id)::text;
  END IF;
  RETURN (coalesce(p_at, now()) AT TIME ZONE v_tz)::date;
END;
$function$

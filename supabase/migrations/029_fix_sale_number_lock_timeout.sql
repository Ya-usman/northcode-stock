-- ============================================================
-- Migration 029 : Add lock_timeout to set_sale_number (BUG-15)
-- ============================================================
-- The LOOP in set_sale_number() (028) acquires a row lock on
-- shop_sale_counters via INSERT ... ON CONFLICT DO UPDATE.
-- If a zombie/idle-in-transaction connection holds that row lock,
-- the trigger waits indefinitely → infinite spinner in the UI.
-- Fix: SET LOCAL lock_timeout forces an error after 8 s so the
-- client receives an error instead of hanging forever.

CREATE OR REPLACE FUNCTION set_sale_number()
RETURNS trigger AS $$
DECLARE
  shop_name_raw text;
  shop_prefix   text;
  next_num      int;
  candidate     text;
BEGIN
  -- Abort immediately if any lock cannot be obtained within 8 seconds.
  -- This surfaces a "Lock not available" error to the client rather than
  -- blocking the HTTP request forever.
  SET LOCAL lock_timeout = '8s';

  SELECT name INTO shop_name_raw FROM shops WHERE id = new.shop_id;

  -- Keep only A-Z letters, take first 3, upper-case; fall back to 'SHP'
  shop_prefix := upper(
    substring(
      regexp_replace(coalesce(shop_name_raw, ''), '[^A-Za-z]', '', 'g'),
      1, 3
    )
  );
  IF shop_prefix IS NULL OR length(shop_prefix) = 0 THEN
    shop_prefix := 'SHP';
  END IF;

  LOOP
    INSERT INTO shop_sale_counters (shop_id, counter)
    VALUES (new.shop_id, 1)
    ON CONFLICT (shop_id)
    DO UPDATE SET counter = shop_sale_counters.counter + 1
    RETURNING counter INTO next_num;

    candidate := shop_prefix || '-' || lpad(next_num::text, 4, '0');

    EXIT WHEN NOT EXISTS (
      SELECT 1 FROM sales
      WHERE shop_id = new.shop_id AND sale_number = candidate
    );
  END LOOP;

  new.sale_number := candidate;
  RETURN new;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

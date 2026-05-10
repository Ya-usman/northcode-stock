-- ============================================================
-- Migration 028 : ASCII-only shop prefix in sale_number trigger
-- ============================================================
-- Arabic (or any non-Latin) shop names produce non-ASCII prefixes
-- (e.g. 'الح-0005') which jsPDF Helvetica cannot render, causing mojibake.
-- Fix: strip every non-ASCII letter from the shop name before building
-- the prefix; fall back to 'SHP' if nothing remains.
-- This builds on migration 027's atomic counter table.

CREATE OR REPLACE FUNCTION set_sale_number()
RETURNS trigger AS $$
DECLARE
  shop_name_raw text;
  shop_prefix   text;
  next_num      int;
  candidate     text;
BEGIN
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
    -- Atomic increment: serialises concurrent inserts at the row lock
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

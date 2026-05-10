-- ============================================================
-- Migration 026 : Fix set_sale_number crashing on non-numeric suffixes
-- ============================================================
-- The ::int cast on sale_number suffix fails if any existing sale has
-- a non-standard format (e.g. offline-synced sales like "HL-XYZ12").
-- Fix: skip rows whose suffix is not purely numeric before casting.

CREATE OR REPLACE FUNCTION set_sale_number()
RETURNS trigger AS $$
DECLARE
  shop_prefix text;
  next_num    int;
BEGIN
  SELECT upper(substring(name, 1, 3)) INTO shop_prefix
  FROM shops WHERE id = new.shop_id;

  -- MAX of numeric-only suffixes, safely skipping any that can't be cast
  SELECT coalesce(
    max(
      CASE
        WHEN nullif(regexp_replace(sale_number, '^[A-Z]+-', ''), '') ~ '^\d+$'
        THEN nullif(regexp_replace(sale_number, '^[A-Z]+-', ''), '')::int
        ELSE NULL
      END
    ), 0
  ) + 1 INTO next_num
  FROM sales
  WHERE shop_id = new.shop_id;

  new.sale_number := shop_prefix || '-' || lpad(next_num::text, 4, '0');
  RETURN new;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

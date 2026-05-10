-- ============================================================
-- Migration 027 : Atomic sale number counter (BUG-14)
-- ============================================================
-- The MAX()+1 approach in set_sale_number() has a race condition:
-- concurrent inserts both read the same MAX and generate duplicate numbers.
-- Fix: a dedicated counter table with atomic INSERT ... ON CONFLICT DO UPDATE
-- which serialises on the row lock and guarantees unique values.

CREATE TABLE IF NOT EXISTS shop_sale_counters (
  shop_id uuid PRIMARY KEY REFERENCES shops(id) ON DELETE CASCADE,
  counter  int NOT NULL DEFAULT 0
);

-- Backfill counters from existing sales
INSERT INTO shop_sale_counters (shop_id, counter)
SELECT
  shop_id,
  COALESCE(max(
    CASE
      WHEN nullif(regexp_replace(sale_number, '^[A-Z]+-', ''), '') ~ '^\d+$'
      THEN nullif(regexp_replace(sale_number, '^[A-Z]+-', ''), '')::int
      ELSE 0
    END
  ), 0)
FROM sales
GROUP BY shop_id
ON CONFLICT (shop_id) DO UPDATE SET counter = EXCLUDED.counter;

-- Updated trigger: atomic increment, safe under concurrency
CREATE OR REPLACE FUNCTION set_sale_number()
RETURNS trigger AS $$
DECLARE
  shop_prefix text;
  next_num    int;
BEGIN
  SELECT upper(substring(name, 1, 3)) INTO shop_prefix
  FROM shops WHERE id = new.shop_id;

  -- Atomic upsert: two concurrent inserts will queue on the row lock
  -- and each get a distinct counter value
  INSERT INTO shop_sale_counters (shop_id, counter)
  VALUES (new.shop_id, 1)
  ON CONFLICT (shop_id)
  DO UPDATE SET counter = shop_sale_counters.counter + 1
  RETURNING counter INTO next_num;

  new.sale_number := shop_prefix || '-' || lpad(next_num::text, 4, '0');
  RETURN new;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

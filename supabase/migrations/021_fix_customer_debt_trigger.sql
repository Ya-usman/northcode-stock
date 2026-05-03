-- ============================================================
-- Migration 021 : Fix customer debt trigger for partial sales (BUG-10)
-- ============================================================
-- Old trigger only fired on payment_method = 'credit'.
-- Partial cash/transfer sales also have balance > 0 and were silently ignored.
-- New condition: any sale with a positive balance and a known customer.

CREATE OR REPLACE FUNCTION update_customer_debt_on_sale()
RETURNS trigger AS $$
BEGIN
  IF new.balance > 0 AND new.customer_id IS NOT NULL THEN
    UPDATE customers
    SET total_debt = total_debt + new.balance
    WHERE id = new.customer_id;
  END IF;
  RETURN new;
END;
$$ LANGUAGE plpgsql;

-- Trigger already exists (after_sale_insert_debt) — no need to recreate it.

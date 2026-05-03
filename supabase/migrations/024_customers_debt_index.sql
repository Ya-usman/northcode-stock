-- ============================================================
-- Migration 024 : Composite index on customers for debt queries (PERF-03)
-- ============================================================
-- /api/payments/debts filters: .in('shop_id', ids).gt('total_debt', 0)
-- A composite index covering both columns avoids full-table scans
-- on shops with many customers.

CREATE INDEX IF NOT EXISTS idx_customers_shop_debt
  ON customers(shop_id, total_debt)
  WHERE total_debt > 0;

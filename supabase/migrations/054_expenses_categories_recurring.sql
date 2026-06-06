-- ============================================================
-- Migration 054 : Catégories + dépenses récurrentes
-- ============================================================

ALTER TABLE expenses
  ADD COLUMN IF NOT EXISTS category        text        NOT NULL DEFAULT 'other',
  ADD COLUMN IF NOT EXISTS is_recurring    boolean     NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS recurrence      text        CHECK (recurrence IN ('weekly', 'monthly')),
  ADD COLUMN IF NOT EXISTS recurrence_day  smallint    CHECK (recurrence_day BETWEEN 1 AND 28),
  ADD COLUMN IF NOT EXISTS next_due_at     date,
  ADD COLUMN IF NOT EXISTS template_id     uuid        REFERENCES expenses(id) ON DELETE SET NULL;

-- Fast lookup of due recurring templates
CREATE INDEX IF NOT EXISTS idx_expenses_recurring_due
  ON expenses (shop_id, next_due_at)
  WHERE is_recurring = true AND next_due_at IS NOT NULL;

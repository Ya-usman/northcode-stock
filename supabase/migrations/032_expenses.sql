-- ============================================================
-- Migration 032 : Table dépenses
-- ============================================================

CREATE TABLE IF NOT EXISTS expenses (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id     uuid NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  amount      numeric(14,2) NOT NULL CHECK (amount > 0),
  description text NOT NULL,
  date        date NOT NULL DEFAULT CURRENT_DATE,
  created_by  uuid REFERENCES auth.users ON DELETE SET NULL,
  created_at  timestamptz DEFAULT now(),
  updated_at  timestamptz DEFAULT now()
);

ALTER TABLE expenses ENABLE ROW LEVEL SECURITY;

-- Only owners can manage expenses
CREATE POLICY "expenses_owner_all" ON expenses
  FOR ALL USING (get_role_in_shop(shop_id) = 'owner');

-- Index for fast queries by shop + date
CREATE INDEX IF NOT EXISTS idx_expenses_shop_date ON expenses(shop_id, date DESC);

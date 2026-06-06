-- ============================================================
-- Migration 055 : Budgets mensuels + méthode de paiement
-- ============================================================

-- Budgets mensuels par catégorie (s'applique à chaque mois)
CREATE TABLE IF NOT EXISTS expense_budgets (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id    uuid        NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  category   text        NOT NULL,
  amount     numeric(14,2) NOT NULL CHECK (amount > 0),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE (shop_id, category)
);

ALTER TABLE expense_budgets ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "expense_budgets_owner_all" ON expense_budgets;
CREATE POLICY "expense_budgets_owner_all" ON expense_budgets
  FOR ALL USING (get_role_in_shop(shop_id) = 'owner');

-- Méthode de paiement sur les dépenses
ALTER TABLE expenses
  ADD COLUMN IF NOT EXISTS payment_method text NOT NULL DEFAULT 'cash'
    CHECK (payment_method IN ('cash', 'mobile_money', 'bank_transfer'));

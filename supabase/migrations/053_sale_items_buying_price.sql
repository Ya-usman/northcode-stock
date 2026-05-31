-- Store buying price at time of sale so profit remains accurate
-- even after products are deleted or their price changes later.
--
-- buying_price: prix d'achat au moment de la vente (figé)
-- unit_price: prix de vente au moment de la vente (déjà figé)
-- Ces deux colonnes permettent de calculer la marge brute
-- sur n'importe quelle période même si les produits sont supprimés.

ALTER TABLE sale_items ADD COLUMN IF NOT EXISTS buying_price numeric(12,2) NOT NULL DEFAULT 0;

-- Backfill: for existing sale_items where product still exists,
-- copy current buying_price so historical reports are as accurate as possible
UPDATE sale_items si
SET buying_price = p.buying_price
FROM products p
WHERE si.product_id = p.id
  AND si.buying_price = 0
  AND p.buying_price > 0;

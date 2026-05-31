-- Store buying price at time of sale so profit remains accurate
-- even after products are deleted or their buying price changes.
ALTER TABLE sale_items ADD COLUMN IF NOT EXISTS buying_price numeric(12,2) NOT NULL DEFAULT 0;

-- Drop old restrictive check constraint and replace with open text
-- to support country-specific payment methods (opay, palmpay, moniepoint,
-- mtn_momo, orange_money, wave, moov_money, airtel_money, flooz, tmoney, pos, etc.)

ALTER TABLE sales DROP CONSTRAINT IF EXISTS sales_payment_method_check;

-- Also update payments table if it has a similar constraint
ALTER TABLE payments DROP CONSTRAINT IF EXISTS payments_method_check;

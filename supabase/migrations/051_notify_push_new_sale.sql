-- Activation des notifications push lors de chaque vente
ALTER TABLE shops ADD COLUMN IF NOT EXISTS notify_push_new_sale boolean DEFAULT true;
 
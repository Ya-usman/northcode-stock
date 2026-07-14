-- ============================================================
-- Migration 096 : Traçabilité des acteurs sur les bons de commande
-- ============================================================
-- created_by existe déjà (083) mais n'était jamais affiché côté UI, et
-- rien ne trace qui a envoyé ou annulé un bon — même pattern manquant que
-- pour sales.cancelled_by (001/020), qu'on reproduit ici.

ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS sent_by uuid references auth.users on delete set null;
ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS cancelled_by uuid references auth.users on delete set null;

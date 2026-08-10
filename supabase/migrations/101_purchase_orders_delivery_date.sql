-- ============================================================
-- 101 — PURCHASE ORDERS: EXPECTED DELIVERY DATE
--
-- Date de livraison prévue, saisie optionnellement à la création d'un bon
-- de commande. Sert de base au badge "En retard" côté client (statut
-- 'sent' + date dépassée + jamais reçu).
-- ============================================================

ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS expected_delivery_date date;

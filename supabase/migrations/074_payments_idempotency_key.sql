-- ============================================================
-- Migration 074 : clé d'idempotence sur les remboursements de dette
-- ============================================================
-- Même risque que pour les ventes (migration 073) : /api/payments n'a
-- aucune protection contre un double envoi (timeout réseau après un succès
-- serveur, ou clic "Confirmer" répété) — un remboursement pourrait être
-- appliqué deux fois à la dette du client.

-- text, not uuid: one repayment action can create several payment rows (FIFO
-- across multiple unpaid sales), so the key stored per row is composite —
-- "<client-generated uuid>:<sale_id>" — unique per (repayment attempt, sale)
-- rather than per repayment attempt alone.
ALTER TABLE payments ADD COLUMN IF NOT EXISTS client_request_id text;

CREATE UNIQUE INDEX IF NOT EXISTS payments_client_request_id_unique
  ON payments (client_request_id)
  WHERE client_request_id IS NOT NULL;

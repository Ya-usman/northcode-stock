-- ============================================================
-- 115 — Abandon de créance (bad debt write-off)
-- ============================================================
-- Modélisé comme un paiement spécial plutôt qu'un système parallèle : un
-- abandon insère une ligne dans payments avec is_write_off = true et
-- amount = solde restant. Le trigger update_customer_debt_on_payment
-- (001_schema.sql) s'applique automatiquement (amount_paid += amount,
-- total_debt -= amount) — aucune fonction/trigger supplémentaire requise.
-- Hérite donc gratuitement de toute la mécanique déjà construite en 113 :
-- impression, annulation soft (cancel_payment restaure la dette), journal
-- d'audit. is_write_off est un booléen dédié (pas method = 'write_off')
-- pour ne jamais polluer l'affichage du mode de paiement ailleurs dans
-- l'app (reçus, historique, rapports).

ALTER TABLE payments ADD COLUMN IF NOT EXISTS is_write_off boolean NOT NULL DEFAULT false;

-- ============================================================
-- Migration 147 : override manuel DATÉ — motif + auteur
-- ============================================================
-- Prépare l'override manuel à pouvoir cibler une date PASSÉE (pas
-- seulement "aujourd'hui") — le mécanisme de priorité existe déjà
-- (is_manual_override + effective_date, migrations 139/146,
-- buildHistoricalRateIndex fait déjà gagner un override à date égale).
-- Ce qui manquait : un motif optionnel, et `updated_by` qui existait dans
-- le schéma (migration 138) mais n'était jamais renseigné par la route.
--
-- `updated_by` reste tel quel (déjà présent) ; on ajoute seulement le motif.

ALTER TABLE exchange_rates ADD COLUMN IF NOT EXISTS override_reason text;

COMMENT ON COLUMN exchange_rates.override_reason IS
  'Motif optionnel saisi par l''admin lors d''un override manuel (audit / traçabilité). NULL pour un taux automatique.';
COMMENT ON COLUMN exchange_rates.updated_by IS
  'Admin auteur du taux — renseigné pour un override manuel (route PUT /api/admin/exchange-rates), NULL pour un taux automatique.';

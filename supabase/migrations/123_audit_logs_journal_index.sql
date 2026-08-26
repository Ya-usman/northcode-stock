-- ============================================================
-- Migration 123 : Index pour les journaux (audit_logs)
-- ============================================================
-- Même défaut que la migration 122 (payments/caisse), cette fois sur
-- audit_logs : toutes les pages "Journal" (Dépenses — suppressions,
-- Stock, Équipe) interrogent shop_id + action (égalité ou liste) triées
-- par created_at, mais seuls des index à colonne unique existaient
-- (idx_audit_logs_shop_id, idx_audit_logs_actor_id, idx_audit_logs_action,
-- idx_audit_logs_created — 050_audit_logs.sql). Sans index composé,
-- Postgres doit croiser plusieurs index mono-colonne puis trier le
-- résultat. audit_logs est en plus une table partagée par toute
-- l'application (ventes, paiements, bons de commande, équipe, produits...)
-- — elle grossit avec l'activité globale de la boutique, pas seulement
-- avec les dépenses, ce qui rend ce défaut plus coûteux ici que sur
-- payments.
CREATE INDEX IF NOT EXISTS idx_audit_logs_shop_action_created
  ON audit_logs (shop_id, action, created_at DESC);

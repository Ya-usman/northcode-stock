-- ============================================================
-- Migration 145 : agent_commissions — colonne notes manquante
-- ============================================================
-- Bug PRÉ-EXISTANT trouvé en vérifiant la migration 144 (création manuelle
-- d'une commission, /api/admin/agents/commissions POST) : la route écrit
-- un champ `notes` depuis toujours (app/api/admin/agents/commissions/route.ts),
-- mais la table agent_commissions (052_referral_agents.sql) n'a jamais eu
-- cette colonne — chaque tentative de création manuelle échouait avec
-- "Could not find the 'notes' column of 'agent_commissions' in the schema
-- cache" (500). Sans lien avec la politique de devise — trouvé en marge en
-- testant la migration 144.
--
-- NON DESTRUCTIF. agent_commissions a 0 ligne à ce jour — aucun backfill.
--
-- ROLLBACK :
--   ALTER TABLE agent_commissions DROP COLUMN IF EXISTS notes;

ALTER TABLE agent_commissions ADD COLUMN IF NOT EXISTS notes text;

-- ============================================================
-- 156 — Clients, dépenses et budgets par le serveur (lot 2 permissions,
--       5 oct. 2026). Compatible avec le code en ligne : à appliquer AVANT
--       le déploiement du lot 2. Aucune donnée modifiée. Ré-exécutable.
--
--   1. Clé d'idempotence des dépenses saisies hors ligne (jamais envoyées
--      deux fois, même si la synchronisation est relancée).
--   2. Verrou anti-doublon des dépenses récurrentes : une seule occurrence
--      par modèle et par date, quel que soit le nombre d'appareils (relevé du
--      5 oct. : 4 occurrences existantes, 0 doublon). template_id NULL
--      (dépense ordinaire) n'entre jamais en conflit : les NULL sont distincts.
--   3. Espace PRIVÉ des justificatifs (documents financiers) : écriture par
--      le serveur seul, lecture par lien signé (une heure) via
--      /api/expenses/receipt. L'espace n'existait pas : l'envoi d'un
--      justificatif échouait depuis toujours (0 justificatif en base).
-- ============================================================

ALTER TABLE expenses ADD COLUMN IF NOT EXISTS client_request_id text;
CREATE UNIQUE INDEX IF NOT EXISTS idx_expenses_client_request
  ON expenses(shop_id, client_request_id) WHERE client_request_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_expenses_template_date
  ON expenses(template_id, date);

INSERT INTO storage.buckets (id, name, public)
VALUES ('expense-receipts', 'expense-receipts', false)
ON CONFLICT (id) DO UPDATE SET public = false;

-- ── Vérification après exécution ───────────────────────────────────────────
-- SELECT public FROM storage.buckets WHERE id = 'expense-receipts';   -- false
-- SELECT indexname FROM pg_indexes WHERE tablename = 'expenses' AND indexname LIKE 'idx_expenses_%';  -- 2 nouvelles lignes

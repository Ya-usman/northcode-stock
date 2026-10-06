-- ============================================================
-- 163 — Accompagnement « Bien démarrer » (lot A)
--
-- Par personne : guide masqué ou non, et suivi des tours guidés
-- (commencé / terminé / passé). Les étapes du guide (produit, vente,
-- catégorie, équipe, reçu) ne sont PAS stockées : elles se déduisent des
-- données réelles de la boutique.
--
-- tours : { "<tour>": { "started_at": "...", "status": "completed" | "skipped", "ended_at": "..." } }
-- Lecture : sa propre ligne. Écriture : serveur seulement (/api/onboarding),
-- règle du lot 4. Ré-exécutable.
-- ============================================================

CREATE TABLE IF NOT EXISTS user_onboarding (
  user_id            uuid        PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  guide_dismissed_at timestamptz,
  tours              jsonb       NOT NULL DEFAULT '{}'::jsonb,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE user_onboarding ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS user_onboarding_own_read ON user_onboarding;
CREATE POLICY user_onboarding_own_read ON user_onboarding
  FOR SELECT TO authenticated USING (user_id = auth.uid());
-- Aucune règle d'écriture : /api/onboarding (serveur)
REVOKE INSERT, UPDATE, DELETE ON user_onboarding FROM anon, authenticated;

NOTIFY pgrst, 'reload schema';

-- ── Vérification après exécution ───────────────────────────────────────────
-- SELECT count(*) FROM user_onboarding;  -- 0 au départ

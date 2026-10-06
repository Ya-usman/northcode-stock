-- ============================================================
-- 164 — Relances « Bien démarrer » par e-mail
--
-- Jusqu'à 3 e-mails (J+1, J+3, J+7) aux propriétaires d'un compte récent
-- (moins de 14 jours) qui n'ont pas encore ajouté de produit ou fait de
-- vente. Tâche quotidienne /api/cron/onboarding-nudges (EN PAUSE tant que
-- ONBOARDING_NUDGES ≠ on).
--
--  · onboarding_nudges : une ligne par personne et par relance envoyée
--    (clé primaire = jamais deux fois la même relance) ;
--  · user_onboarding.nudges_unsubscribed_at : désinscription en un clic
--    (lien signé dans chaque e-mail + en-tête List-Unsubscribe).
-- Serveur seulement : aucune lecture ni écriture depuis le navigateur.
-- Aucune donnée existante modifiée. Ré-exécutable.
-- ============================================================

ALTER TABLE user_onboarding ADD COLUMN IF NOT EXISTS nudges_unsubscribed_at timestamptz;

CREATE TABLE IF NOT EXISTS onboarding_nudges (
  user_id  uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  nudge    text        NOT NULL CHECK (nudge IN ('d1', 'd3', 'd7')),
  variant  text        NOT NULL CHECK (variant IN ('product', 'sale', 'help')),
  sent_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, nudge)
);
ALTER TABLE onboarding_nudges ENABLE ROW LEVEL SECURITY;
-- Aucune règle : serveur seulement
REVOKE ALL ON onboarding_nudges FROM anon, authenticated;

NOTIFY pgrst, 'reload schema';

-- ── Vérification après exécution ───────────────────────────────────────────
-- SELECT count(*) FROM onboarding_nudges;  -- 0
-- SELECT column_name FROM information_schema.columns WHERE table_name = 'user_onboarding' AND column_name = 'nudges_unsubscribed_at';

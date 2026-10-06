-- ============================================================
-- 162 — Nouveautés V2 (remplace la fenêtre bloquante)
--
-- Les annonces ne s'imposent plus à la connexion. Elles sont :
--   · listées dans un panneau « Nouveautés » (icône de l'en-tête, point bleu
--     tant qu'il y a du nouveau depuis la dernière ouverture) ;
--   · rappelées par un bandeau discret sur la page concernée (target_path),
--     que chacun ferme d'un clic (announcement_dismissals) ;
--   · signalées par un badge « Nouveau » dans le menu pendant 14 jours.
-- Chaque annonce : 3 langues, un lien « Essayer » (cta_path), un public
-- (roles, null = tout le monde) et une date de fin facultative (expires_at).
--
-- Écritures : serveur seulement (règle du lot 4). Le navigateur lit les
-- annonces actives et SES fermetures. Ré-exécutable.
-- ============================================================

ALTER TABLE announcements
  ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'new',
  ADD COLUMN IF NOT EXISTS title_en text,
  ADD COLUMN IF NOT EXISTS title_ha text,
  ADD COLUMN IF NOT EXISTS description_en text,
  ADD COLUMN IF NOT EXISTS description_ha text,
  ADD COLUMN IF NOT EXISTS cta_path text,
  ADD COLUMN IF NOT EXISTS target_path text,
  ADD COLUMN IF NOT EXISTS roles text[],
  ADD COLUMN IF NOT EXISTS expires_at timestamptz;

ALTER TABLE announcements DROP CONSTRAINT IF EXISTS announcements_kind_check;
ALTER TABLE announcements ADD CONSTRAINT announcements_kind_check CHECK (kind IN ('new', 'improvement', 'fix'));
-- Chemins internes, sans langue ni barre initiale (ex. « stock/transfers »)
ALTER TABLE announcements DROP CONSTRAINT IF EXISTS announcements_paths_check;
ALTER TABLE announcements ADD CONSTRAINT announcements_paths_check
  CHECK ((cta_path IS NULL OR cta_path ~ '^[a-z0-9][a-z0-9/_?=&-]*$') AND (target_path IS NULL OR target_path ~ '^[a-z0-9][a-z0-9/_-]*$'));

-- Type repris de l'ancienne étiquette française
UPDATE announcements SET kind = CASE badge WHEN 'Amélioration' THEN 'improvement' WHEN 'Correction' THEN 'fix' ELSE 'new' END;

-- Fermetures du bandeau, par personne
CREATE TABLE IF NOT EXISTS announcement_dismissals (
  user_id         uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  announcement_id uuid        NOT NULL REFERENCES announcements(id) ON DELETE CASCADE,
  dismissed_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, announcement_id)
);
ALTER TABLE announcement_dismissals ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS announcement_dismissals_own_read ON announcement_dismissals;
CREATE POLICY announcement_dismissals_own_read ON announcement_dismissals
  FOR SELECT TO authenticated USING (user_id = auth.uid());
-- Aucune règle d'écriture : enregistrement par /api/announcements/dismiss (serveur)
REVOKE INSERT, UPDATE, DELETE ON announcement_dismissals FROM anon, authenticated;

-- ── Contenu des annonces existantes : langues, lien, page, public ──────────
UPDATE announcements SET
  title_en = 'Transfers between shops',
  title_ha = 'Canja wurin kaya tsakanin shaguna',
  description_en = 'Send stock from one shop to another in a few clicks from the Transfers tab of the Stock page. The other shop finds the shipment by its reference and confirms what it actually received.',
  description_ha = 'Aika kaya daga wani shago zuwa wani cikin ’yan dannawa daga shafin Canja wuri na Kaya. Ɗayan shagon zai sami kayan ta lambar shaida kuma ya tabbatar da abin da ya karɓa.',
  cta_path = 'stock/transfers', target_path = 'stock',
  roles = ARRAY['owner', 'shop_manager', 'manager', 'stock_manager']
WHERE title = 'Transferts entre boutiques';

UPDATE announcements SET
  title_en = 'Illustrated user guide',
  title_ha = 'Jagorar amfani mai hotuna',
  description_en = 'A complete guide with screenshots is now available on the Help page, covering the 15 sections of the app step by step.',
  description_ha = 'Akwai cikakkiyar jagora mai hotuna a shafin Taimako, tana bayanin sassa 15 na manhajar mataki-mataki.',
  cta_path = 'help', target_path = 'help'
WHERE title = 'Manuel d''utilisation illustré';

UPDATE announcements SET
  title_en = 'Quarterly and yearly subscription',
  title_ha = 'Biyan kuɗin shiga na wata uku da na shekara',
  description_en = 'Pay less by choosing a longer period: -8% for a quarter, -20% for a year, in every country.',
  description_ha = 'Ka biya ƙasa idan ka zaɓi lokaci mai tsawo: -8% na wata uku, -20% na shekara, a duk ƙasashe.',
  cta_path = 'billing', target_path = 'billing',
  roles = ARRAY['owner']
WHERE title = 'Abonnement trimestriel & annuel';

UPDATE announcements SET
  title_en = 'Log of deleted expenses',
  title_ha = 'Rajistar kashe kuɗin da aka goge',
  description_en = 'The owner can now see who deleted an expense and when, directly from the Expenses page.',
  description_ha = 'Mai shago yanzu zai iya ganin wanda ya goge kashe kuɗi da lokacin, kai tsaye daga shafin Kashe kuɗi.',
  cta_path = 'expenses', target_path = 'expenses',
  roles = ARRAY['owner']
WHERE title = 'Journal des suppressions de dépenses';

-- ── Annonce de démonstration publiée par erreur : désactivée (conservée) ──
UPDATE announcements SET is_active = false
WHERE title = 'Titre de ta fonctionnalité' AND description = 'Description courte.';

NOTIFY pgrst, 'reload schema';

-- ── Vérification après exécution ───────────────────────────────────────────
-- SELECT title, kind, is_active, cta_path, target_path, roles, title_en IS NOT NULL AS en, title_ha IS NOT NULL AS ha
--   FROM announcements ORDER BY published_at DESC;
-- Attendu : 4 annonces actives avec lien, page et langues ; « Titre de ta fonctionnalité » inactive.

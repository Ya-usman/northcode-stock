-- ============================================================
-- 167 — Contacts du support (Admin → Activation, 7 oct. 2026)
--
-- Le support écrit aux commerçants qui débutent depuis la console : message
-- prêt à l'envoi (selon la situation du compte, dans sa langue), envoyé
-- depuis support@stockshop.tech, ou ouvert dans WhatsApp. Chaque contact est
-- gardé ici pour :
--   · afficher « Contacté le … par … » sur la carte du compte ;
--   · demander confirmation avant un 2e message en moins de 2 jours ;
--   · suspendre la relance automatique dans les 2 jours qui suivent.
-- Le texte envoyé est conservé (trace de ce qui a été dit au client).
--
-- Écritures : serveur seulement (/api/admin/support-contact, service role).
-- Aucune lecture depuis le navigateur. Ré-exécutable.
-- ============================================================

CREATE TABLE IF NOT EXISTS support_contacts (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,  -- commerçant contacté
  shop_id     uuid        REFERENCES shops(id) ON DELETE SET NULL,
  channel     text        NOT NULL CHECK (channel IN ('email', 'whatsapp')),
  template    text        NOT NULL CHECK (template IN ('welcome_product', 'late_product', 'first_sale', 'free')),
  locale      text        NOT NULL DEFAULT 'fr',
  recipient   text,                                  -- adresse ou numéro utilisé
  subject     text,
  body        text        NOT NULL,
  sent_by     uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  provider_id text,                                  -- identifiant Resend (e-mail)
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_support_contacts_user ON support_contacts(user_id, created_at DESC);

ALTER TABLE support_contacts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON support_contacts FROM anon, authenticated;

NOTIFY pgrst, 'reload schema';

-- ── Vérification après exécution ───────────────────────────────────────────
-- SELECT count(*) FROM support_contacts;                                  -- 0
-- SELECT relrowsecurity FROM pg_class WHERE relname = 'support_contacts'; -- true

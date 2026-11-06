-- 217 — Liste d'attente des métiers (refonte de l'accueil, lot C, 6 nov. 2026) :
--   • une inscription = un métier (santé, services, éducation, location, hôtellerie, restauration, beauté, gestion
--     locative, autre) + un contact (e-mail en minuscules OU téléphone en chiffres) + facultatif : sous-métier
--     (ex. pharmacie), langue de la page, pays du visiteur (hébergeur) ;
--   • une seule ligne par métier et par contact : une nouvelle inscription du même contact met la ligne à jour et
--     compte les répétitions (signups), sans doublon ;
--   • notified_at : date à laquelle la personne a été prévenue de l'ouverture (rempli plus tard, depuis l'admin).
-- Écriture et lecture par le SERVEUR seul (/api/waitlist, Admin → Liste d'attente) : aucun accès des comptes
-- connectés ou anonymes, garde « table réservée au serveur » de la 154.
-- Retour arrière : supabase/rollbacks/217_waitlist_rollback.sql
-- Appliquée par « supabase db push » (transaction de la CLI) : pas de BEGIN / COMMIT dans ce fichier.

SET LOCAL lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS public.waitlist (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sector text NOT NULL,
  sub_trade text,
  contact text NOT NULL,
  contact_kind text NOT NULL,
  locale text NOT NULL DEFAULT 'fr',
  country text,
  signups integer NOT NULL DEFAULT 1,
  notified_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT waitlist_check CHECK (
    sector IN ('health', 'services', 'education', 'rental', 'hospitality', 'restaurant', 'beauty', 'property', 'other')
    AND (sub_trade IS NULL OR sub_trade ~ '^[a-z_]{2,40}$')
    AND contact_kind IN ('email', 'phone')
    AND char_length(contact) BETWEEN 6 AND 254
    -- E-mail en minuscules, une seule @, un point dans le domaine ; téléphone : chiffres seulement, + facultatif
    AND (contact_kind <> 'email' OR (contact = lower(contact) AND contact ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'))
    AND (contact_kind <> 'phone' OR contact ~ '^\+?[0-9]{6,15}$')
    AND locale IN ('fr', 'en', 'ha')
    AND (country IS NULL OR country ~ '^[A-Z]{2}$')
    AND signups >= 1
  )
);
CREATE UNIQUE INDEX IF NOT EXISTS waitlist_sector_contact_uidx ON public.waitlist (sector, contact);
CREATE INDEX IF NOT EXISTS waitlist_created_idx ON public.waitlist (created_at DESC);

ALTER TABLE public.waitlist ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.waitlist FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.waitlist TO service_role;
DROP TRIGGER IF EXISTS trg_waitlist_guard ON public.waitlist;
CREATE TRIGGER trg_waitlist_guard BEFORE INSERT OR UPDATE OR DELETE ON public.waitlist
  FOR EACH ROW EXECUTE FUNCTION public.guard_server_only_columns('*');

-- Garde-fou : état attendu, sinon tout est annulé
DO $$
BEGIN
  IF to_regclass('public.waitlist') IS NULL THEN RAISE EXCEPTION '217 : liste d''attente absente'; END IF;
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.waitlist'::regclass) THEN RAISE EXCEPTION '217 : règles d''accès non activées'; END IF;
  IF has_table_privilege('authenticated', 'public.waitlist', 'SELECT') OR has_table_privilege('anon', 'public.waitlist', 'SELECT')
     OR has_table_privilege('authenticated', 'public.waitlist', 'INSERT') OR has_table_privilege('anon', 'public.waitlist', 'INSERT') THEN
    RAISE EXCEPTION '217 : liste lisible ou modifiable par un compte connecté ou anonyme';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'waitlist_check') THEN RAISE EXCEPTION '217 : contrainte absente'; END IF;
  IF to_regclass('public.waitlist_sector_contact_uidx') IS NULL THEN RAISE EXCEPTION '217 : unicité métier + contact absente'; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_waitlist_guard') THEN RAISE EXCEPTION '217 : garde de la liste absente'; END IF;
END $$;

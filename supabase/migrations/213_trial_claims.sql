-- 213 — Protection de l'essai gratuit (tarification, étape 4A-2a, décisions du 4 nov. 2026) :
--   • 1 numéro de téléphone = 1 essai sur 12 mois ; sinon le compte est créé sans essai (message clair) ;
--   • registre des essais JAMAIS vidé par la suppression d'un compte (entity_id mis à NULL, la ligne reste) ;
--   • numéro, appareil et « nom + ville » gardés en EMPREINTES irréversibles (HMAC-SHA256, clé côté serveur) :
--     aucun numéro en clair dans ce registre ;
--   • l'appareil et « nom + ville » servent seulement à SIGNALER (« essai répété probable »), jamais à bloquer ;
--   • comptes Google : essai en attente du téléphone (entities.trial_status = 'pending_phone').
-- Écriture et lecture par le serveur seul (aucun accès des comptes connectés). entities est déjà gardée.
-- Retour arrière : supabase/rollbacks/213_trial_claims_rollback.sql
-- Appliquée par « supabase db push » (transaction de la CLI) : pas de BEGIN / COMMIT dans ce fichier.

SET LOCAL lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS public.trial_claims (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_id uuid REFERENCES public.entities(id) ON DELETE SET NULL,
  owner_user_id uuid,
  phone_hash text,
  device_hash text,
  name_hash text,
  country text,
  source text NOT NULL,
  granted boolean NOT NULL,
  flags text[] NOT NULL DEFAULT '{}',
  reason text,
  granted_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT trial_claims_check CHECK (
    source IN ('register', 'oauth', 'backfill', 'admin')
    AND (phone_hash IS NULL OR phone_hash ~ '^[0-9a-f]{64}$')
    AND (device_hash IS NULL OR device_hash ~ '^[0-9a-f]{64}$')
    AND (name_hash IS NULL OR name_hash ~ '^[0-9a-f]{64}$')
    -- Un essai accordé à la main l'est par quelqu'un, avec un motif
    AND (source <> 'admin' OR (granted_by IS NOT NULL AND char_length(coalesce(reason, '')) BETWEEN 3 AND 300))
    -- Une ligne d'inscription ou de reprise porte un numéro (c'est la règle)
    AND (source = 'admin' OR phone_hash IS NOT NULL)
  )
);
CREATE INDEX IF NOT EXISTS trial_claims_phone_idx ON public.trial_claims (phone_hash, created_at DESC) WHERE phone_hash IS NOT NULL;
CREATE INDEX IF NOT EXISTS trial_claims_device_idx ON public.trial_claims (device_hash, created_at DESC) WHERE device_hash IS NOT NULL;
CREATE INDEX IF NOT EXISTS trial_claims_name_idx ON public.trial_claims (name_hash, created_at DESC) WHERE name_hash IS NOT NULL;
CREATE INDEX IF NOT EXISTS trial_claims_entity_idx ON public.trial_claims (entity_id, created_at DESC);

ALTER TABLE public.trial_claims ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.trial_claims FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.trial_claims TO service_role;
DROP TRIGGER IF EXISTS trg_trial_claims_guard ON public.trial_claims;
CREATE TRIGGER trg_trial_claims_guard BEFORE INSERT OR UPDATE OR DELETE ON public.trial_claims
  FOR EACH ROW EXECUTE FUNCTION public.guard_server_only_columns('*');

-- État de l'essai de l'entreprise (NULL = compte d'avant la 213, inchangé)
ALTER TABLE public.entities ADD COLUMN IF NOT EXISTS trial_status text;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'entities_trial_status_check' AND conrelid = 'public.entities'::regclass) THEN
    ALTER TABLE public.entities ADD CONSTRAINT entities_trial_status_check CHECK (trial_status IS NULL OR trial_status IN ('granted', 'refused', 'pending_phone'));
  END IF;
END $$;

-- Garde-fou : état attendu, sinon tout est annulé
DO $$
DECLARE n int;
BEGIN
  IF to_regclass('public.trial_claims') IS NULL THEN RAISE EXCEPTION '213 : registre des essais absent'; END IF;
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.trial_claims'::regclass) THEN RAISE EXCEPTION '213 : règles d''accès non activées'; END IF;
  IF has_table_privilege('authenticated', 'public.trial_claims', 'SELECT') OR has_table_privilege('anon', 'public.trial_claims', 'SELECT') THEN
    RAISE EXCEPTION '213 : registre lisible par un compte connecté ou anonyme';
  END IF;
  SELECT count(*) INTO n FROM pg_constraint WHERE conname IN ('trial_claims_check', 'entities_trial_status_check');
  IF n <> 2 THEN RAISE EXCEPTION '213 : contraintes attendues absentes (% sur 2)', n; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_trial_claims_guard') THEN RAISE EXCEPTION '213 : garde du registre absente'; END IF;
END $$;

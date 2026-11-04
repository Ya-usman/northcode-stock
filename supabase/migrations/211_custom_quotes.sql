-- 211 — Offre sur mesure (tarification du 3-4 nov. 2026, étape 3) : à partir de 4 boutiques, le propriétaire demande un
-- devis ; l'administration fixe le prix (prix conseillé = Business + boutiques et employés au-delà, aux prix des options
-- du pays), les limites et la durée ; le devis part par e-mail (PDF + lien de paiement) ; le serveur lit le montant
-- dans le devis au paiement. Décisions du 4 nov. : devis valable 15 jours (prolongeable par l'admin), prix garanti
-- 1 an après le premier paiement puis révision.
--   custom_quotes                    : demandes et devis, écrits par le serveur seul ; le propriétaire lit les siens ;
--   entities.custom_shops / _seats   : limites sur mesure de l'entreprise (formule Business), posées au paiement ;
--   payment_intents.kind = 'custom'  : paiement d'un devis (quote_id obligatoire).
-- Retour arrière : supabase/rollbacks/211_custom_quotes_rollback.sql
-- Appliquée par « supabase db push » (transaction de la CLI) : pas de BEGIN / COMMIT dans ce fichier.

SET LOCAL lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS public.custom_quotes (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_id         uuid NOT NULL REFERENCES public.entities(id) ON DELETE CASCADE,
  shop_id           uuid REFERENCES public.shops(id) ON DELETE SET NULL,
  requested_by      uuid,
  status            text NOT NULL DEFAULT 'requested',
  -- Demande du client
  req_shops         integer NOT NULL,
  req_seats         integer NOT NULL,
  req_period        text NOT NULL,
  req_needs         text,
  req_phone         text,
  -- Devis de l'administration
  currency          text,
  pricing_country   text,
  suggested_monthly numeric,
  monthly_price     numeric,
  billing_period    text,
  period_total      numeric,
  limit_shops       integer,
  limit_seats       integer,
  client_note       text,
  admin_note        text,
  decline_reason    text,
  valid_until       timestamptz,
  price_until       timestamptz,
  token             text UNIQUE,
  quoted_by         uuid,
  quoted_at         timestamptz,
  sent_at           timestamptz,
  paid_at           timestamptz,
  payment_reference text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT custom_quotes_check CHECK (
    status IN ('requested', 'quoted', 'paid', 'declined', 'expired', 'cancelled')
    AND req_shops BETWEEN 1 AND 200 AND req_seats BETWEEN 0 AND 2000
    AND req_period IN ('monthly', 'semiannual', 'annual')
    AND (req_needs IS NULL OR char_length(req_needs) <= 1000)
    AND (req_phone IS NULL OR char_length(req_phone) <= 40)
    AND (client_note IS NULL OR char_length(client_note) <= 1000)
    AND (admin_note IS NULL OR char_length(admin_note) <= 1000)
    AND (decline_reason IS NULL OR char_length(decline_reason) <= 300)
    AND (currency IS NULL OR currency ~ '^[A-Z]{3}$')
    AND (pricing_country IS NULL OR pricing_country ~ '^[A-Z]{2}$')
    AND (billing_period IS NULL OR billing_period IN ('monthly', 'semiannual', 'annual'))
    AND (token IS NULL OR char_length(token) BETWEEN 24 AND 80)
    -- Un devis envoyé ou payé est complet : prix, durée, total, limites, devise, validité, lien
    AND (status IN ('requested', 'declined', 'cancelled') OR (
      monthly_price > 0 AND period_total > 0 AND billing_period IS NOT NULL AND currency IS NOT NULL
      AND limit_shops BETWEEN 1 AND 200 AND limit_seats BETWEEN 0 AND 2000 AND valid_until IS NOT NULL AND token IS NOT NULL))
  )
);
CREATE INDEX IF NOT EXISTS custom_quotes_entity_idx ON public.custom_quotes (entity_id, created_at DESC);
CREATE INDEX IF NOT EXISTS custom_quotes_status_idx ON public.custom_quotes (status, created_at DESC);

ALTER TABLE public.custom_quotes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.custom_quotes FROM PUBLIC, anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.custom_quotes FROM authenticated;
GRANT SELECT ON public.custom_quotes TO authenticated;
GRANT ALL ON public.custom_quotes TO service_role;
DROP POLICY IF EXISTS custom_quotes_owner_read ON public.custom_quotes;
CREATE POLICY custom_quotes_owner_read ON public.custom_quotes FOR SELECT TO authenticated
  USING (public.is_super_admin() OR EXISTS (SELECT 1 FROM public.entities e WHERE e.id = custom_quotes.entity_id AND e.owner_user_id = auth.uid()));
DROP TRIGGER IF EXISTS trg_custom_quotes_guard ON public.custom_quotes;
CREATE TRIGGER trg_custom_quotes_guard BEFORE INSERT OR UPDATE OR DELETE ON public.custom_quotes
  FOR EACH ROW EXECUTE FUNCTION public.guard_server_only_columns('*');

-- Limites sur mesure de l'entreprise (NULL = aucune)
ALTER TABLE public.entities
  ADD COLUMN IF NOT EXISTS custom_shops integer,
  ADD COLUMN IF NOT EXISTS custom_seats integer,
  ADD COLUMN IF NOT EXISTS custom_quote_id uuid REFERENCES public.custom_quotes(id) ON DELETE SET NULL;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'entities_custom_limits_check' AND conrelid = 'public.entities'::regclass) THEN
    ALTER TABLE public.entities ADD CONSTRAINT entities_custom_limits_check CHECK (
      (custom_shops IS NULL OR custom_shops BETWEEN 1 AND 200) AND (custom_seats IS NULL OR custom_seats BETWEEN 0 AND 2000));
  END IF;
END $$;

-- Paiement d'un devis
ALTER TABLE public.payment_intents ADD COLUMN IF NOT EXISTS quote_id uuid REFERENCES public.custom_quotes(id) ON DELETE SET NULL;
ALTER TABLE public.payment_intents DROP CONSTRAINT IF EXISTS payment_intents_addons_check;
ALTER TABLE public.payment_intents ADD CONSTRAINT payment_intents_addons_check CHECK (
  kind IN ('plan', 'addon', 'custom')
  AND addon_seats BETWEEN 0 AND 20 AND addon_shops BETWEEN 0 AND 2
  AND (kind <> 'addon' OR (addon_seats + addon_shops > 0 AND period_end IS NOT NULL))
  AND (kind <> 'custom' OR quote_id IS NOT NULL));

-- Garde-fou : état attendu, sinon tout est annulé
DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM information_schema.columns WHERE table_schema = 'public'
     AND ((table_name = 'entities' AND column_name IN ('custom_shops', 'custom_seats', 'custom_quote_id'))
       OR (table_name = 'payment_intents' AND column_name = 'quote_id'));
  IF n <> 4 THEN RAISE EXCEPTION '211 : colonnes attendues absentes (% sur 4)', n; END IF;
  IF to_regclass('public.custom_quotes') IS NULL THEN RAISE EXCEPTION '211 : table custom_quotes absente'; END IF;
  SELECT count(*) INTO n FROM pg_policies WHERE schemaname = 'public' AND tablename = 'custom_quotes';
  IF n <> 1 THEN RAISE EXCEPTION '211 : règles de lecture inattendues sur custom_quotes (%)', n; END IF;
END $$;

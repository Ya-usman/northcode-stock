-- ============================================================
-- 204 : paiements d'abonnement préparés par le serveur — 3 nov. 2026
-- ============================================================
-- Faille corrigée : à la confirmation d'un paiement (routes /api/billing/*/verify), l'application lisait la formule et la
-- durée dans les informations JOINTES AU PAIEMENT (meta Flutterwave / NotchPay, metadata Paystack, client_reference
-- Wave) et ne comparait jamais le montant payé au prix. Quelqu'un pouvait payer un petit montant avec « Business, 1 an »
-- en informations jointes. Aucune trace d'exploitation (13 paiements, tous de test, montants = catalogue).
--
-- Désormais chaque paiement est PRÉPARÉ par le serveur (/api/billing/subscribe) : une ligne payment_intents garde notre
-- référence, la formule, la durée, la devise et le montant attendu. La confirmation retrouve cette ligne par la
-- référence, vérifie montant et devise auprès de la passerelle, et n'active que ce qui a été préparé. Les informations
-- jointes au paiement ne sont plus jamais crues. Une ligne n'est réglée qu'une fois (statut conditionnel).
--
-- Accès : serveur seul (client admin). Aucune politique de lecture pour les comptes connectés ; écriture verrouillée par
-- le même garde que les gestes commerciaux (migration 154). Ré-exécutable. Retour arrière :
-- supabase/rollbacks/204_payment_intents_rollback.sql
-- ============================================================

SET LOCAL lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS public.payment_intents (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Notre référence (tx_ref Flutterwave, reference Paystack, client_reference Wave, référence marchand NotchPay)
  reference         text NOT NULL UNIQUE CHECK (char_length(reference) BETWEEN 8 AND 80),
  gateway           text NOT NULL CHECK (gateway IN ('paystack', 'notchpay', 'flutterwave', 'wave', 'stripe')),
  -- Référence donnée par la passerelle à la création (session Wave, transaction NotchPay), pour la retrouver au retour
  gateway_reference text,
  entity_id         uuid REFERENCES public.entities(id) ON DELETE SET NULL,
  shop_id           uuid NOT NULL REFERENCES public.shops(id) ON DELETE CASCADE,
  owner_id          uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  plan              text NOT NULL CHECK (plan IN ('starter', 'pro', 'business')),
  billing_period    text NOT NULL CHECK (billing_period IN ('monthly', 'quarterly', 'semiannual', 'annual')),
  currency          text NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  -- Prix de la formule pour la durée, crédit de parrainage déduit, et ce qui est demandé à la passerelle
  amount            numeric(14, 2) NOT NULL CHECK (amount > 0),
  credit_applied    numeric(14, 2) NOT NULL DEFAULT 0 CHECK (credit_applied >= 0),
  amount_due        numeric(14, 2) NOT NULL CHECK (amount_due > 0 AND amount_due <= amount),
  auto_renew        boolean NOT NULL DEFAULT false,
  status            text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'paid', 'review', 'failed')),
  -- Ce que la passerelle a confirmé
  paid_amount       numeric(14, 2),
  paid_currency     text,
  gateway_tx_id     text,
  review_reason     text CHECK (review_reason IS NULL OR char_length(review_reason) <= 300),
  created_at        timestamptz NOT NULL DEFAULT now(),
  settled_at        timestamptz
);
CREATE INDEX IF NOT EXISTS idx_payment_intents_gateway_ref ON public.payment_intents(gateway_reference) WHERE gateway_reference IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_payment_intents_review ON public.payment_intents(created_at) WHERE status = 'review';

-- Lecture : super administrateur seulement (page Paiements de l'administration) ; le serveur passe par le client admin
ALTER TABLE public.payment_intents ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS payment_intents_select ON public.payment_intents;
CREATE POLICY payment_intents_select ON public.payment_intents FOR SELECT USING (is_super_admin());
REVOKE ALL ON public.payment_intents FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public.payment_intents FROM authenticated;

-- Écriture : serveur seul (verrou de la migration 154)
DROP TRIGGER IF EXISTS trg_payment_intents_guard ON public.payment_intents;
CREATE TRIGGER trg_payment_intents_guard BEFORE INSERT OR UPDATE OR DELETE ON public.payment_intents
  FOR EACH ROW EXECUTE FUNCTION guard_server_only_columns('*');

-- ── Vérification après exécution ───────────────────────────────────────────
-- SELECT count(*) FROM payment_intents;                                              -- 0
-- SELECT tgname FROM pg_trigger WHERE tgname = 'trg_payment_intents_guard';          -- 1 ligne
-- SELECT polname FROM pg_policy WHERE polrelid = 'public.payment_intents'::regclass; -- payment_intents_select

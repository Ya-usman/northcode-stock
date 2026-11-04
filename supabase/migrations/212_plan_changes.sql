-- 212 — Changements de formule sans perte (tarification, étape 4A-1, décisions du 4 nov. 2026) :
--   • renouvellement anticipé de la même formule : la nouvelle période commence à la fin de l'actuelle ;
--   • montée de formule : immédiate, avec un crédit pour les jours payés et non utilisés (payment_intents.prorata_credit) ;
--   • descente de formule : payée maintenant, appliquée à la fin de la période payée (entities.next_*) ;
--   • remboursement d'un paiement fait par erreur (48 h) : l'administration remet la situation d'avant
--     (payment_intents.prev_* gardés au paiement, statut « refunded »).
-- Écriture par le serveur seul : entities et payment_intents sont déjà gardées (guard_server_only_columns('*')).
-- Retour arrière : supabase/rollbacks/212_plan_changes_rollback.sql
-- Appliquée par « supabase db push » (transaction de la CLI) : pas de BEGIN / COMMIT dans ce fichier.

SET LOCAL lock_timeout = '5s';

-- Changement programmé (descente de formule, ou options du renouvellement anticipé)
ALTER TABLE public.entities
  ADD COLUMN IF NOT EXISTS next_plan text,
  ADD COLUMN IF NOT EXISTS next_plan_from timestamptz,
  ADD COLUMN IF NOT EXISTS next_plan_until timestamptz,
  ADD COLUMN IF NOT EXISTS next_billing_period text,
  ADD COLUMN IF NOT EXISTS next_addon_seats integer,
  ADD COLUMN IF NOT EXISTS next_addon_shops integer;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'entities_next_plan_check' AND conrelid = 'public.entities'::regclass) THEN
    ALTER TABLE public.entities ADD CONSTRAINT entities_next_plan_check CHECK (
      -- coalesce : une valeur vide rend la condition « inconnue », que CHECK accepterait (piège vu en 205)
      coalesce((next_plan IS NULL AND next_plan_from IS NULL AND next_plan_until IS NULL)
        OR (next_plan IS NOT NULL AND next_plan IN ('starter', 'pro', 'business') AND next_plan_from IS NOT NULL
            AND next_plan_until IS NOT NULL AND next_plan_until > next_plan_from), false)
      AND (next_billing_period IS NULL OR next_billing_period IN ('monthly', 'semiannual', 'annual', 'quarterly'))
      AND (next_addon_seats IS NULL OR next_addon_seats BETWEEN 0 AND 20)
      AND (next_addon_shops IS NULL OR next_addon_shops BETWEEN 0 AND 2));
  END IF;
END $$;

-- Paiements : crédit de montée, manière d'appliquer, situation d'avant (pour un remboursement d'erreur)
ALTER TABLE public.payment_intents
  ADD COLUMN IF NOT EXISTS prorata_credit numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS schedule text NOT NULL DEFAULT 'now',
  ADD COLUMN IF NOT EXISTS prev_plan text,
  ADD COLUMN IF NOT EXISTS prev_plan_expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS prev_trial_ends_at timestamptz,
  ADD COLUMN IF NOT EXISTS refunded_at timestamptz,
  ADD COLUMN IF NOT EXISTS refund_reason text;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'payment_intents_changes_check' AND conrelid = 'public.payment_intents'::regclass) THEN
    ALTER TABLE public.payment_intents ADD CONSTRAINT payment_intents_changes_check CHECK (
      prorata_credit >= 0 AND schedule IN ('now', 'stack', 'next')
      AND (refund_reason IS NULL OR char_length(refund_reason) BETWEEN 3 AND 300)
      AND ((refunded_at IS NULL) = (refund_reason IS NULL)));
  END IF;
END $$;
-- Statut « refunded » (remboursé par l'administration)
ALTER TABLE public.payment_intents DROP CONSTRAINT IF EXISTS payment_intents_status_check;
ALTER TABLE public.payment_intents ADD CONSTRAINT payment_intents_status_check CHECK (status IN ('pending', 'paid', 'review', 'failed', 'refunded'));

-- Durée « 6 mois » acceptée dans les abonnements enregistrés (défaut trouvé le 4 nov. : vendue depuis le 3 nov. mais
-- refusée ici, l'abonnement payé n'aurait pas été enregistré ; 0 paiement de 6 mois à ce jour)
ALTER TABLE public.subscriptions DROP CONSTRAINT IF EXISTS subscriptions_billing_period_check;
ALTER TABLE public.subscriptions ADD CONSTRAINT subscriptions_billing_period_check CHECK (billing_period IN ('monthly', 'quarterly', 'semiannual', 'annual'));

-- Garde-fou : état attendu, sinon tout est annulé
DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM information_schema.columns WHERE table_schema = 'public'
     AND ((table_name = 'entities' AND column_name IN ('next_plan', 'next_plan_from', 'next_plan_until', 'next_billing_period', 'next_addon_seats', 'next_addon_shops'))
       OR (table_name = 'payment_intents' AND column_name IN ('prorata_credit', 'schedule', 'prev_plan', 'prev_plan_expires_at', 'prev_trial_ends_at', 'refunded_at', 'refund_reason')));
  IF n <> 13 THEN RAISE EXCEPTION '212 : colonnes attendues absentes (% sur 13)', n; END IF;
  SELECT count(*) INTO n FROM pg_constraint WHERE conname IN ('entities_next_plan_check', 'payment_intents_changes_check', 'payment_intents_status_check');
  IF n <> 3 THEN RAISE EXCEPTION '212 : contraintes attendues absentes (% sur 3)', n; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'subscriptions_billing_period_check' AND pg_get_constraintdef(oid) LIKE '%semiannual%') THEN
    RAISE EXCEPTION '212 : durée 6 mois non acceptée dans les abonnements';
  END IF;
END $$;

-- Retour arrière de la 212 (changements de formule). À n'exécuter qu'APRÈS avoir remis en ligne le code d'avant.
-- Données perdues (changements programmés, crédits de montée, remboursements) : exporter d'abord
--   SELECT id, name, next_plan, next_plan_from, next_plan_until FROM entities WHERE next_plan IS NOT NULL;
--   SELECT reference, prorata_credit, schedule, prev_plan, refunded_at, refund_reason FROM payment_intents WHERE prorata_credit > 0 OR schedule <> 'now' OR refunded_at IS NOT NULL;
-- Un paiement « refunded » empêche de remettre l'ancien contrôle des statuts : vérifier d'abord
--   SELECT count(*) FROM payment_intents WHERE status = 'refunded';   -- doit valoir 0
SET LOCAL lock_timeout = '5s';
ALTER TABLE public.payment_intents DROP CONSTRAINT IF EXISTS payment_intents_status_check;
ALTER TABLE public.payment_intents ADD CONSTRAINT payment_intents_status_check CHECK (status IN ('pending', 'paid', 'review', 'failed'));
ALTER TABLE public.payment_intents DROP CONSTRAINT IF EXISTS payment_intents_changes_check;
ALTER TABLE public.payment_intents DROP COLUMN IF EXISTS prorata_credit, DROP COLUMN IF EXISTS schedule, DROP COLUMN IF EXISTS prev_plan,
  DROP COLUMN IF EXISTS prev_plan_expires_at, DROP COLUMN IF EXISTS prev_trial_ends_at, DROP COLUMN IF EXISTS refunded_at, DROP COLUMN IF EXISTS refund_reason;
ALTER TABLE public.entities DROP CONSTRAINT IF EXISTS entities_next_plan_check;
ALTER TABLE public.entities DROP COLUMN IF EXISTS next_plan, DROP COLUMN IF EXISTS next_plan_from, DROP COLUMN IF EXISTS next_plan_until,
  DROP COLUMN IF EXISTS next_billing_period, DROP COLUMN IF EXISTS next_addon_seats, DROP COLUMN IF EXISTS next_addon_shops;
-- La durée « 6 mois » reste acceptée dans les abonnements (correction d'un défaut, pas un retour en arrière souhaitable)

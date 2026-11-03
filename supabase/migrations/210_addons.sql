-- 210 — Options payantes (tarification du 3 nov. 2026, étape 2) : employés et boutiques en plus, achetés par le
-- propriétaire, alignés sur l'abonnement (même date de fin, même durée, prorata en cours de période).
-- Règles validées le 3 nov. : au plus 3 boutiques en tout avec les options (au-delà : offre sur mesure), au plus 20
-- employés en plus ; un retrait prend effet au prochain renouvellement, sans remboursement.
--   entities.addon_seats / addon_shops           : options PAYÉES pour la période en cours ;
--   entities.addon_seats_renew / addon_shops_renew : quantité à renouveler (NULL = la même) — retrait programmé.
--   payment_intents.kind = 'addon'                : achat d'options en cours de période (addon_seats / addon_shops =
--                                                   quantités ajoutées, period_end = fin de la période payée au prorata) ;
--   payment_intents.kind = 'plan'                 : formule, options du renouvellement comprises (addon_* = quantités).
-- Écriture par le serveur seul : entities et payment_intents sont déjà gardées (guard_server_only_columns('*')).
-- Retour arrière : supabase/rollbacks/210_addons_rollback.sql
-- Appliquée par « supabase db push » (transaction de la CLI) : pas de BEGIN / COMMIT dans ce fichier.

SET LOCAL lock_timeout = '5s';

ALTER TABLE public.entities
  ADD COLUMN IF NOT EXISTS addon_seats integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS addon_shops integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS addon_seats_renew integer,
  ADD COLUMN IF NOT EXISTS addon_shops_renew integer;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'entities_addons_check' AND conrelid = 'public.entities'::regclass) THEN
    ALTER TABLE public.entities ADD CONSTRAINT entities_addons_check CHECK (
      addon_seats BETWEEN 0 AND 20 AND addon_shops BETWEEN 0 AND 2
      AND (addon_seats_renew IS NULL OR addon_seats_renew BETWEEN 0 AND 20)
      AND (addon_shops_renew IS NULL OR addon_shops_renew BETWEEN 0 AND 2));
  END IF;
END $$;

ALTER TABLE public.payment_intents
  ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'plan',
  ADD COLUMN IF NOT EXISTS addon_seats integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS addon_shops integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS period_end timestamptz;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'payment_intents_addons_check' AND conrelid = 'public.payment_intents'::regclass) THEN
    ALTER TABLE public.payment_intents ADD CONSTRAINT payment_intents_addons_check CHECK (
      kind IN ('plan', 'addon')
      AND addon_seats BETWEEN 0 AND 20 AND addon_shops BETWEEN 0 AND 2
      AND (kind = 'plan' OR (addon_seats + addon_shops > 0 AND period_end IS NOT NULL)));
  END IF;
END $$;

-- Garde-fou : colonnes et contraintes présentes, sinon tout est annulé
DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM information_schema.columns WHERE table_schema = 'public'
     AND ((table_name = 'entities' AND column_name IN ('addon_seats', 'addon_shops', 'addon_seats_renew', 'addon_shops_renew'))
       OR (table_name = 'payment_intents' AND column_name IN ('kind', 'addon_seats', 'addon_shops', 'period_end')));
  IF n <> 8 THEN RAISE EXCEPTION '210 : colonnes attendues absentes (% sur 8)', n; END IF;
  SELECT count(*) INTO n FROM pg_constraint WHERE conname IN ('entities_addons_check', 'payment_intents_addons_check');
  IF n <> 2 THEN RAISE EXCEPTION '210 : contraintes attendues absentes (% sur 2)', n; END IF;
END $$;

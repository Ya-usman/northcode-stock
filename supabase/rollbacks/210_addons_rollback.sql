-- Retour arrière de la 210 (options payantes). À n'exécuter qu'APRÈS avoir remis en ligne le code d'avant (le serveur
-- écrit ces colonnes). Données perdues (options achetées) : exporter d'abord
--   SELECT id, name, addon_seats, addon_shops, addon_seats_renew, addon_shops_renew FROM entities WHERE addon_seats + addon_shops > 0;
--   SELECT * FROM payment_intents WHERE kind = 'addon' OR addon_seats + addon_shops > 0;
SET LOCAL lock_timeout = '5s';
ALTER TABLE public.payment_intents DROP CONSTRAINT IF EXISTS payment_intents_addons_check;
ALTER TABLE public.payment_intents DROP COLUMN IF EXISTS kind, DROP COLUMN IF EXISTS addon_seats, DROP COLUMN IF EXISTS addon_shops, DROP COLUMN IF EXISTS period_end;
ALTER TABLE public.entities DROP CONSTRAINT IF EXISTS entities_addons_check;
ALTER TABLE public.entities DROP COLUMN IF EXISTS addon_seats, DROP COLUMN IF EXISTS addon_shops, DROP COLUMN IF EXISTS addon_seats_renew, DROP COLUMN IF EXISTS addon_shops_renew;

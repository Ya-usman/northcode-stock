-- Retour arrière de 218 (totaux de période de l'Historique) : retire les deux fonctions de calcul.
-- Aucune donnée touchée. L'écran de l'Historique doit d'abord revenir à la version qui additionne dans le navigateur.
SET LOCAL lock_timeout = '5s';

DROP FUNCTION IF EXISTS public.sales_period_totals(uuid[], timestamptz, timestamptz, text[], text[], text, uuid[]);
DROP FUNCTION IF EXISTS public.payments_period_collected(uuid[], timestamptz, timestamptz, text[], text[], uuid[]);

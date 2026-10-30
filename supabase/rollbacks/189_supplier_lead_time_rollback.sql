-- ============================================================
-- Retour arrière de la 189 : retire le délai de livraison des fournisseurs.
-- Perd les délais déclarés (aucune autre donnée touchée). L'application fonctionne sans la colonne :
-- le champ disparaît de la fiche fournisseur et le réapprovisionnement retombe sur le délai constaté.
-- ============================================================

SET LOCAL lock_timeout = '5s';

ALTER TABLE public.suppliers DROP CONSTRAINT IF EXISTS suppliers_lead_time_days_range;
ALTER TABLE public.suppliers DROP COLUMN IF EXISTS lead_time_days;

NOTIFY pgrst, 'reload schema';

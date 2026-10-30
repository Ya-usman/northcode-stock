-- ============================================================
-- 189 : délai de livraison habituel d'un fournisseur (Stock › Réapprovisionnement, décision du 30 oct. 2026)
-- ============================================================
-- Une seule colonne, facultative : lead_time_days = nombre de jours habituel entre la commande et la livraison,
-- déclaré dans la fiche du fournisseur. Vide = inconnu (le réapprovisionnement se sert alors du délai constaté sur
-- les bons reçus, sinon d'aucun délai). Sert à proposer le fournisseur « plus rapide » et à commander assez tôt.
--
-- Droits : RÉSERVÉE AU SERVEUR. Règle « fail-closed » de la 183 : aucune colonne ajoutée à suppliers n'est lisible
-- par le navigateur sans GRANT SELECT explicite ; celle-ci n'en reçoit pas. Elle est lue par /api/stock/replenishment
-- et /api/suppliers/lead-times, écrite par /api/suppliers (droit Fournisseurs en modification), tous côté serveur.
--
-- Additive, sans réécriture de la table (colonne nullable sans valeur par défaut). Ré-exécutable.
-- Retour arrière : supabase/rollbacks/189_supplier_lead_time_rollback.sql
-- ============================================================

SET LOCAL lock_timeout = '5s';

ALTER TABLE public.suppliers ADD COLUMN IF NOT EXISTS lead_time_days integer;

ALTER TABLE public.suppliers DROP CONSTRAINT IF EXISTS suppliers_lead_time_days_range;
ALTER TABLE public.suppliers ADD CONSTRAINT suppliers_lead_time_days_range
  CHECK (lead_time_days IS NULL OR lead_time_days BETWEEN 0 AND 180);

COMMENT ON COLUMN public.suppliers.lead_time_days IS
  'Délai de livraison habituel en jours, déclaré (migration 189) ; NULL = inconnu ; lu et écrit par le serveur seulement';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_schema = 'public' AND table_name = 'suppliers' AND column_name = 'lead_time_days'
                    AND data_type = 'integer' AND is_nullable = 'YES') THEN
    RAISE EXCEPTION '189 : colonne suppliers.lead_time_days absente ou inattendue — annulé';
  END IF;
  -- Fail-closed : ni le navigateur (authenticated) ni anon ne lisent la colonne ; le serveur (service_role) la lit
  IF has_column_privilege('authenticated', 'public.suppliers', 'lead_time_days', 'SELECT')
     OR has_column_privilege('anon', 'public.suppliers', 'lead_time_days', 'SELECT') THEN
    RAISE EXCEPTION '189 : suppliers.lead_time_days lisible par le navigateur — annulé';
  END IF;
  IF NOT has_column_privilege('service_role', 'public.suppliers', 'lead_time_days', 'SELECT') THEN
    RAISE EXCEPTION '189 : service_role ne lit pas suppliers.lead_time_days — annulé';
  END IF;
  -- total_owed toujours réservé au serveur (183)
  IF has_column_privilege('authenticated', 'public.suppliers', 'total_owed', 'SELECT') THEN
    RAISE EXCEPTION '189 : suppliers.total_owed lisible par le navigateur — annulé';
  END IF;
  RAISE NOTICE '189 : suppliers.lead_time_days ajoutée, réservée au serveur';
END $$;

NOTIFY pgrst, 'reload schema';

-- ── Vérification après exécution ───────────────────────────────────────────
-- SELECT column_name, data_type, is_nullable FROM information_schema.columns
--  WHERE table_schema = 'public' AND table_name = 'suppliers' AND column_name = 'lead_time_days';
-- Attendu : lead_time_days | integer | YES

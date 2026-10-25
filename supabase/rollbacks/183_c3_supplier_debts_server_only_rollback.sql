-- Retour arrière de 183_c3_supplier_debts_server_only.sql — immédiat, sans redéploiement, à lancer seulement sur
-- décision explicite (éditeur SQL en urgence). Rétablit EXACTEMENT les droits d'avant : SELECT de table pour anon et
-- authenticated sur suppliers, purchase_orders et supplier_payments, aucun droit par colonne. Ne touche pas
-- supabase_migrations : enregistrer ensuite l'état (« supabase migration repair --status reverted 183 », ou une
-- nouvelle migration) sur décision.
BEGIN;
SET LOCAL lock_timeout = '5s';

REVOKE SELECT (id, shop_id, name, phone, city, created_at, deleted_at, email) ON public.suppliers FROM authenticated;
GRANT SELECT ON public.suppliers, public.purchase_orders, public.supplier_payments TO anon, authenticated;

NOTIFY pgrst, 'reload schema';
COMMIT;

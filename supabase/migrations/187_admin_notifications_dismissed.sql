-- ============================================================
-- 187 : messages du support masqués par le propriétaire (« × » dans la cloche), décision du 29 oct. 2026
-- ============================================================
-- Une seule colonne : dismissed_at (instant où le propriétaire a masqué le message). Le message reste en base et
-- visible côté administration (historique des envois) ; seule la cloche du propriétaire ne l'affiche plus.
--
-- Droits inchangés : la politique notifs_owner_mark_read (039) laisse déjà le propriétaire modifier ses messages, et
-- le verrou trg_admin_notifications_guard (160) ne protège que id, shop_id, type, title, message et created_at. La
-- nouvelle colonne est donc modifiable par le propriétaire comme read_at ; le texte, lui, reste intouchable ;
-- création et suppression restent réservées au serveur.
--
-- Additive, sans réécriture de la table (colonne nullable sans valeur par défaut). Ré-exécutable.
-- Retour arrière : supabase/rollbacks/187_admin_notifications_dismissed_rollback.sql
-- ============================================================

ALTER TABLE public.admin_notifications ADD COLUMN IF NOT EXISTS dismissed_at timestamptz;

COMMENT ON COLUMN public.admin_notifications.dismissed_at IS
  'Masqué par le propriétaire dans la cloche (migration 187) ; le message reste visible côté administration';

NOTIFY pgrst, 'reload schema';

-- ── Vérification après exécution ───────────────────────────────────────────
-- SELECT column_name, data_type, is_nullable FROM information_schema.columns
--  WHERE table_schema = 'public' AND table_name = 'admin_notifications' AND column_name = 'dismissed_at';
-- Attendu : dismissed_at | timestamp with time zone | YES

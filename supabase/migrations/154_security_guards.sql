-- ============================================================
-- 154 — Verrous de sécurité : colonnes sensibles réservées au serveur
--       (5 oct. 2026)
--
-- À APPLIQUER TOUT DE SUITE : compatible avec le code actuellement en ligne.
--
-- Constat (relecture des migrations 001, 006, 153) :
--   • profiles_update_own (001) : toute personne connectée peut modifier
--     TOUTES les colonnes de son profil depuis le navigateur — dont `role`
--     (lu par is_super_admin()), `is_internal`, `shop_id` et le plan.
--   • shop_owner_can_insert_self (006) : WITH CHECK (user_id = auth.uid())
--     → n'importe qui peut s'ajouter à n'importe quelle boutique, avec
--     n'importe quel rôle (y compris « owner »).
--   • entities_owner_update (153) : le propriétaire peut modifier sa ligne
--     d'entreprise depuis le navigateur — y compris plan / plan_expires_at.
--   • shops_owner_update (040) : le propriétaire peut modifier entity_id,
--     is_internal, suspended_by_plan, billing_country (prix) de sa boutique.
--
-- Usage réel par l'application (vérifié dans le code le 5 oct. 2026) : depuis
-- le navigateur, seules `profiles.last_seen`, `profiles.locale` et
-- `shops.logo_url` sont écrites ; tout le reste passe par les routes /api
-- (clé de service). Les verrous ci-dessous n'enlèvent donc aucune
-- fonctionnalité.
--
-- Principe : un trigger refuse, pour une requête venant d'un NAVIGATEUR
-- (jeton « authenticated » ou « anon ») d'une personne qui n'est pas
-- super_admin, toute modification des colonnes listées. Le serveur (clé de
-- service), l'éditeur SQL et les triggers internes ne sont pas concernés.
-- Le verrou fonctionne quel que soit l'état des politiques RLS existantes.
--
-- Aucune donnée n'est modifiée. Ré-exécutable.
-- ============================================================

-- ── 1. Qui appelle ? ───────────────────────────────────────────────────────
-- true = requête PostgREST d'une personne (jeton authenticated/anon) qui n'est
-- pas super_admin. false = clé de service, éditeur SQL, GoTrue, cron interne.
CREATE OR REPLACE FUNCTION request_is_restricted() RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_role text;
BEGIN
  v_role := COALESCE(
    NULLIF(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role',
    NULLIF(current_setting('request.jwt.claim.role', true), '')
  );
  IF v_role IS NULL OR v_role NOT IN ('authenticated', 'anon') THEN RETURN false; END IF;
  RETURN NOT is_super_admin();
END $$;

-- ── 2. Verrou générique ────────────────────────────────────────────────────
-- Arguments du trigger = colonnes réservées au serveur. '*' = table entière
-- réservée au serveur (aucune écriture depuis le navigateur).
-- INSERT / DELETE depuis le navigateur : refusés sur les tables verrouillées.
-- Comparaison via to_jsonb : une colonne supprimée plus tard (ex. plan du
-- profil, migration 155) est simplement ignorée, sans erreur.
CREATE OR REPLACE FUNCTION guard_server_only_columns() RETURNS trigger
LANGUAGE plpgsql SET search_path = public AS $$
DECLARE c text; v_new jsonb; v_old jsonb;
BEGIN
  IF NOT request_is_restricted() THEN
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  END IF;
  IF TG_OP <> 'UPDATE' OR '*' = ANY (TG_ARGV) THEN
    RAISE EXCEPTION 'Opération % sur % réservée au serveur', TG_OP, TG_TABLE_NAME
      USING ERRCODE = '42501';
  END IF;
  v_new := to_jsonb(NEW); v_old := to_jsonb(OLD);
  FOREACH c IN ARRAY TG_ARGV LOOP
    IF (v_new -> c) IS DISTINCT FROM (v_old -> c) THEN
      RAISE EXCEPTION 'Colonne %.% modifiable uniquement par le serveur', TG_TABLE_NAME, c
        USING ERRCODE = '42501';
    END IF;
  END LOOP;
  RETURN NEW;
END $$;

-- ── 3. Profils : rôle, boutique principale, accès, compte interne, plan ────
DROP TRIGGER IF EXISTS trg_profiles_guard ON profiles;
CREATE TRIGGER trg_profiles_guard BEFORE INSERT OR UPDATE OR DELETE ON profiles
  FOR EACH ROW EXECUTE FUNCTION guard_server_only_columns(
    'id', 'role', 'shop_id', 'is_active', 'is_internal',
    'plan', 'plan_expires_at', 'trial_ends_at', 'plan_grace_ends_at');

-- ── 4. Boutiques : propriété, entreprise, compte interne, suspension, prix ─
DROP TRIGGER IF EXISTS trg_shops_guard ON shops;
CREATE TRIGGER trg_shops_guard BEFORE INSERT OR UPDATE OR DELETE ON shops
  FOR EACH ROW EXECUTE FUNCTION guard_server_only_columns(
    'id', 'owner_id', 'entity_id', 'is_internal', 'suspended_by_plan',
    'billing_country', 'agent_id', 'deleted_at');

-- ── 5. Affectations, entreprise, membres de l'entreprise : serveur seul ───
DROP TRIGGER IF EXISTS trg_shop_members_guard ON shop_members;
CREATE TRIGGER trg_shop_members_guard BEFORE INSERT OR UPDATE OR DELETE ON shop_members
  FOR EACH ROW EXECUTE FUNCTION guard_server_only_columns('*');

DROP TRIGGER IF EXISTS trg_entities_guard ON entities;
CREATE TRIGGER trg_entities_guard BEFORE INSERT OR UPDATE OR DELETE ON entities
  FOR EACH ROW EXECUTE FUNCTION guard_server_only_columns('*');

DROP TRIGGER IF EXISTS trg_entity_members_guard ON entity_members;
CREATE TRIGGER trg_entity_members_guard BEFORE INSERT OR UPDATE OR DELETE ON entity_members
  FOR EACH ROW EXECUTE FUNCTION guard_server_only_columns('*');

-- ── 6. Politiques devenues sans objet ──────────────────────────────────────
-- Écriture de l'entreprise : uniquement via /api/entity (clé de service).
DROP POLICY IF EXISTS entities_owner_update ON entities;
-- Auto-ajout à une boutique : jamais utilisé par l'application (création de
-- boutique et invitations = routes serveur).
DROP POLICY IF EXISTS "shop_owner_can_insert_self" ON shop_members;

-- ── 7. Fonctions « serveur seul » : plus appelables depuis le navigateur ──
-- Constat (sonde du 5 oct. 2026, clé ANONYME, identifiants inexistants) :
-- validate_payment, adjust_referral_wallet, resolve_referral_payout…
-- s'exécutaient pour un visiteur anonyme. Les « REVOKE … FROM PUBLIC » des
-- migrations précédentes sont sans effet sur Supabase, qui accorde aussi
-- EXECUTE directement aux rôles anon et authenticated. Ces fonctions font
-- confiance à leurs paramètres (p_user_id, p_reviewer_id, p_shop_id) : un
-- inconnu pouvait créditer un portefeuille de parrainage, valider un retrait,
-- annuler / supprimer / modifier des ventes, réécrire un inventaire.
--
-- Toutes sont appelées par les routes /api avec la clé de service (vérifié
-- dans le code) : on retire EXECUTE à PUBLIC, anon et authenticated pour
-- toute fonction SECURITY DEFINER du schéma public, SAUF :
--   • les fonctions de trigger (non appelables directement) ;
--   • les fonctions utilisées par une politique RLS (is_shop_member,
--     get_role_in_shop, is_super_admin… — détectées automatiquement dans
--     pg_policies, y compris celles créées hors migrations) ;
--   • request_is_restricted (verrou de la section 2).
DO $$
DECLARE r record; v_list text := '';
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS sig, p.proname
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
       AND p.prosecdef
       AND p.prorettype <> 'trigger'::regtype
       AND p.proname <> 'request_is_restricted'
       AND NOT EXISTS (
         SELECT 1 FROM pg_policies pol
          WHERE COALESCE(pol.qual, '') ~ ('\m' || p.proname || '\M')
             OR COALESCE(pol.with_check, '') ~ ('\m' || p.proname || '\M'))
  LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon, authenticated', r.sig);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', r.sig);
    v_list := v_list || r.proname || ' ';
  END LOOP;
  RAISE NOTICE '154 : fonctions réservées au serveur : %', v_list;
END $$;

-- Fonctions créées à l'avenir : jamais exposées par défaut (une fonction
-- utilisée dans une politique RLS devra recevoir un GRANT explicite).
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC, anon, authenticated;

-- ── 8. Paiements : seule la règle restreinte reste ─────────────────────────
-- 013 autorisait tout membre (observateur compris) à enregistrer un paiement
-- sur N'IMPORTE QUELLE vente de la boutique (effacement de dette). Restent :
-- payments_member_write (063, ses propres ventes — synchro hors ligne) et
-- payments_owner_all (067, propriétaire / Manager / Responsable).
DROP POLICY IF EXISTS payments_shop_member_insert ON payments;
DROP POLICY IF EXISTS payments_shop_member_read ON payments;  -- doublon de payments_member_select

-- ── 9. Abonnements : lecture par le propriétaire, écriture serveur seule ──
-- 002 laissait tout membre de la boutique principale créer / modifier /
-- supprimer des lignes d'abonnement (historique de facturation). Toutes les
-- écritures passent par les routes de paiement et le cron (clé de service).
DROP POLICY IF EXISTS subscriptions_shop ON subscriptions;
DROP POLICY IF EXISTS subscriptions_owner_select ON subscriptions;
CREATE POLICY subscriptions_owner_select ON subscriptions
  FOR SELECT USING (get_role_in_shop(shop_id) = 'owner' OR is_super_admin());

-- ── 10. Fichiers : envoi direct réservé aux espaces réellement utilisés ───
-- Photos produit : envoyées par /api/products/upload-image (clé de service).
-- Espace « receipts » : inutilisé. Sans ces règles, toute personne connectée
-- pouvait déposer n'importe quel fichier dans ces espaces publics.
DROP POLICY IF EXISTS product_images_insert ON storage.objects;
DROP POLICY IF EXISTS receipts_insert ON storage.objects;

-- ── 11. Tables sans RLS dans les migrations (déjà protégées en ligne) ─────
ALTER TABLE shop_sale_counters ENABLE ROW LEVEL SECURITY;            -- écrite par le trigger set_sale_number (SECURITY DEFINER)
ALTER TABLE IF EXISTS exchange_rates_pre_dedup_146 ENABLE ROW LEVEL SECURITY;  -- sauvegarde de la migration 146

-- ── Vérification après exécution ───────────────────────────────────────────
-- 1) Triggers posés (doit renvoyer 5 lignes) :
-- SELECT tgname, tgrelid::regclass FROM pg_trigger WHERE tgname LIKE 'trg\_%\_guard' ORDER BY 1;
-- 2) Politiques retirées (doit renvoyer 0) :
-- SELECT count(*) FROM pg_policies WHERE policyname IN ('entities_owner_update', 'shop_owner_can_insert_self',
--   'payments_shop_member_insert', 'subscriptions_shop', 'product_images_insert', 'receipts_insert');
-- 3) Fonctions sensibles fermées aux navigateurs (doit renvoyer 0) :
-- SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
--  WHERE n.nspname = 'public' AND p.proname IN ('adjust_referral_wallet', 'resolve_referral_payout', 'validate_payment', 'complete_sale', 'cancel_sale')
--    AND has_function_privilege('authenticated', p.oid, 'EXECUTE');

-- ============================================================
-- 155 — L'entreprise, seule source de l'abonnement : retrait de la copie
--       du plan sur le profil du propriétaire (5 oct. 2026)
--
-- ⚠ À APPLIQUER UNIQUEMENT APRÈS LE DÉPLOIEMENT du code du lot Entreprise
--   (Vercel), et après la migration 154. Le code en ligne AVANT ce
--   déploiement lit encore profiles.plan : appliquée trop tôt, cette
--   migration le casserait.
--
-- Ce que fait la migration :
--   0. Contrôles préalables — ARRÊT sans rien modifier si :
--        • une boutique (même supprimée) n'a pas d'entreprise ;
--        • le plan d'une entreprise diffère de celui du profil de son
--          propriétaire (le miroir de la migration 153 aurait décroché) ;
--        • une fonction SQL lit encore le plan sur les profils (fonction créée
--          hors migrations, par exemple dans le tableau de bord).
--   1. Sauvegarde des colonnes de plan du profil (profiles_plan_backup_155).
--   2. Création d'entreprise à la volée (boutique sans entreprise) : ne lit
--      plus le plan du profil — essai par défaut, dates écrites par le serveur.
--   3. Retrait des triggers miroirs entreprise ⇄ profil.
--   4. Vue admin super_admin_shop_stats : plan lu sur l'entreprise.
--   5. Suppression des colonnes plan / plan_expires_at / trial_ends_at /
--      plan_grace_ends_at de profiles (sans CASCADE : toute dépendance
--      oubliée fait échouer la migration au lieu de disparaître en silence).
--   6. shops.entity_id devient obligatoire.
--
-- Conservé sur profiles : is_internal (accès de la personne), country.
-- Ré-exécutable : les étapes déjà faites sont sautées.
-- Retour arrière : colonnes recréables depuis profiles_plan_backup_155.
-- ============================================================

-- ── 0 + 1. Contrôles préalables et sauvegarde ─────────────────────────────
DO $$
DECLARE n int; f text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_schema = 'public' AND table_name = 'profiles' AND column_name = 'plan') THEN
    RAISE NOTICE '155 : colonnes de plan déjà retirées du profil — contrôles et sauvegarde sautés';
    RETURN;
  END IF;

  SELECT count(*) INTO n FROM shops WHERE entity_id IS NULL;
  IF n > 0 THEN
    RAISE EXCEPTION '155 arrêtée : % boutique(s) sans entreprise (SELECT id, name, owner_id FROM shops WHERE entity_id IS NULL)', n;
  END IF;

  EXECUTE $q$
    SELECT count(*) FROM entities e JOIN profiles p ON p.id = e.owner_user_id
     WHERE e.plan IS DISTINCT FROM COALESCE(NULLIF(p.plan, ''), 'trial')
        OR e.plan_expires_at    IS DISTINCT FROM p.plan_expires_at
        OR e.trial_ends_at      IS DISTINCT FROM p.trial_ends_at
        OR e.plan_grace_ends_at IS DISTINCT FROM p.plan_grace_ends_at
  $q$ INTO n;
  IF n > 0 THEN
    RAISE EXCEPTION '155 arrêtée : % entreprise(s) dont l''abonnement diffère du profil du propriétaire — à examiner avant de continuer', n;
  END IF;

  SELECT string_agg(p.proname, ', ' ORDER BY p.proname) INTO f
    FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace
   WHERE ns.nspname = 'public'
     AND p.prosrc ~* '\mprofiles\M'
     AND p.prosrc ~* '\m(plan_expires_at|trial_ends_at|plan_grace_ends_at)\M'
     AND p.proname NOT IN ('entities_mirror_plan_to_owner', 'profiles_mirror_plan_to_entity', 'shops_assign_entity');
  IF f IS NOT NULL THEN
    RAISE EXCEPTION '155 arrêtée : fonction(s) SQL lisant encore le plan sur les profils : %', f;
  END IF;

  -- Sauvegarde (une seule fois)
  IF to_regclass('public.profiles_plan_backup_155') IS NULL THEN
    EXECUTE $q$
      CREATE TABLE profiles_plan_backup_155 AS
      SELECT id AS profile_id, plan, plan_expires_at, trial_ends_at, plan_grace_ends_at, now() AS saved_at
        FROM profiles
    $q$;
    ALTER TABLE profiles_plan_backup_155 ENABLE ROW LEVEL SECURITY;  -- aucune politique : serveur seul
    REVOKE ALL ON profiles_plan_backup_155 FROM anon, authenticated;
  END IF;
END $$;

-- ── 2. Entreprise créée à la volée : plus de lecture du plan du profil ────
CREATE OR REPLACE FUNCTION shops_assign_entity() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_entity uuid; v_email text; v_name text; v_country text; v_internal boolean;
BEGIN
  IF NEW.entity_id IS NOT NULL OR NEW.owner_id IS NULL THEN RETURN NEW; END IF;
  SELECT id INTO v_entity FROM entities WHERE owner_user_id = NEW.owner_id ORDER BY created_at LIMIT 1;
  IF v_entity IS NULL THEN
    SELECT email INTO v_email FROM auth.users WHERE id = NEW.owner_id;
    SELECT NULLIF(btrim(full_name), ''), country, COALESCE(is_internal, false)
      INTO v_name, v_country, v_internal
      FROM profiles WHERE id = NEW.owner_id;
    -- Abonnement : « trial » par défaut (colonne) ; dates d'essai écrites par
    -- le serveur juste après (inscription, compte Google, création admin).
    INSERT INTO entities (name, owner_user_id, country, billing_contact_name, billing_email, billing_country, is_internal)
    VALUES (left(btrim(NEW.name), 120), NEW.owner_id, COALESCE(v_country, NEW.country),
            v_name, v_email, COALESCE(NEW.billing_country, NEW.country), COALESCE(v_internal, false))
    RETURNING id INTO v_entity;
    INSERT INTO entity_members (entity_id, user_id, role) VALUES (v_entity, NEW.owner_id, 'owner')
    ON CONFLICT (entity_id, user_id) DO UPDATE SET role = 'owner', is_active = true;
  END IF;
  NEW.entity_id := v_entity;
  RETURN NEW;
END $$;

-- ── 3. Fin du miroir de transition ─────────────────────────────────────────
DROP TRIGGER IF EXISTS trg_entities_mirror_plan ON entities;
DROP TRIGGER IF EXISTS trg_profiles_mirror_plan ON profiles;
DROP FUNCTION IF EXISTS entities_mirror_plan_to_owner();
DROP FUNCTION IF EXISTS profiles_mirror_plan_to_entity();

-- ── 4. Vue admin : plan de l'entreprise (mêmes colonnes, même ordre) ──────
CREATE OR REPLACE VIEW super_admin_shop_stats
WITH (security_invoker = true) AS
SELECT
  s.id AS shop_id,
  s.name AS shop_name,
  s.city,
  e.plan,
  s.country,
  COUNT(DISTINCT p.id) FILTER (WHERE p.is_active) AS product_count,
  COALESCE(SUM(p.quantity * p.selling_price) FILTER (WHERE p.is_active), 0) AS stock_value,
  COALESCE(SUM(p.quantity) FILTER (WHERE p.is_active), 0) AS total_units,
  COUNT(DISTINCT sa.id) FILTER (
    WHERE sa.created_at >= now() - interval '30 days'
      AND sa.sale_status = 'active'
  ) AS sales_30d,
  COALESCE(SUM(sa.total) FILTER (
    WHERE sa.created_at >= now() - interval '30 days'
      AND sa.sale_status = 'active'
  ), 0) AS revenue_30d
FROM shops s
LEFT JOIN entities e ON e.id = s.entity_id
LEFT JOIN products p ON p.shop_id = s.id
LEFT JOIN sales sa ON sa.shop_id = s.id
GROUP BY s.id, s.name, s.city, e.plan, s.country;

-- ── 5. Colonnes de plan du profil ──────────────────────────────────────────
ALTER TABLE profiles DROP COLUMN IF EXISTS plan;
ALTER TABLE profiles DROP COLUMN IF EXISTS plan_expires_at;
ALTER TABLE profiles DROP COLUMN IF EXISTS trial_ends_at;
ALTER TABLE profiles DROP COLUMN IF EXISTS plan_grace_ends_at;

-- Verrou de la migration 154 : liste alignée sur les colonnes restantes
DROP TRIGGER IF EXISTS trg_profiles_guard ON profiles;
CREATE TRIGGER trg_profiles_guard BEFORE INSERT OR UPDATE OR DELETE ON profiles
  FOR EACH ROW EXECUTE FUNCTION guard_server_only_columns('id', 'role', 'shop_id', 'is_active', 'is_internal');

-- ── 6. Toute boutique appartient à une entreprise ──────────────────────────
ALTER TABLE shops ALTER COLUMN entity_id SET NOT NULL;

-- ── Vérification après exécution ───────────────────────────────────────────
-- SELECT column_name FROM information_schema.columns WHERE table_name = 'profiles' AND (column_name LIKE 'plan%' OR column_name = 'trial_ends_at');  -- 0 ligne attendue
-- SELECT count(*) FROM profiles_plan_backup_155;                         -- = nombre de profils
-- SELECT is_nullable FROM information_schema.columns WHERE table_name = 'shops' AND column_name = 'entity_id';  -- NO
-- SELECT tgname FROM pg_trigger WHERE tgname LIKE 'trg_%mirror_plan';    -- 0 ligne attendue

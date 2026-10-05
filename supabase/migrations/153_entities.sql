-- ============================================================
-- 153 — L'ENTREPRISE (entity) devient la racine du compte (5 oct. 2026)
--
-- Avant : le « compte » était le PROFIL PERSONNEL du propriétaire
-- (profiles.plan / plan_expires_at / trial_ends_at / plan_grace_ends_at,
-- migrations 047 et 106). Une personne portait l'abonnement.
--
-- Après :
--   USER (personne)            → profiles / auth.users (inchangé)
--   ENTITY (entreprise cliente)→ entities : nom, propriétaire, abonnement,
--                                facturation, compte interne
--   Appartenance à l'entreprise→ entity_members (owner | member)
--   ESTABLISHMENT (boutique)   → shops.entity_id + establishment_type
--   Abonnement (historique)    → subscriptions.entity_id
--   Audit                      → audit_logs.entity_id
--
-- Le rôle technique « owner » est CONSERVÉ partout (affectations, RLS, API) :
-- il désigne désormais « la personne propriétaire de l'entreprise ».
--
-- Transition sans désynchronisation possible : tant que les colonnes de plan
-- existent sur profiles, elles sont le MIROIR de l'entreprise, dans les deux
-- sens (triggers ci-dessous). Une migration ultérieure retirera ce miroir et
-- les colonnes du profil, une fois tout le code passé sur entities.
--
-- Aucune donnée existante n'est supprimée ni modifiée (sauf l'ajout des
-- nouvelles colonnes). Ré-exécutable.
-- ============================================================

-- ── 1. Tables ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS entities (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Nom / raison sociale. Nom provisoire à la création, à confirmer par le propriétaire.
  name                 text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 120),
  name_confirmed       boolean NOT NULL DEFAULT false,
  -- Personne propriétaire (transfert de propriété futur = changer cette valeur)
  owner_user_id        uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  country              text,
  address              text CHECK (address IS NULL OR char_length(address) <= 200),
  city                 text CHECK (city IS NULL OR char_length(city) <= 80),
  phone                text CHECK (phone IS NULL OR char_length(phone) <= 30),
  email                text CHECK (email IS NULL OR char_length(email) <= 254),
  -- Abonnement (source de vérité)
  plan                 text NOT NULL DEFAULT 'trial',
  plan_expires_at      timestamptz,
  trial_ends_at        timestamptz,
  plan_grace_ends_at   timestamptz,
  -- Profil de facturation (contact par défaut = propriétaire, modifiable séparément)
  billing_contact_name text CHECK (billing_contact_name IS NULL OR char_length(billing_contact_name) <= 120),
  billing_email        text CHECK (billing_email IS NULL OR char_length(billing_email) <= 254),
  billing_phone        text CHECK (billing_phone IS NULL OR char_length(billing_phone) <= 30),
  billing_address      text CHECK (billing_address IS NULL OR char_length(billing_address) <= 200),
  billing_city         text CHECK (billing_city IS NULL OR char_length(billing_city) <= 80),
  billing_country      text,
  tax_id               text CHECK (tax_id IS NULL OR char_length(tax_id) <= 60),
  is_internal          boolean NOT NULL DEFAULT false,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_entities_owner ON entities(owner_user_id);

CREATE TABLE IF NOT EXISTS entity_members (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_id  uuid NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  user_id    uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  -- Niveau entreprise : 'owner' (propriétaire) ; 'member' (personne affectée à
  -- au moins une boutique de l'entreprise). Prévu : 'manager' (global).
  role       text NOT NULL DEFAULT 'member' CHECK (role IN ('owner', 'manager', 'member')),
  is_active  boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT entity_members_unique UNIQUE (entity_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_entity_members_user ON entity_members(user_id) WHERE is_active;

ALTER TABLE shops         ADD COLUMN IF NOT EXISTS entity_id uuid REFERENCES entities(id);
ALTER TABLE shops         ADD COLUMN IF NOT EXISTS establishment_type text NOT NULL DEFAULT 'shop';
DO $$ BEGIN
  ALTER TABLE shops ADD CONSTRAINT shops_establishment_type_check
    CHECK (establishment_type IN ('shop', 'restaurant', 'service', 'hotel', 'beauty', 'other'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE INDEX IF NOT EXISTS idx_shops_entity ON shops(entity_id);
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS entity_id uuid REFERENCES entities(id);
ALTER TABLE audit_logs    ADD COLUMN IF NOT EXISTS entity_id uuid;
CREATE INDEX IF NOT EXISTS idx_audit_logs_entity ON audit_logs(entity_id, created_at DESC);

-- ── 2. Nom par défaut (même règle que l'aperçu validé le 5 oct. 2026) ──────
-- 1 boutique → son nom ; plusieurs → « Groupe <partie commune> » (« <…> Group »
-- si le propriétaire est en anglais), ou « Groupe <plus ancienne boutique> »
-- sans partie commune d'au moins 3 caractères.
CREATE OR REPLACE FUNCTION entity_default_name(p_names text[], p_locale text)
RETURNS text LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
  prefix text; n text; i int; full_word boolean := true; base text;
BEGIN
  IF p_names IS NULL OR array_length(p_names, 1) IS NULL THEN RETURN 'Mon entreprise'; END IF;
  IF array_length(p_names, 1) = 1 THEN RETURN left(btrim(p_names[1]), 120); END IF;
  prefix := btrim(p_names[1]);
  FOREACH n IN ARRAY p_names[2:] LOOP
    n := btrim(n); i := 0;
    WHILE i < least(length(prefix), length(n)) AND lower(substr(prefix, i + 1, 1)) = lower(substr(n, i + 1, 1)) LOOP i := i + 1; END LOOP;
    prefix := substr(prefix, 1, i);
  END LOOP;
  FOREACH n IN ARRAY p_names LOOP
    n := btrim(n);
    IF length(n) > length(prefix) AND substr(n, length(prefix) + 1, 1) !~ '[[:space:]&,._-]' THEN full_word := false; END IF;
  END LOOP;
  IF NOT full_word THEN prefix := regexp_replace(prefix, '[^[:space:]]*$', ''); END IF;
  prefix := btrim(regexp_replace(prefix, '[[:space:]&,._-]+$', ''));
  base := CASE WHEN length(prefix) >= 3 THEN prefix ELSE btrim(p_names[1]) END;
  RETURN left(CASE WHEN p_locale = 'en' THEN base || ' Group' ELSE 'Groupe ' || base END, 120);
END $$;

-- ── 3. Rattachement des comptes existants (1 entreprise par propriétaire) ──
-- Propriétaire d'une boutique = shops.owner_id, sinon l'affectation « owner »
-- active la plus ancienne (audit du 5 oct. 2026 : 16 comptes, 1 propriétaire
-- chacun, 0 boutique orpheline, 0 cas ambigu).
DO $$
DECLARE r record; v_entity uuid; v_email text;
BEGIN
  FOR r IN
    WITH owners AS (
      SELECT s.id AS shop_id, s.name, s.created_at, s.country, s.billing_country, s.is_internal AS shop_internal,
             COALESCE(s.owner_id, (SELECT sm.user_id FROM shop_members sm WHERE sm.shop_id = s.id AND sm.role = 'owner' AND sm.is_active ORDER BY sm.created_at LIMIT 1)) AS owner_id
      FROM shops s
      WHERE s.entity_id IS NULL
    )
    SELECT o.owner_id,
           array_agg(o.name ORDER BY o.created_at) AS names,
           array_agg(o.shop_id ORDER BY o.created_at) AS shop_ids,
           (array_agg(COALESCE(o.billing_country, o.country) ORDER BY o.created_at))[1] AS billing_country,
           (array_agg(o.country ORDER BY o.created_at))[1] AS first_country,
           bool_or(o.shop_internal) AS any_internal
    FROM owners o
    WHERE o.owner_id IS NOT NULL
    GROUP BY o.owner_id
  LOOP
    SELECT id INTO v_entity FROM entities WHERE owner_user_id = r.owner_id ORDER BY created_at LIMIT 1;
    IF v_entity IS NULL THEN
      SELECT email INTO v_email FROM auth.users WHERE id = r.owner_id;
      INSERT INTO entities (name, owner_user_id, country, plan, plan_expires_at, trial_ends_at, plan_grace_ends_at,
                            billing_contact_name, billing_email, billing_country, is_internal)
      SELECT entity_default_name(r.names, p.locale), r.owner_id, COALESCE(p.country, r.first_country),
             COALESCE(NULLIF(p.plan, ''), 'trial'), p.plan_expires_at, p.trial_ends_at, p.plan_grace_ends_at,
             NULLIF(btrim(p.full_name), ''), v_email, r.billing_country,
             COALESCE(p.is_internal, false) OR COALESCE(r.any_internal, false)
      FROM profiles p WHERE p.id = r.owner_id
      RETURNING id INTO v_entity;
      IF v_entity IS NULL THEN
        -- Propriétaire sans profil (aucun au 5 oct. 2026) : entreprise minimale
        INSERT INTO entities (name, owner_user_id, country, billing_email, billing_country)
        VALUES (entity_default_name(r.names, NULL), r.owner_id, r.first_country, v_email, r.billing_country)
        RETURNING id INTO v_entity;
      END IF;
    END IF;
    UPDATE shops SET entity_id = v_entity WHERE id = ANY (r.shop_ids) AND entity_id IS NULL;
  END LOOP;
END $$;

UPDATE subscriptions sub SET entity_id = s.entity_id FROM shops s WHERE sub.shop_id = s.id AND sub.entity_id IS NULL;
UPDATE audit_logs a     SET entity_id = s.entity_id FROM shops s WHERE a.shop_id = s.id AND a.entity_id IS NULL;

-- Appartenance à l'entreprise : propriétaire + toute personne ayant (eu) une affectation
INSERT INTO entity_members (entity_id, user_id, role, is_active)
SELECT e.id, e.owner_user_id, 'owner', true FROM entities e WHERE e.owner_user_id IS NOT NULL
ON CONFLICT (entity_id, user_id) DO UPDATE SET role = 'owner', is_active = true;
INSERT INTO entity_members (entity_id, user_id, role, is_active)
SELECT s.entity_id, sm.user_id, 'member', bool_or(sm.is_active)
FROM shop_members sm JOIN shops s ON s.id = sm.shop_id
WHERE s.entity_id IS NOT NULL AND sm.role <> 'owner'
GROUP BY s.entity_id, sm.user_id
ON CONFLICT (entity_id, user_id) DO NOTHING;

-- ── 4. Filets de sécurité (triggers) ───────────────────────────────────────
-- 4a. Toute boutique créée sans entreprise reçoit celle de son propriétaire
--     (ou une nouvelle entreprise si le propriétaire n'en a pas encore).
CREATE OR REPLACE FUNCTION shops_assign_entity() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_entity uuid; v_email text;
BEGIN
  IF NEW.entity_id IS NOT NULL OR NEW.owner_id IS NULL THEN RETURN NEW; END IF;
  SELECT id INTO v_entity FROM entities WHERE owner_user_id = NEW.owner_id ORDER BY created_at LIMIT 1;
  IF v_entity IS NULL THEN
    SELECT email INTO v_email FROM auth.users WHERE id = NEW.owner_id;
    INSERT INTO entities (name, owner_user_id, country, plan, plan_expires_at, trial_ends_at, plan_grace_ends_at,
                          billing_contact_name, billing_email, billing_country, is_internal)
    SELECT left(btrim(NEW.name), 120), NEW.owner_id, COALESCE(p.country, NEW.country),
           COALESCE(NULLIF(p.plan, ''), 'trial'), p.plan_expires_at, p.trial_ends_at, p.plan_grace_ends_at,
           NULLIF(btrim(p.full_name), ''), v_email, COALESCE(NEW.billing_country, NEW.country), COALESCE(p.is_internal, false)
    FROM (SELECT 1) one LEFT JOIN profiles p ON p.id = NEW.owner_id
    RETURNING id INTO v_entity;
    INSERT INTO entity_members (entity_id, user_id, role) VALUES (v_entity, NEW.owner_id, 'owner')
    ON CONFLICT (entity_id, user_id) DO UPDATE SET role = 'owner', is_active = true;
  END IF;
  NEW.entity_id := v_entity;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_shops_assign_entity ON shops;
CREATE TRIGGER trg_shops_assign_entity BEFORE INSERT ON shops FOR EACH ROW EXECUTE FUNCTION shops_assign_entity();

-- 4b. Abonnement et journal : entreprise déduite de la boutique
CREATE OR REPLACE FUNCTION fill_entity_from_shop() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.entity_id IS NULL AND NEW.shop_id IS NOT NULL THEN
    SELECT entity_id INTO NEW.entity_id FROM shops WHERE id = NEW.shop_id;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_subscriptions_entity ON subscriptions;
CREATE TRIGGER trg_subscriptions_entity BEFORE INSERT ON subscriptions FOR EACH ROW EXECUTE FUNCTION fill_entity_from_shop();
DROP TRIGGER IF EXISTS trg_audit_logs_entity ON audit_logs;
CREATE TRIGGER trg_audit_logs_entity BEFORE INSERT ON audit_logs FOR EACH ROW EXECUTE FUNCTION fill_entity_from_shop();

-- 4c. Appartenance à l'entreprise suivie depuis les affectations boutique
--     (une personne = un membre de l'entreprise, quel que soit le nombre de boutiques)
CREATE OR REPLACE FUNCTION shop_members_sync_entity() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_entity uuid; v_active boolean;
BEGIN
  SELECT entity_id INTO v_entity FROM shops WHERE id = NEW.shop_id;
  IF v_entity IS NULL THEN RETURN NEW; END IF;
  SELECT bool_or(sm.is_active) INTO v_active
    FROM shop_members sm JOIN shops s ON s.id = sm.shop_id
    WHERE s.entity_id = v_entity AND sm.user_id = NEW.user_id;
  INSERT INTO entity_members (entity_id, user_id, role, is_active)
  VALUES (v_entity, NEW.user_id, CASE WHEN NEW.role = 'owner' THEN 'owner' ELSE 'member' END, COALESCE(v_active, NEW.is_active))
  ON CONFLICT (entity_id, user_id) DO UPDATE
    SET is_active = CASE WHEN entity_members.role = 'owner' THEN true ELSE COALESCE(v_active, EXCLUDED.is_active) END,
        role = CASE WHEN entity_members.role = 'owner' OR EXCLUDED.role = 'owner' THEN 'owner' ELSE entity_members.role END,
        updated_at = now();
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_shop_members_sync_entity ON shop_members;
CREATE TRIGGER trg_shop_members_sync_entity AFTER INSERT OR UPDATE OF is_active, role ON shop_members
  FOR EACH ROW EXECUTE FUNCTION shop_members_sync_entity();

-- 4d. MIROIR DE TRANSITION du plan : entreprise ⇄ profil du propriétaire.
--     L'entreprise est la source de vérité ; le profil reste aligné tant que
--     ses colonnes existent (code ancien, vue admin, retour arrière possible).
CREATE OR REPLACE FUNCTION entities_mirror_plan_to_owner() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF pg_trigger_depth() > 1 OR NEW.owner_user_id IS NULL THEN RETURN NEW; END IF;
  UPDATE profiles SET plan = NEW.plan, plan_expires_at = NEW.plan_expires_at,
                      trial_ends_at = NEW.trial_ends_at, plan_grace_ends_at = NEW.plan_grace_ends_at
   WHERE id = NEW.owner_user_id
     AND (plan IS DISTINCT FROM NEW.plan OR plan_expires_at IS DISTINCT FROM NEW.plan_expires_at
          OR trial_ends_at IS DISTINCT FROM NEW.trial_ends_at OR plan_grace_ends_at IS DISTINCT FROM NEW.plan_grace_ends_at);
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_entities_mirror_plan ON entities;
CREATE TRIGGER trg_entities_mirror_plan AFTER UPDATE OF plan, plan_expires_at, trial_ends_at, plan_grace_ends_at ON entities
  FOR EACH ROW EXECUTE FUNCTION entities_mirror_plan_to_owner();

CREATE OR REPLACE FUNCTION profiles_mirror_plan_to_entity() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF pg_trigger_depth() > 1 THEN RETURN NEW; END IF;
  -- Une seule entreprise possédée (aucun cas multi-entreprise aujourd'hui) : sinon rien
  IF (SELECT count(*) FROM entities WHERE owner_user_id = NEW.id) <> 1 THEN RETURN NEW; END IF;
  UPDATE entities SET plan = COALESCE(NULLIF(NEW.plan, ''), 'trial'), plan_expires_at = NEW.plan_expires_at,
                      trial_ends_at = NEW.trial_ends_at, plan_grace_ends_at = NEW.plan_grace_ends_at, updated_at = now()
   WHERE owner_user_id = NEW.id
     AND (plan IS DISTINCT FROM COALESCE(NULLIF(NEW.plan, ''), 'trial') OR plan_expires_at IS DISTINCT FROM NEW.plan_expires_at
          OR trial_ends_at IS DISTINCT FROM NEW.trial_ends_at OR plan_grace_ends_at IS DISTINCT FROM NEW.plan_grace_ends_at);
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_profiles_mirror_plan ON profiles;
CREATE TRIGGER trg_profiles_mirror_plan AFTER INSERT OR UPDATE OF plan, plan_expires_at, trial_ends_at, plan_grace_ends_at ON profiles
  FOR EACH ROW EXECUTE FUNCTION profiles_mirror_plan_to_entity();

-- ── 5. Sécurité (RLS) ──────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION get_user_entity_ids() RETURNS SETOF uuid
LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public AS $$
  SELECT entity_id FROM entity_members WHERE user_id = auth.uid() AND is_active
$$;

ALTER TABLE entities ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS entities_member_select ON entities;
CREATE POLICY entities_member_select ON entities FOR SELECT USING (id IN (SELECT get_user_entity_ids()) OR is_super_admin());
DROP POLICY IF EXISTS entities_owner_update ON entities;
-- Modification directe réservée au propriétaire ; l'abonnement n'est écrit que
-- par les routes serveur (client admin) — voir /api/entity.
CREATE POLICY entities_owner_update ON entities FOR UPDATE USING (owner_user_id = auth.uid());
DROP POLICY IF EXISTS entities_super_admin ON entities;
CREATE POLICY entities_super_admin ON entities FOR ALL USING (is_super_admin());

ALTER TABLE entity_members ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS entity_members_select ON entity_members;
CREATE POLICY entity_members_select ON entity_members FOR SELECT USING (entity_id IN (SELECT get_user_entity_ids()) OR is_super_admin());

-- ── Vérification après exécution (doit renvoyer 0 / 0 / 0) ───────────────
-- SELECT count(*) FROM shops WHERE entity_id IS NULL AND deleted_at IS NULL;
-- SELECT count(*) FROM entities e JOIN profiles p ON p.id = e.owner_user_id
--   WHERE e.plan IS DISTINCT FROM COALESCE(NULLIF(p.plan,''),'trial') OR e.plan_expires_at IS DISTINCT FROM p.plan_expires_at;
-- SELECT count(*) FROM entities WHERE owner_user_id IS NULL;

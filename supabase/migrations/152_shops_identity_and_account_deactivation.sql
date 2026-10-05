-- ============================================================
-- 152 — Refonte Boutiques / Équipe (5 oct. 2026)
--
-- 1. Fiche boutique : code, adresse, téléphone, e-mail.
--    Colonnes FACULTATIVES (NULL autorisé) : aucune boutique existante
--    n'est cassée ni obligée de les renseigner.
-- 2. Code boutique UNIQUE à l'intérieur d'un même compte (propriétaire),
--    sans tenir compte de la casse ni des espaces autour, et seulement
--    parmi les boutiques non supprimées.
-- 3. shop_members.account_suspended : marque les affectations coupées par
--    « Désactiver le compte » (désactivation globale d'une personne), pour
--    pouvoir les rétablir à l'identique à la réactivation — sans confondre
--    avec « Retirer de cette boutique » (is_active = false seul) ni avec la
--    suspension par la formule (suspended_by_plan).
--
-- Aucune donnée existante n'est modifiée ni supprimée. Ré-exécutable.
-- ============================================================

ALTER TABLE shops ADD COLUMN IF NOT EXISTS code    text;
ALTER TABLE shops ADD COLUMN IF NOT EXISTS address text;
ALTER TABLE shops ADD COLUMN IF NOT EXISTS phone   text;
ALTER TABLE shops ADD COLUMN IF NOT EXISTS email   text;

-- Bornes (même logique que les textes de reçu, migration 149) : un message
-- clair est renvoyé par /api/shops/settings avant d'atteindre ces CHECK.
DO $$ BEGIN
  ALTER TABLE shops ADD CONSTRAINT shops_code_format
    CHECK (code IS NULL OR (char_length(btrim(code)) BETWEEN 1 AND 20 AND code ~ '^[A-Za-z0-9_-]+$'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE shops ADD CONSTRAINT shops_address_len CHECK (address IS NULL OR char_length(address) <= 200);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE shops ADD CONSTRAINT shops_phone_len CHECK (phone IS NULL OR char_length(phone) <= 30);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE shops ADD CONSTRAINT shops_email_format
    CHECK (email IS NULL OR (char_length(email) <= 254 AND email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Unicité du code par compte. shops.owner_id peut être NULL pour une boutique
-- orpheline (migration 105) : NULL ≠ NULL en index unique, donc sans effet
-- pour elles — l'API vérifie en plus via shop_members (propriétaire réel).
CREATE UNIQUE INDEX IF NOT EXISTS idx_shops_owner_code_unique
  ON shops (owner_id, upper(btrim(code)))
  WHERE code IS NOT NULL AND deleted_at IS NULL;

ALTER TABLE shop_members ADD COLUMN IF NOT EXISTS account_suspended boolean NOT NULL DEFAULT false;

-- Vérification après exécution (doit renvoyer 4 colonnes shops + 1 shop_members) :
-- SELECT table_name, column_name FROM information_schema.columns
--  WHERE (table_name = 'shops' AND column_name IN ('code','address','phone','email'))
--     OR (table_name = 'shop_members' AND column_name = 'account_suspended');

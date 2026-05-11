-- ============================================================
-- 036 — PROTECTION ABSOLUE DES DONNÉES
--
-- 1. Trigger BEFORE DELETE sur shops : bloque toute suppression
--    d'une boutique qui contient des données (produits / ventes /
--    clients). Seules les boutiques vides de moins de 10 minutes
--    (rollback d'inscription raté) peuvent encore être supprimées.
--
-- 2. Table deleted_records_log : snapshot JSON complet avant
--    tout DELETE définitif sur les tables critiques.
--
-- 3. Triggers BEFORE DELETE sur products et customers pour
--    archiver automatiquement la ligne dans deleted_records_log.
-- ============================================================

-- ── 1. Bloquer la suppression d'une boutique avec données ────────────────────

CREATE OR REPLACE FUNCTION protect_shop_from_deletion()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_age_minutes  numeric;
  v_products     int := 0;
  v_sales        int := 0;
  v_customers    int := 0;
BEGIN
  -- Age de la boutique en minutes
  v_age_minutes := EXTRACT(EPOCH FROM (now() - OLD.created_at)) / 60.0;

  -- Compter les données existantes
  SELECT COUNT(*) INTO v_products  FROM products  WHERE shop_id = OLD.id;
  SELECT COUNT(*) INTO v_sales     FROM sales      WHERE shop_id = OLD.id;
  SELECT COUNT(*) INTO v_customers FROM customers  WHERE shop_id = OLD.id;

  -- Autoriser uniquement si : boutique < 10 min ET aucune donnée
  -- (cas : rollback d'une inscription qui a échoué)
  IF v_age_minutes <= 10
     AND v_products  = 0
     AND v_sales     = 0
     AND v_customers = 0
  THEN
    RETURN OLD;
  END IF;

  -- Dans tous les autres cas : bloquer définitivement
  RAISE EXCEPTION
    'SHOP_HAS_DATA: Impossible de supprimer la boutique "%" — '
    'elle contient % produit(s), % vente(s) et % client(s). '
    'Les données sont protégées.',
    OLD.name, v_products, v_sales, v_customers;
END;
$$;

DROP TRIGGER IF EXISTS trg_protect_shop ON shops;
CREATE TRIGGER trg_protect_shop
  BEFORE DELETE ON shops
  FOR EACH ROW EXECUTE FUNCTION protect_shop_from_deletion();


-- ── 2. Table d'audit pour les suppressions définitives ───────────────────────

CREATE TABLE IF NOT EXISTS deleted_records_log (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  table_name   text        NOT NULL,
  record_id    uuid        NOT NULL,
  shop_id      uuid,
  deleted_by   uuid        REFERENCES auth.users ON DELETE SET NULL,
  deleted_at   timestamptz NOT NULL DEFAULT now(),
  record_data  jsonb       NOT NULL   -- snapshot complet de la ligne avant suppression
);

CREATE INDEX IF NOT EXISTS idx_deleted_log_shop
  ON deleted_records_log (shop_id, deleted_at DESC);

-- Seul le super admin peut consulter le journal (pour récupération)
ALTER TABLE deleted_records_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "deleted_log_super_admin" ON deleted_records_log;
CREATE POLICY "deleted_log_super_admin" ON deleted_records_log
  FOR ALL USING (is_super_admin());


-- ── 3. Archiver chaque produit avant suppression définitive ─────────────────

CREATE OR REPLACE FUNCTION log_before_product_delete()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  INSERT INTO deleted_records_log
    (table_name, record_id, shop_id, deleted_by, record_data)
  VALUES
    ('products', OLD.id, OLD.shop_id, auth.uid(), to_jsonb(OLD));
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS trg_log_product_delete ON products;
CREATE TRIGGER trg_log_product_delete
  BEFORE DELETE ON products
  FOR EACH ROW EXECUTE FUNCTION log_before_product_delete();


-- ── 4. Archiver chaque client avant suppression définitive ──────────────────
-- (Les clients utilisent désormais le soft-delete via deleted_at,
--  mais ce trigger est une ceinture de sécurité supplémentaire.)

CREATE OR REPLACE FUNCTION log_before_customer_delete()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  INSERT INTO deleted_records_log
    (table_name, record_id, shop_id, deleted_by, record_data)
  VALUES
    ('customers', OLD.id, OLD.shop_id, auth.uid(), to_jsonb(OLD));
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS trg_log_customer_delete ON customers;
CREATE TRIGGER trg_log_customer_delete
  BEFORE DELETE ON customers
  FOR EACH ROW EXECUTE FUNCTION log_before_customer_delete();


-- ── Résumé de la protection en place ────────────────────────────────────────
--
--  Niveau 1 — Application  : pas de bouton DELETE boutique pour l'owner
--  Niveau 2 — API          : seule une API service-role peut effacer des produits
--                            (avec confirmation par frappe du nom)
--  Niveau 3 — RLS          : le client Supabase ne peut pas faire de DELETE
--                            sur products (migration 035)
--  Niveau 4 — Trigger DB   : même le service-role ne peut pas supprimer une
--                            boutique avec des données (cette migration)
--  Niveau 5 — Audit log    : tout DELETE définitif est archivé en JSON avant
--                            d'être exécuté → récupération possible
--
--  Action manuelle requise (dashboard Supabase) :
--    → Activer "Point-in-Time Recovery" dans Settings → Add-ons
--       pour avoir 7 jours de backup continu au niveau base de données
-- ============================================================

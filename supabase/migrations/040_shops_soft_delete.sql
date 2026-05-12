-- ============================================================
-- 040 — SOFT-DELETE DES BOUTIQUES
--
-- Au lieu de supprimer physiquement une boutique, on pose
-- deleted_at = now(). Les boutiques supprimées restent en base,
-- visibles uniquement par le super_admin pour restauration.
--
-- 1. Ajouter la colonne deleted_at sur shops
-- 2. Filtrer les boutiques supprimées dans toutes les policies RLS
-- 3. Remplacer le trigger de blocage par un trigger de soft-delete
-- 4. Policy super_admin pour lire les boutiques supprimées
-- ============================================================

-- ── 1. Colonne deleted_at ─────────────────────────────────────
ALTER TABLE shops ADD COLUMN IF NOT EXISTS deleted_at timestamptz DEFAULT NULL;

CREATE INDEX IF NOT EXISTS idx_shops_deleted_at ON shops (deleted_at) WHERE deleted_at IS NOT NULL;

-- ── 2. Mettre à jour les policies RLS existantes ──────────────
-- On ajoute "AND deleted_at IS NULL" aux policies owner/member
-- pour qu'une boutique soft-deleted disparaisse du client.

-- Politique principale de lecture des membres
DROP POLICY IF EXISTS "shops_member_select" ON shops;
CREATE POLICY "shops_member_select" ON shops
  FOR SELECT USING (
    deleted_at IS NULL
    AND id IN (
      SELECT shop_id FROM shop_members
      WHERE user_id = auth.uid() AND is_active = true
    )
  );

-- ── 3. Remplacer le trigger bloquant par un soft-delete ───────
-- Le trigger protect_shop_from_deletion bloquait toute suppression.
-- On le supprime : l'API fera un UPDATE deleted_at au lieu d'un DELETE.
-- Le hard-delete reste bloqué côté RLS (pas de DELETE policy pour owner).

DROP TRIGGER IF EXISTS trg_protect_shop ON shops;
DROP FUNCTION IF EXISTS protect_shop_from_deletion();

-- Bloquer quand même tout hard-DELETE via RLS (ceinture de sécurité)
DROP POLICY IF EXISTS "shops_no_hard_delete" ON shops;
CREATE POLICY "shops_no_hard_delete" ON shops
  FOR DELETE USING (false);  -- personne ne peut hard-delete via le client

-- ── 4. Super-admin : voir et gérer toutes les boutiques ───────
DROP POLICY IF EXISTS "shops_super_admin_all" ON shops;
CREATE POLICY "shops_super_admin_all" ON shops
  FOR ALL USING (is_super_admin());

-- ── 5. Owner : mettre à jour (y compris poser deleted_at) ─────
DROP POLICY IF EXISTS "shops_owner_update" ON shops;
CREATE POLICY "shops_owner_update" ON shops
  FOR UPDATE USING (
    owner_id = auth.uid()
    AND deleted_at IS NULL
  );

-- ── Résumé ────────────────────────────────────────────────────
--  - API /api/shops/[shopId] DELETE → UPDATE shops SET deleted_at = now()
--  - RLS bloque tout hard-DELETE client
--  - Les boutiques avec deleted_at IS NOT NULL disparaissent de l'app
--  - Super-admin voit tout et peut restaurer (deleted_at = null)
-- ============================================================

-- ============================================================
-- Migration 151 : fusion de fiches client (doublons)
-- ============================================================
-- La saisie libre en caisse créait une fiche par vente (la base ne
-- réutilisait une fiche que sur le téléphone) : « job » ×2, etc. Le
-- commerçant fusionne lui-même depuis la page Clients ; rien n'est fusionné
-- automatiquement (deux « Job » peuvent être deux personnes).
--
-- Une fiche doublon n'est JAMAIS effacée : elle est marquée merged_into et
-- masquée (deleted_at), pour l'historique et les reçus déjà émis. Ses ventes
-- passent sur la fiche gardée (les paiements suivent : ils sont liés aux
-- ventes) ; le solde dû de la fiche gardée est recalculé depuis ses ventes
-- actives (même formule que la migration 111). Tout en une transaction.
--
-- Appelable uniquement par le serveur (service_role) : /api/customers/merge
-- vérifie le rôle (owner, manager, shop_manager) et écrit le journal d'audit.
-- Voir discussion produit du 2026-10-03.

ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS merged_into uuid REFERENCES customers(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_customers_merged_into
  ON customers (merged_into) WHERE merged_into IS NOT NULL;

COMMENT ON COLUMN customers.merged_into IS
  'Fiche gardée lors d''une fusion de doublons (migration 151) ; la fiche porteuse est masquée (deleted_at) mais conservée pour l''historique.';

CREATE OR REPLACE FUNCTION merge_customers(p_shop_id uuid, p_keep_id uuid, p_merge_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_keep        customers%ROWTYPE;
  v_merge       customers%ROWTYPE;
  v_sales_moved int;
  v_debt_after  numeric;
BEGIN
  IF p_keep_id = p_merge_id THEN
    RAISE EXCEPTION 'same_customer' USING ERRCODE = 'P0010';
  END IF;

  -- Verrou sur les deux fiches : deux fusions simultanées ne peuvent pas se croiser
  SELECT * INTO v_keep FROM customers WHERE id = p_keep_id AND shop_id = p_shop_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'customer_not_found' USING ERRCODE = 'P0011'; END IF;
  SELECT * INTO v_merge FROM customers WHERE id = p_merge_id AND shop_id = p_shop_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'customer_not_found' USING ERRCODE = 'P0011'; END IF;

  IF v_keep.merged_into IS NOT NULL OR v_keep.deleted_at IS NOT NULL
     OR v_merge.merged_into IS NOT NULL OR v_merge.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'customer_unavailable' USING ERRCODE = 'P0012';
  END IF;

  -- Toutes les ventes du doublon (actives ou annulées : l'historique suit)
  UPDATE sales SET customer_id = p_keep_id WHERE customer_id = p_merge_id;
  GET DIAGNOSTICS v_sales_moved = ROW_COUNT;

  -- Fiche gardée : champs vides complétés depuis le doublon, solde recalculé
  UPDATE customers SET
    phone        = COALESCE(NULLIF(trim(phone), ''), v_merge.phone),
    city         = COALESCE(NULLIF(trim(city), ''), v_merge.city),
    credit_limit = COALESCE(credit_limit, v_merge.credit_limit),
    total_debt   = COALESCE((
      SELECT SUM(s.balance) FROM sales s
      WHERE s.customer_id = p_keep_id AND s.sale_status = 'active'
    ), 0)
  WHERE id = p_keep_id
  RETURNING total_debt INTO v_debt_after;

  -- Doublon : marqué et masqué, jamais effacé
  UPDATE customers
  SET merged_into = p_keep_id, deleted_at = now(), total_debt = 0
  WHERE id = p_merge_id;

  RETURN jsonb_build_object(
    'sales_moved',     v_sales_moved,
    'debt_moved',      COALESCE(v_merge.total_debt, 0),
    'kept_total_debt', v_debt_after,
    'kept_name',       v_keep.name,
    'merged_name',     v_merge.name
  );
END;
$$;

REVOKE ALL ON FUNCTION merge_customers(uuid, uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION merge_customers(uuid, uuid, uuid) TO service_role;

COMMENT ON FUNCTION merge_customers(uuid, uuid, uuid) IS
  'Fusionne le doublon p_merge_id dans p_keep_id (ventes rattachées, solde recalculé, doublon marqué merged_into + deleted_at). Serveur uniquement.';

-- ============================================================
-- Migration 086 : Suivi de péremption par lot (FEFO) — Phase 1
-- ============================================================
-- Un produit n'a qu'une seule quantity/buying_price globale — exactement
-- le défaut structurel déjà corrigé pour le prix d'achat (migration 085).
-- Une date de péremption unique par produit serait écrasée à chaque
-- réassort dès qu'un produit a deux lots à des dates différentes. On
-- introduit donc un vrai suivi par lot, avec sortie FEFO (First Expired
-- First Out) à la vente.
--
-- products.quantity/buying_price restent la source de vérité pour "combien
-- y a-t-il en stock" — les lots sont une couche additive, jamais un
-- remplacement. Si la comptabilité des lots dérive un jour, le dégât reste
-- cantonné aux lots, jamais à la quantité totale.
--
-- Cette migration ne fait QUE poser les fondations : schéma + rétro-
-- remplissage + fonctions de déplétion/restauration. Le câblage dans la
-- vente est dans la migration suivante (087). Aucune UI ne change encore —
-- toutes les dates de péremption sont NULL tant que la Phase 2 (réassort,
-- bons de commande, inventaire) n'a pas ajouté de vraie saisie.

CREATE TABLE IF NOT EXISTS product_batches (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid references shops(id) on delete cascade,
  product_id uuid references products(id) on delete cascade,
  supplier_id uuid references suppliers(id) on delete set null,
  quantity int not null check (quantity >= 0),        -- restant dans ce lot
  initial_quantity int not null,
  buying_price numeric,
  expiry_date date,                                    -- nullable — tous les produits ne périment pas
  source text not null check (source in ('backfill', 'restock', 'purchase_order', 'adjustment')),
  received_at timestamptz default now(),
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

CREATE INDEX IF NOT EXISTS idx_product_batches_product ON product_batches(product_id);

-- Index partiel pour le tri FEFO — ne porte que sur les lots encore actifs,
-- pour que la déplétion à la vente reste un Index Scan même après des
-- années de réassorts accumulés (les lots épuisés ne sont jamais purgés).
CREATE INDEX IF NOT EXISTS idx_product_batches_fefo
  ON product_batches(product_id, expiry_date ASC NULLS LAST, received_at ASC)
  WHERE quantity > 0;

-- Registre d'allocation : quel(s) lot(s) a couvert une ligne de vente
-- donnée, pour pouvoir restaurer précisément à l'annulation/suppression/
-- modification au lieu de deviner.
CREATE TABLE IF NOT EXISTS sale_item_batches (
  id uuid primary key default gen_random_uuid(),
  sale_item_id uuid references sale_items(id) on delete cascade,
  batch_id uuid references product_batches(id) on delete set null,
  quantity int not null check (quantity > 0),
  created_at timestamptz default now()
);

CREATE INDEX IF NOT EXISTS idx_sale_item_batches_item ON sale_item_batches(sale_item_id);
CREATE INDEX IF NOT EXISTS idx_sale_item_batches_batch ON sale_item_batches(batch_id);

ALTER TABLE product_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE sale_item_batches ENABLE ROW LEVEL SECURITY;

-- ── product_batches RLS ──────────────────────────────────────────────────
-- Lecture ouverte à tout membre actif, comme stock_movements.
CREATE POLICY product_batches_select ON product_batches
  FOR SELECT USING (is_shop_member(shop_id));

-- Création d'un lot = réassort/réception, réservé aux rôles gestion stock
-- (même liste que purchase_orders/product_supplier_prices). Sans effet
-- aujourd'hui : le seul INSERT de cette phase est le rétro-remplissage
-- ci-dessous, exécuté par la migration elle-même (contourne RLS) — cette
-- policy prépare la Phase 2 (réassort/bons de commande).
CREATE POLICY product_batches_insert ON product_batches
  FOR INSERT WITH CHECK (
    is_shop_member(shop_id)
    AND get_role_in_shop(shop_id) IN ('owner', 'manager', 'shop_manager', 'stock_manager')
  );

-- Mise à jour (déplétion FEFO / restauration) ouverte à tout membre actif —
-- comme stock_movements_member_insert : c'est un déclencheur de vente qui
-- écrit ici pour le compte d'un caissier, pas un formulaire CRUD direct.
-- La restreindre aux rôles gestion bloquerait une vente faite par un
-- caissier standard.
CREATE POLICY product_batches_update ON product_batches
  FOR UPDATE USING (is_shop_member(shop_id))
  WITH CHECK (is_shop_member(shop_id));

CREATE POLICY product_batches_delete ON product_batches
  FOR DELETE USING (
    is_shop_member(shop_id)
    AND get_role_in_shop(shop_id) IN ('owner', 'manager', 'shop_manager')
  );

-- ── sale_item_batches RLS ────────────────────────────────────────────────
-- Pas de shop_id direct — même pattern que purchase_order_items : on
-- remonte jusqu'à sales.shop_id via une sous-requête EXISTS.
CREATE POLICY sale_item_batches_select ON sale_item_batches
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM sale_items si JOIN sales s ON s.id = si.sale_id
      WHERE si.id = sale_item_batches.sale_item_id AND is_shop_member(s.shop_id)
    )
  );

-- Ouvert à tout membre actif — écrit par le déclencheur de vente pour le
-- compte de n'importe quel caissier, même raisonnement que product_batches_update.
CREATE POLICY sale_item_batches_insert ON sale_item_batches
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM sale_items si JOIN sales s ON s.id = si.sale_id
      WHERE si.id = sale_item_batches.sale_item_id AND is_shop_member(s.shop_id)
    )
  );

CREATE POLICY sale_item_batches_delete ON sale_item_batches
  FOR DELETE USING (
    EXISTS (
      SELECT 1 FROM sale_items si JOIN sales s ON s.id = si.sale_id
      WHERE si.id = sale_item_batches.sale_item_id AND is_shop_member(s.shop_id)
    )
  );

-- ── Rétro-remplissage ─────────────────────────────────────────────────────
-- Un lot par produit avec du stock existant, sans date de péremption connue
-- (source='backfill') — pour que dès le déploiement, toute vente ait de
-- vrais lots à consommer. Pas de cas particulier "stock hérité" à gérer
-- indéfiniment dans le code applicatif.
INSERT INTO product_batches (shop_id, product_id, supplier_id, quantity, initial_quantity, buying_price, expiry_date, source, received_at)
SELECT shop_id, id, supplier_id, quantity, quantity, COALESCE(buying_price, 0), NULL, 'backfill', COALESCE(created_at, now())
FROM products
WHERE quantity > 0;

-- ── deplete_product_batches() ────────────────────────────────────────────
-- Décrémente les lots d'un produit en ordre FEFO (péremption la plus
-- proche d'abord, NULL en dernier, puis date de réception la plus
-- ancienne) jusqu'à couvrir p_qty. Si p_sale_item_id est fourni, journalise
-- exactement quel(s) lot(s) a couvert cette ligne de vente dans
-- sale_item_batches, pour permettre une restauration précise plus tard.
--
-- Règle non négociable : si les lots ne suffisent pas à couvrir p_qty
-- (dérive de données), on déplète ce qui existe et on s'arrête là — cette
-- fonction ne doit JAMAIS faire échouer son appelant. products.quantity
-- reste la source de vérité pour le stock disponible ; un manque ici ne
-- doit jamais bloquer une vente.
--
-- Discipline anti-interblocage : cette fonction doit toujours être appelée
-- APRÈS que l'appelant a déjà verrouillé (FOR UPDATE) la ligne products
-- concernée, et verrouille toujours les lots dans le même ordre fixe
-- (expiry_date ASC NULLS LAST, received_at ASC).
CREATE OR REPLACE FUNCTION deplete_product_batches(
  p_product_id   uuid,
  p_qty          int,
  p_sale_item_id uuid DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  v_batch     RECORD;
  v_remaining int := p_qty;
  v_take      int;
BEGIN
  IF p_qty IS NULL OR p_qty <= 0 THEN
    RETURN;
  END IF;

  FOR v_batch IN
    SELECT id, quantity
    FROM product_batches
    WHERE product_id = p_product_id AND quantity > 0
    ORDER BY expiry_date ASC NULLS LAST, received_at ASC
    FOR UPDATE
  LOOP
    EXIT WHEN v_remaining <= 0;

    v_take := LEAST(v_batch.quantity, v_remaining);

    UPDATE product_batches
      SET quantity = quantity - v_take, updated_at = now()
      WHERE id = v_batch.id;

    IF p_sale_item_id IS NOT NULL THEN
      INSERT INTO sale_item_batches (sale_item_id, batch_id, quantity)
      VALUES (p_sale_item_id, v_batch.id, v_take);
    END IF;

    v_remaining := v_remaining - v_take;
  END LOOP;

  -- v_remaining > 0 ici signifie que les lots ne couvraient pas tout —
  -- toléré par design (voir commentaire ci-dessus), pas une erreur.
END;
$$;

-- ── restore_sale_item_batches() ──────────────────────────────────────────
-- Restaure exactement les lots enregistrés pour une ligne de vente donnée
-- (annulation/suppression/modification), puis supprime les lignes
-- d'allocation. Si un lot référencé a depuis été supprimé (batch_id NULL
-- via ON DELETE SET NULL), on ne peut pas y restaurer — toléré, pas bloquant.
CREATE OR REPLACE FUNCTION restore_sale_item_batches(p_sale_item_id uuid)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  v_alloc RECORD;
BEGIN
  FOR v_alloc IN
    SELECT id, batch_id, quantity
    FROM sale_item_batches
    WHERE sale_item_id = p_sale_item_id
    FOR UPDATE
  LOOP
    IF v_alloc.batch_id IS NOT NULL THEN
      UPDATE product_batches
        SET quantity = quantity + v_alloc.quantity, updated_at = now()
        WHERE id = v_alloc.batch_id;
    END IF;
  END LOOP;

  DELETE FROM sale_item_batches WHERE sale_item_id = p_sale_item_id;
END;
$$;

-- ============================================================
-- Migration 083 : Bons de commande fournisseurs (Phase 1)
-- ============================================================
-- Génère un bon de commande PDF pour un fournisseur à partir des
-- produits en rupture/stock faible (ou choisis manuellement), avec un
-- suivi de statut (Brouillon/Envoyé/Reçu/Annulé). L'envoi reste manuel
-- (téléchargement/partage du PDF) et le réassort reste manuel dans
-- cette phase — voir le plan pour les phases ultérieures.

-- Coordonnée de contact manquante sur les fournisseurs — pas utilisée
-- pour un envoi automatique dans cette phase, mais utile en soi et
-- prête pour une phase ultérieure.
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS email text;

CREATE TABLE IF NOT EXISTS purchase_orders (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid references shops(id) on delete cascade,
  supplier_id uuid references suppliers(id) on delete set null,
  reference text not null,
  status text not null default 'draft' check (status in ('draft', 'sent', 'received', 'cancelled')),
  notes text,
  created_by uuid references auth.users on delete set null,
  sent_at timestamptz,
  received_at timestamptz,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

CREATE TABLE IF NOT EXISTS purchase_order_items (
  id uuid primary key default gen_random_uuid(),
  purchase_order_id uuid references purchase_orders(id) on delete cascade,
  product_id uuid references products(id) on delete set null,
  -- Snapshots : le bon reste lisible même si le produit est renommé/supprimé plus tard.
  product_name text not null,
  unit text,
  quantity_ordered int not null check (quantity_ordered > 0),
  unit_price numeric,
  created_at timestamptz default now()
);

CREATE INDEX IF NOT EXISTS idx_purchase_orders_shop ON purchase_orders(shop_id);
CREATE INDEX IF NOT EXISTS idx_purchase_order_items_po ON purchase_order_items(purchase_order_id);

ALTER TABLE purchase_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE purchase_order_items ENABLE ROW LEVEL SECURITY;

-- Même pattern que suppliers (migration 081) / product_supplier_prices
-- (migration 082) : lecture pour tout membre actif, écriture réservée à
-- owner/manager/shop_manager/stock_manager.
CREATE POLICY purchase_orders_select ON purchase_orders
  FOR SELECT USING (is_shop_member(shop_id));

CREATE POLICY purchase_orders_insert ON purchase_orders
  FOR INSERT WITH CHECK (
    is_shop_member(shop_id)
    AND get_role_in_shop(shop_id) IN ('owner', 'manager', 'shop_manager', 'stock_manager')
  );

CREATE POLICY purchase_orders_update ON purchase_orders
  FOR UPDATE USING (
    is_shop_member(shop_id)
    AND get_role_in_shop(shop_id) IN ('owner', 'manager', 'shop_manager', 'stock_manager')
  )
  WITH CHECK (
    is_shop_member(shop_id)
    AND get_role_in_shop(shop_id) IN ('owner', 'manager', 'shop_manager', 'stock_manager')
  );

CREATE POLICY purchase_orders_delete ON purchase_orders
  FOR DELETE USING (
    is_shop_member(shop_id)
    AND get_role_in_shop(shop_id) IN ('owner', 'manager', 'shop_manager', 'stock_manager')
  );

-- purchase_order_items n'a pas shop_id directement — s'appuie sur la
-- policy du bon parent via une sous-requête.
CREATE POLICY purchase_order_items_select ON purchase_order_items
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM purchase_orders po WHERE po.id = purchase_order_id AND is_shop_member(po.shop_id))
  );

CREATE POLICY purchase_order_items_insert ON purchase_order_items
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM purchase_orders po WHERE po.id = purchase_order_id
      AND is_shop_member(po.shop_id)
      AND get_role_in_shop(po.shop_id) IN ('owner', 'manager', 'shop_manager', 'stock_manager')
    )
  );

CREATE POLICY purchase_order_items_update ON purchase_order_items
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM purchase_orders po WHERE po.id = purchase_order_id
      AND is_shop_member(po.shop_id)
      AND get_role_in_shop(po.shop_id) IN ('owner', 'manager', 'shop_manager', 'stock_manager')
    )
  );

CREATE POLICY purchase_order_items_delete ON purchase_order_items
  FOR DELETE USING (
    EXISTS (
      SELECT 1 FROM purchase_orders po WHERE po.id = purchase_order_id
      AND is_shop_member(po.shop_id)
      AND get_role_in_shop(po.shop_id) IN ('owner', 'manager', 'shop_manager', 'stock_manager')
    )
  );

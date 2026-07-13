-- ============================================================
-- Migration 082 : Comparateur de prix fournisseurs par produit
-- ============================================================
-- products.supplier_id/buying_price restent la source de vérité pour la
-- marge, les rapports et la valorisation du stock — trop de calculs en
-- dépendent pour les rendre multi-valués. Cette table est une couche de
-- comparaison au-dessus : un prix courant (pas un historique) par couple
-- (produit, fournisseur), pour pouvoir chercher un produit et voir ce que
-- proposent différents fournisseurs avant de choisir.

CREATE TABLE IF NOT EXISTS product_supplier_prices (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid references shops(id) on delete cascade,
  product_id uuid references products(id) on delete cascade,
  supplier_id uuid references suppliers(id) on delete cascade,
  price numeric not null check (price > 0),
  updated_at timestamptz default now(),
  created_at timestamptz default now(),
  unique (product_id, supplier_id)
);

CREATE INDEX IF NOT EXISTS idx_product_supplier_prices_shop ON product_supplier_prices(shop_id);
CREATE INDEX IF NOT EXISTS idx_product_supplier_prices_product ON product_supplier_prices(product_id);

ALTER TABLE product_supplier_prices ENABLE ROW LEVEL SECURITY;

-- Same pattern as suppliers (migration 081): any active member can read,
-- writes restricted to owner/manager/shop_manager/stock_manager.
CREATE POLICY product_supplier_prices_select ON product_supplier_prices
  FOR SELECT USING (is_shop_member(shop_id));

CREATE POLICY product_supplier_prices_insert ON product_supplier_prices
  FOR INSERT WITH CHECK (
    is_shop_member(shop_id)
    AND get_role_in_shop(shop_id) IN ('owner', 'manager', 'shop_manager', 'stock_manager')
  );

CREATE POLICY product_supplier_prices_update ON product_supplier_prices
  FOR UPDATE USING (
    is_shop_member(shop_id)
    AND get_role_in_shop(shop_id) IN ('owner', 'manager', 'shop_manager', 'stock_manager')
  )
  WITH CHECK (
    is_shop_member(shop_id)
    AND get_role_in_shop(shop_id) IN ('owner', 'manager', 'shop_manager', 'stock_manager')
  );

CREATE POLICY product_supplier_prices_delete ON product_supplier_prices
  FOR DELETE USING (
    is_shop_member(shop_id)
    AND get_role_in_shop(shop_id) IN ('owner', 'manager', 'shop_manager', 'stock_manager')
  );

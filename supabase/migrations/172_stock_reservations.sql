-- ============================================================
-- 172 — Stock réservé (étape 5B de la refonte Stock, 13 oct. 2026)
--
-- Un panier « mis en attente » à la caisse réserve ses articles : ils restent
-- en rayon (stock physique inchangé) mais ne comptent plus dans le stock
-- DISPONIBLE affiché aux autres vendeurs et dans le module Stock.
--
--   Disponible = Physique − Périmé − Réservé
--
-- Décisions validées :
--   • la réservation est INDICATIVE : elle ne bloque jamais une vente (aucun
--     déclencheur, aucune contrainte sur les ventes ; complete_sale n'est pas
--     touchée) ;
--   • niveau : un produit dans une boutique (ni lot, ni variante) ;
--   • elle expire seule (expires_at, 24 h après la mise en attente) : un panier
--     oublié ou un appareil hors connexion ne laisse pas de stock fantôme.
--     Une ligne expirée ne compte plus ; elle est effacée au passage suivant.
--
-- Écritures : uniquement par le serveur (/api/stock/reservations, rôle de
-- service), comme toutes les écritures métier depuis la 160. Le navigateur
-- lit seulement, et seulement les boutiques dont la personne est membre.
--
-- Aucune donnée existante modifiée. Ré-exécutable.
-- ============================================================

CREATE TABLE IF NOT EXISTS stock_reservations (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id     uuid NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  product_id  uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  quantity    int  NOT NULL CHECK (quantity > 0),
  -- Origine de la réservation. Une seule aujourd'hui : le panier en attente.
  source      text NOT NULL DEFAULT 'held_cart' CHECK (source IN ('held_cart')),
  -- Identifiant du panier en attente, créé par l'appareil (« draft_… »)
  source_ref  text NOT NULL CHECK (length(source_ref) BETWEEN 1 AND 120),
  -- Nom libre donné à la mise en attente (« Table 3 », « Mme Fatou »)
  label       text CHECK (label IS NULL OR length(label) <= 120),
  created_by  uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  expires_at  timestamptz NOT NULL,
  CONSTRAINT stock_reservations_unique UNIQUE (shop_id, source, source_ref, product_id)
);

-- Somme des réservations vivantes par produit d'une boutique
CREATE INDEX IF NOT EXISTS idx_stock_reservations_shop_expiry ON stock_reservations (shop_id, expires_at);
CREATE INDEX IF NOT EXISTS idx_stock_reservations_product ON stock_reservations (product_id);

ALTER TABLE stock_reservations ENABLE ROW LEVEL SECURITY;

-- Lecture : membres actifs de la boutique. Aucune règle d'écriture : le
-- navigateur ne peut ni créer, ni modifier, ni supprimer une réservation.
DROP POLICY IF EXISTS stock_reservations_select ON stock_reservations;
CREATE POLICY stock_reservations_select ON stock_reservations
  FOR SELECT USING (is_shop_member(shop_id));

REVOKE ALL ON TABLE stock_reservations FROM PUBLIC, anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLE stock_reservations FROM authenticated;
GRANT SELECT ON TABLE stock_reservations TO authenticated;
GRANT ALL ON TABLE stock_reservations TO service_role;

-- ── Vérifications (à coller après exécution) ────────────────────────────────
-- SELECT count(*) FROM stock_reservations;                                         -- 0
-- SELECT relrowsecurity FROM pg_class WHERE relname = 'stock_reservations';        -- true
-- SELECT policyname, cmd FROM pg_policies WHERE tablename = 'stock_reservations';  -- stock_reservations_select | SELECT
-- SELECT grantee, string_agg(privilege_type, ', ' ORDER BY privilege_type)
--   FROM information_schema.role_table_grants
--  WHERE table_name = 'stock_reservations' AND grantee IN ('anon', 'authenticated', 'service_role')
--  GROUP BY grantee;   -- authenticated : SELECT seulement ; anon : aucune ligne ; service_role : tout

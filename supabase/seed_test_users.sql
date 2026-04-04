-- ============================================
-- PROFILS DE TEST PAR RÔLE
-- À exécuter APRÈS avoir créé les users dans
-- Supabase Authentication → Users
-- ============================================

-- ÉTAPE 1: Crée ces 3 users dans Authentication → Users → Add user
--   cashier@northcode.ng    / Test1234!
--   stock@northcode.ng      / Test1234!
--   viewer@northcode.ng     / Test1234!

-- ÉTAPE 2: Remplace les UUIDs ci-dessous par les vrais UUIDs de chaque user
--   puis exécute ce SQL

INSERT INTO profiles (id, shop_id, full_name, role, is_active) VALUES
  (
    'UUID-CASHIER-ICI',   -- UUID de cashier@northcode.ng
    'a0000000-0000-0000-0000-000000000001',
    'Aminu Cashier',
    'cashier',
    true
  ),
  (
    'UUID-STOCK-ICI',     -- UUID de stock@northcode.ng
    'a0000000-0000-0000-0000-000000000001',
    'Binta Stock Manager',
    'stock_manager',
    true
  ),
  (
    'UUID-VIEWER-ICI',    -- UUID de viewer@northcode.ng
    'a0000000-0000-0000-0000-000000000001',
    'Chidi Viewer',
    'viewer',
    true
  );

-- ============================================
-- RÉSUMÉ DES DROITS PAR RÔLE
-- ============================================
--
-- OWNER (admin@northcode.ng)
--   ✅ Dashboard (chiffres + revenus)
--   ✅ Nouvelle vente (POS)
--   ✅ Historique ventes
--   ✅ Stock (voir prix d'achat)
--   ✅ Mouvements de stock
--   ✅ Fournisseurs
--   ✅ Clients
--   ✅ Paiements
--   ✅ Rapports
--   ✅ Équipe (inviter/modifier rôles)
--   ✅ Paramètres boutique
--
-- CASHIER (cashier@northcode.ng)
--   ✅ Dashboard (métriques de base)
--   ✅ Nouvelle vente (POS) — NE VOIT PAS le prix d'achat
--   ✅ Historique ventes
--   ✅ Clients
--   ❌ Stock / Fournisseurs
--   ❌ Rapports / Équipe / Paramètres
--
-- STOCK_MANAGER (stock@northcode.ng)
--   ✅ Dashboard
--   ✅ Stock (voir prix d'achat)
--   ✅ Mouvements de stock
--   ✅ Fournisseurs
--   ❌ POS / Ventes / Paiements
--   ❌ Rapports / Équipe / Paramètres
--
-- VIEWER (viewer@northcode.ng)
--   ✅ Dashboard (lecture seule)
--   ❌ Toutes les actions (pas de vente, pas de stock)
-- ============================================

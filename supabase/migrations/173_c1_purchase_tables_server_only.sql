-- ============================================================
-- 173 — Prix d'achat protégé, étape C1 (14 oct. 2026)
--       Tables d'achat réservées au serveur
--
-- Le navigateur ne lit plus ces trois tables (ni en direct, ni imbriquées dans
-- une autre lecture) : elles portent des prix d'achat unitaires. On retire donc
-- le droit de lecture aux rôles du navigateur (anon, authenticated).
--
--   purchase_order_items      (unit_price)
--   product_supplier_prices   (price)
--   stock_transfer_items      (buying_price)
--
-- Ce qui continue de fonctionner, sans changement :
--   • les routes serveur (clé de service) : bons de commande, réceptions,
--     transferts, comparateur de prix, dettes fournisseurs — elles appliquent
--     les droits (canViewCost, Fournisseurs, Crédits) ;
--   • les fonctions de la base (apply_purchase_order_receipt,
--     send_stock_transfer, receive_stock_transfer…) : exécutées avec les
--     droits de leur propriétaire, non appelables par le navigateur.
--
-- Vérifié avant (catalogue et journaux, lecture seule) :
--   • aucune lecture de ces tables par un navigateur sur 24 h ;
--   • aucune règle d'accès d'une autre table, aucune fonction exécutée avec
--     les droits de l'appelant, aucune vue n'en dépend ;
--   • elles ne sont pas diffusées en temps réel.
--
-- La vue héritée products_public (migration 001) exposait le prix d'achat au
-- rôle « owner » ; aucun code ne l'utilise et elle n'a reçu aucune requête :
-- supprimée.
--
-- Les écritures directes étaient déjà impossibles (aucune règle d'écriture
-- depuis la migration 160) : seul le droit de LECTURE est retiré ici.
--
-- Retour arrière : supabase/rollbacks/173_c1_rollback.sql — effet immédiat,
-- aucune donnée modifiée, aucun redéploiement.
-- Contrôle après application :
--   node scripts/security/probe-column-access.js --email=<compte de test> --expect=c1
-- ============================================================

begin;

revoke select on table public.purchase_order_items    from anon, authenticated;
revoke select on table public.product_supplier_prices from anon, authenticated;
revoke select on table public.stock_transfer_items    from anon, authenticated;

drop view if exists public.products_public;

commit;

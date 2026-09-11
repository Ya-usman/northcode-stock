-- ============================================================
-- Migration 144 : agent_commissions — ajout de la devise
-- ============================================================
-- Le module Agents n'avait AUCUNE colonne devise (schéma d'origine
-- 052_referral_agents.sql, `paystack_reference` suggère un module conçu
-- 100% Nigeria/NGN). Le total des commissions en attente additionnait donc
-- `commission_amount` de toutes les boutiques sans distinction de devise,
-- et l'affichage admin montrait « ₦ » en dur sur chaque ligne — faux pour
-- une commission liée à une boutique XAF/EUR/autre.
--
-- Trouvé lors de l'audit de la politique de devise StockShop (2026-09-11).
--
-- NON DESTRUCTIF. Vérifié avant migration : agent_commissions contient
-- 0 ligne à ce jour (module non encore utilisé en production réelle) —
-- aucun backfill historique nécessaire. Le défaut 'NGN' reste correct pour
-- toute ligne existante, seule source de création à ce jour
-- (app/api/billing/verify — Paystack, Nigeria exclusivement).
--
-- ROLLBACK :
--   ALTER TABLE agent_commissions DROP CONSTRAINT IF EXISTS agent_commissions_currency_supported;
--   ALTER TABLE agent_commissions ALTER COLUMN currency DROP NOT NULL;
--   ALTER TABLE agent_commissions DROP COLUMN IF EXISTS currency;

ALTER TABLE agent_commissions ADD COLUMN IF NOT EXISTS currency text;
UPDATE agent_commissions SET currency = 'NGN' WHERE currency IS NULL;
ALTER TABLE agent_commissions ALTER COLUMN currency SET DEFAULT 'NGN';
ALTER TABLE agent_commissions ALTER COLUMN currency SET NOT NULL;

-- Miroir de shops_currency_supported (migration 143) — les commissions ne
-- peuvent être que dans une devise que StockShop sait déjà représenter.
ALTER TABLE agent_commissions DROP CONSTRAINT IF EXISTS agent_commissions_currency_supported;
ALTER TABLE agent_commissions ADD CONSTRAINT agent_commissions_currency_supported CHECK (
  currency IN (
    'NGN','XOF','XAF','GHS','GNF','GMD','SLE','LRD','CVE','MRU','CDF','EUR','USD','CAD',
    'CZK','DKK','HUF','PLN','RON','SEK'
  )
);

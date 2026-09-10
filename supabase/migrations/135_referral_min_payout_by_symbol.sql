-- ============================================================
-- Migration 135 : min_payout_by_currency indexé par SYMBOLE
-- ============================================================
-- Le moteur de retrait (request_referral_payout, migration 131) résout le
-- minimum avec `min_payout_by_currency ->> wallet.currency`, où
-- `referral_wallets.currency` contient le SYMBOLE de devise (`₦`, `F CFA`,
-- `€`…) — comme `shops.currency` partout dans StockShop.
--
-- Or la config amorcée en 127 était indexée par CODE ISO (`NGN`, `XOF`…) :
-- la clé ne matchait jamais → aucun minimum de retrait ne s'appliquait
-- (v_min tombait à 0). Cette migration réindexe la ligne existante par
-- symbole, en préservant toute valeur déjà personnalisée, et complète les
-- devises supportées qui manquaient.
--
-- XOF et XAF partagent le symbole « F CFA » → une seule entrée.

UPDATE referral_program_config
SET min_payout_by_currency = jsonb_strip_nulls(jsonb_build_object(
  '₦',     COALESCE((min_payout_by_currency->>'₦')::numeric,     (min_payout_by_currency->>'NGN')::numeric, 10000),
  'F CFA', COALESCE((min_payout_by_currency->>'F CFA')::numeric, (min_payout_by_currency->>'XOF')::numeric, (min_payout_by_currency->>'XAF')::numeric, 5000),
  'GH₵',   COALESCE((min_payout_by_currency->>'GH₵')::numeric,   (min_payout_by_currency->>'GHS')::numeric, 100),
  '€',     COALESCE((min_payout_by_currency->>'€')::numeric,     (min_payout_by_currency->>'EUR')::numeric, 20),
  '$',     COALESCE((min_payout_by_currency->>'$')::numeric,     (min_payout_by_currency->>'USD')::numeric, 20),
  'CA$',   COALESCE((min_payout_by_currency->>'CA$')::numeric,   (min_payout_by_currency->>'CAD')::numeric, 25),
  'FG',    COALESCE((min_payout_by_currency->>'FG')::numeric,    150000),
  'D',     COALESCE((min_payout_by_currency->>'D')::numeric,     1500),
  'Le',    COALESCE((min_payout_by_currency->>'Le')::numeric,    500),
  'L$',    COALESCE((min_payout_by_currency->>'L$')::numeric,    4000),
  'Esc',   COALESCE((min_payout_by_currency->>'Esc')::numeric,   2000),
  'UM',    COALESCE((min_payout_by_currency->>'UM')::numeric,    1000),
  'FC',    COALESCE((min_payout_by_currency->>'FC')::numeric,    50000)
))
WHERE id = '00000000-0000-0000-0000-000000000001';

-- Nouveau défaut de colonne (installations futures) — même jeu, par symbole.
ALTER TABLE referral_program_config
  ALTER COLUMN min_payout_by_currency SET DEFAULT
  '{"₦": 10000, "F CFA": 5000, "GH₵": 100, "€": 20, "$": 20, "CA$": 25, "FG": 150000, "D": 1500, "Le": 500, "L$": 4000, "Esc": 2000, "UM": 1000, "FC": 50000}'::jsonb;

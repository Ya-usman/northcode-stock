-- ============================================================
-- Migration 136 : le module Parrainage passe aux codes ISO de devise
-- ============================================================
-- Le moteur de parrainage n'indexe plus rien par symbole d'affichage
-- (`₦`, `F CFA`…) mais par CODE ISO (`NGN`, `XOF`, `XAF`…) — stable et
-- non ambigu (XOF ≠ XAF). La devise est résolue depuis `shops.country`
-- (voir lib/saas/currencies.ts `currencyCodeForCountry`), plus jamais
-- depuis la chaîne libre `shops.currency`.
--
-- Portée : referral_wallets.currency, referral_program_config
-- .min_payout_by_currency. Les tables referral_rewards /
-- referral_wallet_transactions / referral_payout_requests sont vides —
-- rien à migrer, les écritures futures seront en ISO.
--
-- NB : `shops.currency` reste le symbole (dette historique utilisée dans
-- toute l'app pour l'affichage) — sa migration ISO complète est un
-- chantier V2.

-- ── 1. Correctif de données : une boutique avait « FCFA » sans espace ──
UPDATE shops SET currency = 'F CFA' WHERE currency = 'FCFA';

-- ── 2. referral_wallets.currency : symbole -> ISO ──────────────────────
-- Résolution non ambiguë via le pays de la boutique dont l'utilisateur
-- est propriétaire actif (le symbole seul ne distingue pas XOF de XAF).
UPDATE referral_wallets w
SET currency = sub.iso
FROM (
  SELECT sm.user_id,
         CASE s.country
           WHEN 'NG' THEN 'NGN'
           WHEN 'GH' THEN 'GHS'
           WHEN 'GN' THEN 'GNF'
           WHEN 'GM' THEN 'GMD'
           WHEN 'SL' THEN 'SLE'
           WHEN 'LR' THEN 'LRD'
           WHEN 'CV' THEN 'CVE'
           WHEN 'MR' THEN 'MRU'
           WHEN 'CD' THEN 'CDF'
           WHEN 'EU' THEN 'EUR'
           WHEN 'US' THEN 'USD'
           WHEN 'CA' THEN 'CAD'
           WHEN 'CM' THEN 'XAF' WHEN 'CG' THEN 'XAF' WHEN 'GA' THEN 'XAF'
           WHEN 'GQ' THEN 'XAF' WHEN 'CF' THEN 'XAF' WHEN 'TD' THEN 'XAF'
           WHEN 'CI' THEN 'XOF' WHEN 'ML' THEN 'XOF' WHEN 'NE' THEN 'XOF'
           WHEN 'SN' THEN 'XOF' WHEN 'BJ' THEN 'XOF' WHEN 'TG' THEN 'XOF'
           WHEN 'BF' THEN 'XOF' WHEN 'GW' THEN 'XOF'
           ELSE NULL
         END AS iso
  FROM shop_members sm
  JOIN shops s ON s.id = sm.shop_id
  WHERE sm.role = 'owner' AND sm.is_active = true
) sub
WHERE sub.user_id = w.user_id
  AND sub.iso IS NOT NULL
  AND w.currency !~ '^[A-Z]{3}$';   -- seulement les valeurs encore en symbole

-- Repli : tout portefeuille dont la devise est un symbole connu mais dont
-- le pays n'a pas pu être résolu (ne devrait pas arriver).
UPDATE referral_wallets SET currency = 'NGN'   WHERE currency = '₦';
UPDATE referral_wallets SET currency = 'GHS'   WHERE currency = 'GH₵';
UPDATE referral_wallets SET currency = 'EUR'   WHERE currency = '€';
UPDATE referral_wallets SET currency = 'USD'   WHERE currency = '$';
UPDATE referral_wallets SET currency = 'CAD'   WHERE currency = 'CA$';
-- « F CFA » sans pays résolu : impossible de trancher XOF/XAF -> laissé tel
-- quel, à corriger manuellement (aucun cas connu à ce jour).

-- ── 3. min_payout_by_currency : symbole -> ISO ────────────────────────
UPDATE referral_program_config
SET min_payout_by_currency = jsonb_build_object(
  'NGN', COALESCE((min_payout_by_currency->>'NGN')::numeric, (min_payout_by_currency->>'₦')::numeric,    10000),
  'XOF', COALESCE((min_payout_by_currency->>'XOF')::numeric, (min_payout_by_currency->>'F CFA')::numeric, 5000),
  'XAF', COALESCE((min_payout_by_currency->>'XAF')::numeric, (min_payout_by_currency->>'F CFA')::numeric, 5000),
  'GHS', COALESCE((min_payout_by_currency->>'GHS')::numeric, (min_payout_by_currency->>'GH₵')::numeric,   100),
  'EUR', COALESCE((min_payout_by_currency->>'EUR')::numeric, (min_payout_by_currency->>'€')::numeric,      20),
  'USD', COALESCE((min_payout_by_currency->>'USD')::numeric, (min_payout_by_currency->>'$')::numeric,      20),
  'CAD', COALESCE((min_payout_by_currency->>'CAD')::numeric, (min_payout_by_currency->>'CA$')::numeric,    25),
  'GNF', COALESCE((min_payout_by_currency->>'GNF')::numeric, (min_payout_by_currency->>'FG')::numeric,     150000),
  'GMD', COALESCE((min_payout_by_currency->>'GMD')::numeric, (min_payout_by_currency->>'D')::numeric,      1500),
  'SLE', COALESCE((min_payout_by_currency->>'SLE')::numeric, (min_payout_by_currency->>'Le')::numeric,     500),
  'LRD', COALESCE((min_payout_by_currency->>'LRD')::numeric, (min_payout_by_currency->>'L$')::numeric,     4000),
  'CVE', COALESCE((min_payout_by_currency->>'CVE')::numeric, (min_payout_by_currency->>'Esc')::numeric,    2000),
  'MRU', COALESCE((min_payout_by_currency->>'MRU')::numeric, (min_payout_by_currency->>'UM')::numeric,     1000),
  'CDF', COALESCE((min_payout_by_currency->>'CDF')::numeric, (min_payout_by_currency->>'FC')::numeric,     50000)
)
WHERE id = '00000000-0000-0000-0000-000000000001';

ALTER TABLE referral_program_config
  ALTER COLUMN min_payout_by_currency SET DEFAULT
  '{"NGN": 10000, "XOF": 5000, "XAF": 5000, "GHS": 100, "EUR": 20, "USD": 20, "CAD": 25, "GNF": 150000, "GMD": 1500, "SLE": 500, "LRD": 4000, "CVE": 2000, "MRU": 1000, "CDF": 50000}'::jsonb;

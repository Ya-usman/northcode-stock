-- ============================================================
-- Migration 143 : extension devises — Union européenne (27 pays)
-- ============================================================
-- Le sélecteur de pays passe de l'entrée unique « EU » (Europe) à 27 pays
-- individuels (lib/saas/countries.ts). 21 sont en euro ; 6 ont leur propre
-- devise (Rép. tchèque=CZK, Danemark=DKK, Hongrie=HUF, Pologne=PLN,
-- Roumanie=RON, Suède=SEK) — l'UE n'est PAS la zone euro, jamais supposer
-- EUR pour les 27.
--
-- ⚠️ Cette devise est la devise MÉTIER de la boutique (shops.currency :
-- POS, stock, rapports). La facturation de l'abonnement StockShop reste en
-- EUR pour les 27 pays UE (CountryConfig.billingCurrency, non stocké en
-- base — dérivé à la volée, comme le reste de la V3). Cette migration ne
-- touche donc QUE `shops.currency` / `shops_currency_supported`.
--
-- NON DESTRUCTIVE : élargit une contrainte et une fonction, ne modifie
-- aucune ligne existante (les 14 boutiques réelles restent NGN/XAF/XOF).
--
-- ROLLBACK (si besoin — sûr uniquement si aucune boutique n'utilise les 6
-- nouvelles devises) :
--   ALTER TABLE shops DROP CONSTRAINT IF EXISTS shops_currency_supported;
--   ALTER TABLE shops ADD CONSTRAINT shops_currency_supported CHECK (
--     currency IN ('NGN','XOF','XAF','GHS','GNF','GMD','SLE','LRD','CVE','MRU','CDF','EUR','USD','CAD')
--   );
--   -- puis restaurer l'ancienne définition de currency_code_for_country
--   -- (voir supabase/migrations/137_referral_wallet_currency_fix.sql)

-- ── 1. Contrainte : 14 → 20 codes ISO supportés ─────────────────────────
-- Miroir de SUPPORTED_CURRENCY_CODES (lib/saas/currencies.ts) après ajout
-- de CZK/DKK/HUF/PLN/RON/SEK.
ALTER TABLE shops DROP CONSTRAINT IF EXISTS shops_currency_supported;
ALTER TABLE shops ADD CONSTRAINT shops_currency_supported CHECK (
  currency IN (
    'NGN','XOF','XAF','GHS','GNF','GMD','SLE','LRD','CVE','MRU','CDF','EUR','USD','CAD',
    'CZK','DKK','HUF','PLN','RON','SEK'
  )
);

-- ── 2. currency_code_for_country() : +27 pays UE ────────────────────────
-- Remplace la fonction de la migration 137 (mêmes branches Afrique/US/CA
-- inchangées) en ajoutant les 27 codes UE. Utilisée par la migration 141
-- (déjà appliquée) et par le moteur de parrainage (devise du portefeuille
-- du parrain) — aucun des deux n'est ré-exécuté ici.
CREATE OR REPLACE FUNCTION currency_code_for_country(p_country text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE p_country
    WHEN 'NG' THEN 'NGN'
    WHEN 'GH' THEN 'GHS'
    WHEN 'GN' THEN 'GNF'
    WHEN 'GM' THEN 'GMD'
    WHEN 'SL' THEN 'SLE'
    WHEN 'LR' THEN 'LRD'
    WHEN 'CV' THEN 'CVE'
    WHEN 'MR' THEN 'MRU'
    WHEN 'CD' THEN 'CDF'
    WHEN 'US' THEN 'USD'
    WHEN 'CA' THEN 'CAD'
    WHEN 'CM' THEN 'XAF' WHEN 'CG' THEN 'XAF' WHEN 'GA' THEN 'XAF'
    WHEN 'GQ' THEN 'XAF' WHEN 'CF' THEN 'XAF' WHEN 'TD' THEN 'XAF'
    WHEN 'CI' THEN 'XOF' WHEN 'ML' THEN 'XOF' WHEN 'NE' THEN 'XOF'
    WHEN 'SN' THEN 'XOF' WHEN 'BJ' THEN 'XOF' WHEN 'TG' THEN 'XOF'
    WHEN 'BF' THEN 'XOF' WHEN 'GW' THEN 'XOF'
    -- Union européenne — 21 pays en euro
    WHEN 'DE' THEN 'EUR' WHEN 'AT' THEN 'EUR' WHEN 'BE' THEN 'EUR'
    WHEN 'BG' THEN 'EUR' WHEN 'HR' THEN 'EUR' WHEN 'CY' THEN 'EUR'
    WHEN 'ES' THEN 'EUR' WHEN 'EE' THEN 'EUR' WHEN 'FI' THEN 'EUR'
    WHEN 'FR' THEN 'EUR' WHEN 'GR' THEN 'EUR' WHEN 'IE' THEN 'EUR'
    WHEN 'IT' THEN 'EUR' WHEN 'LV' THEN 'EUR' WHEN 'LT' THEN 'EUR'
    WHEN 'LU' THEN 'EUR' WHEN 'MT' THEN 'EUR' WHEN 'NL' THEN 'EUR'
    WHEN 'PT' THEN 'EUR' WHEN 'SK' THEN 'EUR' WHEN 'SI' THEN 'EUR'
    -- Union européenne — 6 pays hors zone euro (jamais EUR)
    WHEN 'CZ' THEN 'CZK'
    WHEN 'DK' THEN 'DKK'
    WHEN 'HU' THEN 'HUF'
    WHEN 'PL' THEN 'PLN'
    WHEN 'RO' THEN 'RON'
    WHEN 'SE' THEN 'SEK'
    ELSE 'NGN'
  END
$$;

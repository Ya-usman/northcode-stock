-- ============================================================
-- Migration 149 : identité de la boutique sur les reçus et tickets
-- ============================================================
-- Trois textes libres, saisis dans Paramètres → Informations de la boutique
-- et imprimés sur le ticket thermique comme sur les reçus A5 :
--   receipt_tagline   : ligne d'activité sous le nom (« Alimentation générale »)
--   receipt_legal_ids : mentions légales, une par ligne (NIU, RCCM, TIN, NINEA,
--                       IFU, SIRET…) — texte libre, chaque pays a les siennes
--   receipt_footer    : message de pied ; remplace « Merci pour votre confiance »
--                       + « À très bientôt ! » quand il est rempli
-- NULL = non renseigné (jamais de ligne vide imprimée). Longueurs bornées :
-- un rouleau de 58 mm n'a que 32 caractères par ligne. Voir discussion
-- produit du 2026-10-03 (lot B du ticket).

ALTER TABLE shops
  ADD COLUMN IF NOT EXISTS receipt_tagline   text,
  ADD COLUMN IF NOT EXISTS receipt_legal_ids text,
  ADD COLUMN IF NOT EXISTS receipt_footer    text;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'shops_receipt_tagline_len') THEN
    ALTER TABLE shops ADD CONSTRAINT shops_receipt_tagline_len
      CHECK (receipt_tagline IS NULL OR char_length(receipt_tagline) <= 80);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'shops_receipt_legal_ids_len') THEN
    ALTER TABLE shops ADD CONSTRAINT shops_receipt_legal_ids_len
      CHECK (receipt_legal_ids IS NULL OR char_length(receipt_legal_ids) <= 300);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'shops_receipt_footer_len') THEN
    ALTER TABLE shops ADD CONSTRAINT shops_receipt_footer_len
      CHECK (receipt_footer IS NULL OR char_length(receipt_footer) <= 200);
  END IF;
END $$;

COMMENT ON COLUMN shops.receipt_tagline IS
  'Ligne d''activité imprimée sous le nom sur les tickets et reçus (« Alimentation générale »). NULL = absente.';
COMMENT ON COLUMN shops.receipt_legal_ids IS
  'Mentions légales imprimées sous l''en-tête des tickets et reçus, une par ligne (NIU, RCCM, TIN…). Texte libre, NULL = absentes.';
COMMENT ON COLUMN shops.receipt_footer IS
  'Message de pied des tickets et reçus (2 lignes max.) ; remplace le « Merci pour votre confiance » par défaut. NULL = défaut.';

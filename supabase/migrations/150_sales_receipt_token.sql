-- ============================================================
-- Migration 150 : jeton public du reçu (QR code sur le ticket)
-- ============================================================
-- Chaque vente porte un jeton de 16 caractères [a-z0-9] (36^16 ≈ 8·10^24
-- combinaisons : impossible à deviner) qui ouvre la page publique
-- stockshop.tech/r/<jeton> — le client la scanne sur le ticket, la retrouve
-- dans son WhatsApp, y télécharge le PDF. Généré :
--   - par la base (DEFAULT) pour les ventes en ligne : complete_sale renvoie
--     la ligne complète, l'app reçoit donc le jeton avant d'imprimer, sans
--     modifier cette fonction ;
--   - par l'app pour les ventes hors ligne (QR imprimé avant la synchro) ;
--     la synchro insère ce jeton tel quel (même format, vérifié par CHECK).
-- Les ventes existantes reçoivent un jeton pour que les réimpressions depuis
-- l'historique aient aussi leur QR. Lot C du ticket (2026-10-03).

CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;

-- Octets aléatoires cryptographiques (pgcrypto), un caractère par octet.
-- 256 mod 36 = 4 : les quatre premières lettres sont très légèrement plus
-- fréquentes — sans effet sur le caractère indevinable (≈ 82 bits).
CREATE OR REPLACE FUNCTION gen_receipt_token()
RETURNS text
LANGUAGE sql
VOLATILE
AS $$
  SELECT string_agg(
    substr('abcdefghijklmnopqrstuvwxyz0123456789', (get_byte(gen_random_bytes(1), 0) % 36) + 1, 1),
    ''
  )
  FROM generate_series(1, 16);
$$;

ALTER TABLE sales ADD COLUMN IF NOT EXISTS receipt_token text;

-- Ventes existantes : un jeton chacune (fonction VOLATILE → évaluée par ligne)
UPDATE sales SET receipt_token = gen_receipt_token() WHERE receipt_token IS NULL;

ALTER TABLE sales ALTER COLUMN receipt_token SET DEFAULT gen_receipt_token();
ALTER TABLE sales ALTER COLUMN receipt_token SET NOT NULL;

-- Recherche par jeton depuis la page publique : index unique
CREATE UNIQUE INDEX IF NOT EXISTS idx_sales_receipt_token ON sales (receipt_token);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sales_receipt_token_format') THEN
    ALTER TABLE sales ADD CONSTRAINT sales_receipt_token_format
      CHECK (receipt_token ~ '^[a-z0-9]{16}$');
  END IF;
END $$;

COMMENT ON COLUMN sales.receipt_token IS
  'Jeton public du reçu (16 car. [a-z0-9], indevinable) : page stockshop.tech/r/<jeton>, QR sur le ticket. DEFAULT en base ; fourni par l''app pour les ventes hors ligne.';

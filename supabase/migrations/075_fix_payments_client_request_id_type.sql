-- ============================================================
-- Migration 075 : corrige le type de payments.client_request_id
-- ============================================================
-- La migration 074 a été appliquée avant sa correction en type "text"
-- (nécessaire car ce champ stocke une clé composite "uuid:sale_id", pas un
-- UUID pur) — la colonne existante en "uuid" rejette ces valeurs avec
-- "invalid input syntax for type uuid". ALTER COLUMN TYPE corrige la
-- colonne déjà créée (contrairement à ADD COLUMN IF NOT EXISTS, qui ne
-- touche pas une colonne existante).

ALTER TABLE payments
  ALTER COLUMN client_request_id TYPE text
  USING client_request_id::text;

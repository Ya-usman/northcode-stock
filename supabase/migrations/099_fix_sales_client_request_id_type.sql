-- ============================================================
-- Migration 099 : corrige le type de sales.client_request_id
-- ============================================================
-- Migration 073 a typé cette colonne en "uuid" en supposant que le client
-- générerait toujours un vrai UUID (crypto.randomUUID(), comme le fait
-- effectivement le chemin de vente en ligne). Mais la file d'attente
-- hors-ligne (lib/offline/db.ts) réutilise le local_id de la vente comme
-- client_request_id à la synchronisation — un identifiant de la forme
-- "local-<timestamp>-<random>", pas un UUID — et la synchro échouait
-- systématiquement avec "invalid input syntax for type uuid: local-...".
-- Même défaut, même correctif que la migration 075 pour payments.client_request_id.

ALTER TABLE sales
  ALTER COLUMN client_request_id TYPE text
  USING client_request_id::text;

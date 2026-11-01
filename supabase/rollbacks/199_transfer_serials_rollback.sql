-- Retour arrière de 199 (numéros de série, lot C : transferts). Les fonctions de transfert de la 188 n'ont pas été
-- modifiées : on retire seulement les fonctions d'enveloppe, le déclencheur et la colonne. Les numéros encore « en
-- transit » restent tels quels (à remettre en stock à la main si un transfert est ensuite annulé).
SET LOCAL lock_timeout = '5s';
DROP TRIGGER IF EXISTS trg_release_serials_on_transfer_cancel ON public.stock_transfers;
DROP FUNCTION IF EXISTS public.release_serials_on_transfer_cancel();
DROP FUNCTION IF EXISTS public.receive_transfer_with_serials(uuid, uuid, uuid, uuid, jsonb);
DROP FUNCTION IF EXISTS public.create_transfer_with_serials(uuid, uuid, uuid, text, jsonb, jsonb);
DROP FUNCTION IF EXISTS public.send_transfer_with_serials(uuid, uuid, uuid, jsonb);
DROP FUNCTION IF EXISTS public._clean_serial_list(jsonb, text);
DROP INDEX IF EXISTS public.idx_product_serials_transfer;
ALTER TABLE public.product_serials DROP COLUMN IF EXISTS transfer_item_id;

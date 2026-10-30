-- ============================================================
-- Retour arrière de la 190 : supprime les demandes de transfert et le réglage « stock des autres boutiques ».
-- Perd les demandes enregistrées (les transferts eux-mêmes ne sont pas touchés). L'application fonctionne sans :
-- « Disponible ailleurs » reste affiché (réglage par défaut), le bouton « Demander » et l'encadré « Demandes »
-- disparaissent.
-- ============================================================

SET LOCAL lock_timeout = '5s';

DROP TABLE IF EXISTS public.stock_transfer_requests;
ALTER TABLE public.entities DROP COLUMN IF EXISTS share_stock_with_sellers;

NOTIFY pgrst, 'reload schema';

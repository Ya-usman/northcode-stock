-- ============================================================
-- 190 : demandes de transfert entre boutiques + réglage « stock des autres boutiques visible par les vendeurs »
--       (conception validée le 30 oct. 2026)
-- ============================================================
-- Quand un article manque, le vendeur voit dans quelles autres boutiques de l'entreprise il est disponible
-- (« Disponible ailleurs ») et peut DEMANDER un transfert. La boutique qui a le stock DÉCIDE : accepter ouvre le
-- circuit normal des transferts (188), refuser enregistre un motif.
--
-- 1. entities.share_stock_with_sellers : le propriétaire peut cacher le stock des autres boutiques aux vendeurs
--    (activé par défaut ; propriétaire et responsables le voient toujours). Lisible comme les autres colonnes.
-- 2. stock_transfer_requests : RÉSERVÉE AU SERVEUR (aucun droit pour anon / authenticated, RLS active sans
--    politique), comme les autres tables des transferts. Une seule demande EN ATTENTE par boutique demandeuse et
--    produit d'origine (pas de doublon).
--
-- Additive, ré-exécutable. Retour arrière : supabase/rollbacks/190_stock_transfer_requests_rollback.sql
-- ============================================================

SET LOCAL lock_timeout = '5s';

ALTER TABLE public.entities ADD COLUMN IF NOT EXISTS share_stock_with_sellers boolean NOT NULL DEFAULT true;
COMMENT ON COLUMN public.entities.share_stock_with_sellers IS
  'Vendeurs : voir le stock des autres boutiques (« Disponible ailleurs ») et demander un transfert (migration 190)';

CREATE TABLE IF NOT EXISTS public.stock_transfer_requests (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  requesting_shop_id     uuid NOT NULL REFERENCES public.shops(id) ON DELETE CASCADE,
  source_shop_id         uuid NOT NULL REFERENCES public.shops(id) ON DELETE CASCADE,
  source_product_id      uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  destination_product_id uuid REFERENCES public.products(id) ON DELETE SET NULL,
  product_name           text NOT NULL,
  quantity               integer NOT NULL,
  note                   text,
  status                 text NOT NULL DEFAULT 'pending',
  decline_reason         text,
  transfer_id            uuid REFERENCES public.stock_transfers(id) ON DELETE SET NULL,
  requested_by           uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  decided_by             uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at             timestamptz NOT NULL DEFAULT now(),
  decided_at             timestamptz,
  updated_at             timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT stock_transfer_requests_status_check CHECK (status IN ('pending', 'accepted', 'declined', 'cancelled')),
  CONSTRAINT stock_transfer_requests_quantity_check CHECK (quantity > 0 AND quantity <= 1000000),
  CONSTRAINT stock_transfer_requests_distinct_shops CHECK (requesting_shop_id <> source_shop_id),
  CONSTRAINT stock_transfer_requests_note_length CHECK (note IS NULL OR length(note) <= 500),
  CONSTRAINT stock_transfer_requests_reason_length CHECK (decline_reason IS NULL OR length(decline_reason) <= 500),
  CONSTRAINT stock_transfer_requests_accepted_has_transfer CHECK (status <> 'accepted' OR transfer_id IS NOT NULL)
);
COMMENT ON TABLE public.stock_transfer_requests IS
  'Demandes de transfert entre boutiques d''une même entreprise (migration 190) ; réservée au serveur';

-- Une seule demande en attente par boutique demandeuse et produit d'origine
CREATE UNIQUE INDEX IF NOT EXISTS stock_transfer_requests_one_pending
  ON public.stock_transfer_requests (requesting_shop_id, source_product_id) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS stock_transfer_requests_source_pending
  ON public.stock_transfer_requests (source_shop_id) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS stock_transfer_requests_requesting
  ON public.stock_transfer_requests (requesting_shop_id, created_at DESC);

ALTER TABLE public.stock_transfer_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.stock_transfer_requests FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.stock_transfer_requests TO service_role;

DO $$
DECLARE bad text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'entities'
                  AND column_name = 'share_stock_with_sellers' AND data_type = 'boolean' AND is_nullable = 'NO') THEN
    RAISE EXCEPTION '190 : entities.share_stock_with_sellers absente ou inattendue — annulé';
  END IF;
  IF EXISTS (SELECT 1 FROM public.entities WHERE share_stock_with_sellers IS DISTINCT FROM true) THEN
    RAISE EXCEPTION '190 : valeur par défaut inattendue sur les entreprises existantes — annulé';
  END IF;
  SELECT string_agg(r, ', ') INTO bad FROM unnest(ARRAY['anon', 'authenticated']) r
   WHERE has_table_privilege(r, 'public.stock_transfer_requests', 'SELECT')
      OR has_table_privilege(r, 'public.stock_transfer_requests', 'INSERT')
      OR has_table_privilege(r, 'public.stock_transfer_requests', 'UPDATE')
      OR has_table_privilege(r, 'public.stock_transfer_requests', 'DELETE');
  IF bad IS NOT NULL THEN RAISE EXCEPTION '190 : stock_transfer_requests accessible à % — annulé', bad; END IF;
  IF NOT has_table_privilege('service_role', 'public.stock_transfer_requests', 'SELECT') THEN
    RAISE EXCEPTION '190 : service_role ne lit pas stock_transfer_requests — annulé';
  END IF;
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.stock_transfer_requests'::regclass) THEN
    RAISE EXCEPTION '190 : RLS inactive sur stock_transfer_requests — annulé';
  END IF;
  RAISE NOTICE '190 : demandes de transfert (serveur seulement) + réglage share_stock_with_sellers';
END $$;

NOTIFY pgrst, 'reload schema';

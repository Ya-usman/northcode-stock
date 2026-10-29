-- 188 — Transferts entre boutiques : brouillon, envoi, réception en plusieurs fois, écarts, traçabilité LOT PAR LOT.
-- Reprise du brouillon validé le 14-15 oct. 2026 (supabase/drafts/176_transferts_workflow.sql, jamais appliqué),
-- corrigé le 29 oct. 2026 après revérification contre les migrations 173 à 187 et selon les décisions de l'utilisateur.
--
-- Statuts : brouillon → en transit → reçu ; annulé ; réception partielle (« partially_received »).
-- « Reçu avec écart » = reçu + has_discrepancy (pas de statut de plus).
--
-- Décisions du 29 oct. 2026 :
--   1. Envoyer = droit « Transferts » en modification sur la boutique SOURCE (contrôlé par les routes) ; la base ne
--      réserve plus l'envoi au propriétaire (104). Le propriétaire règle ce droit par rôle (Paramètres).
--   2. Boutiques de devises différentes (même entreprise) : transfert autorisé ; à l'arrivée le coût est INCONNU
--      (NULL sur les lots) ; un produit créé à l'arrivée l'est DÉSACTIVÉ, prix à 0 (jamais vendu à 0 par erreur :
--      le propriétaire fixe le prix puis l'active). Même devise : coûts et prix de la source repris.
--   3. Surplus à la réception (plus que l'envoyé) : ENTRE en stock à l'arrivée, dans un lot « origine non tracée »
--      (sans date, coût inconnu), écart signalé (has_discrepancy) et tracé (ligne de réception « surplus »).
--   4. Manque : la DESTINATION déclare seulement ce qu'elle a reçu ; le reste reste « en transit » ; c'est la SOURCE
--      qui le règle : « jamais parti » (rendu à ses lots EXACTS) ou perdu / cassé / volé / autre (motif).
--
-- Corrections techniques (revérification du 29 oct.) :
--   • stock_movements.batch_id existe depuis la 179 (clé étrangère NO ACTION) : réutilisée, jamais recréée ;
--   • péremption à la DATE MÉTIER de la boutique source (shop_business_date, 178) ; quantité transférable =
--     sellable_stock(...).sellable (même règle que la caisse) ; lots choisis comme allocate_sale_batches (FEFO,
--     lots périmés exclus) ;
--   • coût inconnu = NULL sur les lots, jamais 0 ; un lot sans coût ne reprend pas le coût actuel du produit ;
--   • clé de réception rejouée sur un AUTRE transfert : refusée (P0069) ;
--   • colonnes d'origine des lots lisibles par le navigateur (non sensibles), comme les autres colonnes autorisées (182) ;
--   • motifs de mouvement sans tiret long.
--
-- ENVOI (une transaction, jamais deux fois) : stock du produit ET lots source diminuent ; chaque ALLOCATION (lot
-- source, péremption, coût, quantité) est enregistrée : c'est la source de vérité du stock en transit.
-- RÉCEPTION : les unités reçues vont aux allocations qui périment le plus tôt ; un lot destination par lot source
-- reçu (même péremption, coût du lot source si même devise, liens d'origine).
-- POUR CHAQUE ALLOCATION : envoyé = reçu + rendu à la source + perdu + en transit (calculé, contrainte en base).
-- ANNULATION : seulement si rien n'a été reçu ni réglé ; tout revient aux lots source exacts.
-- Stock SANS LOT (données anciennes) : part en une allocation « sans lot connu », arrive dans un lot technique
-- « origine non tracée » (sans date, jamais inventée).
-- Historique : les 6 transferts existants reçoivent des allocations « ancien modèle » (quantités connues) ; les 2
-- encore en route restent réceptionnables. Rien n'est corrigé dans le passé.
--
-- Erreurs codées P0060 à P0077 (messages traduits par l'application, détail JSON quand utile).
-- Appliquée par « supabase db push » (transaction de la CLI) : pas de BEGIN / COMMIT dans ce fichier.
-- Retour arrière : supabase/rollbacks/188_transfers_workflow_rollback.sql (possible tant qu'aucun transfert n'a
-- utilisé le nouveau modèle).

SET LOCAL lock_timeout = '5s';

-- ── 1. Transferts : statuts et envoi ────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.stock_transfers DROP CONSTRAINT IF EXISTS stock_transfers_status_check;
ALTER TABLE public.stock_transfers ADD CONSTRAINT stock_transfers_status_check
  CHECK (status IN ('draft', 'sent', 'partially_received', 'received', 'cancelled'));

ALTER TABLE public.stock_transfers
  ADD COLUMN sent_at          timestamptz,
  ADD COLUMN sent_by          uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN has_discrepancy  boolean NOT NULL DEFAULT false,
  ADD COLUMN updated_at       timestamptz NOT NULL DEFAULT now();

-- Les transferts existants ont tous été envoyés au moment de leur création
UPDATE public.stock_transfers SET sent_at = created_at, sent_by = created_by;

CREATE UNIQUE INDEX stock_transfers_source_reference ON public.stock_transfers (source_shop_id, reference);
CREATE INDEX stock_transfers_open_destination ON public.stock_transfers (destination_shop_id) WHERE status IN ('sent', 'partially_received');

-- ── 2. Lignes : surplus reçu ─────────────────────────────────────────────────────────────────────────────────────
-- quantity_received reste la somme reçue AU TITRE DE L'ENVOI (tenue à jour par les fonctions, lue par l'ancien écran) ;
-- le surplus est compté à part.
ALTER TABLE public.stock_transfer_items
  ADD COLUMN quantity_surplus int NOT NULL DEFAULT 0 CHECK (quantity_surplus >= 0);

-- ── 3. Allocations : quels lots sont partis, et ce qu'ils sont devenus ──────────────────────────────────────────
CREATE TABLE public.stock_transfer_allocations (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  transfer_id          uuid NOT NULL REFERENCES public.stock_transfers(id) ON DELETE CASCADE,
  item_id              uuid NOT NULL REFERENCES public.stock_transfer_items(id) ON DELETE CASCADE,
  coverage             text NOT NULL CHECK (coverage IN ('batch', 'uncovered', 'legacy')),
                       -- batch : unités sorties d'un lot précis ; uncovered : stock sans lot ;
                       -- legacy : transfert d'avant cette migration (lots non décomptés à l'époque)
  source_batch_id      uuid REFERENCES public.product_batches(id) ON DELETE SET NULL,
  source_expiry_date   date,                 -- figés : restent lisibles même si le lot source disparaît
  source_received_at   timestamptz,
  unit_cost            numeric,              -- coût à la SOURCE (sa devise) ; NULL = inconnu ; réservé au serveur
  quantity_sent        int NOT NULL CHECK (quantity_sent > 0),
  quantity_received    int NOT NULL DEFAULT 0 CHECK (quantity_received >= 0),
  quantity_returned    int NOT NULL DEFAULT 0 CHECK (quantity_returned >= 0),
  quantity_lost        int NOT NULL DEFAULT 0 CHECK (quantity_lost >= 0),
  quantity_in_transit  int GENERATED ALWAYS AS (quantity_sent - quantity_received - quantity_returned - quantity_lost) STORED,
  created_at           timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT stock_transfer_allocations_balance CHECK (quantity_received + quantity_returned + quantity_lost <= quantity_sent),
  CONSTRAINT stock_transfer_allocations_batch_has_lot CHECK (coverage <> 'batch' OR source_received_at IS NOT NULL),
  CONSTRAINT stock_transfer_allocations_cost CHECK (unit_cost IS NULL OR unit_cost > 0)
);
CREATE INDEX stock_transfer_allocations_transfer ON public.stock_transfer_allocations (transfer_id);
CREATE INDEX stock_transfer_allocations_item ON public.stock_transfer_allocations (item_id);
CREATE INDEX stock_transfer_allocations_source_batch ON public.stock_transfer_allocations (source_batch_id) WHERE source_batch_id IS NOT NULL;

-- ── 4. Réceptions (une par passage) et leur répartition ─────────────────────────────────────────────────────────
CREATE TABLE public.stock_transfer_receipts (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  transfer_id  uuid NOT NULL REFERENCES public.stock_transfers(id) ON DELETE CASCADE,
  receipt_key  uuid NOT NULL UNIQUE,          -- idempotence : une réception renvoyée n'est appliquée qu'une fois
  received_by  uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  received_at  timestamptz NOT NULL DEFAULT now(),
  note         text
);
CREATE INDEX stock_transfer_receipts_transfer ON public.stock_transfer_receipts (transfer_id, received_at);

CREATE TABLE public.stock_transfer_receipt_lines (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  receipt_id              uuid NOT NULL REFERENCES public.stock_transfer_receipts(id) ON DELETE CASCADE,
  item_id                 uuid NOT NULL REFERENCES public.stock_transfer_items(id) ON DELETE CASCADE,
  allocation_id           uuid REFERENCES public.stock_transfer_allocations(id) ON DELETE CASCADE,
  kind                    text NOT NULL CHECK (kind IN ('received', 'surplus')),
  quantity                int NOT NULL CHECK (quantity > 0),
  assignment              text NOT NULL DEFAULT 'auto' CHECK (assignment IN ('auto', 'manual')),
  destination_product_id  uuid REFERENCES public.products(id) ON DELETE SET NULL,
  destination_batch_id    uuid REFERENCES public.product_batches(id) ON DELETE SET NULL,
  movement_id             uuid,               -- mouvement « entrée » de la ligne (un par produit et par réception)
  CONSTRAINT stock_transfer_receipt_lines_kind CHECK ((kind = 'received') = (allocation_id IS NOT NULL))
);
CREATE INDEX stock_transfer_receipt_lines_receipt ON public.stock_transfer_receipt_lines (receipt_id);
CREATE INDEX stock_transfer_receipt_lines_allocation ON public.stock_transfer_receipt_lines (allocation_id) WHERE allocation_id IS NOT NULL;
CREATE INDEX stock_transfer_receipt_lines_item ON public.stock_transfer_receipt_lines (item_id);

-- ── 5. Écarts réglés par la SOURCE : rendus (annulé, jamais parti) ou perdus ────────────────────────────────────
CREATE TABLE public.stock_transfer_settlements (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  transfer_id        uuid NOT NULL REFERENCES public.stock_transfers(id) ON DELETE CASCADE,
  item_id            uuid NOT NULL REFERENCES public.stock_transfer_items(id) ON DELETE CASCADE,
  allocation_id      uuid NOT NULL REFERENCES public.stock_transfer_allocations(id) ON DELETE CASCADE,
  kind               text NOT NULL CHECK (kind IN ('returned', 'lost')),
  reason             text NOT NULL CHECK (reason IN ('cancelled', 'not_sent', 'transport_loss', 'breakage', 'theft', 'other')),
  note               text,
  quantity           int NOT NULL CHECK (quantity > 0),
  action_key         uuid NOT NULL,           -- idempotence d'une action (une action peut toucher plusieurs allocations)
  settled_by         uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  settled_at         timestamptz NOT NULL DEFAULT now(),
  restored_batch_id  uuid REFERENCES public.product_batches(id) ON DELETE SET NULL,   -- lot source crédité (retour)
  movement_id        uuid,
  CONSTRAINT stock_transfer_settlements_kind CHECK ((kind = 'returned') = (reason IN ('cancelled', 'not_sent'))),
  CONSTRAINT stock_transfer_settlements_other_note CHECK (reason <> 'other' OR coalesce(btrim(note), '') <> ''),
  CONSTRAINT stock_transfer_settlements_once UNIQUE (action_key, allocation_id)
);
CREATE INDEX stock_transfer_settlements_transfer ON public.stock_transfer_settlements (transfer_id);
CREATE INDEX stock_transfer_settlements_allocation ON public.stock_transfer_settlements (allocation_id);
CREATE INDEX stock_transfer_settlements_action ON public.stock_transfer_settlements (action_key);

-- ── 6. Liens de traçabilité sur les lots et les mouvements ──────────────────────────────────────────────────────
ALTER TABLE public.product_batches
  ADD COLUMN origin_transfer_id  uuid REFERENCES public.stock_transfers(id) ON DELETE SET NULL,
  ADD COLUMN origin_batch_id     uuid REFERENCES public.product_batches(id) ON DELETE SET NULL,
  ADD COLUMN origin_untracked    boolean NOT NULL DEFAULT false;   -- lot technique : origine non tracée (sans date)
CREATE INDEX product_batches_origin_transfer ON public.product_batches (origin_transfer_id) WHERE origin_transfer_id IS NOT NULL;
CREATE INDEX product_batches_origin_batch ON public.product_batches (origin_batch_id) WHERE origin_batch_id IS NOT NULL;
-- Colonnes non sensibles : lisibles comme les autres colonnes autorisées des lots (182 : fermé par défaut, liste explicite)
GRANT SELECT (origin_transfer_id, origin_batch_id, origin_untracked) ON public.product_batches TO authenticated;

-- stock_movements.batch_id : créée par la 179 (clé étrangère NO ACTION, index idx_stock_movements_batch) — réutilisée
ALTER TABLE public.stock_movements
  ADD COLUMN transfer_id uuid REFERENCES public.stock_transfers(id) ON DELETE SET NULL;
CREATE INDEX stock_movements_transfer ON public.stock_movements (transfer_id) WHERE transfer_id IS NOT NULL;

-- Perte pendant le transport : un mouvement explicite qui ne change AUCUN stock (avant / après vides)
ALTER TABLE public.stock_movements DROP CONSTRAINT IF EXISTS stock_movements_type_check;
ALTER TABLE public.stock_movements ADD CONSTRAINT stock_movements_type_check
  CHECK (type IN ('in', 'out', 'adjustment', 'sale', 'transit_loss'));

-- ── 7. Réservé au serveur ────────────────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.stock_transfer_allocations    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stock_transfer_receipts       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stock_transfer_receipt_lines  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stock_transfer_settlements    ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.stock_transfer_allocations   FROM anon, authenticated;
REVOKE ALL ON TABLE public.stock_transfer_receipts      FROM anon, authenticated;
REVOKE ALL ON TABLE public.stock_transfer_receipt_lines FROM anon, authenticated;
REVOKE ALL ON TABLE public.stock_transfer_settlements   FROM anon, authenticated;

-- ── 8. Les transferts existants (rien n'est corrigé, tout reste lisible) ────────────────────────────────────────
-- Une allocation « ancien modèle » par ligne, aux quantités déjà connues (coût repris seulement s'il est positif)
INSERT INTO public.stock_transfer_allocations (transfer_id, item_id, coverage, unit_cost, quantity_sent, quantity_received, quantity_returned, quantity_lost)
SELECT t.id, i.id, 'legacy', nullif(greatest(coalesce(i.buying_price, 0), 0), 0), i.quantity_sent,
       CASE WHEN t.status = 'received' THEN least(coalesce(i.quantity_received, 0), i.quantity_sent) ELSE 0 END,
       CASE WHEN t.status = 'cancelled' THEN i.quantity_sent ELSE 0 END,
       CASE WHEN t.status = 'received' THEN i.quantity_sent - least(coalesce(i.quantity_received, 0), i.quantity_sent) ELSE 0 END
FROM public.stock_transfers t JOIN public.stock_transfer_items i ON i.stock_transfer_id = t.id;

-- Réceptions des transferts reçus, et le règlement des annulés
INSERT INTO public.stock_transfer_receipts (transfer_id, receipt_key, received_by, received_at)
SELECT id, gen_random_uuid(), received_by, coalesce(received_at, created_at) FROM public.stock_transfers WHERE status = 'received';
INSERT INTO public.stock_transfer_receipt_lines (receipt_id, item_id, allocation_id, kind, quantity, destination_product_id)
SELECT r.id, a.item_id, a.id, 'received', a.quantity_received, i.destination_product_id
FROM public.stock_transfer_receipts r
JOIN public.stock_transfer_allocations a ON a.transfer_id = r.transfer_id AND a.quantity_received > 0
JOIN public.stock_transfer_items i ON i.id = a.item_id;
INSERT INTO public.stock_transfer_settlements (transfer_id, item_id, allocation_id, kind, reason, quantity, action_key, settled_by, settled_at)
SELECT a.transfer_id, a.item_id, a.id, 'returned', 'cancelled', a.quantity_returned, gen_random_uuid(), t.cancelled_by, coalesce(t.cancelled_at, t.created_at)
FROM public.stock_transfer_allocations a JOIN public.stock_transfers t ON t.id = a.transfer_id
WHERE a.quantity_returned > 0;
-- Ancienne réception incomplète (aucune au 29 oct. 2026, gardé par sécurité) : manque réglé « autre », écart signalé
INSERT INTO public.stock_transfer_settlements (transfer_id, item_id, allocation_id, kind, reason, note, quantity, action_key, settled_by, settled_at)
SELECT a.transfer_id, a.item_id, a.id, 'lost', 'other', 'Écart enregistré avant la migration 188', a.quantity_lost, gen_random_uuid(), t.received_by, coalesce(t.received_at, t.created_at)
FROM public.stock_transfer_allocations a JOIN public.stock_transfers t ON t.id = a.transfer_id
WHERE a.quantity_lost > 0;
UPDATE public.stock_transfers t SET has_discrepancy = true
WHERE EXISTS (SELECT 1 FROM public.stock_transfer_allocations a WHERE a.transfer_id = t.id AND a.quantity_lost > 0);

-- Mouvements existants rattachés à leur transfert quand le rattachement est certain (référence + boutique, un seul candidat)
UPDATE public.stock_movements m SET transfer_id = x.id
FROM (
  SELECT m2.id AS movement_id, min(t.id::text)::uuid AS id, count(*) AS n
  FROM public.stock_movements m2
  JOIN public.stock_transfers t
    ON m2.reason LIKE '%' || t.reference || '%'
   AND ((m2.reason LIKE 'Transfert % vers %' AND m2.shop_id = t.source_shop_id)
     OR (m2.reason LIKE 'Annulation transfert %' AND m2.shop_id = t.source_shop_id)
     OR (m2.reason LIKE 'Transfert % depuis %' AND m2.shop_id = t.destination_shop_id))
  GROUP BY m2.id
) x
WHERE m.id = x.movement_id AND x.n = 1;

-- ── 9. Fonctions internes ───────────────────────────────────────────────────────────────────────────────────────
CREATE FUNCTION public._transfer_check_shops(p_source uuid, p_dest uuid)
RETURNS void LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $f$
BEGIN
  IF p_source IS NULL OR p_dest IS NULL OR p_source = p_dest THEN
    RAISE EXCEPTION 'transfer_same_shop' USING ERRCODE = 'P0060';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM shops s JOIN shops d ON d.entity_id = s.entity_id WHERE s.id = p_source AND d.id = p_dest) THEN
    RAISE EXCEPTION 'transfer_other_company' USING ERRCODE = 'P0061';
  END IF;
END;
$f$;

CREATE FUNCTION public._transfer_replace_items(p_transfer_id uuid, p_source uuid, p_items jsonb)
RETURNS int LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $f$
DECLARE
  v_row   record;
  v_count int := 0;
BEGIN
  DELETE FROM stock_transfer_items WHERE stock_transfer_id = p_transfer_id;
  FOR v_row IN
    SELECT (e->>'product_id')::uuid AS product_id, sum((e->>'quantity')::int)::int AS quantity
      FROM jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) e
     WHERE nullif(e->>'product_id', '') IS NOT NULL AND nullif(e->>'quantity', '') IS NOT NULL
     GROUP BY 1 HAVING sum((e->>'quantity')::int) > 0
  LOOP
    INSERT INTO stock_transfer_items (stock_transfer_id, source_product_id, product_name, unit, quantity_sent)
      SELECT p_transfer_id, p.id, p.name, p.unit, v_row.quantity FROM products p WHERE p.id = v_row.product_id AND p.shop_id = p_source;
    IF NOT FOUND THEN RAISE EXCEPTION 'product_not_found' USING ERRCODE = 'P0066'; END IF;
    v_count := v_count + 1;
  END LOOP;
  RETURN v_count;
END;
$f$;

-- Régler le reliquat EN TRANSIT d'une ligne : rendu à la source (annulé, jamais parti) ou perdu.
-- Ordre : les allocations qui périment le plus TARD d'abord (ce sont celles qui restent après une réception
-- partielle, puisque les unités reçues vont aux plus proches de leur péremption).
CREATE FUNCTION public._transfer_settle_item(p_item_id uuid, p_reason text, p_note text, p_user uuid, p_action_key uuid)
RETURNS int LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $f$
DECLARE
  v_it     record;
  v_a      record;
  v_kind   text;
  v_qty    int;
  v_total  int := 0;
  v_batch  uuid;
  v_prev   int;
  v_mv     uuid;
  v_label  text;
BEGIN
  IF p_reason IS NULL OR p_reason NOT IN ('cancelled', 'not_sent', 'transport_loss', 'breakage', 'theft', 'other') THEN
    RAISE EXCEPTION 'settlement_reason_required' USING ERRCODE = 'P0071';
  END IF;
  IF p_reason = 'other' AND coalesce(btrim(p_note), '') = '' THEN
    RAISE EXCEPTION 'settlement_note_required' USING ERRCODE = 'P0072';
  END IF;
  v_kind := CASE WHEN p_reason IN ('cancelled', 'not_sent') THEN 'returned' ELSE 'lost' END;

  SELECT i.*, t.reference AS ref, t.source_shop_id AS src INTO v_it
    FROM stock_transfer_items i JOIN stock_transfers t ON t.id = i.stock_transfer_id WHERE i.id = p_item_id;

  -- Rendu à la source : le produit source doit encore exister (sinon : régler en « perdu » / « autre »)
  IF v_kind = 'returned' AND (v_it.source_product_id IS NULL OR NOT EXISTS (SELECT 1 FROM products WHERE id = v_it.source_product_id AND shop_id = v_it.src)) THEN
    IF EXISTS (SELECT 1 FROM stock_transfer_allocations WHERE item_id = p_item_id AND quantity_in_transit > 0) THEN
      RAISE EXCEPTION 'source_product_missing' USING ERRCODE = 'P0077';
    END IF;
  END IF;

  FOR v_a IN
    SELECT * FROM stock_transfer_allocations
     WHERE item_id = p_item_id AND quantity_in_transit > 0
     ORDER BY (coverage = 'batch') ASC, source_expiry_date DESC NULLS FIRST, source_received_at DESC NULLS FIRST, id DESC
     FOR UPDATE
  LOOP
    v_qty := v_a.quantity_in_transit;
    v_batch := NULL; v_mv := NULL;

    IF v_kind = 'returned' THEN
      -- Rendu aux lots source EXACTS ; lot disparu entre-temps : recréé (même péremption, même coût s'il est connu)
      IF v_a.coverage = 'batch' THEN
        UPDATE product_batches SET quantity = quantity + v_qty, updated_at = now() WHERE id = v_a.source_batch_id
          RETURNING id INTO v_batch;
        IF v_batch IS NULL THEN
          INSERT INTO product_batches (shop_id, product_id, quantity, initial_quantity, buying_price, expiry_date, source, received_at, origin_transfer_id)
            VALUES (v_it.src, v_it.source_product_id, v_qty, v_qty, v_a.unit_cost, v_a.source_expiry_date, 'adjustment',
                    coalesce(v_a.source_received_at, now()), v_it.stock_transfer_id)
            RETURNING id INTO v_batch;
        END IF;
      END IF;
      UPDATE stock_transfer_allocations SET quantity_returned = quantity_returned + v_qty WHERE id = v_a.id;
    ELSE
      -- Perdu : sort du reliquat, n'entre nulle part ; mouvement explicite à la SOURCE, aucun stock modifié
      UPDATE stock_transfer_allocations SET quantity_lost = quantity_lost + v_qty WHERE id = v_a.id;
      v_label := CASE p_reason WHEN 'transport_loss' THEN 'perte' WHEN 'breakage' THEN 'casse' WHEN 'theft' THEN 'vol' ELSE 'autre écart' END;
      INSERT INTO stock_movements (shop_id, product_id, type, quantity, previous_qty, new_qty, reason, notes, performed_by, transfer_id, batch_id)
        VALUES (v_it.src, v_it.source_product_id, 'transit_loss', v_qty, NULL, NULL,
                'Transfert ' || v_it.ref || ' : ' || v_label || ' pendant le transport', nullif(btrim(p_note), ''), p_user,
                v_it.stock_transfer_id, CASE WHEN EXISTS (SELECT 1 FROM product_batches WHERE id = v_a.source_batch_id) THEN v_a.source_batch_id END)
        RETURNING id INTO v_mv;
    END IF;

    INSERT INTO stock_transfer_settlements (transfer_id, item_id, allocation_id, kind, reason, note, quantity, action_key, settled_by, restored_batch_id, movement_id)
      VALUES (v_it.stock_transfer_id, p_item_id, v_a.id, v_kind, p_reason, nullif(btrim(p_note), ''), v_qty, p_action_key, p_user, v_batch, v_mv);
    v_total := v_total + v_qty;
  END LOOP;

  -- Retour : le stock du produit source remonte d'autant (un mouvement par ligne)
  IF v_kind = 'returned' AND v_total > 0 THEN
    SELECT quantity INTO v_prev FROM products WHERE id = v_it.source_product_id AND shop_id = v_it.src;
    UPDATE products SET quantity = v_prev + v_total, updated_at = now() WHERE id = v_it.source_product_id;
    INSERT INTO stock_movements (shop_id, product_id, type, quantity, previous_qty, new_qty, reason, performed_by, transfer_id)
      VALUES (v_it.src, v_it.source_product_id, 'in', v_total, v_prev, v_prev + v_total,
              'Annulation transfert ' || v_it.ref || CASE WHEN p_reason = 'not_sent' THEN ' (quantité non envoyée)' ELSE '' END,
              p_user, v_it.stock_transfer_id)
      RETURNING id INTO v_mv;
    UPDATE stock_transfer_settlements SET movement_id = v_mv WHERE action_key = p_action_key AND item_id = p_item_id AND kind = 'returned';
  END IF;

  IF v_total > 0 AND p_reason <> 'cancelled' THEN
    UPDATE stock_transfers SET has_discrepancy = true, updated_at = now() WHERE id = v_it.stock_transfer_id;
  END IF;
  RETURN v_total;
END;
$f$;

-- Statut d'après les allocations (source de vérité)
CREATE FUNCTION public._transfer_refresh_status(p_transfer_id uuid, p_user uuid)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $f$
DECLARE
  v_sent     int;
  v_transit  int;
  v_received int;
  v_returned int;
  v_status   text;
BEGIN
  SELECT sum(quantity_sent), sum(quantity_in_transit), sum(quantity_received), sum(quantity_returned)
    INTO v_sent, v_transit, v_received, v_returned FROM stock_transfer_allocations WHERE transfer_id = p_transfer_id;
  -- « Annulé » seulement si TOUT est revenu à la source ; terminé avec des pertes = « reçu » + écart
  v_status := CASE
    WHEN v_transit = v_sent THEN 'sent'
    WHEN v_transit > 0 THEN 'partially_received'
    WHEN v_returned = v_sent THEN 'cancelled'
    ELSE 'received' END;
  UPDATE stock_transfers
     SET status = v_status,
         received_at  = CASE WHEN v_status = 'received' AND received_at IS NULL THEN now() ELSE received_at END,
         received_by  = CASE WHEN v_status = 'received' AND received_by IS NULL THEN p_user ELSE received_by END,
         cancelled_at = CASE WHEN v_status = 'cancelled' THEN now() ELSE cancelled_at END,
         cancelled_by = CASE WHEN v_status = 'cancelled' THEN p_user ELSE cancelled_by END,
         has_discrepancy = has_discrepancy OR EXISTS (SELECT 1 FROM stock_transfer_items WHERE stock_transfer_id = p_transfer_id AND quantity_surplus > 0),
         updated_at = now()
   WHERE id = p_transfer_id;
  RETURN v_status;
END;
$f$;

-- ── 10. Fonctions appelées par les routes (droits vérifiés par les routes, boutique par boutique) ────────────────

CREATE FUNCTION public.create_stock_transfer(p_source uuid, p_dest uuid, p_user uuid, p_notes text, p_items jsonb, p_send boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $f$
DECLARE
  v_id   uuid;
  v_year text := to_char(now(), 'YYYY');
  v_seq  int;
  v_ref  text;
BEGIN
  PERFORM _transfer_check_shops(p_source, p_dest);
  PERFORM pg_advisory_xact_lock(hashtextextended('transfer-ref:' || p_source::text, 0));
  SELECT coalesce(max(nullif(regexp_replace(split_part(reference, '-', 3), '\D', '', 'g'), '')::int), 0) + 1 INTO v_seq
    FROM stock_transfers WHERE source_shop_id = p_source AND reference LIKE 'TR-' || v_year || '-%';
  v_ref := 'TR-' || v_year || '-' || lpad(v_seq::text, 4, '0');
  INSERT INTO stock_transfers (reference, source_shop_id, destination_shop_id, status, notes, created_by)
    VALUES (v_ref, p_source, p_dest, 'draft', nullif(btrim(p_notes), ''), p_user)
    RETURNING id INTO v_id;
  IF _transfer_replace_items(v_id, p_source, p_items) = 0 THEN RAISE EXCEPTION 'transfer_empty' USING ERRCODE = 'P0062'; END IF;
  IF p_send THEN RETURN send_stock_transfer_draft(v_id, p_source, p_user); END IF;
  RETURN jsonb_build_object('id', v_id, 'reference', v_ref, 'status', 'draft');
END;
$f$;

CREATE FUNCTION public.update_stock_transfer_draft(p_transfer_id uuid, p_source uuid, p_dest uuid, p_user uuid, p_notes text, p_items jsonb, p_expected_updated_at timestamptz)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $f$
DECLARE
  v_status  text;
  v_src     uuid;
  v_updated timestamptz;
BEGIN
  SELECT status, source_shop_id, updated_at INTO v_status, v_src, v_updated FROM stock_transfers WHERE id = p_transfer_id FOR UPDATE;
  IF NOT FOUND OR v_src <> p_source THEN RAISE EXCEPTION 'transfer_not_found' USING ERRCODE = 'P0063'; END IF;
  IF v_status <> 'draft' THEN RAISE EXCEPTION 'transfer_not_draft' USING ERRCODE = 'P0064'; END IF;
  IF p_expected_updated_at IS NOT NULL AND v_updated <> p_expected_updated_at THEN RAISE EXCEPTION 'transfer_changed' USING ERRCODE = 'P0065'; END IF;
  PERFORM _transfer_check_shops(p_source, p_dest);
  UPDATE stock_transfers SET destination_shop_id = p_dest, notes = nullif(btrim(p_notes), ''), updated_at = now() WHERE id = p_transfer_id;
  IF _transfer_replace_items(p_transfer_id, p_source, p_items) = 0 THEN RAISE EXCEPTION 'transfer_empty' USING ERRCODE = 'P0062'; END IF;
  RETURN jsonb_build_object('id', p_transfer_id, 'status', 'draft');
END;
$f$;

-- Envoyer : stock ET lots source décomptés (FEFO de la caisse), allocations enregistrées ; jamais deux fois
CREATE FUNCTION public.send_stock_transfer_draft(p_transfer_id uuid, p_source uuid, p_user uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $f$
DECLARE
  v_status    text;
  v_src       uuid;
  v_dest      uuid;
  v_ref       text;
  v_dest_name text;
  v_asof      date;
  v_it        record;
  v_p         record;
  v_s         record;
  v_left      int;
  v_b         record;
  v_take      int;
BEGIN
  SELECT status, source_shop_id, destination_shop_id, reference INTO v_status, v_src, v_dest, v_ref
    FROM stock_transfers WHERE id = p_transfer_id FOR UPDATE;
  IF NOT FOUND OR v_src <> p_source THEN RAISE EXCEPTION 'transfer_not_found' USING ERRCODE = 'P0063'; END IF;
  IF v_status IN ('sent', 'partially_received', 'received') THEN
    RETURN jsonb_build_object('id', p_transfer_id, 'reference', v_ref, 'status', v_status, 'already_sent', true);
  END IF;
  IF v_status <> 'draft' THEN RAISE EXCEPTION 'transfer_not_draft' USING ERRCODE = 'P0064'; END IF;
  PERFORM _transfer_check_shops(v_src, v_dest);
  SELECT name INTO v_dest_name FROM shops WHERE id = v_dest;
  v_asof := shop_business_date(v_src);          -- date métier de la boutique source (178)

  -- Produits verrouillés dans un ordre fixe (comme une vente : produit puis ses lots)
  PERFORM 1 FROM products
    WHERE id IN (SELECT source_product_id FROM stock_transfer_items WHERE stock_transfer_id = p_transfer_id)
    ORDER BY id FOR UPDATE;

  FOR v_it IN SELECT * FROM stock_transfer_items WHERE stock_transfer_id = p_transfer_id ORDER BY source_product_id LOOP
    SELECT id, quantity, buying_price, selling_price, name, unit INTO v_p
      FROM products WHERE id = v_it.source_product_id AND shop_id = v_src;
    IF NOT FOUND THEN RAISE EXCEPTION 'product_not_found' USING ERRCODE = 'P0066'; END IF;
    -- Transférable = vendable, MÊME règle que la caisse (lots périmés exclus, stock sans lot compris)
    SELECT * INTO v_s FROM sellable_stock(v_it.source_product_id, v_asof);
    IF v_s.sellable < v_it.quantity_sent THEN
      RAISE EXCEPTION 'insufficient_transferable_stock' USING ERRCODE = 'P0067', DETAIL = jsonb_build_object(
        'product', v_p.name, 'transferable', v_s.sellable, 'expired', v_s.expired, 'requested', v_it.quantity_sent)::text;
    END IF;

    UPDATE products SET quantity = v_p.quantity - v_it.quantity_sent, updated_at = now() WHERE id = v_it.source_product_id;
    INSERT INTO stock_movements (shop_id, product_id, type, quantity, previous_qty, new_qty, reason, performed_by, transfer_id)
      VALUES (v_src, v_it.source_product_id, 'out', v_it.quantity_sent, v_p.quantity, v_p.quantity - v_it.quantity_sent,
              'Transfert ' || v_ref || ' vers ' || v_dest_name, p_user, p_transfer_id);

    -- Lots : même choix que allocate_sale_batches (péremption croissante, sans date en dernier, puis réception ;
    -- lots périmés à la date métier EXCLUS)
    v_left := v_it.quantity_sent;
    FOR v_b IN SELECT id, quantity, expiry_date, buying_price, received_at FROM product_batches
                WHERE product_id = v_it.source_product_id AND quantity > 0
                  AND NOT coalesce(expiry_date < v_asof, false)
                ORDER BY expiry_date ASC NULLS LAST, received_at ASC
                FOR UPDATE LOOP
      EXIT WHEN v_left <= 0;
      v_take := least(v_b.quantity, v_left);
      UPDATE product_batches SET quantity = quantity - v_take, updated_at = now() WHERE id = v_b.id;
      INSERT INTO stock_transfer_allocations (transfer_id, item_id, coverage, source_batch_id, source_expiry_date, source_received_at, unit_cost, quantity_sent)
        VALUES (p_transfer_id, v_it.id, 'batch', v_b.id, v_b.expiry_date, v_b.received_at, CASE WHEN v_b.buying_price > 0 THEN v_b.buying_price END, v_take);
      v_left := v_left - v_take;
    END LOOP;
    -- Stock non couvert par un lot : il part tel quel, sans lot inventé ; coût = coût moyen actuel du produit
    -- (c'est la valeur tenue pour ce stock sans lot), inconnu s'il vaut 0
    IF v_left > 0 THEN
      INSERT INTO stock_transfer_allocations (transfer_id, item_id, coverage, unit_cost, quantity_sent)
        VALUES (p_transfer_id, v_it.id, 'uncovered', CASE WHEN v_p.buying_price > 0 THEN v_p.buying_price END, v_left);
    END IF;

    UPDATE stock_transfer_items SET product_name = v_p.name, unit = v_p.unit, buying_price = v_p.buying_price, selling_price = v_p.selling_price
     WHERE id = v_it.id;
  END LOOP;

  UPDATE stock_transfers SET status = 'sent', sent_at = now(), sent_by = p_user, updated_at = now() WHERE id = p_transfer_id;
  RETURN jsonb_build_object('id', p_transfer_id, 'reference', v_ref, 'status', 'sent', 'already_sent', false);
END;
$f$;

-- Réceptionner (tout ou partie, en plusieurs fois). p_lines : [{ item_id, quantity_received, destination_product_id? }]
-- La destination déclare ce qu'elle a REÇU ; le reste reste en transit (réglé par la source) ; le surplus entre en stock.
CREATE FUNCTION public.receive_stock_transfer_lines(p_transfer_id uuid, p_dest uuid, p_user uuid, p_receipt_key uuid, p_lines jsonb, p_note text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $f$
DECLARE
  v_status    text;
  v_src       uuid;
  v_destshop  uuid;
  v_ref       text;
  v_src_name  text;
  v_same_cur  boolean;
  v_ids       uuid[];
  v_receipt   uuid;
  v_existing  uuid;
  v_line      jsonb;
  v_it        record;
  v_transit   int;
  v_q         int;
  v_acc       int;
  v_surplus   int;
  v_dest_pid  uuid;
  v_prev      int;
  v_mv        uuid;
  v_left      int;
  v_a         record;
  v_take      int;
  v_batch     uuid;
  v_created   jsonb := '[]'::jsonb;
BEGIN
  SELECT status, source_shop_id, destination_shop_id, reference INTO v_status, v_src, v_destshop, v_ref
    FROM stock_transfers WHERE id = p_transfer_id FOR UPDATE;
  IF NOT FOUND OR v_destshop <> p_dest THEN RAISE EXCEPTION 'transfer_not_found' USING ERRCODE = 'P0063'; END IF;
  SELECT transfer_id INTO v_existing FROM stock_transfer_receipts WHERE receipt_key = p_receipt_key;
  IF FOUND THEN
    IF v_existing <> p_transfer_id THEN RAISE EXCEPTION 'receipt_key_conflict' USING ERRCODE = 'P0069'; END IF;
    RETURN jsonb_build_object('id', p_transfer_id, 'reference', v_ref, 'status', v_status, 'replayed', true);
  END IF;
  IF v_status NOT IN ('sent', 'partially_received') THEN RAISE EXCEPTION 'transfer_not_in_transit' USING ERRCODE = 'P0068'; END IF;
  SELECT name INTO v_src_name FROM shops WHERE id = v_src;
  SELECT s.currency IS NOT DISTINCT FROM d.currency INTO v_same_cur FROM shops s, shops d WHERE s.id = v_src AND d.id = p_dest;

  -- Produits destination touchés verrouillés dans un ordre fixe
  SELECT array_agg(x) INTO v_ids FROM (
    SELECT nullif(l->>'destination_product_id', '')::uuid AS x FROM jsonb_array_elements(coalesce(p_lines, '[]'::jsonb)) l
    UNION SELECT destination_product_id FROM stock_transfer_items WHERE stock_transfer_id = p_transfer_id
  ) s WHERE x IS NOT NULL;
  PERFORM 1 FROM products WHERE id = ANY(v_ids) ORDER BY id FOR UPDATE;

  INSERT INTO stock_transfer_receipts (transfer_id, receipt_key, received_by, note)
    VALUES (p_transfer_id, p_receipt_key, p_user, nullif(btrim(p_note), ''))
    RETURNING id INTO v_receipt;

  FOR v_line IN SELECT * FROM jsonb_array_elements(coalesce(p_lines, '[]'::jsonb)) LOOP
    SELECT * INTO v_it FROM stock_transfer_items
      WHERE id = nullif(v_line->>'item_id', '')::uuid AND stock_transfer_id = p_transfer_id FOR UPDATE;
    CONTINUE WHEN NOT FOUND;

    v_q := coalesce(nullif(v_line->>'quantity_received', '')::int, 0);
    IF v_q < 0 THEN RAISE EXCEPTION 'invalid_quantity' USING ERRCODE = 'P0076'; END IF;
    CONTINUE WHEN v_q = 0;
    SELECT coalesce(sum(quantity_in_transit), 0) INTO v_transit FROM stock_transfer_allocations WHERE item_id = v_it.id;
    v_acc := least(v_q, v_transit);
    v_surplus := v_q - v_acc;
    v_dest_pid := coalesce(nullif(v_line->>'destination_product_id', '')::uuid, v_it.destination_product_id);

    IF v_dest_pid IS NOT NULL THEN
      SELECT quantity INTO v_prev FROM products WHERE id = v_dest_pid AND shop_id = p_dest;
      IF NOT FOUND THEN RAISE EXCEPTION 'destination_product_not_found' USING ERRCODE = 'P0070'; END IF;
    ELSE
      -- Nouveau produit à l'arrivée. Même devise : prix et coût de la source. Devises différentes : désactivé,
      -- prix et coût à 0 (inconnus ; la colonne ne peut pas être vide) — le propriétaire fixe le prix puis l'active.
      INSERT INTO products (shop_id, name, unit, buying_price, selling_price, quantity, is_active)
        VALUES (p_dest, v_it.product_name, v_it.unit,
                CASE WHEN v_same_cur THEN greatest(coalesce(v_it.buying_price, 0), 0) ELSE 0 END,
                CASE WHEN v_same_cur THEN greatest(coalesce(v_it.selling_price, 0), 0) ELSE 0 END,
                0, v_same_cur)
        RETURNING id, quantity INTO v_dest_pid, v_prev;
      v_created := v_created || jsonb_build_object('product_id', v_dest_pid, 'name', v_it.product_name, 'needs_price', NOT v_same_cur);
    END IF;

    -- Entrée en stock : reçu au titre de l'envoi + surplus (décision 3), un seul mouvement
    UPDATE products SET quantity = v_prev + v_acc + v_surplus, updated_at = now() WHERE id = v_dest_pid;
    INSERT INTO stock_movements (shop_id, product_id, type, quantity, previous_qty, new_qty, reason, performed_by, transfer_id)
      VALUES (p_dest, v_dest_pid, 'in', v_acc + v_surplus, v_prev, v_prev + v_acc + v_surplus,
              'Transfert ' || v_ref || ' depuis ' || v_src_name, p_user, p_transfer_id)
      RETURNING id INTO v_mv;

    -- Répartition : les allocations qui périment le plus tôt d'abord (déterministe)
    v_left := v_acc;
    FOR v_a IN SELECT * FROM stock_transfer_allocations
                WHERE item_id = v_it.id AND quantity_in_transit > 0
                ORDER BY (coverage = 'batch') DESC, source_expiry_date ASC NULLS LAST, source_received_at ASC NULLS LAST, id
                FOR UPDATE LOOP
      EXIT WHEN v_left <= 0;
      v_take := least(v_a.quantity_in_transit, v_left);
      -- Un lot destination par lot source reçu (même péremption, coût du lot source si même devise, liens d'origine) ;
      -- « sans lot connu » et « ancien modèle » : lot technique « origine non tracée », sans date (jamais inventée)
      INSERT INTO product_batches (shop_id, product_id, quantity, initial_quantity, buying_price, expiry_date, source, received_at,
                                   origin_transfer_id, origin_batch_id, origin_untracked)
        VALUES (p_dest, v_dest_pid, v_take, v_take,
                CASE WHEN v_same_cur THEN v_a.unit_cost END,
                CASE WHEN v_a.coverage = 'batch' THEN v_a.source_expiry_date END, 'transfer', now(),
                p_transfer_id,
                CASE WHEN v_a.coverage = 'batch' AND EXISTS (SELECT 1 FROM product_batches WHERE id = v_a.source_batch_id) THEN v_a.source_batch_id END,
                v_a.coverage <> 'batch')
        RETURNING id INTO v_batch;
      UPDATE stock_transfer_allocations SET quantity_received = quantity_received + v_take WHERE id = v_a.id;
      INSERT INTO stock_transfer_receipt_lines (receipt_id, item_id, allocation_id, kind, quantity, assignment, destination_product_id, destination_batch_id, movement_id)
        VALUES (v_receipt, v_it.id, v_a.id, 'received', v_take, 'auto', v_dest_pid, v_batch, v_mv);
      v_left := v_left - v_take;
    END LOOP;

    -- Surplus : entre en stock dans un lot « origine non tracée » (sans date, coût inconnu), écart signalé
    IF v_surplus > 0 THEN
      INSERT INTO product_batches (shop_id, product_id, quantity, initial_quantity, buying_price, expiry_date, source, received_at,
                                   origin_transfer_id, origin_untracked)
        VALUES (p_dest, v_dest_pid, v_surplus, v_surplus, NULL, NULL, 'transfer', now(), p_transfer_id, true)
        RETURNING id INTO v_batch;
      INSERT INTO stock_transfer_receipt_lines (receipt_id, item_id, kind, quantity, destination_product_id, destination_batch_id, movement_id)
        VALUES (v_receipt, v_it.id, 'surplus', v_surplus, v_dest_pid, v_batch, v_mv);
      UPDATE stock_transfers SET has_discrepancy = true WHERE id = p_transfer_id;
    END IF;

    UPDATE stock_transfer_items
       SET quantity_received = coalesce(quantity_received, 0) + v_acc,
           quantity_surplus = quantity_surplus + v_surplus,
           destination_product_id = v_dest_pid
     WHERE id = v_it.id;
  END LOOP;

  PERFORM _transfer_refresh_status(p_transfer_id, p_user);
  RETURN (SELECT jsonb_build_object('id', t.id, 'reference', t.reference, 'status', t.status, 'has_discrepancy', t.has_discrepancy, 'replayed', false,
                                    'in_transit', (SELECT coalesce(sum(quantity_in_transit), 0) FROM stock_transfer_allocations WHERE transfer_id = t.id),
                                    'created_products', v_created)
            FROM stock_transfers t WHERE t.id = p_transfer_id);
END;
$f$;

-- Régler un reliquat en transit — par la SOURCE (décision 4) : « jamais parti » (rendu aux lots exacts) ou perdu
CREATE FUNCTION public.settle_stock_transfer_item(p_transfer_id uuid, p_source uuid, p_user uuid, p_item_id uuid, p_reason text, p_note text, p_action_key uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $f$
DECLARE
  v_status  text;
  v_src     uuid;
  v_src_pid uuid;
  v_done    uuid;
BEGIN
  SELECT status, source_shop_id INTO v_status, v_src FROM stock_transfers WHERE id = p_transfer_id FOR UPDATE;
  IF NOT FOUND OR v_src <> p_source THEN RAISE EXCEPTION 'transfer_not_found' USING ERRCODE = 'P0063'; END IF;
  SELECT transfer_id INTO v_done FROM stock_transfer_settlements WHERE action_key = p_action_key LIMIT 1;
  IF FOUND THEN
    IF v_done <> p_transfer_id THEN RAISE EXCEPTION 'receipt_key_conflict' USING ERRCODE = 'P0069'; END IF;
    RETURN jsonb_build_object('id', p_transfer_id, 'status', v_status, 'replayed', true);
  END IF;
  IF v_status NOT IN ('sent', 'partially_received') THEN RAISE EXCEPTION 'transfer_not_in_transit' USING ERRCODE = 'P0068'; END IF;
  IF p_reason IS NULL OR p_reason = 'cancelled' THEN RAISE EXCEPTION 'settlement_reason_required' USING ERRCODE = 'P0071'; END IF;
  SELECT source_product_id INTO v_src_pid FROM stock_transfer_items WHERE id = p_item_id AND stock_transfer_id = p_transfer_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'item_not_found' USING ERRCODE = 'P0075'; END IF;
  IF v_src_pid IS NOT NULL THEN PERFORM 1 FROM products WHERE id = v_src_pid FOR UPDATE; END IF;
  IF _transfer_settle_item(p_item_id, p_reason, p_note, p_user, p_action_key) = 0 THEN
    RAISE EXCEPTION 'nothing_in_transit' USING ERRCODE = 'P0073';
  END IF;
  RETURN jsonb_build_object('id', p_transfer_id, 'status', _transfer_refresh_status(p_transfer_id, p_user), 'replayed', false);
END;
$f$;

-- Annuler : brouillon (aucun stock) ; envoyé et RIEN encore reçu ni réglé (tout revient aux lots source exacts).
-- Après une réception partielle : refusé (on ne réécrit pas l'histoire), seul le reliquat se règle.
CREATE OR REPLACE FUNCTION public.cancel_stock_transfer(p_transfer_id uuid, p_source_shop_id uuid, p_performed_by uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $f$
DECLARE
  v_status text;
  v_src    uuid;
  v_key    uuid := gen_random_uuid();
  v_it     record;
BEGIN
  SELECT status, source_shop_id INTO v_status, v_src FROM stock_transfers WHERE id = p_transfer_id FOR UPDATE;
  IF NOT FOUND OR v_src IS DISTINCT FROM p_source_shop_id THEN RAISE EXCEPTION 'transfer_not_found' USING ERRCODE = 'P0063'; END IF;
  IF v_status = 'cancelled' THEN RETURN; END IF;                       -- déjà annulé : rien de plus
  IF v_status = 'draft' THEN
    UPDATE stock_transfers SET status = 'cancelled', cancelled_at = now(), cancelled_by = p_performed_by, updated_at = now() WHERE id = p_transfer_id;
    RETURN;
  END IF;
  IF v_status <> 'sent' OR EXISTS (SELECT 1 FROM stock_transfer_allocations
                                    WHERE transfer_id = p_transfer_id AND quantity_in_transit <> quantity_sent) THEN
    RAISE EXCEPTION 'transfer_not_cancellable' USING ERRCODE = 'P0074';
  END IF;
  PERFORM 1 FROM products WHERE id IN (SELECT source_product_id FROM stock_transfer_items WHERE stock_transfer_id = p_transfer_id)
    ORDER BY id FOR UPDATE;
  FOR v_it IN SELECT id FROM stock_transfer_items WHERE stock_transfer_id = p_transfer_id ORDER BY source_product_id LOOP
    PERFORM _transfer_settle_item(v_it.id, 'cancelled', NULL, p_performed_by, v_key);
  END LOOP;
  UPDATE stock_transfers SET status = 'cancelled', cancelled_at = now(), cancelled_by = p_performed_by, updated_at = now() WHERE id = p_transfer_id;
END;
$f$;

-- ── 11. Anciennes fonctions : même nom, même appel, nouvelles règles (versions de l'application d'avant) ─────────
CREATE OR REPLACE FUNCTION public.send_stock_transfer(p_source_shop_id uuid, p_destination_shop_id uuid, p_performed_by uuid, p_notes text, p_items jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $f$
BEGIN
  RETURN create_stock_transfer(p_source_shop_id, p_destination_shop_id, p_performed_by, p_notes, p_items, true);
END;
$f$;

CREATE OR REPLACE FUNCTION public.receive_stock_transfer(p_transfer_id uuid, p_destination_shop_id uuid, p_performed_by uuid, p_items jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $f$
DECLARE
  v_lines jsonb;
BEGIN
  -- Ancien écran : une réception ; le manque reste en transit (réglé par la source), le surplus entre en stock
  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'item_id', e->>'transfer_item_id',
           'quantity_received', greatest(coalesce(nullif(e->>'quantity_received', '')::int, 0), 0),
           'destination_product_id', e->>'destination_product_id')), '[]'::jsonb)
    INTO v_lines FROM jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) e;
  RETURN receive_stock_transfer_lines(p_transfer_id, p_destination_shop_id, p_performed_by, gen_random_uuid(), v_lines, NULL);
END;
$f$;

-- ── 12. Exécution : serveur seulement ────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE f text;
BEGIN
  FOREACH f IN ARRAY ARRAY[
    'public._transfer_check_shops(uuid, uuid)',
    'public._transfer_replace_items(uuid, uuid, jsonb)',
    'public._transfer_settle_item(uuid, text, text, uuid, uuid)',
    'public._transfer_refresh_status(uuid, uuid)',
    'public.create_stock_transfer(uuid, uuid, uuid, text, jsonb, boolean)',
    'public.update_stock_transfer_draft(uuid, uuid, uuid, uuid, text, jsonb, timestamptz)',
    'public.send_stock_transfer_draft(uuid, uuid, uuid)',
    'public.receive_stock_transfer_lines(uuid, uuid, uuid, uuid, jsonb, text)',
    'public.settle_stock_transfer_item(uuid, uuid, uuid, uuid, text, text, uuid)',
    'public.cancel_stock_transfer(uuid, uuid, uuid)',
    'public.send_stock_transfer(uuid, uuid, uuid, text, jsonb)',
    'public.receive_stock_transfer(uuid, uuid, uuid, jsonb)'
  ] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', f);
  END LOOP;
END $$;

-- ── 13. Contrôle : droits effectifs (arrêt si le navigateur peut exécuter ou lire ce qui est réservé au serveur) ──
DO $$
DECLARE v_bad text;
BEGIN
  SELECT string_agg(p.oid::regprocedure::text || ' par ' || r.rolname, ', ') INTO v_bad
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace CROSS JOIN (VALUES ('anon'), ('authenticated')) r(rolname)
   WHERE n.nspname = 'public'
     AND p.proname IN ('_transfer_check_shops', '_transfer_replace_items', '_transfer_settle_item', '_transfer_refresh_status',
                       'create_stock_transfer', 'update_stock_transfer_draft', 'send_stock_transfer_draft', 'receive_stock_transfer_lines',
                       'settle_stock_transfer_item', 'cancel_stock_transfer', 'send_stock_transfer', 'receive_stock_transfer')
     AND has_function_privilege(r.rolname, p.oid, 'EXECUTE');
  IF v_bad IS NOT NULL THEN RAISE EXCEPTION '188 : fonctions exécutables par le navigateur : %', v_bad; END IF;
  SELECT string_agg(t || ' par ' || r, ', ') INTO v_bad
    FROM unnest(ARRAY['public.stock_transfer_allocations', 'public.stock_transfer_receipts', 'public.stock_transfer_receipt_lines', 'public.stock_transfer_settlements']) t,
         unnest(ARRAY['anon', 'authenticated']) r
   WHERE has_table_privilege(r, t, 'SELECT') OR has_table_privilege(r, t, 'INSERT') OR has_table_privilege(r, t, 'UPDATE') OR has_table_privilege(r, t, 'DELETE');
  IF v_bad IS NOT NULL THEN RAISE EXCEPTION '188 : tables lisibles ou modifiables par le navigateur : %', v_bad; END IF;
  IF has_column_privilege('authenticated', 'public.product_batches', 'buying_price', 'SELECT') THEN
    RAISE EXCEPTION '188 : buying_price des lots redevenu lisible par le navigateur';
  END IF;
  RAISE NOTICE '188 : transferts lot par lot installés ; fonctions et tables réservées au serveur';
END $$;

NOTIFY pgrst, 'reload schema';

-- ── Vérification après exécution ───────────────────────────────────────────────────────────────────────────────
-- SELECT status, count(*) FROM stock_transfers GROUP BY 1;                                   -- inchangé (2 sent, 3 received, 1 cancelled)
-- SELECT coverage, count(*), sum(quantity_in_transit) FROM stock_transfer_allocations GROUP BY 1;  -- legacy uniquement

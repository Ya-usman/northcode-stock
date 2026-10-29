-- 188 — Transferts entre boutiques V1 : brouillon → en transit → reçu, traçabilité LOT PAR LOT, QR sécurisé,
-- réception unique et définitive avec écarts (décisions et conception validées par l'utilisateur le 29-30 oct. 2026).
--
-- Statuts : draft (brouillon) → sent (affiché « En transit ») → received ; cancelled. Pas de réception partielle.
--
-- ENVOI (une transaction, jamais deux fois) : produits et lots verrouillés ; quantité transférable = stock VENDABLE à
-- la date métier de la boutique source (sellable_stock, 178 : lots périmés exclus) ; lots choisis comme
-- allocate_sale_batches (FEFO) ; chaque ALLOCATION (lot, péremption, coût, quantité) est enregistrée ; stock du
-- produit et lots diminuent ; un jeton de QR est créé. Un brouillon ne touche aucun stock.
-- RÉCEPTION (une transaction, définitive) : toutes les lignes, quantité reçue entre 0 et l'envoyé ; stock d'arrivée
-- augmenté des quantités REÇUES ; un lot d'arrivée par lot source (même péremption, jamais inventée ; coût du lot
-- source si même devise, sinon inconnu ; lien d'origine) ; le manque est un ÉCART enregistré (mouvement « manquant »
-- à la source, aucun stock ne bouge) ; statut reçu, jeton révoqué, journal dans la même transaction. Déjà reçu : même
-- clé de réception → rien n'est refait ; autre clé → « déjà réceptionné » (date, personne).
-- ANNULATION : brouillon ; en transit (tout revient dans les lots EXACTS, mouvements) ; jamais après réception.
-- Produit absent à l'arrivée : créé ; devises différentes → créé DÉSACTIVÉ, prix 0 (le propriétaire fixe le prix).
-- Fournisseur : non recopié (les fournisseurs appartiennent à chaque boutique) ; traçabilité par le lot d'origine.
-- Anciens transferts : allocations « ancien modèle » ; les 2 en route restent réceptionnables (lot « origine non
-- tracée », sans date) et reçoivent un jeton de QR. Rien n'est corrigé dans le passé.
-- stock_movements.batch_id (179) est réutilisée, jamais recréée. Erreurs codées P0060 à P0080.
-- Appliquée par « supabase db push » (transaction de la CLI) : pas de BEGIN / COMMIT dans ce fichier.
-- Retour arrière : supabase/rollbacks/188_transfers_workflow_rollback.sql (tant que le nouveau modèle n'a pas servi).

SET LOCAL lock_timeout = '5s';

-- ── 1. Transferts ───────────────────────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.stock_transfers DROP CONSTRAINT IF EXISTS stock_transfers_status_check;
ALTER TABLE public.stock_transfers ADD CONSTRAINT stock_transfers_status_check
  CHECK (status IN ('draft', 'sent', 'received', 'cancelled'));
ALTER TABLE public.stock_transfers
  ADD COLUMN sent_at          timestamptz,
  ADD COLUMN sent_by          uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN has_discrepancy  boolean NOT NULL DEFAULT false,
  ADD COLUMN receipt_key      uuid,
  ADD COLUMN updated_at       timestamptz NOT NULL DEFAULT now();
-- Les transferts existants ont tous été envoyés au moment de leur création
UPDATE public.stock_transfers SET sent_at = created_at, sent_by = created_by;
CREATE UNIQUE INDEX stock_transfers_source_reference ON public.stock_transfers (source_shop_id, reference);
CREATE INDEX stock_transfers_in_transit_destination ON public.stock_transfers (destination_shop_id) WHERE status = 'sent';

-- ── 2. Allocations : quels lots sont partis, et ce qu'ils sont devenus ──────────────────────────────────────────
CREATE TABLE public.stock_transfer_allocations (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  transfer_id           uuid NOT NULL REFERENCES public.stock_transfers(id) ON DELETE CASCADE,
  item_id               uuid NOT NULL REFERENCES public.stock_transfer_items(id) ON DELETE CASCADE,
  coverage              text NOT NULL CHECK (coverage IN ('batch', 'uncovered', 'legacy')),
                        -- batch : unités sorties d'un lot précis ; uncovered : stock sans lot ;
                        -- legacy : transfert d'avant cette migration (lots non décomptés à l'époque)
  source_batch_id       uuid REFERENCES public.product_batches(id) ON DELETE SET NULL,
  source_expiry_date    date,                -- figés : restent lisibles même si le lot source disparaît
  source_received_at    timestamptz,
  unit_cost             numeric,             -- coût à la SOURCE (sa devise) ; NULL = inconnu ; réservé au serveur
  quantity_sent         int NOT NULL CHECK (quantity_sent > 0),
  quantity_received     int NOT NULL DEFAULT 0 CHECK (quantity_received >= 0),
  quantity_missing      int NOT NULL DEFAULT 0 CHECK (quantity_missing >= 0),
  quantity_returned     int NOT NULL DEFAULT 0 CHECK (quantity_returned >= 0),
  quantity_in_transit   int GENERATED ALWAYS AS (quantity_sent - quantity_received - quantity_missing - quantity_returned) STORED,
  destination_batch_id  uuid REFERENCES public.product_batches(id) ON DELETE SET NULL,
  created_at            timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT stock_transfer_allocations_balance CHECK (quantity_received + quantity_missing + quantity_returned <= quantity_sent),
  CONSTRAINT stock_transfer_allocations_batch_has_lot CHECK (coverage <> 'batch' OR source_received_at IS NOT NULL),
  CONSTRAINT stock_transfer_allocations_cost CHECK (unit_cost IS NULL OR unit_cost > 0)
);
CREATE INDEX stock_transfer_allocations_transfer ON public.stock_transfer_allocations (transfer_id);
CREATE INDEX stock_transfer_allocations_item ON public.stock_transfer_allocations (item_id);
CREATE INDEX stock_transfer_allocations_source_batch ON public.stock_transfer_allocations (source_batch_id) WHERE source_batch_id IS NOT NULL;

-- ── 3. Jeton du QR (créé à l'envoi, révoqué à la réception / annulation) ─────────────────────────────────────────
-- Gardé en clair pour pouvoir réafficher le QR, mais RÉSERVÉ AU SERVEUR (aucune lecture navigateur). Le QR ne porte
-- que l'identifiant du transfert et ce jeton ; les droits sont toujours vérifiés par le serveur.
CREATE TABLE public.stock_transfer_tokens (
  transfer_id  uuid PRIMARY KEY REFERENCES public.stock_transfers(id) ON DELETE CASCADE,
  token        text NOT NULL UNIQUE CHECK (token ~ '^[0-9a-f]{64}$'),
  issued_at    timestamptz NOT NULL DEFAULT now(),
  revoked_at   timestamptz
);

-- ── 4. Liens de traçabilité sur les lots et les mouvements ──────────────────────────────────────────────────────
ALTER TABLE public.product_batches
  ADD COLUMN origin_transfer_id  uuid REFERENCES public.stock_transfers(id) ON DELETE SET NULL,
  ADD COLUMN origin_batch_id     uuid REFERENCES public.product_batches(id) ON DELETE SET NULL,
  ADD COLUMN origin_untracked    boolean NOT NULL DEFAULT false;   -- lot « origine non tracée » (sans date)
CREATE INDEX product_batches_origin_transfer ON public.product_batches (origin_transfer_id) WHERE origin_transfer_id IS NOT NULL;
CREATE INDEX product_batches_origin_batch ON public.product_batches (origin_batch_id) WHERE origin_batch_id IS NOT NULL;
-- Colonnes non sensibles : lisibles comme les autres colonnes autorisées des lots (182 : fermé par défaut, liste explicite)
GRANT SELECT (origin_transfer_id, origin_batch_id, origin_untracked) ON public.product_batches TO authenticated;

-- stock_movements.batch_id : créée par la 179 (NO ACTION, index idx_stock_movements_batch) — réutilisée
ALTER TABLE public.stock_movements ADD COLUMN transfer_id uuid REFERENCES public.stock_transfers(id) ON DELETE SET NULL;
CREATE INDEX stock_movements_transfer ON public.stock_movements (transfer_id) WHERE transfer_id IS NOT NULL;
-- Unités manquantes à la réception : mouvement explicite à la source, AUCUN stock modifié (avant / après vides)
ALTER TABLE public.stock_movements DROP CONSTRAINT IF EXISTS stock_movements_type_check;
ALTER TABLE public.stock_movements ADD CONSTRAINT stock_movements_type_check
  CHECK (type IN ('in', 'out', 'adjustment', 'sale', 'transit_loss'));

-- ── 5. Réservé au serveur ────────────────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.stock_transfer_allocations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stock_transfer_tokens      ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.stock_transfer_allocations FROM anon, authenticated;
REVOKE ALL ON TABLE public.stock_transfer_tokens      FROM anon, authenticated;

-- ── 6. Les transferts existants (rien n'est corrigé, tout reste lisible) ────────────────────────────────────────
INSERT INTO public.stock_transfer_allocations (transfer_id, item_id, coverage, unit_cost, quantity_sent, quantity_received, quantity_missing, quantity_returned)
SELECT t.id, i.id, 'legacy', nullif(greatest(coalesce(i.buying_price, 0), 0), 0), i.quantity_sent,
       CASE WHEN t.status = 'received' THEN least(coalesce(i.quantity_received, 0), i.quantity_sent) ELSE 0 END,
       CASE WHEN t.status = 'received' THEN i.quantity_sent - least(coalesce(i.quantity_received, 0), i.quantity_sent) ELSE 0 END,
       CASE WHEN t.status = 'cancelled' THEN i.quantity_sent ELSE 0 END
FROM public.stock_transfers t JOIN public.stock_transfer_items i ON i.stock_transfer_id = t.id;
UPDATE public.stock_transfers t SET has_discrepancy = true
 WHERE EXISTS (SELECT 1 FROM public.stock_transfer_allocations a WHERE a.transfer_id = t.id AND a.quantity_missing > 0);
-- Les transferts encore en route reçoivent un jeton de QR
INSERT INTO public.stock_transfer_tokens (transfer_id, token)
SELECT id, replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '') FROM public.stock_transfers WHERE status = 'sent';
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

-- ── 7. Fonctions internes ───────────────────────────────────────────────────────────────────────────────────────
CREATE FUNCTION public._transfer_audit(p_shop_id uuid, p_user uuid, p_action text, p_transfer_id uuid, p_meta jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $f$
BEGIN
  -- Journal d'activité dans la MÊME transaction que l'action (comme l'inventaire, 175)
  INSERT INTO audit_logs (shop_id, entity_id, actor_id, actor_email, action, target_id, target_type, metadata)
  VALUES (p_shop_id, (SELECT entity_id FROM shops WHERE id = p_shop_id), p_user,
          (SELECT email FROM auth.users WHERE id = p_user), p_action, p_transfer_id::text, 'stock_transfer',
          coalesce(p_meta, '{}'::jsonb));
END;
$f$;

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

-- ── 8. Fonctions appelées par les routes (droits vérifiés par les routes, boutique par boutique) ────────────────

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
  PERFORM _transfer_audit(p_source, p_user, 'stock_transfer.draft', v_id, jsonb_build_object('reference', v_ref, 'destination_shop_id', p_dest));
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
  RETURN jsonb_build_object('id', p_transfer_id, 'status', 'draft', 'updated_at', (SELECT updated_at FROM stock_transfers WHERE id = p_transfer_id));
END;
$f$;

-- Envoyer : stock ET lots source décomptés (FEFO de la caisse), allocations, jeton de QR ; jamais deux fois
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
  v_units     int := 0;
BEGIN
  SELECT status, source_shop_id, destination_shop_id, reference INTO v_status, v_src, v_dest, v_ref
    FROM stock_transfers WHERE id = p_transfer_id FOR UPDATE;
  IF NOT FOUND OR v_src <> p_source THEN RAISE EXCEPTION 'transfer_not_found' USING ERRCODE = 'P0063'; END IF;
  IF v_status IN ('sent', 'received') THEN
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
    -- Stock non couvert par un lot : il part tel quel, sans lot inventé ; coût = coût moyen actuel du produit (valeur
    -- tenue pour ce stock sans lot), inconnu s'il vaut 0
    IF v_left > 0 THEN
      INSERT INTO stock_transfer_allocations (transfer_id, item_id, coverage, unit_cost, quantity_sent)
        VALUES (p_transfer_id, v_it.id, 'uncovered', CASE WHEN v_p.buying_price > 0 THEN v_p.buying_price END, v_left);
    END IF;

    UPDATE stock_transfer_items SET product_name = v_p.name, unit = v_p.unit, buying_price = v_p.buying_price, selling_price = v_p.selling_price
     WHERE id = v_it.id;
    v_units := v_units + v_it.quantity_sent;
  END LOOP;

  UPDATE stock_transfers SET status = 'sent', sent_at = now(), sent_by = p_user, updated_at = now() WHERE id = p_transfer_id;
  INSERT INTO stock_transfer_tokens (transfer_id, token)
    VALUES (p_transfer_id, replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', ''))
    ON CONFLICT (transfer_id) DO NOTHING;
  PERFORM _transfer_audit(v_src, p_user, 'stock_transfer.send', p_transfer_id,
    jsonb_build_object('reference', v_ref, 'destination_shop_id', v_dest, 'units', v_units));
  RETURN jsonb_build_object('id', p_transfer_id, 'reference', v_ref, 'status', 'sent', 'already_sent', false);
END;
$f$;

-- Réception DÉFINITIVE. p_lines : [{ item_id, quantity_received, destination_product_id?, discrepancy_category?,
-- discrepancy_detail? }] — TOUTES les lignes du transfert ; reçu entre 0 et l'envoyé ; le reste est un écart.
CREATE FUNCTION public.receive_stock_transfer_final(p_transfer_id uuid, p_dest uuid, p_user uuid, p_receipt_key uuid, p_lines jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $f$
DECLARE
  v_t         record;
  v_src_name  text;
  v_same_cur  boolean;
  v_ids       uuid[];
  v_it        record;
  v_line      jsonb;
  v_transit   int;
  v_r         int;
  v_m         int;
  v_cat       text;
  v_dest_pid  uuid;
  v_prev      int;
  v_mv        uuid;
  v_left      int;
  v_a         record;
  v_take      int;
  v_miss      int;
  v_batch     uuid;
  v_created   jsonb := '[]'::jsonb;
  v_sent_tot  int := 0;
  v_recv_tot  int := 0;
BEGIN
  SELECT * INTO v_t FROM stock_transfers WHERE id = p_transfer_id FOR UPDATE;
  IF NOT FOUND OR v_t.destination_shop_id <> p_dest THEN RAISE EXCEPTION 'transfer_not_found' USING ERRCODE = 'P0063'; END IF;
  IF v_t.status = 'received' THEN
    IF v_t.receipt_key IS NOT DISTINCT FROM p_receipt_key THEN
      RETURN jsonb_build_object('id', v_t.id, 'reference', v_t.reference, 'status', 'received', 'replayed', true);
    END IF;
    RAISE EXCEPTION 'transfer_already_received' USING ERRCODE = 'P0078',
      DETAIL = jsonb_build_object('received_at', v_t.received_at, 'received_by', v_t.received_by)::text;
  END IF;
  IF v_t.status <> 'sent' THEN RAISE EXCEPTION 'transfer_not_in_transit' USING ERRCODE = 'P0068'; END IF;
  SELECT name INTO v_src_name FROM shops WHERE id = v_t.source_shop_id;
  SELECT s.currency IS NOT DISTINCT FROM d.currency INTO v_same_cur FROM shops s, shops d WHERE s.id = v_t.source_shop_id AND d.id = p_dest;

  -- Toutes les lignes, chacune une seule fois, quantité entre 0 et le reste en transit
  IF EXISTS (SELECT 1 FROM stock_transfer_items i WHERE i.stock_transfer_id = p_transfer_id
               AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(coalesce(p_lines, '[]'::jsonb)) l WHERE nullif(l->>'item_id', '')::uuid = i.id))
     OR (SELECT count(*) FROM jsonb_array_elements(coalesce(p_lines, '[]'::jsonb))) <> (SELECT count(*) FROM stock_transfer_items WHERE stock_transfer_id = p_transfer_id) THEN
    RAISE EXCEPTION 'transfer_lines_incomplete' USING ERRCODE = 'P0080';
  END IF;

  -- Produits d'arrivée touchés verrouillés dans un ordre fixe
  SELECT array_agg(x) INTO v_ids FROM (
    SELECT nullif(l->>'destination_product_id', '')::uuid AS x FROM jsonb_array_elements(p_lines) l
    UNION SELECT destination_product_id FROM stock_transfer_items WHERE stock_transfer_id = p_transfer_id
  ) s WHERE x IS NOT NULL;
  PERFORM 1 FROM products WHERE id = ANY(v_ids) ORDER BY id FOR UPDATE;

  FOR v_it IN SELECT * FROM stock_transfer_items WHERE stock_transfer_id = p_transfer_id ORDER BY id FOR UPDATE LOOP
    SELECT l INTO v_line FROM jsonb_array_elements(p_lines) l WHERE nullif(l->>'item_id', '')::uuid = v_it.id LIMIT 1;
    SELECT coalesce(sum(quantity_in_transit), 0) INTO v_transit FROM stock_transfer_allocations WHERE item_id = v_it.id;
    v_r := coalesce(nullif(v_line->>'quantity_received', '')::int, -1);
    IF v_r < 0 OR v_r > v_transit THEN
      RAISE EXCEPTION 'invalid_quantity' USING ERRCODE = 'P0076', DETAIL = jsonb_build_object('product', v_it.product_name, 'max', v_transit)::text;
    END IF;
    v_m := v_transit - v_r;
    v_cat := CASE WHEN v_m > 0 AND v_line->>'discrepancy_category' IN ('transport_loss', 'theft', 'breakage', 'count_error', 'other')
                  THEN v_line->>'discrepancy_category' END;
    v_dest_pid := coalesce(nullif(v_line->>'destination_product_id', '')::uuid, v_it.destination_product_id);
    v_mv := NULL;

    IF v_r > 0 THEN
      IF v_dest_pid IS NOT NULL THEN
        SELECT quantity INTO v_prev FROM products WHERE id = v_dest_pid AND shop_id = p_dest;
        IF NOT FOUND THEN RAISE EXCEPTION 'destination_product_not_found' USING ERRCODE = 'P0070'; END IF;
      ELSE
        -- Nouveau produit à l'arrivée. Même devise : prix et coût de la source. Devises différentes : DÉSACTIVÉ,
        -- prix et coût à 0 (inconnus ; colonnes obligatoires) — le propriétaire fixe le prix puis l'active.
        INSERT INTO products (shop_id, name, unit, buying_price, selling_price, quantity, is_active)
          VALUES (p_dest, v_it.product_name, v_it.unit,
                  CASE WHEN v_same_cur THEN greatest(coalesce(v_it.buying_price, 0), 0) ELSE 0 END,
                  CASE WHEN v_same_cur THEN greatest(coalesce(v_it.selling_price, 0), 0) ELSE 0 END,
                  0, v_same_cur)
          RETURNING id, quantity INTO v_dest_pid, v_prev;
        v_created := v_created || jsonb_build_object('product_id', v_dest_pid, 'name', v_it.product_name, 'needs_price', NOT v_same_cur);
      END IF;
      UPDATE products SET quantity = v_prev + v_r, updated_at = now() WHERE id = v_dest_pid;
      INSERT INTO stock_movements (shop_id, product_id, type, quantity, previous_qty, new_qty, reason, performed_by, transfer_id)
        VALUES (p_dest, v_dest_pid, 'in', v_r, v_prev, v_prev + v_r, 'Transfert ' || v_t.reference || ' depuis ' || v_src_name, p_user, p_transfer_id)
        RETURNING id INTO v_mv;
    END IF;

    -- Répartition : reçu d'abord sur les allocations qui périment le plus tôt ; le manque sur les suivantes
    v_left := v_r;
    FOR v_a IN SELECT * FROM stock_transfer_allocations
                WHERE item_id = v_it.id AND quantity_in_transit > 0
                ORDER BY (coverage = 'batch') DESC, source_expiry_date ASC NULLS LAST, source_received_at ASC NULLS LAST, id
                FOR UPDATE LOOP
      v_take := least(v_a.quantity_in_transit, v_left);
      v_miss := v_a.quantity_in_transit - v_take;
      v_batch := NULL;
      IF v_take > 0 THEN
        -- Un lot d'arrivée par lot source reçu : même péremption (jamais inventée), coût du lot source si même devise
        INSERT INTO product_batches (shop_id, product_id, quantity, initial_quantity, buying_price, expiry_date, source, received_at,
                                     origin_transfer_id, origin_batch_id, origin_untracked)
          VALUES (p_dest, v_dest_pid, v_take, v_take,
                  CASE WHEN v_same_cur THEN v_a.unit_cost END,
                  CASE WHEN v_a.coverage = 'batch' THEN v_a.source_expiry_date END, 'transfer', now(),
                  p_transfer_id,
                  CASE WHEN v_a.coverage = 'batch' AND EXISTS (SELECT 1 FROM product_batches WHERE id = v_a.source_batch_id) THEN v_a.source_batch_id END,
                  v_a.coverage <> 'batch')
          RETURNING id INTO v_batch;
      END IF;
      UPDATE stock_transfer_allocations
         SET quantity_received = quantity_received + v_take, quantity_missing = quantity_missing + v_miss, destination_batch_id = coalesce(v_batch, destination_batch_id)
       WHERE id = v_a.id;
      v_left := v_left - v_take;
    END LOOP;

    -- Manque : écart enregistré à la SOURCE, aucun stock ne bouge
    IF v_m > 0 THEN
      INSERT INTO stock_movements (shop_id, product_id, type, quantity, previous_qty, new_qty, reason, notes, performed_by, transfer_id)
        VALUES (v_t.source_shop_id, v_it.source_product_id, 'transit_loss', v_m, NULL, NULL,
                'Transfert ' || v_t.reference || ' : manquant à la réception', nullif(btrim(v_line->>'discrepancy_detail'), ''), p_user, p_transfer_id);
    END IF;

    UPDATE stock_transfer_items
       SET quantity_received = v_r,
           destination_product_id = coalesce(v_dest_pid, destination_product_id),
           discrepancy_category = v_cat,
           discrepancy_detail = CASE WHEN v_m > 0 THEN nullif(left(btrim(coalesce(v_line->>'discrepancy_detail', '')), 300), '') END
     WHERE id = v_it.id;
    v_sent_tot := v_sent_tot + v_transit;
    v_recv_tot := v_recv_tot + v_r;
  END LOOP;

  UPDATE stock_transfers
     SET status = 'received', received_at = now(), received_by = p_user, receipt_key = p_receipt_key,
         has_discrepancy = (v_recv_tot < v_sent_tot), updated_at = now()
   WHERE id = p_transfer_id;
  UPDATE stock_transfer_tokens SET revoked_at = now() WHERE transfer_id = p_transfer_id AND revoked_at IS NULL;
  PERFORM _transfer_audit(p_dest, p_user, 'stock_transfer.receive', p_transfer_id,
    jsonb_build_object('reference', v_t.reference, 'sent', v_sent_tot, 'received', v_recv_tot, 'missing', v_sent_tot - v_recv_tot));
  RETURN jsonb_build_object('id', v_t.id, 'reference', v_t.reference, 'status', 'received', 'replayed', false,
                            'sent', v_sent_tot, 'received', v_recv_tot, 'missing', v_sent_tot - v_recv_tot, 'created_products', v_created);
END;
$f$;

-- Annuler : brouillon (aucun stock) ; en transit (tout revient aux lots source EXACTS) ; jamais après réception
CREATE OR REPLACE FUNCTION public.cancel_stock_transfer(p_transfer_id uuid, p_source_shop_id uuid, p_performed_by uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $f$
DECLARE
  v_status text;
  v_src    uuid;
  v_ref    text;
  v_it     record;
  v_a      record;
  v_batch  uuid;
  v_total  int;
  v_prev   int;
BEGIN
  SELECT status, source_shop_id, reference INTO v_status, v_src, v_ref FROM stock_transfers WHERE id = p_transfer_id FOR UPDATE;
  IF NOT FOUND OR v_src IS DISTINCT FROM p_source_shop_id THEN RAISE EXCEPTION 'transfer_not_found' USING ERRCODE = 'P0063'; END IF;
  IF v_status = 'cancelled' THEN RETURN; END IF;                       -- déjà annulé : rien de plus
  IF v_status = 'received' THEN RAISE EXCEPTION 'transfer_not_cancellable' USING ERRCODE = 'P0074'; END IF;
  IF v_status = 'sent' THEN
    PERFORM 1 FROM products WHERE id IN (SELECT source_product_id FROM stock_transfer_items WHERE stock_transfer_id = p_transfer_id)
      ORDER BY id FOR UPDATE;
    FOR v_it IN SELECT * FROM stock_transfer_items WHERE stock_transfer_id = p_transfer_id ORDER BY source_product_id LOOP
      v_total := 0;
      FOR v_a IN SELECT * FROM stock_transfer_allocations WHERE item_id = v_it.id AND quantity_in_transit > 0 FOR UPDATE LOOP
        IF v_a.coverage = 'batch' THEN
          -- Rendu au lot source EXACT ; lot disparu entre-temps : recréé (même péremption, même coût s'il est connu)
          v_batch := NULL;
          UPDATE product_batches SET quantity = quantity + v_a.quantity_in_transit, updated_at = now() WHERE id = v_a.source_batch_id
            RETURNING id INTO v_batch;
          IF v_batch IS NULL AND v_it.source_product_id IS NOT NULL THEN
            INSERT INTO product_batches (shop_id, product_id, quantity, initial_quantity, buying_price, expiry_date, source, received_at, origin_transfer_id)
              VALUES (v_src, v_it.source_product_id, v_a.quantity_in_transit, v_a.quantity_in_transit, v_a.unit_cost, v_a.source_expiry_date,
                      'adjustment', coalesce(v_a.source_received_at, now()), p_transfer_id);
          END IF;
        END IF;
        v_total := v_total + v_a.quantity_in_transit;
        UPDATE stock_transfer_allocations SET quantity_returned = quantity_returned + v_a.quantity_in_transit WHERE id = v_a.id;
      END LOOP;
      IF v_total > 0 AND v_it.source_product_id IS NOT NULL THEN
        SELECT quantity INTO v_prev FROM products WHERE id = v_it.source_product_id AND shop_id = v_src;
        IF FOUND THEN
          UPDATE products SET quantity = v_prev + v_total, updated_at = now() WHERE id = v_it.source_product_id;
          INSERT INTO stock_movements (shop_id, product_id, type, quantity, previous_qty, new_qty, reason, performed_by, transfer_id)
            VALUES (v_src, v_it.source_product_id, 'in', v_total, v_prev, v_prev + v_total, 'Annulation transfert ' || v_ref, p_performed_by, p_transfer_id);
        END IF;
      END IF;
    END LOOP;
  END IF;
  UPDATE stock_transfers SET status = 'cancelled', cancelled_at = now(), cancelled_by = p_performed_by, updated_at = now() WHERE id = p_transfer_id;
  UPDATE stock_transfer_tokens SET revoked_at = now() WHERE transfer_id = p_transfer_id AND revoked_at IS NULL;
  PERFORM _transfer_audit(v_src, p_performed_by, 'stock_transfer.cancel', p_transfer_id, jsonb_build_object('reference', v_ref, 'was', v_status));
END;
$f$;

-- ── 9. Anciennes fonctions : même nom, même appel, nouvelles règles (versions de l'application d'avant) ──────────
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
  -- Ancien écran : réception définitive ; le manque devient un écart (catégorie reprise), jamais au-delà de l'envoyé
  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'item_id', i.id,
           'quantity_received', least(greatest(coalesce(nullif(e->>'quantity_received', '')::int, 0), 0), i.quantity_sent),
           'destination_product_id', e->>'destination_product_id',
           'discrepancy_category', e->>'discrepancy_category',
           'discrepancy_detail', e->>'discrepancy_detail')), '[]'::jsonb)
    INTO v_lines
    FROM stock_transfer_items i
    LEFT JOIN jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) e ON nullif(e->>'transfer_item_id', '')::uuid = i.id
   WHERE i.stock_transfer_id = p_transfer_id;
  RETURN receive_stock_transfer_final(p_transfer_id, p_destination_shop_id, p_performed_by, gen_random_uuid(), v_lines);
END;
$f$;

-- ── 10. Exécution : serveur seulement ────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE f text;
BEGIN
  FOREACH f IN ARRAY ARRAY[
    'public._transfer_audit(uuid, uuid, text, uuid, jsonb)',
    'public._transfer_check_shops(uuid, uuid)',
    'public._transfer_replace_items(uuid, uuid, jsonb)',
    'public.create_stock_transfer(uuid, uuid, uuid, text, jsonb, boolean)',
    'public.update_stock_transfer_draft(uuid, uuid, uuid, uuid, text, jsonb, timestamptz)',
    'public.send_stock_transfer_draft(uuid, uuid, uuid)',
    'public.receive_stock_transfer_final(uuid, uuid, uuid, uuid, jsonb)',
    'public.cancel_stock_transfer(uuid, uuid, uuid)',
    'public.send_stock_transfer(uuid, uuid, uuid, text, jsonb)',
    'public.receive_stock_transfer(uuid, uuid, uuid, jsonb)'
  ] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', f);
  END LOOP;
END $$;

-- ── 11. Contrôle : droits effectifs (arrêt si le navigateur peut exécuter ou lire ce qui est réservé au serveur) ──
DO $$
DECLARE v_bad text;
BEGIN
  SELECT string_agg(p.oid::regprocedure::text || ' par ' || r.rolname, ', ') INTO v_bad
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace CROSS JOIN (VALUES ('anon'), ('authenticated')) r(rolname)
   WHERE n.nspname = 'public'
     AND p.proname IN ('_transfer_audit', '_transfer_check_shops', '_transfer_replace_items', 'create_stock_transfer', 'update_stock_transfer_draft',
                       'send_stock_transfer_draft', 'receive_stock_transfer_final', 'cancel_stock_transfer', 'send_stock_transfer', 'receive_stock_transfer')
     AND has_function_privilege(r.rolname, p.oid, 'EXECUTE');
  IF v_bad IS NOT NULL THEN RAISE EXCEPTION '188 : fonctions exécutables par le navigateur : %', v_bad; END IF;
  SELECT string_agg(t || ' par ' || r, ', ') INTO v_bad
    FROM unnest(ARRAY['public.stock_transfer_allocations', 'public.stock_transfer_tokens']) t, unnest(ARRAY['anon', 'authenticated']) r
   WHERE has_table_privilege(r, t, 'SELECT') OR has_table_privilege(r, t, 'INSERT') OR has_table_privilege(r, t, 'UPDATE') OR has_table_privilege(r, t, 'DELETE');
  IF v_bad IS NOT NULL THEN RAISE EXCEPTION '188 : tables lisibles ou modifiables par le navigateur : %', v_bad; END IF;
  IF has_column_privilege('authenticated', 'public.product_batches', 'buying_price', 'SELECT') THEN
    RAISE EXCEPTION '188 : buying_price des lots redevenu lisible par le navigateur';
  END IF;
  RAISE NOTICE '188 : transferts V1 installés ; fonctions et tables réservées au serveur';
END $$;

NOTIFY pgrst, 'reload schema';

-- ── Vérification après exécution ───────────────────────────────────────────────────────────────────────────────
-- SELECT status, count(*) FROM stock_transfers GROUP BY 1;                                   -- inchangé (2 sent, 3 received, 1 cancelled)
-- SELECT coverage, count(*), sum(quantity_in_transit) FROM stock_transfer_allocations GROUP BY 1;  -- legacy uniquement
-- SELECT count(*) FROM stock_transfer_tokens WHERE revoked_at IS NULL;                        -- 2 (les transferts en route)

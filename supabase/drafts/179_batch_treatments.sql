-- ════════════════════════════════════════════════════════════════════════════════════════════════════════════
-- 179 — Traitement des lots périmés + résolution des ventes hors ligne non attribuées — BROUILLON, NON APPLIQUÉ
-- ════════════════════════════════════════════════════════════════════════════════════════════════════════════
-- Deux opérations métier DISTINCTES (décisions du 24 oct. 2026) :
--   A. TRAITEMENT d'un lot encore présent physiquement (treat_batch) :
--        dispose (destruction), supplier_return (retour fournisseur), quantity_adjustment, date_correction.
--        dispose / supplier_return / quantity_adjustment changent le lot ET le stock produit du même écart, avec
--        exactement un mouvement de stock ; date_correction ne change aucune quantité.
--   B. RÉSOLUTION d'une vente hors ligne déjà sortie du stock (resolve_unallocated) :
--        « ces n unités vendues venaient du lot L ». batch_unallocated est une quantité DÉJÀ sortie du stock
--        produit : la résolution corrige uniquement la traçabilité → lot −n, batch_unallocated −n, allocation
--        vente ↔ lot +n, AUCUNE modification de products.quantity, AUCUN mouvement de stock.
--        Exemple : produit 8, lot 10, non attribué 2 → produit 8, lot 8, non attribué 0 (jamais produit 6).
-- Historique : une ligne IMMUABLE par événement (batch_treatments) ; photos = lignes séparées, immuables.
-- Une correction = un NOUVEL événement (corrects_treatment_id), jamais la modification d'un ancien.
-- Aucun remplissage, aucune correction historique automatique. Codes d'erreur nouveaux P0040 à P0049.
-- Ordre des verrous, identique aux ventes (deduct_stock_on_sale, edit_sale) : [vente → lignes] → produit → lot.
-- ════════════════════════════════════════════════════════════════════════════════════════════════════════════

-- ── 1. Historique des traitements ────────────────────────────────────────────────────────────────────────────
-- Clés vers le lot et le produit en NO ACTION (contrôle en fin d'instruction) : la suppression d'un lot ou d'un
-- produit ayant un historique est REFUSÉE, mais la suppression d'une boutique entière (suppression d'un compte
-- par l'administration, inscription annulée) reste possible — tout part en cascade dans la même instruction.
-- Fournisseur, vente et auteur : identifiant + copie du nom / numéro, SANS clé étrangère (une mise à NULL en
-- cascade serait une modification de l'événement ; l'historique doit survivre à leur suppression).
CREATE TABLE public.batch_treatments (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id               uuid NOT NULL REFERENCES public.shops(id) ON DELETE CASCADE,
  batch_id              uuid NOT NULL REFERENCES public.product_batches(id) ON DELETE NO ACTION,
  product_id            uuid NOT NULL REFERENCES public.products(id) ON DELETE NO ACTION,
  action                text NOT NULL,
  quantity              int,
  lot_qty_before        int  NOT NULL,
  lot_qty_after         int  NOT NULL,
  product_qty_before    int  NOT NULL,
  product_qty_after     int  NOT NULL,
  old_expiry_date       date,
  new_expiry_date       date,
  supplier_id           uuid,
  supplier_name         text,
  sale_id               uuid,
  sale_number           text,
  reason_code           text,
  note                  text,
  request_id            text NOT NULL,
  corrects_treatment_id uuid REFERENCES public.batch_treatments(id) ON DELETE NO ACTION,
  performed_by          uuid NOT NULL,
  performed_by_name     text,
  created_at            timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT batch_treatments_request_unique UNIQUE (shop_id, request_id),
  CONSTRAINT batch_treatments_action_check CHECK (action IN
    ('dispose', 'supplier_return', 'quantity_adjustment', 'date_correction', 'unallocated_resolution')),
  CONSTRAINT batch_treatments_request_id_check CHECK (length(request_id) BETWEEN 8 AND 120),
  CONSTRAINT batch_treatments_qty_nonneg_check CHECK (
    lot_qty_before >= 0 AND lot_qty_after >= 0 AND product_qty_before >= 0 AND product_qty_after >= 0),
  -- Cohérence quantité ↔ action (aucun événement ne peut décrire un effet impossible)
  CONSTRAINT batch_treatments_effect_check CHECK (
    (action IN ('dispose', 'supplier_return') AND quantity > 0
       AND lot_qty_after = lot_qty_before - quantity AND product_qty_after = product_qty_before - quantity)
    OR (action = 'quantity_adjustment' AND quantity <> 0
       AND lot_qty_after = lot_qty_before + quantity AND product_qty_after = product_qty_before + quantity)
    OR (action = 'date_correction' AND quantity IS NULL
       AND lot_qty_after = lot_qty_before AND product_qty_after = product_qty_before)
    OR (action = 'unallocated_resolution' AND quantity > 0
       AND lot_qty_after = lot_qty_before - quantity AND product_qty_after = product_qty_before)),
  CONSTRAINT batch_treatments_dates_check CHECK (
    CASE WHEN action = 'date_correction' THEN old_expiry_date IS DISTINCT FROM new_expiry_date
         ELSE old_expiry_date IS NULL AND new_expiry_date IS NULL END),
  CONSTRAINT batch_treatments_supplier_check CHECK (
    (action = 'supplier_return') = (supplier_id IS NOT NULL) AND (supplier_id IS NULL) = (supplier_name IS NULL)),
  CONSTRAINT batch_treatments_sale_check CHECK (
    (action = 'unallocated_resolution') = (sale_id IS NOT NULL)),
  CONSTRAINT batch_treatments_reason_check CHECK (
    CASE WHEN action = 'quantity_adjustment'
         THEN reason_code IN ('damage', 'loss', 'theft', 'counting_error', 'other')
         ELSE reason_code IS NULL END),
  -- Notes obligatoires : correction de date, résolution, ajustement « autre »
  CONSTRAINT batch_treatments_note_check CHECK (
    CASE WHEN action IN ('date_correction', 'unallocated_resolution')
           OR (action = 'quantity_adjustment' AND reason_code = 'other')
         THEN note IS NOT NULL AND length(btrim(note)) > 0
         ELSE true END),
  CONSTRAINT batch_treatments_note_length_check CHECK (note IS NULL OR length(note) <= 1000),
  CONSTRAINT batch_treatments_not_self_correction CHECK (corrects_treatment_id IS DISTINCT FROM id)
);
CREATE INDEX idx_batch_treatments_batch   ON public.batch_treatments (batch_id, created_at);
CREATE INDEX idx_batch_treatments_product ON public.batch_treatments (shop_id, product_id, created_at);
CREATE INDEX idx_batch_treatments_sale    ON public.batch_treatments (sale_id) WHERE sale_id IS NOT NULL;
COMMENT ON TABLE public.batch_treatments IS
  'Historique immuable des traitements de lot (179) : une ligne par événement, jamais modifiée ; une correction est un nouvel événement (corrects_treatment_id).';

-- ── 2. Photos justificatives (lignes séparées, immuables) ────────────────────────────────────────────────────
-- Seul le chemin de stockage est conservé (jamais d'URL signée). Espace privé batch-treatment-photos,
-- chemin « <shop_id>/<batch_id>/<treatment_id>/<fichier> ». 3 photos au plus par traitement (garde ci-dessous,
-- verrou sur le traitement : deux envois simultanés ne peuvent pas en créer une 4e).
CREATE TABLE public.batch_treatment_photos (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  treatment_id  uuid NOT NULL REFERENCES public.batch_treatments(id) ON DELETE CASCADE,
  shop_id       uuid NOT NULL REFERENCES public.shops(id) ON DELETE CASCADE,
  storage_path  text NOT NULL UNIQUE,
  mime_type     text NOT NULL CHECK (mime_type IN ('image/jpeg', 'image/png', 'image/webp')),
  size_bytes    int  NOT NULL CHECK (size_bytes > 0 AND size_bytes <= 2097152),
  uploaded_by   uuid NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT batch_treatment_photos_path_check CHECK (
    storage_path LIKE shop_id::text || '/%' AND storage_path NOT LIKE '%..%' AND length(storage_path) <= 300)
);
CREATE INDEX idx_batch_treatment_photos_treatment ON public.batch_treatment_photos (treatment_id);

-- ── 3. Mouvements de stock : lien facultatif vers le lot et le traitement ────────────────────────────────────
-- NO ACTION : un lot ou un traitement référencé par un mouvement ne peut pas disparaître (historique conservé).
ALTER TABLE public.stock_movements
  ADD COLUMN IF NOT EXISTS batch_id uuid REFERENCES public.product_batches(id) ON DELETE NO ACTION,
  ADD COLUMN IF NOT EXISTS batch_treatment_id uuid REFERENCES public.batch_treatments(id) ON DELETE NO ACTION;
CREATE INDEX IF NOT EXISTS idx_stock_movements_batch ON public.stock_movements (batch_id) WHERE batch_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_stock_movements_treatment ON public.stock_movements (batch_treatment_id) WHERE batch_treatment_id IS NOT NULL;

-- Allocation vente ↔ lot : la base protège indépendamment de l'interface — un lot VENDU ne peut plus être
-- supprimé (avant : ON DELETE SET NULL effaçait silencieusement la trace de l'allocation). NO ACTION garde
-- possibles la modification / suppression d'une vente (lignes et allocations en cascade) et la suppression
-- complète d'une boutique ; un produit vendu est archivé par l'application (D5), jamais supprimé.
ALTER TABLE public.sale_item_batches DROP CONSTRAINT sale_item_batches_batch_id_fkey;
ALTER TABLE public.sale_item_batches ADD CONSTRAINT sale_item_batches_batch_id_fkey
  FOREIGN KEY (batch_id) REFERENCES public.product_batches(id) ON DELETE NO ACTION;

-- ── 4. Gardes ────────────────────────────────────────────────────────────────────────────────────────────────

-- Immuabilité : aucune modification ; suppression seulement quand la boutique elle-même est supprimée (cascade
-- dans la même instruction : la boutique n'est alors plus visible). Aucune route ne supprime un traitement.
CREATE OR REPLACE FUNCTION public.batch_history_immutable() RETURNS trigger
LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'batch_history_immutable' USING ERRCODE = '42501',
      DETAIL = json_build_object('table', TG_TABLE_NAME, 'id', OLD.id)::text;
  END IF;
  IF EXISTS (SELECT 1 FROM shops WHERE id = OLD.shop_id) THEN
    RAISE EXCEPTION 'batch_history_immutable' USING ERRCODE = '42501',
      DETAIL = json_build_object('table', TG_TABLE_NAME, 'id', OLD.id)::text;
  END IF;
  RETURN OLD;
END;
$$;
CREATE TRIGGER trg_batch_treatments_immutable BEFORE UPDATE OR DELETE ON public.batch_treatments
  FOR EACH ROW EXECUTE FUNCTION public.batch_history_immutable();
-- Photos : mêmes règles, et en plus la référence ne peut disparaître que si le FICHIER a déjà été retiré de
-- l'espace de stockage (via l'API Storage, qui supprime aussi sa ligne storage.objects). Une suppression de
-- boutique qui oublierait le nettoyage des fichiers échoue donc, au lieu de laisser des fichiers privés orphelins.
CREATE OR REPLACE FUNCTION public.batch_treatment_photos_immutable() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP = 'UPDATE' OR EXISTS (SELECT 1 FROM shops WHERE id = OLD.shop_id) THEN
    RAISE EXCEPTION 'batch_history_immutable' USING ERRCODE = '42501',
      DETAIL = json_build_object('table', TG_TABLE_NAME, 'id', OLD.id)::text;
  END IF;
  IF EXISTS (SELECT 1 FROM storage.objects WHERE bucket_id = 'batch-treatment-photos' AND name = OLD.storage_path) THEN
    RAISE EXCEPTION 'photo_file_still_stored' USING ERRCODE = 'P0049',
      DETAIL = json_build_object('reason', 'storage_object_present', 'path', OLD.storage_path)::text;
  END IF;
  RETURN OLD;
END;
$$;
CREATE TRIGGER trg_batch_treatment_photos_immutable BEFORE UPDATE OR DELETE ON public.batch_treatment_photos
  FOR EACH ROW EXECUTE FUNCTION public.batch_treatment_photos_immutable();

-- Cohérence à l'insertion d'un traitement : boutique et produit = ceux du lot ; un événement corrigé appartient
-- à la même boutique et au même lot. Un événement ne peut viser qu'un événement DÉJÀ existant et rien n'est
-- jamais modifié : aucune boucle de corrections n'est possible.
CREATE OR REPLACE FUNCTION public.batch_treatments_insert_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM product_batches WHERE id = NEW.batch_id AND shop_id = NEW.shop_id AND product_id = NEW.product_id) THEN
    RAISE EXCEPTION 'batch_mismatch' USING ERRCODE = 'P0047',
      DETAIL = json_build_object('what', 'batch', 'batch_id', NEW.batch_id)::text;
  END IF;
  IF NEW.corrects_treatment_id IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM batch_treatments WHERE id = NEW.corrects_treatment_id AND shop_id = NEW.shop_id AND batch_id = NEW.batch_id) THEN
    RAISE EXCEPTION 'corrected_treatment_mismatch' USING ERRCODE = 'P0047',
      DETAIL = json_build_object('what', 'corrects_treatment', 'id', NEW.corrects_treatment_id)::text;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER trg_batch_treatments_insert_guard BEFORE INSERT ON public.batch_treatments
  FOR EACH ROW EXECUTE FUNCTION public.batch_treatments_insert_guard();

-- 3 photos au plus, boutique = celle du traitement — verrou sur le traitement (FOR UPDATE ne déclenche pas la
-- garde d'immuabilité) : deux insertions simultanées sont sérialisées, jamais 4 photos.
CREATE OR REPLACE FUNCTION public.batch_treatment_photos_insert_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = public AS $$
DECLARE v_shop uuid; v_batch uuid; v_n int;
BEGIN
  SELECT shop_id, batch_id INTO v_shop, v_batch FROM batch_treatments WHERE id = NEW.treatment_id FOR UPDATE;
  IF v_shop IS NULL OR v_shop <> NEW.shop_id
     OR NEW.storage_path NOT LIKE v_shop::text || '/' || v_batch::text || '/' || NEW.treatment_id::text || '/%' THEN
    RAISE EXCEPTION 'photo_mismatch' USING ERRCODE = 'P0047',
      DETAIL = json_build_object('what', 'photo', 'treatment_id', NEW.treatment_id)::text;
  END IF;
  SELECT count(*) INTO v_n FROM batch_treatment_photos WHERE treatment_id = NEW.treatment_id;
  IF v_n >= 3 THEN
    RAISE EXCEPTION 'photo_limit' USING ERRCODE = 'P0049',
      DETAIL = json_build_object('reason', 'limit', 'max', 3)::text;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER trg_batch_treatment_photos_insert_guard BEFORE INSERT ON public.batch_treatment_photos
  FOR EACH ROW EXECUTE FUNCTION public.batch_treatment_photos_insert_guard();

-- Un seul chemin d'écriture pour la date de péremption d'un lot : treat_batch (événement date_correction).
-- (Seule l'ancienne route /api/product-batches/expiry modifiait cette colonne ; elle devient un appel à treat_batch.)
CREATE OR REPLACE FUNCTION public.product_batches_expiry_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.expiry_date IS DISTINCT FROM OLD.expiry_date
     AND coalesce(current_setting('stockshop.batch_treatment', true), '') <> 'on' THEN
    RAISE EXCEPTION 'expiry_change_requires_treatment' USING ERRCODE = 'P0045',
      DETAIL = json_build_object('batch_id', OLD.id)::text;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER trg_product_batches_expiry_guard BEFORE UPDATE OF expiry_date ON public.product_batches
  FOR EACH ROW EXECUTE FUNCTION public.product_batches_expiry_guard();

-- ── 5. Outils ────────────────────────────────────────────────────────────────────────────────────────────────

-- Retire un motif EXACT d'une liste « a,b,c » (format texte de sales.review_reason), normalisation
-- déterministe : découpage sur « , », espaces retirés autour de chaque motif, motifs vides supprimés (jamais
-- « ,, » ni virgule finale), ordre des autres motifs conservé, comparaison par égalité (jamais une
-- sous-chaîne). NULL si plus aucun motif ne reste (représentation actuelle d'une vente sans motif).
CREATE OR REPLACE FUNCTION public.remove_review_reason(p_reasons text, p_code text) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT NULLIF(string_agg(t.token, ',' ORDER BY t.ord), '')
  FROM (SELECT btrim(u.x) AS token, u.ord
        FROM unnest(string_to_array(coalesce(p_reasons, ''), ',')) WITH ORDINALITY AS u(x, ord)) t
  WHERE t.token <> '' AND t.token <> btrim(p_code)
$$;

-- DÉFINITION UNIQUE d'un « lot candidat » à une vente hors ligne non résolue — utilisée par le bandeau du
-- panneau de lot, par resolve_unallocated ET par le blocage D2 de treat_batch (aucune seconde définition) :
-- même boutique, même produit, vente active, quantité non attribuée > 0, lot enregistré AVANT la vente
-- (product_batches.created_at ≤ sales.created_at), lot non vide.
CREATE OR REPLACE FUNCTION public.unallocated_candidates(p_batch_id uuid)
RETURNS TABLE (sale_id uuid, sale_number text, sale_at timestamptz, unallocated int)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT s.id, s.sale_number, s.created_at, sum(si.batch_unallocated)::int
  FROM product_batches b
  JOIN sales s ON s.shop_id = b.shop_id AND s.sale_status = 'active' AND s.created_at >= b.created_at
  JOIN sale_items si ON si.sale_id = s.id AND si.product_id = b.product_id AND si.batch_unallocated > 0
  WHERE b.id = p_batch_id AND b.quantity > 0
  GROUP BY s.id, s.sale_number, s.created_at
  ORDER BY s.created_at
$$;

-- ── 6. Traitement d'un lot (A) ───────────────────────────────────────────────────────────────────────────────
-- p_quantity : dispose / supplier_return (1 ≤ n ≤ lot, n ≤ produit, aucun ajustement automatique).
-- p_new_quantity : quantity_adjustment — l'écart est calculé ICI (nouvelle quantité − quantité actuelle relue),
--   jamais reçu du navigateur.
-- p_new_expiry_date : date_correction (NULL = « sans date », cas déjà pris en charge par l'application).
-- Idempotence : (boutique, request_id) déjà vu → même événement renvoyé si mêmes paramètres, sinon P0041.
-- Verrous : produit puis lot (ordre des ventes). Boutique, produit et fournisseur relus en base.
CREATE OR REPLACE FUNCTION public.treat_batch(
  p_shop_id uuid, p_batch_id uuid, p_action text,
  p_quantity int, p_new_quantity int, p_new_expiry_date date,
  p_reason_code text, p_note text, p_request_id text, p_performed_by uuid,
  p_corrects_treatment_id uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_product_id uuid;
  v_lot        RECORD;
  v_prod_qty   int;
  v_prev       RECORD;
  v_today      date;
  v_expired    boolean;
  v_delta      int;
  v_note       text := NULLIF(btrim(p_note), '');
  v_sup_name   text;
  v_name       text;
  v_id         uuid;
BEGIN
  IF p_action NOT IN ('dispose', 'supplier_return', 'quantity_adjustment', 'date_correction') THEN
    RAISE EXCEPTION 'invalid_action' USING ERRCODE = 'P0043', DETAIL = json_build_object('action', p_action)::text;
  END IF;
  IF p_request_id IS NULL OR length(p_request_id) NOT BETWEEN 8 AND 120 THEN
    RAISE EXCEPTION 'request_id_required' USING ERRCODE = 'P0043';
  END IF;

  -- Pré-contrôle d'idempotence (rapide, sans verrou) : un double clic retrouve l'événement aussitôt.
  -- Le contrôle DÉFINITIF est refait après les verrous ; l'unicité (shop_id, request_id) reste l'autorité finale.
  SELECT * INTO v_prev FROM batch_treatments WHERE shop_id = p_shop_id AND request_id = p_request_id;
  IF v_prev.id IS NOT NULL AND v_prev.action = p_action AND v_prev.batch_id = p_batch_id
     AND v_prev.corrects_treatment_id IS NOT DISTINCT FROM p_corrects_treatment_id
     AND CASE p_action
           WHEN 'quantity_adjustment' THEN v_prev.lot_qty_after = p_new_quantity AND v_prev.reason_code = p_reason_code
           WHEN 'date_correction' THEN v_prev.new_expiry_date IS NOT DISTINCT FROM p_new_expiry_date
           ELSE v_prev.quantity = p_quantity END THEN
    RETURN jsonb_build_object('treatment_id', v_prev.id, 'already', true, 'action', v_prev.action,
      'lot_quantity', v_prev.lot_qty_after, 'product_quantity', v_prev.product_qty_after);
  END IF;

  SELECT product_id INTO v_product_id FROM product_batches WHERE id = p_batch_id AND shop_id = p_shop_id;
  IF v_product_id IS NULL THEN
    RAISE EXCEPTION 'batch_not_found' USING ERRCODE = 'P0047', DETAIL = json_build_object('what', 'batch')::text;
  END IF;
  SELECT quantity INTO v_prod_qty FROM products WHERE id = v_product_id AND shop_id = p_shop_id FOR UPDATE;
  SELECT * INTO v_lot FROM product_batches WHERE id = p_batch_id AND shop_id = p_shop_id FOR UPDATE;
  IF v_prod_qty IS NULL OR v_lot.id IS NULL OR v_lot.product_id <> v_product_id THEN
    RAISE EXCEPTION 'batch_not_found' USING ERRCODE = 'P0047', DETAIL = json_build_object('what', 'batch')::text;
  END IF;

  -- Idempotence (après les verrous : une requête identique concurrente attend puis voit l'événement validé)
  SELECT * INTO v_prev FROM batch_treatments WHERE shop_id = p_shop_id AND request_id = p_request_id;
  IF v_prev.id IS NOT NULL THEN
    IF v_prev.action = p_action AND v_prev.batch_id = p_batch_id
       AND v_prev.corrects_treatment_id IS NOT DISTINCT FROM p_corrects_treatment_id
       AND CASE p_action
             WHEN 'quantity_adjustment' THEN v_prev.lot_qty_after = p_new_quantity AND v_prev.reason_code = p_reason_code
             WHEN 'date_correction' THEN v_prev.new_expiry_date IS NOT DISTINCT FROM p_new_expiry_date
             ELSE v_prev.quantity = p_quantity END THEN
      RETURN jsonb_build_object('treatment_id', v_prev.id, 'already', true, 'action', v_prev.action,
        'lot_quantity', v_prev.lot_qty_after, 'product_quantity', v_prev.product_qty_after);
    END IF;
    RAISE EXCEPTION 'request_id_conflict' USING ERRCODE = 'P0041',
      DETAIL = json_build_object('treatment_id', v_prev.id)::text;
  END IF;

  v_today := shop_business_date(p_shop_id, now());
  v_expired := coalesce(v_lot.expiry_date < v_today, false);
  SELECT NULLIF(btrim(full_name), '') INTO v_name FROM profiles WHERE id = p_performed_by;

  IF p_action IN ('dispose', 'supplier_return') THEN
    IF NOT v_expired THEN
      RAISE EXCEPTION 'batch_not_expired' USING ERRCODE = 'P0044',
        DETAIL = json_build_object('expiry_date', v_lot.expiry_date, 'business_date', v_today)::text;
    END IF;
    IF p_quantity IS NULL OR p_quantity < 1 OR p_quantity > v_lot.quantity OR p_quantity > v_prod_qty THEN
      RAISE EXCEPTION 'invalid_quantity' USING ERRCODE = 'P0043',
        DETAIL = json_build_object('requested', p_quantity, 'lot', v_lot.quantity, 'product', v_prod_qty)::text;
    END IF;
    -- D2 : CE lot est candidat à une vente non résolue → ses unités ont pu partir avec la vente : refus
    IF EXISTS (SELECT 1 FROM unallocated_candidates(p_batch_id)) THEN
      RAISE EXCEPTION 'unallocated_pending' USING ERRCODE = 'P0040',
        DETAIL = (SELECT json_build_object('batch_id', p_batch_id, 'sales', count(*), 'pending', sum(unallocated))::text
                  FROM unallocated_candidates(p_batch_id));
    END IF;
    IF p_action = 'supplier_return' THEN
      SELECT name INTO v_sup_name FROM suppliers WHERE id = v_lot.supplier_id;
      IF v_lot.supplier_id IS NULL OR v_sup_name IS NULL THEN
        RAISE EXCEPTION 'batch_no_supplier' USING ERRCODE = 'P0042';
      END IF;
    END IF;
    v_delta := -p_quantity;

  ELSIF p_action = 'quantity_adjustment' THEN
    IF p_new_quantity IS NULL OR p_new_quantity < 0 OR p_new_quantity = v_lot.quantity THEN
      RAISE EXCEPTION 'invalid_quantity' USING ERRCODE = 'P0043',
        DETAIL = json_build_object('new_quantity', p_new_quantity, 'lot', v_lot.quantity)::text;
    END IF;
    IF p_reason_code IS NULL OR p_reason_code NOT IN ('damage', 'loss', 'theft', 'counting_error', 'other') THEN
      RAISE EXCEPTION 'reason_required' USING ERRCODE = 'P0046', DETAIL = json_build_object('field', 'reason_code')::text;
    END IF;
    IF p_reason_code = 'other' AND v_note IS NULL THEN
      RAISE EXCEPTION 'note_required' USING ERRCODE = 'P0046', DETAIL = json_build_object('field', 'note')::text;
    END IF;
    v_delta := p_new_quantity - v_lot.quantity;
    -- D2 : diminuer un lot PÉRIMÉ candidat à une vente non résolue → refus (double sortie possible) ;
    -- augmentation, ou lot non candidat : autorisé
    IF v_delta < 0 AND v_expired AND EXISTS (SELECT 1 FROM unallocated_candidates(p_batch_id)) THEN
      RAISE EXCEPTION 'unallocated_pending' USING ERRCODE = 'P0040',
        DETAIL = (SELECT json_build_object('batch_id', p_batch_id, 'sales', count(*), 'pending', sum(unallocated))::text
                  FROM unallocated_candidates(p_batch_id));
    END IF;
    IF v_prod_qty + v_delta < 0 THEN
      RAISE EXCEPTION 'invalid_quantity' USING ERRCODE = 'P0043',
        DETAIL = json_build_object('delta', v_delta, 'product', v_prod_qty)::text;
    END IF;

  ELSE -- date_correction
    IF v_note IS NULL THEN
      RAISE EXCEPTION 'note_required' USING ERRCODE = 'P0046', DETAIL = json_build_object('field', 'note')::text;
    END IF;
    IF p_new_expiry_date IS NOT DISTINCT FROM v_lot.expiry_date THEN
      RAISE EXCEPTION 'same_expiry_date' USING ERRCODE = 'P0043';
    END IF;
    v_delta := 0;
  END IF;

  -- Effets
  IF v_delta <> 0 THEN
    UPDATE product_batches SET quantity = quantity + v_delta, updated_at = now() WHERE id = p_batch_id;
    UPDATE products SET quantity = quantity + v_delta, updated_at = now() WHERE id = v_product_id;
  END IF;
  IF p_action = 'date_correction' THEN
    PERFORM set_config('stockshop.batch_treatment', 'on', true);
    UPDATE product_batches SET expiry_date = p_new_expiry_date, updated_at = now() WHERE id = p_batch_id;
    PERFORM set_config('stockshop.batch_treatment', '', true);
  END IF;

  INSERT INTO batch_treatments (shop_id, batch_id, product_id, action, quantity,
    lot_qty_before, lot_qty_after, product_qty_before, product_qty_after,
    old_expiry_date, new_expiry_date, supplier_id, supplier_name, reason_code, note,
    request_id, corrects_treatment_id, performed_by, performed_by_name)
  VALUES (p_shop_id, p_batch_id, v_product_id, p_action,
    CASE WHEN p_action = 'date_correction' THEN NULL WHEN p_action = 'quantity_adjustment' THEN v_delta ELSE p_quantity END,
    v_lot.quantity, v_lot.quantity + v_delta, v_prod_qty, v_prod_qty + v_delta,
    CASE WHEN p_action = 'date_correction' THEN v_lot.expiry_date END,
    CASE WHEN p_action = 'date_correction' THEN p_new_expiry_date END,
    CASE WHEN p_action = 'supplier_return' THEN v_lot.supplier_id END, v_sup_name,
    CASE WHEN p_action = 'quantity_adjustment' THEN p_reason_code END, v_note,
    p_request_id, p_corrects_treatment_id, p_performed_by, v_name)
  RETURNING id INTO v_id;

  -- Un mouvement par changement de stock produit ; previous_qty / new_qty = quantités PRODUIT
  IF v_delta <> 0 THEN
    INSERT INTO stock_movements (shop_id, product_id, type, quantity, previous_qty, new_qty, reason, notes,
                                 performed_by, batch_id, batch_treatment_id)
    VALUES (p_shop_id, v_product_id,
      CASE WHEN p_action = 'quantity_adjustment' THEN 'adjustment' ELSE 'out' END,
      CASE WHEN p_action = 'quantity_adjustment' THEN v_delta ELSE p_quantity END,
      v_prod_qty, v_prod_qty + v_delta,
      CASE p_action WHEN 'dispose' THEN 'Lot périmé détruit'
                    WHEN 'supplier_return' THEN 'Retour fournisseur — lot périmé'
                    ELSE 'Correction de lot — ' || CASE p_reason_code
                      WHEN 'damage' THEN 'Dommage' WHEN 'loss' THEN 'Perte' WHEN 'theft' THEN 'Vol'
                      WHEN 'counting_error' THEN 'Erreur de comptage' ELSE 'Autre' END END,
      v_note, p_performed_by, p_batch_id, v_id);
  END IF;

  RETURN jsonb_build_object('treatment_id', v_id, 'already', false, 'action', p_action,
    'lot_quantity', v_lot.quantity + v_delta, 'product_quantity', v_prod_qty + v_delta);
END;
$$;

-- ── 7. Résolution d'une vente hors ligne non attribuée (B) ───────────────────────────────────────────────────
-- Attribue n unités DÉJÀ vendues (batch_unallocated de la vente S pour le produit P) au lot L.
-- Conditions : vente active de la boutique ; lot de la même boutique et du même produit ; lot ENREGISTRÉ
-- avant la vente (product_batches.created_at ≤ sales.created_at : date d'enregistrement en base, jamais
-- modifiée — received_at est antérieure pour les lots de remplissage initial) ; lot ≥ n ; non attribué ≥ n.
-- La date de péremption du lot n'est PAS exigée « périmée aujourd'hui » : elle a pu être corrigée depuis, et
-- l'ancien état n'est connu que par l'historique date_correction ; la condition d'antériorité suffit.
-- Verrous : vente → ses lignes du produit (ordre id) → produit → lot. Deux résolutions concurrentes des mêmes
-- unités : la 2e attend, puis ne trouve plus assez d'unités non attribuées (P0048) — jamais de lot négatif.
-- Répartition déterministe : lignes de la vente pour ce produit, par id croissant.
CREATE OR REPLACE FUNCTION public.resolve_unallocated(
  p_shop_id uuid, p_sale_id uuid, p_product_id uuid, p_batch_id uuid, p_quantity int,
  p_note text, p_request_id text, p_performed_by uuid
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_sale     RECORD;
  v_line     RECORD;
  v_lot      RECORD;
  v_prod_qty int;
  v_pending  int := 0;
  v_rest     int;
  v_take     int;
  v_prev     RECORD;
  v_note     text := NULLIF(btrim(p_note), '');
  v_name     text;
  v_id       uuid;
  v_alloc_id uuid;
BEGIN
  IF p_request_id IS NULL OR length(p_request_id) NOT BETWEEN 8 AND 120 THEN
    RAISE EXCEPTION 'request_id_required' USING ERRCODE = 'P0043';
  END IF;

  -- Pré-contrôle d'idempotence sans verrou (le contrôle définitif est refait après les verrous)
  SELECT * INTO v_prev FROM batch_treatments WHERE shop_id = p_shop_id AND request_id = p_request_id;
  IF v_prev.id IS NOT NULL AND v_prev.action = 'unallocated_resolution' AND v_prev.sale_id = p_sale_id
     AND v_prev.batch_id = p_batch_id AND v_prev.product_id = p_product_id AND v_prev.quantity = p_quantity THEN
    RETURN jsonb_build_object('treatment_id', v_prev.id, 'already', true, 'lot_quantity', v_prev.lot_qty_after,
      'product_quantity', v_prev.product_qty_after);
  END IF;

  SELECT * INTO v_sale FROM sales WHERE id = p_sale_id AND shop_id = p_shop_id FOR UPDATE;
  IF v_sale.id IS NULL OR v_sale.sale_status <> 'active' THEN
    RAISE EXCEPTION 'sale_not_resolvable' USING ERRCODE = 'P0047',
      DETAIL = json_build_object('what', 'sale', 'status', v_sale.sale_status)::text;
  END IF;
  FOR v_line IN SELECT id, batch_unallocated FROM sale_items
                WHERE sale_id = p_sale_id AND product_id = p_product_id ORDER BY id FOR UPDATE LOOP
    v_pending := v_pending + v_line.batch_unallocated;
  END LOOP;
  SELECT quantity INTO v_prod_qty FROM products WHERE id = p_product_id AND shop_id = p_shop_id FOR UPDATE;
  SELECT * INTO v_lot FROM product_batches
    WHERE id = p_batch_id AND shop_id = p_shop_id AND product_id = p_product_id FOR UPDATE;
  IF v_prod_qty IS NULL OR v_lot.id IS NULL THEN
    RAISE EXCEPTION 'batch_not_resolvable' USING ERRCODE = 'P0047', DETAIL = json_build_object('what', 'batch')::text;
  END IF;

  SELECT * INTO v_prev FROM batch_treatments WHERE shop_id = p_shop_id AND request_id = p_request_id;
  IF v_prev.id IS NOT NULL THEN
    IF v_prev.action = 'unallocated_resolution' AND v_prev.sale_id = p_sale_id AND v_prev.batch_id = p_batch_id
       AND v_prev.product_id = p_product_id AND v_prev.quantity = p_quantity THEN
      RETURN jsonb_build_object('treatment_id', v_prev.id, 'already', true, 'lot_quantity', v_prev.lot_qty_after,
        'product_quantity', v_prev.product_qty_after);
    END IF;
    RAISE EXCEPTION 'request_id_conflict' USING ERRCODE = 'P0041',
      DETAIL = json_build_object('treatment_id', v_prev.id)::text;
  END IF;

  IF v_note IS NULL THEN
    RAISE EXCEPTION 'note_required' USING ERRCODE = 'P0046', DETAIL = json_build_object('field', 'note')::text;
  END IF;
  IF p_quantity IS NULL OR p_quantity < 1 OR p_quantity > v_lot.quantity THEN
    RAISE EXCEPTION 'invalid_quantity' USING ERRCODE = 'P0043',
      DETAIL = json_build_object('requested', p_quantity, 'lot', v_lot.quantity)::text;
  END IF;
  -- Avant le contrôle « candidat » : une 2e résolution concurrente des mêmes unités obtient P0048 (plus assez
  -- d'unités non attribuées), l'erreur métier attendue
  IF p_quantity > v_pending THEN
    RAISE EXCEPTION 'unallocated_insufficient' USING ERRCODE = 'P0048',
      DETAIL = json_build_object('requested', p_quantity, 'pending', v_pending)::text;
  END IF;
  -- Même définition de « lot candidat » que le bandeau et le blocage D2 (lot enregistré avant la vente, etc.)
  IF NOT EXISTS (SELECT 1 FROM unallocated_candidates(p_batch_id) c WHERE c.sale_id = p_sale_id) THEN
    RAISE EXCEPTION 'batch_not_resolvable' USING ERRCODE = 'P0047',
      DETAIL = json_build_object('what', 'candidate', 'batch_created_at', v_lot.created_at, 'sale_at', v_sale.created_at)::text;
  END IF;

  -- Répartition sur les lignes (ordre id) : non attribué −, allocation vers le lot + (créée ou augmentée)
  v_rest := p_quantity;
  FOR v_line IN SELECT id, batch_unallocated FROM sale_items
                WHERE sale_id = p_sale_id AND product_id = p_product_id AND batch_unallocated > 0 ORDER BY id LOOP
    EXIT WHEN v_rest <= 0;
    v_take := least(v_rest, v_line.batch_unallocated);
    UPDATE sale_items SET batch_unallocated = batch_unallocated - v_take WHERE id = v_line.id;
    SELECT id INTO v_alloc_id FROM sale_item_batches WHERE sale_item_id = v_line.id AND batch_id = p_batch_id
      ORDER BY created_at LIMIT 1 FOR UPDATE;
    IF v_alloc_id IS NOT NULL THEN
      UPDATE sale_item_batches SET quantity = quantity + v_take WHERE id = v_alloc_id;
    ELSE
      INSERT INTO sale_item_batches (sale_item_id, batch_id, quantity) VALUES (v_line.id, p_batch_id, v_take);
    END IF;
    v_alloc_id := NULL;
    v_rest := v_rest - v_take;
  END LOOP;

  -- Traçabilité du lot uniquement : products.quantity N'EST PAS modifié (unités déjà sorties à la vente)
  UPDATE product_batches SET quantity = quantity - p_quantity, updated_at = now() WHERE id = p_batch_id;

  -- D1 : plus rien de non attribué sur la vente → retirer SEULEMENT ce motif ; reviewed_at intact
  IF NOT EXISTS (SELECT 1 FROM sale_items WHERE sale_id = p_sale_id AND batch_unallocated > 0) THEN
    UPDATE sales SET review_reason = remove_review_reason(review_reason, 'expired_stock_unresolved')
      WHERE id = p_sale_id AND review_reason LIKE '%expired_stock_unresolved%';
  END IF;

  SELECT NULLIF(btrim(full_name), '') INTO v_name FROM profiles WHERE id = p_performed_by;
  INSERT INTO batch_treatments (shop_id, batch_id, product_id, action, quantity,
    lot_qty_before, lot_qty_after, product_qty_before, product_qty_after,
    sale_id, sale_number, note, request_id, performed_by, performed_by_name)
  VALUES (p_shop_id, p_batch_id, p_product_id, 'unallocated_resolution', p_quantity,
    v_lot.quantity, v_lot.quantity - p_quantity, v_prod_qty, v_prod_qty,
    p_sale_id, v_sale.sale_number, v_note, p_request_id, p_performed_by, v_name)
  RETURNING id INTO v_id;
  -- AUCUN mouvement de stock : le stock produit ne change pas

  RETURN jsonb_build_object('treatment_id', v_id, 'already', false, 'lot_quantity', v_lot.quantity - p_quantity,
    'product_quantity', v_prod_qty, 'pending_after', v_pending - p_quantity);
END;
$$;

-- ── 8. Photo d'un traitement (enregistrée APRÈS l'envoi du fichier par la route serveur) ─────────────────────
-- Auteur du traitement uniquement, 30 minutes au plus après l'événement, 3 au plus (garde + verrou).
-- Si l'enregistrement est refusé, la route supprime le fichier envoyé (aucun fichier orphelin).
CREATE OR REPLACE FUNCTION public.register_batch_treatment_photo(
  p_shop_id uuid, p_treatment_id uuid, p_storage_path text, p_mime_type text, p_size_bytes int, p_uploaded_by uuid
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_t RECORD; v_id uuid;
BEGIN
  SELECT * INTO v_t FROM batch_treatments WHERE id = p_treatment_id AND shop_id = p_shop_id FOR UPDATE;
  IF v_t.id IS NULL OR v_t.performed_by <> p_uploaded_by THEN
    RAISE EXCEPTION 'photo_not_allowed' USING ERRCODE = 'P0047', DETAIL = json_build_object('what', 'treatment')::text;
  END IF;
  IF now() > v_t.created_at + interval '30 minutes' THEN
    RAISE EXCEPTION 'photo_window_closed' USING ERRCODE = 'P0049', DETAIL = json_build_object('reason', 'window')::text;
  END IF;
  INSERT INTO batch_treatment_photos (treatment_id, shop_id, storage_path, mime_type, size_bytes, uploaded_by)
  VALUES (p_treatment_id, p_shop_id, p_storage_path, p_mime_type, p_size_bytes, p_uploaded_by)
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

-- ── 9. Suppression physique d'un lot : uniquement sans aucun historique ──────────────────────────────────────
-- Corps identique à la 117 (en production) + refus si traitement, photo ou mouvement lié existe.
-- (Les clés NO ACTION l'empêchent aussi en base ; ce contrôle donne une erreur lisible.)
CREATE OR REPLACE FUNCTION public.delete_product_batch(
  p_batch_id      UUID,
  p_shop_id       UUID,
  p_reason_code   TEXT,
  p_performed_by  UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_product_id    UUID;
  v_batch_qty     INT;
  v_product_qty   INT;
  v_new_prod_qty  INT;
  v_reason_label  TEXT;
BEGIN
  SELECT product_id, quantity INTO v_product_id, v_batch_qty
    FROM product_batches
    WHERE id = p_batch_id AND shop_id = p_shop_id
    FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'batch_not_found';
  END IF;

  IF EXISTS (SELECT 1 FROM sale_item_batches WHERE batch_id = p_batch_id) THEN
    RAISE EXCEPTION 'batch_already_sold';
  END IF;

  -- 179 : un lot ayant un historique (traitement, photo, mouvement lié) n'est jamais supprimé
  IF EXISTS (SELECT 1 FROM batch_treatments WHERE batch_id = p_batch_id)
     OR EXISTS (SELECT 1 FROM stock_movements WHERE batch_id = p_batch_id) THEN
    RAISE EXCEPTION 'batch_has_history';
  END IF;

  SELECT quantity INTO v_product_qty
    FROM products
    WHERE id = v_product_id AND shop_id = p_shop_id
    FOR UPDATE;

  v_new_prod_qty := GREATEST(0, v_product_qty - v_batch_qty);

  UPDATE products SET quantity = v_new_prod_qty, updated_at = now()
    WHERE id = v_product_id;

  v_reason_label := CASE p_reason_code
    WHEN 'damage'  THEN 'Dommage'
    WHEN 'loss'    THEN 'Perte'
    WHEN 'theft'   THEN 'Vol'
    WHEN 'expiry'  THEN 'Expiration'
    WHEN 'other'   THEN 'Autre'
    ELSE 'Correction de stock'
  END;

  IF v_batch_qty > 0 THEN
    INSERT INTO stock_movements(
      shop_id, product_id, type, quantity, previous_qty, new_qty, reason, performed_by
    ) VALUES (
      p_shop_id, v_product_id, 'adjustment', -v_batch_qty,
      v_product_qty, v_new_prod_qty, 'Suppression de lot — ' || v_reason_label, p_performed_by
    );
  END IF;

  DELETE FROM product_batches WHERE id = p_batch_id;

  RETURN JSONB_BUILD_OBJECT('product_quantity', v_new_prod_qty);
END;
$$;

-- ── 10. Espace de stockage privé des photos ──────────────────────────────────────────────────────────────────
-- Aucune politique sur storage.objects : seul le serveur (rôle service) écrit et signe des liens (10 min).
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('batch-treatment-photos', 'batch-treatment-photos', false, 2097152, ARRAY['image/jpeg', 'image/png', 'image/webp'])
ON CONFLICT (id) DO NOTHING;

-- ── 11. Droits : serveur uniquement ──────────────────────────────────────────────────────────────────────────
ALTER TABLE public.batch_treatments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.batch_treatment_photos ENABLE ROW LEVEL SECURITY;
-- Les nouvelles tables reçoivent par défaut des droits pour authenticated et service_role : tout est retiré,
-- le serveur garde la LECTURE seule ; toute écriture passe par les fonctions ci-dessus (propriétaire postgres).
REVOKE ALL ON TABLE public.batch_treatments, public.batch_treatment_photos FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE public.batch_treatments, public.batch_treatment_photos TO service_role;

REVOKE EXECUTE ON FUNCTION public.treat_batch(uuid, uuid, text, int, int, date, text, text, text, uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.resolve_unallocated(uuid, uuid, uuid, uuid, int, text, text, uuid)         FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.register_batch_treatment_photo(uuid, uuid, text, text, int, uuid)          FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.unallocated_candidates(uuid)                                               FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.remove_review_reason(text, text)                                           FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.batch_history_immutable()                                                  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.batch_treatment_photos_immutable()                                         FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.batch_treatments_insert_guard()                                            FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.batch_treatment_photos_insert_guard()                                      FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.product_batches_expiry_guard()                                             FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.delete_product_batch(uuid, uuid, text, uuid)                               FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.treat_batch(uuid, uuid, text, int, int, date, text, text, text, uuid, uuid) TO service_role;
GRANT  EXECUTE ON FUNCTION public.resolve_unallocated(uuid, uuid, uuid, uuid, int, text, text, uuid)         TO service_role;
GRANT  EXECUTE ON FUNCTION public.register_batch_treatment_photo(uuid, uuid, text, text, int, uuid)          TO service_role;
GRANT  EXECUTE ON FUNCTION public.unallocated_candidates(uuid)                                               TO service_role;
GRANT  EXECUTE ON FUNCTION public.delete_product_batch(uuid, uuid, text, uuid)                               TO service_role;
-- Un seul chemin métier pour corriger la quantité d'un lot : l'ancienne fonction n'est plus exécutable par le
-- serveur (la route /api/product-batches/adjust appelle treat_batch dès que la 179 est présente).
REVOKE EXECUTE ON FUNCTION public.adjust_batch_quantity(uuid, uuid, integer, text, uuid) FROM PUBLIC, anon, authenticated, service_role;

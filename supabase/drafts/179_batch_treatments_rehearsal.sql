-- ════════════════════════════════════════════════════════════════════════════════════════════════════════════
-- 179 — RÉPÉTITION TRANSACTIONNELLE en production — BROUILLON, À N'EXÉCUTER QUE SUR INSTRUCTION EXPLICITE
-- ════════════════════════════════════════════════════════════════════════════════════════════════════════════
-- UN SEUL bloc DO : la migration 179 (texte EXACT du brouillon, inséré entre les deux repères ci-dessous) puis
-- les contrôles, sur des objets TEST de Boutique Alpha uniquement. Le bloc se termine TOUJOURS par une erreur :
--   • tout s'est passé comme prévu → « EXPECTED_ROLLBACK: 179 rehearsal PASS | … » ;
--   • premier invariant inattendu → arrêt immédiat « REHEARSAL_FAIL: … » (aucun test suivant n'est exécuté) ;
--   • contrôle préalable non satisfait → « PRECHECK_FAIL … » (rien n'a été modifié).
-- Dans les trois cas PostgreSQL annule TOUT (même si le client découpait les requêtes : un seul bloc). Rien ne
-- peut être validé : ni la migration, ni les données de test, ni les compteurs de numéros de vente.
--
-- Données : objets nommés « TEST 179 RH … » (produits, fournisseur, une boutique TEST supprimée pendant le test),
-- identifiants de requête « TEST-179-RH-… ». Aucune suppression large : chaque suppression vise un identifiant
-- créé par ce script. L'historique des traitements est immuable par construction : il n'est pas « nettoyé » à
-- la main, c'est l'annulation finale qui le retire (avec tout le reste).
--
-- STORAGE — différence importante : l'espace de stockage (fichiers) n'est PAS transactionnel. Ce script ne crée
-- AUCUN fichier réel et n'appelle jamais l'API Storage. La seule chose écrite côté stockage est UNE ligne de base
-- de données dans storage.objects (sans fichier derrière) pour contrôler la garde « fichier encore stocké » ;
-- elle est supprimée explicitement par son identifiant pendant le test (storage.allow_delete_query, transaction
-- seulement), puis l'annulation finale efface aussi l'espace « batch-treatment-photos » créé par la migration.
-- Aucun fichier orphelin ne peut en résulter.
--
-- Prévu pour l'éditeur SQL Supabase (rôle postgres). Durée attendue : quelques secondes. lock_timeout 3 s sur les
-- verrous structurels (sinon abandon propre), statement_timeout 60 s.
SET statement_timeout = '60s';
DO $rh$
DECLARE
  r_alpha   constant uuid := 'a0000000-0000-0000-0000-000000000001';
  r_tag     constant text := 'TEST 179 RH';
  r_t0      timestamptz := clock_timestamp();
  r_t_lock  timestamptz; r_t_mig timestamptz; r_t_end timestamptz;
  r_today   date; r_cashier uuid; r_sup uuid; r_shop uuid;
  r_alpha_before text; r_alpha_after text; r_glob_before text; r_glob_after text; r_md5 text;
  r_objects_before bigint; r_counter_before bigint; r_n int; r_n2 int; r_e text; r_j jsonb; r_s jsonb; r_tr uuid; r_tr2 uuid;
  r_pe uuid; r_le uuid; r_lns uuid; r_lf uuid; r_po uuid; r_lo_exp uuid; r_lo_fresh uuid; r_sale uuid; r_ps uuid; r_ls uuid; r_obj uuid;
  r_rev timestamptz; r_mv int;
BEGIN
  -- ── Contrôles préalables (rien n'est encore modifié) ──
  IF current_setting('statement_timeout') <> '1min' AND current_setting('statement_timeout') <> '60s' THEN
    RAISE EXCEPTION 'PRECHECK_FAIL statement_timeout = %', current_setting('statement_timeout');
  END IF;
  IF to_regclass('public.batch_treatments') IS NOT NULL OR to_regclass('public.batch_treatment_photos') IS NOT NULL
     OR EXISTS (SELECT 1 FROM pg_proc WHERE pronamespace = 'public'::regnamespace
                AND proname IN ('treat_batch', 'resolve_unallocated', 'register_batch_treatment_photo', 'unallocated_candidates', 'delete_shops'))
     OR EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'stock_movements' AND column_name IN ('batch_id', 'batch_treatment_id'))
     OR EXISTS (SELECT 1 FROM storage.buckets WHERE id = 'batch-treatment-photos') THEN
    RAISE EXCEPTION 'PRECHECK_FAIL 179 deja (partiellement) presente';
  END IF;
  IF (SELECT confdeltype::text || condeferrable::text FROM pg_constraint WHERE conname = 'sale_item_batches_batch_id_fkey') IS DISTINCT FROM 'nfalse' THEN
    RAISE EXCEPTION 'PRECHECK_FAIL cle sale_item_batches_batch_id_fkey inattendue (attendu SET NULL non differable)';
  END IF;
  IF (SELECT md5(replace(prosrc, E'\r', '')) FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname = 'delete_product_batch')
     IS DISTINCT FROM '8ad155aae3901f1125b1ace5e138a0dd' THEN
    RAISE EXCEPTION 'PRECHECK_FAIL delete_product_batch differente de la 117';
  END IF;
  IF NOT has_function_privilege('service_role', 'public.adjust_batch_quantity(uuid,uuid,integer,text,uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'PRECHECK_FAIL adjust_batch_quantity deja retiree au serveur';
  END IF;
  IF (SELECT name FROM shops WHERE id = r_alpha) IS DISTINCT FROM 'Boutique Alpha' THEN
    RAISE EXCEPTION 'PRECHECK_FAIL cible Alpha inattendue';
  END IF;
  IF EXISTS (SELECT 1 FROM products WHERE name LIKE r_tag || '%') OR EXISTS (SELECT 1 FROM shops WHERE name LIKE r_tag || '%')
     OR EXISTS (SELECT 1 FROM suppliers WHERE name LIKE r_tag || '%') OR EXISTS (SELECT 1 FROM sales WHERE client_request_id LIKE 'TEST-179-RH-%') THEN
    RAISE EXCEPTION 'PRECHECK_FAIL objets TEST 179 RH deja presents (references non uniques)';
  END IF;
  SELECT user_id INTO r_cashier FROM shop_members WHERE shop_id = r_alpha AND role = 'owner' AND is_active ORDER BY user_id LIMIT 1;
  IF r_cashier IS NULL THEN RAISE EXCEPTION 'PRECHECK_FAIL proprietaire Alpha introuvable'; END IF;

  -- Empreintes AVANT (comparées à la fin) : Alpha hors objets TEST, volumes globaux, fichiers, compteur de ventes
  SELECT md5(coalesce((SELECT string_agg(id::text || ':' || quantity || ':' || is_active, ',' ORDER BY id) FROM products WHERE shop_id = r_alpha), '')
          || coalesce((SELECT string_agg(id::text || ':' || quantity || ':' || coalesce(expiry_date::text, ''), ',' ORDER BY id) FROM product_batches WHERE shop_id = r_alpha), '')
          || coalesce((SELECT string_agg(id::text || ':' || coalesce(review_reason, '') || ':' || coalesce(reviewed_at::text, ''), ',' ORDER BY id) FROM sales WHERE shop_id = r_alpha), ''))
    INTO r_alpha_before;
  SELECT format('shops %s | sales %s | sale_items %s | allocations %s | lots %s | produits %s | mouvements %s',
                (SELECT count(*) FROM shops), (SELECT count(*) FROM sales), (SELECT count(*) FROM sale_items), (SELECT count(*) FROM sale_item_batches),
                (SELECT count(*) FROM product_batches), (SELECT count(*) FROM products), (SELECT count(*) FROM stock_movements)) INTO r_glob_before;
  r_objects_before := (SELECT count(*) FROM storage.objects);
  r_n2 := (SELECT count(*) FROM pg_constraint WHERE contype = 'f' AND connamespace = 'public'::regnamespace AND condeferrable);
  r_counter_before := (SELECT counter FROM shop_sale_counters WHERE shop_id = r_alpha);

  -- ── Verrous structurels pris EN PREMIER (3 s d'attente maximum, sinon abandon propre) ──
  PERFORM set_config('lock_timeout', '3s', true);
  LOCK TABLE public.product_batches IN ACCESS EXCLUSIVE MODE;
  LOCK TABLE public.sale_item_batches IN ACCESS EXCLUSIVE MODE;
  LOCK TABLE public.stock_movements IN ACCESS EXCLUSIVE MODE;
  r_t_lock := clock_timestamp();

  -- ════════════ MIGRATION 179 (brouillon, texte inséré tel quel) ════════════
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
-- par l'administration, inscription annulée) reste possible — tout part en cascade dans la même instruction
-- (traitements, mouvements et lots dépendent directement de la boutique : ils partent au même niveau de
-- cascade, avant le contrôle de ces clés). Seule l'allocation vente ↔ lot demande delete_shops (section 3).
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
-- possible la modification / suppression d'une vente (lignes et allocations en cascade) ; un produit vendu est
-- archivé par l'application (D5), jamais supprimé.
-- DEFERRABLE INITIALLY IMMEDIATE : contrôle IMMÉDIAT en fonctionnement normal (comme sans DEFERRABLE). Lors de
-- la suppression d'une boutique entière, les allocations sont trois niveaux de cascade plus bas que les lots
-- (boutique → vente → ligne → allocation) : un contrôle immédiat les trouve encore et refuse. delete_shops
-- (section 9 bis) diffère CETTE SEULE clé le temps du DELETE, puis rétablit le contrôle immédiat avant de
-- rendre la main — lots et allocations partent ensemble, aucune allocation n'est jamais vidée.
ALTER TABLE public.sale_item_batches DROP CONSTRAINT sale_item_batches_batch_id_fkey;
ALTER TABLE public.sale_item_batches ADD CONSTRAINT sale_item_batches_batch_id_fkey
  FOREIGN KEY (batch_id) REFERENCES public.product_batches(id) ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE;

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
     AND (CASE p_action
           WHEN 'quantity_adjustment' THEN v_prev.lot_qty_after = p_new_quantity AND v_prev.reason_code = p_reason_code
           WHEN 'date_correction' THEN v_prev.new_expiry_date IS NOT DISTINCT FROM p_new_expiry_date
           ELSE v_prev.quantity = p_quantity END) THEN
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
       AND (CASE p_action
             WHEN 'quantity_adjustment' THEN v_prev.lot_qty_after = p_new_quantity AND v_prev.reason_code = p_reason_code
             WHEN 'date_correction' THEN v_prev.new_expiry_date IS NOT DISTINCT FROM p_new_expiry_date
             ELSE v_prev.quantity = p_quantity END) THEN
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

-- ── 9 bis. Suppression définitive de boutiques entières ──────────────────────────────────────────────────────
-- Seul chemin de l'application pour supprimer une boutique (administration, inscription annulée). Diffère
-- UNIQUEMENT la clé allocation → lot pendant le DELETE (jamais SET CONSTRAINTS ALL), puis la rétablit en
-- contrôle immédiat : une violation éventuelle est refusée ICI, dans l'appel, pas au COMMIT, et rien ne reste
-- différé ensuite. Les autres gardes s'appliquent normalement (fichiers photo encore stockés → P0049).
-- Les fichiers de l'espace de stockage sont supprimés AVANT par l'application (purgeTreatmentPhotos).
-- ORDRE DE MISE EN LIGNE : l'application (lib/api/delete-shops.ts, qui appelle cette fonction) AVANT cette
-- migration — après elle, un DELETE direct d'une boutique ayant vendu des lots est refusé (23503).
-- L'autorisation (super_admin, boutique désactivée d'abord, boutiques du propriétaire) reste vérifiée par les
-- routes, comme pour les autres fonctions réservées au serveur.
CREATE OR REPLACE FUNCTION public.delete_shops(p_shop_ids uuid[])
RETURNS integer
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE v_n integer;
BEGIN
  SET CONSTRAINTS public.sale_item_batches_batch_id_fkey DEFERRED;
  DELETE FROM public.shops WHERE id = ANY (coalesce(p_shop_ids, '{}'));
  GET DIAGNOSTICS v_n = ROW_COUNT;
  SET CONSTRAINTS public.sale_item_batches_batch_id_fkey IMMEDIATE;
  RETURN v_n;
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
REVOKE EXECUTE ON FUNCTION public.delete_shops(uuid[])                                                       FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.delete_shops(uuid[])                                                       TO service_role;
GRANT  EXECUTE ON FUNCTION public.treat_batch(uuid, uuid, text, int, int, date, text, text, text, uuid, uuid) TO service_role;
GRANT  EXECUTE ON FUNCTION public.resolve_unallocated(uuid, uuid, uuid, uuid, int, text, text, uuid)         TO service_role;
GRANT  EXECUTE ON FUNCTION public.register_batch_treatment_photo(uuid, uuid, text, text, int, uuid)          TO service_role;
GRANT  EXECUTE ON FUNCTION public.unallocated_candidates(uuid)                                               TO service_role;
GRANT  EXECUTE ON FUNCTION public.delete_product_batch(uuid, uuid, text, uuid)                               TO service_role;
-- Un seul chemin métier pour corriger la quantité d'un lot : l'ancienne fonction n'est plus exécutable par le
-- serveur (la route /api/product-batches/adjust appelle treat_batch dès que la 179 est présente).
REVOKE EXECUTE ON FUNCTION public.adjust_batch_quantity(uuid, uuid, integer, text, uuid) FROM PUBLIC, anon, authenticated, service_role;
  -- ════════════ FIN DE LA MIGRATION 179 ════════════
  r_t_mig := clock_timestamp();
  PERFORM set_config('lock_timeout', '3s', true);

  -- ── Outils de test (pg_temp : annulés avec tout le reste) ──
  -- rh_ok : ARRÊT au premier invariant inattendu (l'erreur annule toute la transaction)
  PERFORM set_config('rh.pass', '0', true);
  PERFORM set_config('rh.cashier', r_cashier::text, true);
  CREATE FUNCTION pg_temp.rh_ok(c boolean, m text) RETURNS void LANGUAGE plpgsql AS $f$
  BEGIN
    IF NOT coalesce(c, false) THEN
      RAISE EXCEPTION 'REHEARSAL_FAIL: % (apres % controles reussis)', m, current_setting('rh.pass');
    END IF;
    PERFORM set_config('rh.pass', (current_setting('rh.pass')::int + 1)::text, true);
  END $f$;
  -- rh_try : exécute une instruction ; renvoie 'ok' ou le code d'erreur (l'instruction échouée est annulée)
  CREATE FUNCTION pg_temp.rh_try(q text) RETURNS text LANGUAGE plpgsql AS $f$
  BEGIN EXECUTE q; RETURN 'ok'; EXCEPTION WHEN others THEN RETURN SQLSTATE; END $f$;
  CREATE FUNCTION pg_temp.rh_tb(p_shop uuid, b uuid, a text, q int, nq int, d date, r text, note text, rid text) RETURNS jsonb LANGUAGE sql AS $f$
    SELECT treat_batch(p_shop, b, a, q, nq, d, r, note, 'TEST-179-RH-' || rid, current_setting('rh.cashier')::uuid, NULL)
  $f$;
  CREATE FUNCTION pg_temp.rh_tbe(p_shop uuid, b uuid, a text, q int, nq int, d date, r text, note text, rid text) RETURNS text LANGUAGE plpgsql AS $f$
  BEGIN PERFORM pg_temp.rh_tb(p_shop, b, a, q, nq, d, r, note, rid); RETURN 'ok'; EXCEPTION WHEN others THEN RETURN SQLSTATE; END $f$;
  CREATE FUNCTION pg_temp.rh_q(p uuid) RETURNS int LANGUAGE sql AS $f$ SELECT quantity FROM products WHERE id = p $f$;
  CREATE FUNCTION pg_temp.rh_lq(b uuid) RETURNS int LANGUAGE sql AS $f$ SELECT quantity FROM product_batches WHERE id = b $f$;
  CREATE FUNCTION pg_temp.rh_mv(p uuid) RETURNS int LANGUAGE sql AS $f$ SELECT count(*)::int FROM stock_movements WHERE product_id = p $f$;
  CREATE FUNCTION pg_temp.rh_sell(p_shop uuid, p_pid uuid, p_qty int, p_off timestamptz, p_rid text) RETURNS jsonb LANGUAGE plpgsql AS $f$
  DECLARE v jsonb; v_detail text;
  BEGIN
    -- complete_sale active « stockshop.stock_mode = offline » jusqu'à la FIN de la transaction quand p_created_at est
    -- fourni (jamais remis à zéro) : remis à vide avant et après chaque vente, sinon une vente en ligne suivante
    -- serait traitée comme hors ligne
    PERFORM set_config('stockshop.stock_mode', '', true);
    BEGIN
      v := complete_sale(p_shop_id => p_shop, p_cashier_id => current_setting('rh.cashier')::uuid,
        p_customer_id => NULL, p_customer_name => NULL, p_customer_phone => NULL, p_subtotal => p_qty * 100, p_discount => 0, p_tax => 0,
        p_total => p_qty * 100, p_payment_method => 'cash', p_notes => 'TEST 179 RH', p_paystack_reference => NULL,
        p_client_request_id => 'TEST-179-RH-' || p_rid,
        p_items => jsonb_build_array(jsonb_build_object('product_id', p_pid, 'product_name', 'TEST 179 RH', 'quantity', p_qty, 'unit_price', 100, 'buying_price', 50)),
        p_payments => '[]'::jsonb, p_due_date => NULL, p_created_at => p_off, p_receipt_token => NULL, p_review_reason => NULL);
      -- set_sale_number impose lock_timeout = 8 s jusqu'à la fin de la transaction : niveau de la répétition rétabli
      PERFORM set_config('lock_timeout', '3s', true);
      PERFORM set_config('stockshop.stock_mode', '', true);
      RETURN jsonb_build_object('code', 'ok', 'sale_id', v->'sale'->>'id');
    EXCEPTION WHEN others THEN
      GET STACKED DIAGNOSTICS v_detail = PG_EXCEPTION_DETAIL;
      PERFORM set_config('lock_timeout', '3s', true);
      PERFORM set_config('stockshop.stock_mode', '', true);
      RETURN jsonb_build_object('code', SQLSTATE, 'detail', NULLIF(v_detail, ''));
    END;
  END $f$;

  -- ══ 1. Structure après migration ══
  PERFORM pg_temp.rh_ok(to_regclass('public.batch_treatments') IS NOT NULL AND to_regclass('public.batch_treatment_photos') IS NOT NULL
    AND (SELECT count(*) FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'stock_movements' AND column_name IN ('batch_id', 'batch_treatment_id')) = 2,
    '1 tables et colonnes 179 presentes');
  PERFORM pg_temp.rh_ok((SELECT confdeltype = 'a' AND condeferrable AND NOT condeferred FROM pg_constraint WHERE conname = 'sale_item_batches_batch_id_fkey'),
    '1 allocation -> lot : NO ACTION DEFERRABLE INITIALLY IMMEDIATE');
  PERFORM pg_temp.rh_ok((SELECT count(*) FROM pg_constraint WHERE contype = 'f' AND connamespace = 'public'::regnamespace AND condeferrable) = r_n2 + 1
    AND (SELECT count(*) FROM pg_constraint WHERE contype = 'f' AND confdeltype = 'a' AND NOT condeferrable AND conname IN ('batch_treatments_batch_id_fkey',
         'batch_treatments_product_id_fkey', 'batch_treatments_corrects_treatment_id_fkey', 'stock_movements_batch_id_fkey', 'stock_movements_batch_treatment_id_fkey')) = 5,
    '1 seule cle differable ; les 5 autres NO ACTION non differables');
  PERFORM pg_temp.rh_ok(has_function_privilege('service_role', 'public.delete_shops(uuid[])', 'EXECUTE')
    AND NOT has_function_privilege('authenticated', 'public.delete_shops(uuid[])', 'EXECUTE') AND NOT has_function_privilege('anon', 'public.delete_shops(uuid[])', 'EXECUTE')
    AND has_function_privilege('service_role', 'public.treat_batch(uuid,uuid,text,int,int,date,text,text,text,uuid,uuid)', 'EXECUTE')
    AND NOT has_function_privilege('authenticated', 'public.treat_batch(uuid,uuid,text,int,int,date,text,text,text,uuid,uuid)', 'EXECUTE')
    AND NOT has_function_privilege('anon', 'public.resolve_unallocated(uuid,uuid,uuid,uuid,int,text,text,uuid)', 'EXECUTE')
    AND NOT has_function_privilege('service_role', 'public.adjust_batch_quantity(uuid,uuid,integer,text,uuid)', 'EXECUTE'),
    '1 droits : fonctions 179 serveur uniquement, adjust_batch_quantity retiree au serveur');
  PERFORM pg_temp.rh_ok(NOT has_table_privilege('authenticated', 'public.batch_treatments', 'SELECT') AND NOT has_table_privilege('anon', 'public.batch_treatment_photos', 'SELECT')
    AND has_table_privilege('service_role', 'public.batch_treatments', 'SELECT') AND NOT has_table_privilege('service_role', 'public.batch_treatments', 'INSERT')
    AND (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.batch_treatments'::regclass), '1 tables : lecture serveur seulement, RLS active');
  PERFORM pg_temp.rh_ok((SELECT NOT public AND file_size_limit = 2097152 FROM storage.buckets WHERE id = 'batch-treatment-photos'), '1 espace de stockage prive, 2 Mo');
  PERFORM pg_temp.rh_ok((SELECT count(*) FROM batch_treatments) = 0 AND (SELECT count(*) FROM stock_movements WHERE batch_id IS NOT NULL OR batch_treatment_id IS NOT NULL) = 0,
    '1 aucun remplissage : 0 traitement, 0 mouvement lie');
  SELECT string_agg(proname || '=' || left(md5(replace(prosrc, E'\r', '')), 8), ' ' ORDER BY proname) INTO r_md5
    FROM pg_proc WHERE pronamespace = 'public'::regnamespace
     AND proname IN ('treat_batch', 'resolve_unallocated', 'register_batch_treatment_photo', 'unallocated_candidates', 'remove_review_reason',
                     'delete_shops', 'delete_product_batch', 'batch_history_immutable', 'batch_treatment_photos_immutable');

  -- ══ 2. Traitements sur des objets TEST d'Alpha ══
  r_today := shop_business_date(r_alpha, now());
  INSERT INTO suppliers (shop_id, name) VALUES (r_alpha, r_tag || ' fournisseur') RETURNING id INTO r_sup;
  INSERT INTO products (shop_id, name, quantity, selling_price, buying_price, is_active, unit)
    VALUES (r_alpha, r_tag || ' traitements', 15, 100, 50, true, 'piece') RETURNING id INTO r_pe;
  INSERT INTO product_batches (shop_id, product_id, supplier_id, quantity, initial_quantity, expiry_date, source, received_at, created_at)
    VALUES (r_alpha, r_pe, r_sup, 10, 10, r_today - 5, 'adjustment', now() - interval '10 days', now() - interval '10 days') RETURNING id INTO r_le;
  INSERT INTO product_batches (shop_id, product_id, quantity, initial_quantity, expiry_date, source, received_at, created_at)
    VALUES (r_alpha, r_pe, 2, 2, r_today - 5, 'adjustment', now() - interval '10 days', now() - interval '10 days') RETURNING id INTO r_lns;
  INSERT INTO product_batches (shop_id, product_id, quantity, initial_quantity, expiry_date, source, received_at, created_at)
    VALUES (r_alpha, r_pe, 3, 3, r_today + 30, 'adjustment', now() - interval '10 days', now() - interval '10 days') RETURNING id INTO r_lf;

  r_j := pg_temp.rh_tb(r_alpha, r_le, 'dispose', 3, NULL, NULL, NULL, NULL, 'dispose-1');
  r_tr := (r_j->>'treatment_id')::uuid;
  PERFORM pg_temp.rh_ok(NOT (r_j->>'already')::boolean AND pg_temp.rh_lq(r_le) = 7 AND pg_temp.rh_q(r_pe) = 12, '2 destruction 3 : lot 10 -> 7, produit 15 -> 12');
  PERFORM pg_temp.rh_ok((SELECT count(*) FROM stock_movements WHERE product_id = r_pe AND type = 'out' AND quantity = 3 AND previous_qty = 15 AND new_qty = 12
    AND batch_id = r_le AND batch_treatment_id = r_tr) = 1 AND pg_temp.rh_mv(r_pe) = 1, '2 exactement un mouvement, lie au lot et au traitement');
  r_j := pg_temp.rh_tb(r_alpha, r_le, 'dispose', 3, NULL, NULL, NULL, NULL, 'dispose-1');
  PERFORM pg_temp.rh_ok((r_j->>'already')::boolean AND (r_j->>'treatment_id')::uuid = r_tr AND pg_temp.rh_lq(r_le) = 7 AND pg_temp.rh_mv(r_pe) = 1,
    '2 meme demande rejouee : meme evenement, rien deduit deux fois');
  PERFORM pg_temp.rh_ok(pg_temp.rh_tbe(r_alpha, r_le, 'dispose', 2, NULL, NULL, NULL, NULL, 'dispose-1') = 'P0041', '2 meme identifiant, autre quantite -> P0041');
  r_j := pg_temp.rh_tb(r_alpha, r_le, 'supplier_return', 2, NULL, NULL, NULL, NULL, 'return-1');
  PERFORM pg_temp.rh_ok(pg_temp.rh_lq(r_le) = 5 AND pg_temp.rh_q(r_pe) = 10
    AND (SELECT supplier_name FROM batch_treatments WHERE id = (r_j->>'treatment_id')::uuid) = r_tag || ' fournisseur', '2 retour fournisseur 2 : lot 5, produit 10, fournisseur copie');
  PERFORM pg_temp.rh_ok(pg_temp.rh_tbe(r_alpha, r_lns, 'supplier_return', 1, NULL, NULL, NULL, NULL, 'return-nosup') = 'P0042', '2 retour sans fournisseur du lot -> P0042');
  PERFORM pg_temp.rh_ok(pg_temp.rh_tbe(r_alpha, r_lf, 'dispose', 1, NULL, NULL, NULL, NULL, 'dispose-fresh') = 'P0044', '2 destruction d''un lot non perime -> P0044');
  PERFORM pg_temp.rh_ok(pg_temp.rh_tbe(r_alpha, r_le, 'quantity_adjustment', NULL, 4, NULL, NULL, NULL, 'adj-noreason') = 'P0046'
    AND pg_temp.rh_tbe(r_alpha, r_le, 'quantity_adjustment', NULL, 4, NULL, 'other', NULL, 'adj-other') = 'P0046', '2 ajustement sans motif / « other » sans note -> P0046');
  r_j := pg_temp.rh_tb(r_alpha, r_le, 'quantity_adjustment', NULL, 4, NULL, 'damage', NULL, 'adj-1');
  PERFORM pg_temp.rh_ok(pg_temp.rh_lq(r_le) = 4 AND pg_temp.rh_q(r_pe) = 9
    AND (SELECT count(*) FROM stock_movements WHERE product_id = r_pe AND type = 'adjustment' AND quantity = -1 AND batch_id = r_le) = 1, '2 ajustement 5 -> 4 (dommage) : produit 9, mouvement -1');
  PERFORM pg_temp.rh_ok(pg_temp.rh_tbe(r_alpha, r_lf, 'date_correction', NULL, NULL, r_today + 60, NULL, NULL, 'date-nonote') = 'P0046'
    AND pg_temp.rh_tbe(r_alpha, r_lf, 'date_correction', NULL, NULL, r_today + 30, NULL, 'meme date', 'date-same') = 'P0043', '2 correction de date sans note -> P0046, meme date -> P0043');
  r_mv := pg_temp.rh_mv(r_pe);
  r_j := pg_temp.rh_tb(r_alpha, r_lf, 'date_correction', NULL, NULL, r_today + 60, NULL, 'etiquette relue', 'date-1');
  PERFORM pg_temp.rh_ok((SELECT expiry_date FROM product_batches WHERE id = r_lf) = r_today + 60 AND pg_temp.rh_lq(r_lf) = 3 AND pg_temp.rh_q(r_pe) = 9
    AND pg_temp.rh_mv(r_pe) = r_mv, '2 correction de date : quantites inchangees, aucun mouvement');
  PERFORM pg_temp.rh_ok(pg_temp.rh_try(format('UPDATE product_batches SET expiry_date = %L WHERE id = %L', r_today + 90, r_lf)) = 'P0045', '2 date modifiee hors treat_batch -> P0045');
  PERFORM pg_temp.rh_ok(pg_temp.rh_try(format('UPDATE batch_treatments SET note = %L WHERE id = %L', 'x', r_tr)) = '42501'
    AND pg_temp.rh_try(format('DELETE FROM batch_treatments WHERE id = %L', r_tr)) = '42501', '2 historique immuable : modification et suppression refusees (42501)');
  PERFORM pg_temp.rh_ok(pg_temp.rh_try(format('SELECT delete_product_batch(%L, %L, %L, %L)', r_le, r_alpha, 'correction', r_cashier)) = 'P0001'
    AND pg_temp.rh_try(format('DELETE FROM product_batches WHERE id = %L', r_le)) = '23503'
    AND pg_temp.rh_try(format('DELETE FROM products WHERE id = %L', r_pe)) = '23503', '2 lot / produit avec historique : suppression refusee (la route archive)');

  -- ══ 3. Vente hors ligne non attribuée : D2 puis résolution (aucune double déduction) ══
  INSERT INTO products (shop_id, name, quantity, selling_price, buying_price, is_active, unit)
    VALUES (r_alpha, r_tag || ' hors ligne', 13, 100, 50, true, 'piece') RETURNING id INTO r_po;
  INSERT INTO product_batches (shop_id, product_id, quantity, initial_quantity, expiry_date, source, received_at, created_at)
    VALUES (r_alpha, r_po, 10, 10, r_today - 5, 'adjustment', now() - interval '10 days', now() - interval '10 days') RETURNING id INTO r_lo_exp;
  INSERT INTO product_batches (shop_id, product_id, quantity, initial_quantity, expiry_date, source, received_at, created_at)
    VALUES (r_alpha, r_po, 3, 3, r_today + 30, 'adjustment', now() - interval '9 days', now() - interval '9 days') RETURNING id INTO r_lo_fresh;
  r_s := pg_temp.rh_sell(r_alpha, r_po, 5, now(), 'off-1');
  r_sale := (r_s->>'sale_id')::uuid;
  PERFORM pg_temp.rh_ok(r_s->>'code' = 'ok' AND pg_temp.rh_q(r_po) = 8 AND pg_temp.rh_lq(r_lo_fresh) = 0 AND pg_temp.rh_lq(r_lo_exp) = 10
    AND (SELECT sum(batch_unallocated) FROM sale_items WHERE sale_id = r_sale) = 2
    AND (SELECT review_reason FROM sales WHERE id = r_sale) LIKE '%expired_stock_unresolved%', '3 vente hors ligne 5 : produit 8, lot frais 0, perime 10, non attribue 2 ' || coalesce(r_s->>'code', ''));
  r_rev := (SELECT reviewed_at FROM sales WHERE id = r_sale);
  PERFORM pg_temp.rh_ok(pg_temp.rh_tbe(r_alpha, r_lo_exp, 'dispose', 1, NULL, NULL, NULL, NULL, 'd2-dispose') = 'P0040'
    AND pg_temp.rh_tbe(r_alpha, r_lo_exp, 'quantity_adjustment', NULL, 9, NULL, 'loss', NULL, 'd2-adjm') = 'P0040', '3 D2 lot candidat : destruction et ajustement negatif -> P0040');
  r_j := pg_temp.rh_tb(r_alpha, r_lo_exp, 'quantity_adjustment', NULL, 11, NULL, 'counting_error', NULL, 'd2-adjp');
  PERFORM pg_temp.rh_ok(pg_temp.rh_lq(r_lo_exp) = 11 AND pg_temp.rh_q(r_po) = 9, '3 D2 ajustement positif autorise : lot 11, produit 9');
  r_mv := pg_temp.rh_mv(r_po);
  r_j := resolve_unallocated(r_alpha, r_sale, r_po, r_lo_exp, 2, 'TEST 179 RH resolution', 'TEST-179-RH-resolve-1', r_cashier);
  PERFORM pg_temp.rh_ok(pg_temp.rh_lq(r_lo_exp) = 9 AND pg_temp.rh_q(r_po) = 9 AND pg_temp.rh_mv(r_po) = r_mv
    AND (SELECT sum(batch_unallocated) FROM sale_items WHERE sale_id = r_sale) = 0
    AND (SELECT sum(sib.quantity) FROM sale_item_batches sib JOIN sale_items si ON si.id = sib.sale_item_id WHERE si.sale_id = r_sale AND sib.batch_id = r_lo_exp) = 2,
    '3 resolution 2 : lot -2, PRODUIT INCHANGE, aucun mouvement, allocation +2, non attribue 0');
  PERFORM pg_temp.rh_ok(coalesce((SELECT review_reason FROM sales WHERE id = r_sale), '') NOT LIKE '%expired_stock_unresolved%'
    AND (SELECT reviewed_at FROM sales WHERE id = r_sale) IS NOT DISTINCT FROM r_rev, '3 D1 motif expired_stock_unresolved retire, reviewed_at inchange');
  r_j := resolve_unallocated(r_alpha, r_sale, r_po, r_lo_exp, 2, 'TEST 179 RH resolution', 'TEST-179-RH-resolve-1', r_cashier);
  PERFORM pg_temp.rh_ok((r_j->>'already')::boolean AND pg_temp.rh_lq(r_lo_exp) = 9, '3 resolution rejouee : rien deux fois');
  PERFORM pg_temp.rh_ok(pg_temp.rh_try(format('SELECT resolve_unallocated(%L, %L, %L, %L, 1, %L, %L, %L)', r_alpha, r_sale, r_po, r_lo_exp, 'x', 'TEST-179-RH-resolve-2', r_cashier)) = 'P0048',
    '3 plus rien a attribuer -> P0048');
  r_j := pg_temp.rh_tb(r_alpha, r_lo_exp, 'dispose', 1, NULL, NULL, NULL, NULL, 'd2-after');
  PERFORM pg_temp.rh_ok(pg_temp.rh_lq(r_lo_exp) = 8 AND pg_temp.rh_q(r_po) = 8, '3 apres resolution : destruction de nouveau possible');

  -- ══ 4. Clé allocation → lot : contrôle immédiat, report sans effet sur un lot vendu ══
  PERFORM pg_temp.rh_ok(pg_temp.rh_try(format('DELETE FROM product_batches WHERE id = %L', r_lo_fresh)) = '23503', '4 lot vendu supprime directement -> 23503 immediat');
  BEGIN
    SET CONSTRAINTS public.sale_item_batches_batch_id_fkey DEFERRED;
    DELETE FROM product_batches WHERE id = r_lo_fresh;
    SET CONSTRAINTS public.sale_item_batches_batch_id_fkey IMMEDIATE;
    r_e := 'ok';
  EXCEPTION WHEN others THEN r_e := SQLSTATE; END;
  SET CONSTRAINTS public.sale_item_batches_batch_id_fkey IMMEDIATE;
  PERFORM pg_temp.rh_ok(r_e = '23503' AND pg_temp.rh_lq(r_lo_fresh) = 0
    AND (SELECT count(*) FROM sale_item_batches WHERE batch_id = r_lo_fresh) >= 1, '4 lot vendu supprime sous report -> refuse au retour IMMEDIATE, lot et allocation intacts');

  -- ══ 5. Photos : partie base de données uniquement (aucun fichier réel) ══
  PERFORM pg_temp.rh_ok(pg_temp.rh_try(format('SELECT register_batch_treatment_photo(%L, %L, %L, %L, 1000, %L)', r_alpha, r_tr,
      r_alpha || '/' || r_le || '/' || r_tr || '/p1.jpg', 'image/jpeg', r_cashier)) = 'ok', '5 photo enregistree par l''auteur du traitement');
  PERFORM pg_temp.rh_ok(pg_temp.rh_try(format('SELECT register_batch_treatment_photo(%L, %L, %L, %L, 1000, %L)', r_alpha, r_tr,
      r_alpha || '/' || r_le || '/' || r_tr || '/p2.jpg', 'image/jpeg', gen_random_uuid())) = 'P0047'
    AND pg_temp.rh_try(format('SELECT register_batch_treatment_photo(%L, %L, %L, %L, 1000, %L)', r_alpha, r_tr,
      r_alpha || '/autre/' || r_tr || '/p3.jpg', 'image/jpeg', r_cashier)) = 'P0047', '5 autre auteur / chemin hors du lot -> P0047');
  PERFORM pg_temp.rh_ok(pg_temp.rh_try('UPDATE batch_treatment_photos SET size_bytes = 1 WHERE treatment_id = ''' || r_tr || '''') = '42501', '5 photo immuable');

  -- ══ 6. Suppression complète d'une boutique TEST par delete_shops ══
  INSERT INTO shops (name, owner_id, country, currency, city, state) VALUES (r_tag || ' boutique', r_cashier, 'CM', 'XAF', 'TEST', 'TEST') RETURNING id INTO r_shop;
  INSERT INTO products (shop_id, name, quantity, selling_price, buying_price, is_active, unit)
    VALUES (r_shop, r_tag || ' boutique produit', 5, 100, 50, true, 'piece') RETURNING id INTO r_ps;
  INSERT INTO product_batches (shop_id, product_id, quantity, initial_quantity, source) VALUES (r_shop, r_ps, 5, 5, 'adjustment') RETURNING id INTO r_ls;
  r_s := pg_temp.rh_sell(r_shop, r_ps, 1, NULL, 'shop-sale-1');
  PERFORM pg_temp.rh_ok(r_s->>'code' = 'ok' AND (SELECT count(*) FROM sale_item_batches WHERE batch_id = r_ls) = 1, '6 boutique TEST : vente en ligne allouee au lot ' || coalesce(r_s->>'code', ''));
  r_j := pg_temp.rh_tb(r_shop, r_ls, 'quantity_adjustment', NULL, 5, NULL, 'counting_error', NULL, 'shop-adj-1');
  r_tr2 := (r_j->>'treatment_id')::uuid;
  PERFORM register_batch_treatment_photo(r_shop, r_tr2, r_shop || '/' || r_ls || '/' || r_tr2 || '/p1.jpg', 'image/jpeg', 1000, r_cashier);
  -- Ligne storage.objects SANS fichier (aucun appel à l'API Storage) : contrôle de la garde « fichier encore stocké »
  INSERT INTO storage.objects (bucket_id, name) VALUES ('batch-treatment-photos', r_shop || '/' || r_ls || '/' || r_tr2 || '/p1.jpg') RETURNING id INTO r_obj;
  PERFORM pg_temp.rh_ok((SELECT count(*) FROM batch_treatments WHERE shop_id = r_shop) = 1 AND (SELECT count(*) FROM batch_treatment_photos WHERE shop_id = r_shop) = 1
    AND (SELECT count(*) FROM stock_movements WHERE shop_id = r_shop AND batch_id = r_ls) = 1, '6 boutique TEST : produit, lot, vente, allocation, traitement, mouvement, photo');
  PERFORM pg_temp.rh_ok(pg_temp.rh_try(format('SELECT delete_shops(ARRAY[%L]::uuid[])', r_shop)) = 'P0049'
    AND (SELECT count(*) FROM shops WHERE id = r_shop) = 1 AND (SELECT count(*) FROM batch_treatment_photos WHERE shop_id = r_shop) = 1,
    '6 fichier encore stocke -> delete_shops refusee (P0049), rien retire');
  PERFORM set_config('storage.allow_delete_query', 'true', true);
  DELETE FROM storage.objects WHERE id = r_obj;
  PERFORM set_config('storage.allow_delete_query', 'false', true);
  PERFORM pg_temp.rh_ok((SELECT count(*) FROM storage.objects) = r_objects_before, '6 ligne storage.objects retiree par son identifiant : volume identique a l''avant');
  PERFORM pg_temp.rh_ok(pg_temp.rh_try(format('DELETE FROM shops WHERE id = %L', r_shop)) = '23503' AND (SELECT count(*) FROM shops WHERE id = r_shop) = 1,
    '6 DELETE simple d''une boutique avec lot vendu -> refuse (23503)');
  -- Atomicité : une allocation incohérente (ligne de la vente TEST d'Alpha → lot de la boutique TEST) fait échouer
  -- le retour IMMEDIATE ; TOUTE la suppression doit être annulée
  INSERT INTO sale_item_batches (sale_item_id, batch_id, quantity)
    VALUES ((SELECT id FROM sale_items WHERE sale_id = r_sale LIMIT 1), r_ls, 1) RETURNING id INTO r_obj;
  PERFORM pg_temp.rh_ok(pg_temp.rh_try(format('SELECT delete_shops(ARRAY[%L]::uuid[])', r_shop)) = '23503'
    AND (SELECT count(*) FROM shops WHERE id = r_shop) = 1 AND (SELECT count(*) FROM products WHERE shop_id = r_shop) = 1
    AND (SELECT count(*) FROM product_batches WHERE shop_id = r_shop) = 1 AND (SELECT count(*) FROM sales WHERE shop_id = r_shop) = 1
    AND (SELECT count(*) FROM batch_treatments WHERE shop_id = r_shop) = 1 AND (SELECT count(*) FROM sale_item_batches WHERE batch_id = r_ls) = 2,
    '6 violation au retour IMMEDIATE -> delete_shops annulee ATOMIQUEMENT (boutique, produit, lot, vente, traitement, allocations intacts)');
  DELETE FROM sale_item_batches WHERE id = r_obj;
  PERFORM pg_temp.rh_ok(delete_shops(ARRAY[r_shop]) = 1, '6 delete_shops : boutique TEST supprimee');
  PERFORM pg_temp.rh_ok((SELECT count(*) FROM shops WHERE id = r_shop) = 0 AND (SELECT count(*) FROM products WHERE shop_id = r_shop) = 0
    AND (SELECT count(*) FROM product_batches WHERE shop_id = r_shop) = 0 AND (SELECT count(*) FROM sales WHERE shop_id = r_shop) = 0
    AND (SELECT count(*) FROM sale_item_batches WHERE batch_id = r_ls) = 0 AND (SELECT count(*) FROM batch_treatments WHERE shop_id = r_shop) = 0
    AND (SELECT count(*) FROM batch_treatment_photos WHERE shop_id = r_shop) = 0 AND (SELECT count(*) FROM stock_movements WHERE shop_id = r_shop) = 0,
    '6 aucun residu de la boutique TEST (8 tables)');
  PERFORM pg_temp.rh_ok(pg_temp.rh_try(format('DELETE FROM product_batches WHERE id = %L', r_lo_fresh)) = '23503', '6 apres delete_shops, meme transaction : controle de nouveau IMMEDIAT');

  -- ══ 7. Vérification finale : rien d'autre n'a bougé ══
  SELECT md5(coalesce((SELECT string_agg(id::text || ':' || quantity || ':' || is_active, ',' ORDER BY id) FROM products WHERE shop_id = r_alpha AND name NOT LIKE r_tag || '%'), '')
          || coalesce((SELECT string_agg(b.id::text || ':' || b.quantity || ':' || coalesce(b.expiry_date::text, ''), ',' ORDER BY b.id) FROM product_batches b
                        JOIN products p ON p.id = b.product_id WHERE b.shop_id = r_alpha AND p.name NOT LIKE r_tag || '%'), '')
          || coalesce((SELECT string_agg(id::text || ':' || coalesce(review_reason, '') || ':' || coalesce(reviewed_at::text, ''), ',' ORDER BY id) FROM sales
                        WHERE shop_id = r_alpha AND coalesce(client_request_id, '') NOT LIKE 'TEST-179-RH-%'), ''))
    INTO r_alpha_after;
  PERFORM pg_temp.rh_ok(r_alpha_after = r_alpha_before, '7 Alpha : produits, lots et ventes preexistants identiques');
  SELECT format('shops %s | sales %s | sale_items %s | allocations %s | lots %s | produits %s | mouvements %s',
                (SELECT count(*) FROM shops), (SELECT count(*) FROM sales WHERE coalesce(client_request_id, '') NOT LIKE 'TEST-179-RH-%'),
                (SELECT count(*) FROM sale_items si JOIN sales s ON s.id = si.sale_id WHERE coalesce(s.client_request_id, '') NOT LIKE 'TEST-179-RH-%'),
                (SELECT count(*) FROM sale_item_batches sib JOIN sale_items si ON si.id = sib.sale_item_id JOIN sales s ON s.id = si.sale_id
                   WHERE coalesce(s.client_request_id, '') NOT LIKE 'TEST-179-RH-%'),
                (SELECT count(*) FROM product_batches b JOIN products p ON p.id = b.product_id WHERE p.name NOT LIKE r_tag || '%'),
                (SELECT count(*) FROM products WHERE name NOT LIKE r_tag || '%'),
                (SELECT count(*) FROM stock_movements m WHERE m.product_id IS NULL OR m.product_id NOT IN (r_pe, r_po))) INTO r_glob_after;
  PERFORM pg_temp.rh_ok(r_glob_after = r_glob_before, '7 volumes hors objets TEST identiques : ' || r_glob_after);
  PERFORM pg_temp.rh_ok((SELECT count(*) FROM storage.objects) = r_objects_before, '7 storage.objects : aucune ligne ajoutee');

  r_t_end := clock_timestamp();
  RAISE EXCEPTION 'EXPECTED_ROLLBACK: 179 rehearsal PASS | controles % | durees : attente verrous % ms, migration % ms, tests % ms, total % ms | lock_timeout final % | avant : % | empreintes : %',
    current_setting('rh.pass'),
    round(extract(epoch FROM r_t_lock - r_t0) * 1000, 1), round(extract(epoch FROM r_t_mig - r_t_lock) * 1000, 1),
    round(extract(epoch FROM r_t_end - r_t_mig) * 1000, 1), round(extract(epoch FROM r_t_end - r_t0) * 1000, 1),
    current_setting('lock_timeout'), r_glob_before, r_md5;
END
$rh$;

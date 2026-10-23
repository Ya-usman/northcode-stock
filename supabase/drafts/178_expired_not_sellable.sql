-- ════════════════════════════════════════════════════════════════════════════════════════════════════════════
-- 178 — P0 : un lot PÉRIMÉ n'est plus vendable — BROUILLON FINAL, NON APPLIQUÉ (relecture finale demandée)
-- ════════════════════════════════════════════════════════════════════════════════════════════════════════════
-- Avant : le contrôle de vente comparait la quantité demandée au stock PHYSIQUE (périmés compris) et le FEFO
-- (deplete_product_batches) consommait les lots par date croissante SANS exclure les dates passées : un lot périmé
-- était vendu EN PREMIER, en ligne, hors ligne et à la modification d'une vente.
--
-- Règles validées (23 oct. 2026) :
--   • Fuseau : shops.timezone (IANA, obligatoire) est la SEULE source de la date métier d'une boutique.
--     country_default_time_zone(pays) ne sert qu'aux valeurs par défaut (création, remplissage initial) et renvoie
--     NULL pour un pays à plusieurs fuseaux (US, CA, CD, ES, PT) : jamais de déduction depuis le seul pays.
--   • Date métier = instant converti dans shops.timezone. Lot périmé ⇔ expiry_date < date métier
--     (expiry_date = date métier → encore vendable). Vente hors ligne : instant RÉEL de la vente (created_at).
--   • Stock vendable (référence unique, serveur / caisse / Stock), à une date métier :
--       fresh = Σ lots non périmés ; expired = Σ lots périmés ; untracked = max(physique − (fresh + expired), 0)
--       sellable = min(physique, fresh + untracked) ; non_sellable = physique − sellable
--     (robuste aux incohérences historiques produit ↔ lots ; le stock sans lot reste vendable).
--   • Réservations (172) : indicatives, jamais un refus serveur.
--   • Vente en ligne : P0001 si physique insuffisant (inchangé) ; P0030 si quantité > sellable, détail
--     {product_id, sellable, non_sellable, requested}.
--   • Vente hors ligne : jamais refusée pour du vendable insuffisant. Sortie réelle du stock produit (écart physique
--     → stock_shortfall, inchangé). Répartition de la quantité sortie : lots frais (FEFO) → stock historique sans lot
--     (aucune alerte) → reste = batch_unallocated (+ vente « à vérifier » expired_stock_unresolved). JAMAIS un lot
--     périmé décrémenté automatiquement.
--   • Trois notions distinctes par ligne vendue : stock_shortfall (physique insuffisant) ; part historique sans
--     lot (implicite) ; batch_unallocated (sortie impossible à attribuer à cause des périmés) ;
--     quantity = stock_shortfall + part sans lot + batch_unallocated + Σ allocations connues.
--   • Modification de vente : PAR ÉCART et par produit ; produit inchangé → rien ne bouge ; réduction : écart
--     physique → part sans lot → batch_unallocated → allocations connues rendues à LEUR lot (inverse du FEFO) ;
--     augmentation = NOUVELLE sortie, contrôlée à la date métier du moment de la modification ; jamais de
--     réallocation des unités déjà vendues.
--   • « Marquer vérifiée » (reviewed_at) ne touche ni review_reason ni batch_unallocated.
--   • L'ancienne deplete_product_batches reste pour l'inventaire (défaut suivi séparément).
-- Annulation (cancel_sale) et suppression (delete_sale) : INCHANGÉES — produit recrédité de la sortie réelle,
-- lots recrédités des SEULES allocations connues (sale_item_batches) : jamais la part sans lot ni batch_unallocated.
-- Codes d'erreur nouveaux : P0030 (vendable insuffisant), P0031 (fuseau invalide), P0032 (fuseau obligatoire)
-- — P0011 / P0012 sont déjà pris (fusion de clients, reprise de dette).
-- ════════════════════════════════════════════════════════════════════════════════════════════════════════════

-- ── 1. Fuseau horaire de la boutique ─────────────────────────────────────────────────────────────────────────

-- Zone IANA réelle uniquement : région géographique + présence dans la base de fuseaux de PostgreSQL.
-- Refuse « UTC+1 », « GMT+2 », « Etc/GMT-1 », abréviations et valeurs inventées.
CREATE OR REPLACE FUNCTION public.is_iana_time_zone(p_tz text) RETURNS boolean
LANGUAGE sql STABLE SET search_path = public, pg_catalog AS $$
  SELECT p_tz IS NOT NULL
     AND p_tz ~ '^(Africa|America|Asia|Atlantic|Australia|Europe|Indian|Pacific)/[A-Za-z0-9_+-]+(/[A-Za-z0-9_+-]+)?$'
     AND EXISTS (SELECT 1 FROM pg_timezone_names WHERE name = p_tz)
$$;

-- Valeur PAR DÉFAUT d'un pays à fuseau unique (création, remplissage initial) — jamais la source de vérité.
-- NULL pour un pays à plusieurs fuseaux ou inconnu : le fuseau doit alors venir de la localisation ou d'un choix.
-- Même table que lib/time/time-zones.ts (countryDefaultTimeZone) — test : tests/e2e/p0-expired-sellable.js
CREATE OR REPLACE FUNCTION public.country_default_time_zone(p_country text) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT CASE upper(coalesce(p_country, ''))
    WHEN 'AT' THEN 'Europe/Vienna'       WHEN 'BE' THEN 'Europe/Brussels'     WHEN 'BF' THEN 'Africa/Ouagadougou'
    WHEN 'BG' THEN 'Europe/Sofia'        WHEN 'BJ' THEN 'Africa/Porto-Novo'   WHEN 'CF' THEN 'Africa/Bangui'
    WHEN 'CG' THEN 'Africa/Brazzaville'  WHEN 'CI' THEN 'Africa/Abidjan'      WHEN 'CM' THEN 'Africa/Douala'
    WHEN 'CV' THEN 'Atlantic/Cape_Verde' WHEN 'CY' THEN 'Asia/Nicosia'        WHEN 'CZ' THEN 'Europe/Prague'
    WHEN 'DE' THEN 'Europe/Berlin'       WHEN 'DK' THEN 'Europe/Copenhagen'   WHEN 'EE' THEN 'Europe/Tallinn'
    WHEN 'FI' THEN 'Europe/Helsinki'     WHEN 'FR' THEN 'Europe/Paris'        WHEN 'GA' THEN 'Africa/Libreville'
    WHEN 'GB' THEN 'Europe/London'       WHEN 'GH' THEN 'Africa/Accra'        WHEN 'GM' THEN 'Africa/Banjul'
    WHEN 'GN' THEN 'Africa/Conakry'      WHEN 'GQ' THEN 'Africa/Malabo'       WHEN 'GR' THEN 'Europe/Athens'
    WHEN 'GW' THEN 'Africa/Bissau'       WHEN 'HR' THEN 'Europe/Zagreb'       WHEN 'HU' THEN 'Europe/Budapest'
    WHEN 'IE' THEN 'Europe/Dublin'       WHEN 'IT' THEN 'Europe/Rome'         WHEN 'LR' THEN 'Africa/Monrovia'
    WHEN 'LT' THEN 'Europe/Vilnius'      WHEN 'LU' THEN 'Europe/Luxembourg'   WHEN 'LV' THEN 'Europe/Riga'
    WHEN 'ML' THEN 'Africa/Bamako'       WHEN 'MR' THEN 'Africa/Nouakchott'   WHEN 'MT' THEN 'Europe/Malta'
    WHEN 'NE' THEN 'Africa/Niamey'       WHEN 'NG' THEN 'Africa/Lagos'        WHEN 'NL' THEN 'Europe/Amsterdam'
    WHEN 'PL' THEN 'Europe/Warsaw'       WHEN 'RO' THEN 'Europe/Bucharest'    WHEN 'SE' THEN 'Europe/Stockholm'
    WHEN 'SI' THEN 'Europe/Ljubljana'    WHEN 'SK' THEN 'Europe/Bratislava'   WHEN 'SL' THEN 'Africa/Freetown'
    WHEN 'SN' THEN 'Africa/Dakar'        WHEN 'TD' THEN 'Africa/Ndjamena'     WHEN 'TG' THEN 'Africa/Lome'
    ELSE NULL   -- US, CA, CD, ES, PT (plusieurs fuseaux) et pays inconnus : aucune déduction depuis le pays
  END
$$;

-- Zones AUTORISÉES pour un pays (cohérence pays ↔ fuseau) : pays à fuseau unique → sa seule zone ; pays à
-- plusieurs fuseaux → leurs zones IANA (zone.tab) ; pays inconnu → NULL (aucune zone acceptée).
-- Même liste que lib/time/time-zones.ts (COUNTRY_TIME_ZONES) — test de cohérence : tests/e2e/p0-expired-sellable.js
CREATE OR REPLACE FUNCTION public.country_time_zones(p_country text) RETURNS text[]
LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT CASE upper(coalesce(p_country, ''))
    WHEN 'US' THEN ARRAY['America/New_York','America/Detroit','America/Kentucky/Louisville','America/Kentucky/Monticello',
      'America/Indiana/Indianapolis','America/Indiana/Vincennes','America/Indiana/Winamac','America/Indiana/Marengo',
      'America/Indiana/Petersburg','America/Indiana/Vevay','America/Chicago','America/Indiana/Tell_City','America/Indiana/Knox',
      'America/Menominee','America/North_Dakota/Center','America/North_Dakota/New_Salem','America/North_Dakota/Beulah',
      'America/Denver','America/Boise','America/Phoenix','America/Los_Angeles','America/Anchorage','America/Juneau',
      'America/Sitka','America/Metlakatla','America/Yakutat','America/Nome','America/Adak','Pacific/Honolulu']
    WHEN 'CA' THEN ARRAY['America/St_Johns','America/Halifax','America/Glace_Bay','America/Moncton','America/Goose_Bay',
      'America/Toronto','America/Iqaluit','America/Winnipeg','America/Resolute','America/Rankin_Inlet','America/Regina',
      'America/Swift_Current','America/Edmonton','America/Cambridge_Bay','America/Inuvik','America/Dawson_Creek',
      'America/Fort_Nelson','America/Whitehorse','America/Dawson','America/Vancouver','America/Atikokan',
      'America/Blanc-Sablon','America/Creston']
    WHEN 'CD' THEN ARRAY['Africa/Kinshasa','Africa/Lubumbashi']
    WHEN 'ES' THEN ARRAY['Europe/Madrid','Africa/Ceuta','Atlantic/Canary']
    WHEN 'PT' THEN ARRAY['Europe/Lisbon','Atlantic/Madeira','Atlantic/Azores']
    ELSE CASE WHEN country_default_time_zone(p_country) IS NULL THEN NULL
              ELSE ARRAY[country_default_time_zone(p_country)] END
  END
$$;

ALTER TABLE public.shops ADD COLUMN IF NOT EXISTS timezone text;
COMMENT ON COLUMN public.shops.timezone IS
  'Fuseau IANA de la boutique — SEULE source de la date métier (péremption, ventes). Modifiable par le serveur uniquement (Paramètres boutique).';

-- Remplissage des 26 boutiques existantes : fuseau unique du pays, et Boutique de Ange Kossa (US, Missouri,
-- information de l'utilisateur du 23 oct. 2026) → America/Chicago. Aucune autre déduction.
UPDATE public.shops SET timezone = country_default_time_zone(country)
  WHERE timezone IS NULL AND country_default_time_zone(country) IS NOT NULL;
UPDATE public.shops SET timezone = 'America/Chicago'
  WHERE id = 'f9cf4bcd-e6c5-4c29-9098-dd00d20f2cbf' AND country = 'US' AND timezone IS NULL;

DO $$
DECLARE n_null int; n_bad int; n_mismatch int;
BEGIN
  SELECT count(*) INTO n_null FROM public.shops WHERE timezone IS NULL;
  SELECT count(*) INTO n_bad  FROM public.shops WHERE timezone IS NOT NULL AND NOT is_iana_time_zone(timezone);
  SELECT count(*) INTO n_mismatch FROM public.shops
    WHERE timezone IS NOT NULL AND NOT coalesce(timezone = ANY (country_time_zones(country)), false);
  IF n_null > 0 OR n_bad > 0 OR n_mismatch > 0 THEN
    RAISE EXCEPTION '178 : % boutique(s) sans fuseau, % fuseau(x) invalide(s), % incohérent(s) avec le pays — migration arrêtée',
      n_null, n_bad, n_mismatch;
  END IF;
END $$;

ALTER TABLE public.shops ALTER COLUMN timezone SET NOT NULL;

-- Garde du couple pays ↔ fuseau (création, changement de fuseau, changement de pays) :
--   • création sans fuseau → fuseau unique du pays, sinon REFUS P0032 (localisation ou choix requis) ;
--   • changement de pays sans nouveau fuseau → l'ancien est gardé s'il reste valable pour le nouveau pays, sinon
--     fuseau unique du nouveau pays, sinon REFUS P0032 (nouveau choix requis) — jamais « France + America/Chicago » ;
--   • toute valeur finale : zone IANA réelle (P0031 invalid_timezone) ET zone autorisée pour le pays
--     (P0031 timezone_country_mismatch).
CREATE OR REPLACE FUNCTION public.shops_timezone_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = public AS $$
DECLARE v_allowed text[] := country_time_zones(NEW.country);
BEGIN
  IF NEW.timezone IS NOT NULL AND btrim(NEW.timezone) = '' THEN
    NEW.timezone := NULL;
  END IF;
  IF TG_OP = 'INSERT' AND NEW.timezone IS NULL THEN
    NEW.timezone := country_default_time_zone(NEW.country);
    IF NEW.timezone IS NULL THEN
      RAISE EXCEPTION 'shop_timezone_required' USING ERRCODE = 'P0032',
        DETAIL = json_build_object('country', NEW.country)::text;
    END IF;
  ELSIF TG_OP = 'UPDATE' AND NEW.country IS DISTINCT FROM OLD.country AND NEW.timezone IS NOT DISTINCT FROM OLD.timezone THEN
    IF NOT coalesce(NEW.timezone = ANY (v_allowed), false) THEN
      NEW.timezone := country_default_time_zone(NEW.country);
      IF NEW.timezone IS NULL THEN
        RAISE EXCEPTION 'shop_timezone_required' USING ERRCODE = 'P0032',
          DETAIL = json_build_object('country', NEW.country)::text;
      END IF;
    END IF;
  END IF;
  IF NOT is_iana_time_zone(NEW.timezone) THEN
    RAISE EXCEPTION 'invalid_timezone' USING ERRCODE = 'P0031',
      DETAIL = json_build_object('timezone', NEW.timezone)::text;
  END IF;
  IF NOT coalesce(NEW.timezone = ANY (v_allowed), false) THEN
    RAISE EXCEPTION 'timezone_country_mismatch' USING ERRCODE = 'P0031',
      DETAIL = json_build_object('country', NEW.country, 'timezone', NEW.timezone)::text;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_shops_timezone_guard ON public.shops;
CREATE TRIGGER trg_shops_timezone_guard BEFORE INSERT OR UPDATE OF timezone, country ON public.shops
  FOR EACH ROW EXECUTE FUNCTION public.shops_timezone_guard();

-- Date métier : instant converti dans shops.timezone. Le pays n'intervient pas.
-- Comportement explicite si la boutique ou son fuseau manquent (impossible avec NOT NULL, gardé par sûreté) :
-- erreur P0032, jamais un repli silencieux sur l'heure du serveur, UTC, l'appareil ou le pays.
CREATE OR REPLACE FUNCTION public.shop_business_date(p_shop_id uuid, p_at timestamptz DEFAULT now()) RETURNS date
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_tz text;
BEGIN
  SELECT timezone INTO v_tz FROM shops WHERE id = p_shop_id;
  IF v_tz IS NULL THEN
    RAISE EXCEPTION 'shop_timezone_required' USING ERRCODE = 'P0032',
      DETAIL = json_build_object('shop_id', p_shop_id)::text;
  END IF;
  RETURN (coalesce(p_at, now()) AT TIME ZONE v_tz)::date;
END;
$$;

-- ── 2. Stock vendable ────────────────────────────────────────────────────────────────────────────────────────

-- Référence unique (voir en-tête). p_as_of NULL = produit sans aucun lot daté : rien n'est périmé.
CREATE OR REPLACE FUNCTION public.sellable_stock(p_product_id uuid, p_as_of date)
RETURNS TABLE (physical int, fresh int, expired int, untracked int, sellable int, non_sellable int)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH p AS (SELECT greatest(quantity, 0) AS physical FROM products WHERE id = p_product_id),
  l AS (
    SELECT coalesce(sum(quantity) FILTER (WHERE NOT coalesce(expiry_date < p_as_of, false)), 0)::int AS fresh,
           coalesce(sum(quantity) FILTER (WHERE coalesce(expiry_date < p_as_of, false)), 0)::int AS expired
    FROM product_batches WHERE product_id = p_product_id AND quantity > 0)
  SELECT p.physical, l.fresh, l.expired,
         greatest(p.physical - (l.fresh + l.expired), 0) AS untracked,
         least(p.physical, l.fresh + greatest(p.physical - (l.fresh + l.expired), 0)) AS sellable,
         p.physical - least(p.physical, l.fresh + greatest(p.physical - (l.fresh + l.expired), 0)) AS non_sellable
  FROM p CROSS JOIN l
$$;

-- Allocation des lots pour une VENTE : FEFO actuel (péremption croissante, sans date en dernier, puis réception),
-- lots périmés à p_as_of EXCLUS. Décrémente les lots choisis, renvoie [{batch_id, quantity}] ; peut allouer moins.
CREATE OR REPLACE FUNCTION public.allocate_sale_batches(p_product_id uuid, p_qty int, p_as_of date) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_batch     RECORD;
  v_remaining int := p_qty;
  v_take      int;
  v_out       jsonb := '[]'::jsonb;
BEGIN
  IF p_qty IS NULL OR p_qty <= 0 THEN
    RETURN v_out;
  END IF;
  FOR v_batch IN
    SELECT id, quantity
    FROM product_batches
    WHERE product_id = p_product_id AND quantity > 0
      AND NOT coalesce(expiry_date < p_as_of, false)
    ORDER BY expiry_date ASC NULLS LAST, received_at ASC
    FOR UPDATE
  LOOP
    EXIT WHEN v_remaining <= 0;
    v_take := LEAST(v_batch.quantity, v_remaining);
    UPDATE product_batches SET quantity = quantity - v_take, updated_at = now() WHERE id = v_batch.id;
    v_out := v_out || jsonb_build_object('batch_id', v_batch.id, 'quantity', v_take);
    v_remaining := v_remaining - v_take;
  END LOOP;
  RETURN v_out;
END;
$$;

-- ── 3. Ligne de vente : part non attribuable à un lot ────────────────────────────────────────────────────────

ALTER TABLE public.sale_items ADD COLUMN IF NOT EXISTS batch_unallocated int NOT NULL DEFAULT 0;
ALTER TABLE public.sale_items ADD CONSTRAINT sale_items_batch_unallocated_check
  CHECK (batch_unallocated >= 0 AND stock_shortfall + batch_unallocated <= quantity);
COMMENT ON COLUMN public.sale_items.batch_unallocated IS
  'Quantité sortie du stock produit, attribuable ni à un lot frais ni au stock historique sans lot, à cause de lots périmés exclus (vente hors ligne). Dette de traçabilité de lot : ne repasse à 0 que par une vraie résolution, jamais par « vérifiée ».';

-- ── 4. Déclencheur de vente (après insertion d'une ligne) ────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.deduct_stock_on_sale() RETURNS trigger
LANGUAGE plpgsql SET search_path = public AS $function$
DECLARE
  v_shop_id     uuid;
  v_cashier_id  uuid;
  v_sale_number text;
  v_sale_at     timestamptz;
  v_current_qty int;
  v_take        int;
  v_as_of       date;
  v_st          RECORD;
  v_allocs      jsonb;
  v_alloc       jsonb;
  v_allocated   int := 0;
  v_rest        int;
  v_unal        int;
  v_mode text := coalesce(current_setting('stockshop.stock_mode', true), '');
BEGIN
  IF new.product_id IS NULL OR v_mode = 'skip' THEN
    RETURN new;
  END IF;

  -- Verrou de la ligne produit avant lecture (anti-concurrence, migration 057)
  SELECT quantity INTO v_current_qty FROM products WHERE id = new.product_id FOR UPDATE;
  IF v_current_qty IS NULL THEN
    RETURN new;
  END IF;

  SELECT s.shop_id, s.cashier_id, s.sale_number, s.created_at
    INTO v_shop_id, v_cashier_id, v_sale_number, v_sale_at
    FROM sales s WHERE s.id = new.sale_id;

  -- Date métier DE LA VENTE (hors ligne : instant réel de la vente), seulement si un lot daté existe
  IF EXISTS (SELECT 1 FROM product_batches WHERE product_id = new.product_id AND quantity > 0 AND expiry_date IS NOT NULL) THEN
    v_as_of := shop_business_date(v_shop_id, v_sale_at);
  END IF;
  SELECT * INTO v_st FROM sellable_stock(new.product_id, v_as_of);

  IF v_current_qty < new.quantity THEN
    IF v_mode = 'offline' THEN
      v_take := greatest(v_current_qty, 0);
      UPDATE sale_items SET stock_shortfall = new.quantity - v_take WHERE id = new.id;
    ELSE
      RAISE EXCEPTION 'Stock insuffisant pour le produit % (disponible: %, demandé: %)',
        new.product_id, v_current_qty, new.quantity
        USING ERRCODE = 'P0001';
    END IF;
  ELSE
    v_take := new.quantity;
  END IF;

  -- En ligne : jamais au-delà du VENDABLE. Hors ligne : la vente a eu lieu, jamais refusée ici.
  IF v_mode <> 'offline' AND new.quantity > v_st.sellable THEN
    RAISE EXCEPTION 'sellable_insufficient'
      USING ERRCODE = 'P0030',
            DETAIL = json_build_object('product_id', new.product_id, 'sellable', v_st.sellable,
                                       'non_sellable', v_st.non_sellable, 'requested', new.quantity)::text;
  END IF;

  IF v_take > 0 THEN
    UPDATE products SET quantity = quantity - v_take, updated_at = now() WHERE id = new.product_id;

    -- 1) lots frais (FEFO) ; jamais un lot périmé
    v_allocs := allocate_sale_batches(new.product_id, v_take, v_as_of);
    FOR v_alloc IN SELECT * FROM jsonb_array_elements(v_allocs) LOOP
      INSERT INTO sale_item_batches (sale_item_id, batch_id, quantity)
      VALUES (new.id, (v_alloc->>'batch_id')::uuid, (v_alloc->>'quantity')::int);
      v_allocated := v_allocated + (v_alloc->>'quantity')::int;
    END LOOP;

    -- 2) stock historique sans lot : couvert, aucune alerte (comportement historique)
    -- 3) reste : sortie impossible à attribuer à cause des périmés → écart de lot EXPLICITE (jamais inventé)
    v_rest := v_take - v_allocated;
    v_unal := greatest(v_rest - v_st.untracked, 0);
    IF v_unal > 0 THEN
      UPDATE sale_items SET batch_unallocated = v_unal WHERE id = new.id;
      UPDATE sales SET review_reason = concat_ws(',', NULLIF(review_reason, ''), 'expired_stock_unresolved')
        WHERE id = new.sale_id AND coalesce(review_reason, '') NOT LIKE '%expired_stock_unresolved%';
    END IF;

    INSERT INTO stock_movements (shop_id, product_id, type, quantity, reason, performed_by)
    VALUES (v_shop_id, new.product_id, 'sale', v_take, 'Sale ' || v_sale_number, v_cashier_id);
  END IF;

  RETURN new;
END;
$function$;

-- ── 5. Modification d'une vente : par écart et par produit ───────────────────────────────────────────────────
-- Réduction de r unités, dans cet ordre : écart physique (stock_shortfall, jamais sorti du stock) → part
-- historique sans lot → batch_unallocated → allocations connues rendues à LEUR lot, inverse du FEFO.
-- Augmentation de i unités = NOUVELLE sortie de stock au moment de la modification : contrôlée contre
-- sellable_stock à la date métier de la MODIFICATION (pas celle de la vente d'origine) ; lots frais FEFO, puis
-- stock sans lot. Produit inchangé : aucun mouvement. Aucune réallocation des unités déjà vendues.
CREATE OR REPLACE FUNCTION public.edit_sale(p_sale_id uuid, p_edited_by uuid, p_customer_id uuid, p_payment_method text, p_notes text, p_items jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_sale         RECORD;
  v_elem         JSONB;
  v_new_sub      NUMERIC := 0;
  v_new_total    NUMERIC;
  v_new_bal      NUMERIC;
  v_new_status   TEXT;
  v_prod_id      UUID;
  v_old_prices   JSONB;
  v_buying_price NUMERIC;
  v_new_item_id  UUID;
  v_old          JSONB;
  v_new_qty      JSONB;
  v_plan         JSONB := '{}'::jsonb;
  v_pid          UUID;
  v_o            JSONB;
  v_old_q        INT;
  v_short        INT;
  v_unal         INT;
  v_allocs       JSONB;
  v_alloc_sum    INT;
  v_untracked    INT;
  v_new_q        INT;
  v_r            INT;
  v_d            INT;
  v_back         INT;
  v_i            INT;
  v_cur          INT;
  v_as_of        DATE;
  v_st           RECORD;
  v_got          JSONB;
  v_got_sum      INT;
  v_a            JSONB;
  v_rest         JSONB;
  v_kept         JSONB;
  v_cap          INT;
  v_put          INT;
  v_line_short   INT;
  v_line_unal    INT;
  v_line_allocs  JSONB;
  v_add_unal     INT;
  v_flag         BOOLEAN := false;
BEGIN
  SELECT * INTO v_sale FROM sales WHERE id = p_sale_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Vente introuvable' USING ERRCODE = 'P0002';
  END IF;
  IF v_sale.sale_status = 'cancelled' THEN
    RAISE EXCEPTION 'Vente annulée, modification impossible' USING ERRCODE = 'P0003';
  END IF;
  IF JSONB_ARRAY_LENGTH(p_items) = 0 THEN
    RAISE EXCEPTION 'La vente doit avoir au moins un article' USING ERRCODE = 'P0004';
  END IF;

  IF v_sale.customer_id IS NOT NULL AND v_sale.balance > 0 THEN
    UPDATE customers SET total_debt = greatest(0, total_debt - v_sale.balance) WHERE id = v_sale.customer_id;
  END IF;

  SELECT COALESCE(JSONB_OBJECT_AGG(product_id, buying_price), '{}'::JSONB)
    INTO v_old_prices FROM sale_items WHERE sale_id = p_sale_id AND product_id IS NOT NULL;

  -- État connu AVANT modification, par produit (ordre de restitution : allocations sans lot, puis inverse du FEFO)
  SELECT COALESCE(JSONB_OBJECT_AGG(x.pid, x.st), '{}'::JSONB) INTO v_old FROM (
    SELECT si.product_id AS pid, JSONB_BUILD_OBJECT(
      'q', SUM(si.quantity), 'short', SUM(si.stock_shortfall), 'unal', SUM(si.batch_unallocated),
      'allocs', COALESCE((
        SELECT JSONB_AGG(JSONB_BUILD_OBJECT('batch_id', sib.batch_id, 'quantity', sib.quantity)
                         ORDER BY (sib.batch_id IS NOT NULL), b.expiry_date DESC NULLS FIRST, b.received_at DESC, sib.created_at DESC)
        FROM sale_item_batches sib
        JOIN sale_items s2 ON s2.id = sib.sale_item_id
        LEFT JOIN product_batches b ON b.id = sib.batch_id
        WHERE s2.sale_id = p_sale_id AND s2.product_id = si.product_id), '[]'::JSONB)) AS st
    FROM sale_items si WHERE si.sale_id = p_sale_id AND si.product_id IS NOT NULL
    GROUP BY si.product_id) x;

  SELECT COALESCE(JSONB_OBJECT_AGG(y.pid, y.q), '{}'::JSONB) INTO v_new_qty FROM (
    SELECT NULLIF(e->>'product_id', '')::UUID AS pid, SUM((e->>'quantity')::INT) AS q
    FROM JSONB_ARRAY_ELEMENTS(p_items) e WHERE NULLIF(e->>'product_id', '') IS NOT NULL GROUP BY 1) y;

  FOR v_pid IN
    SELECT k::UUID FROM (SELECT JSONB_OBJECT_KEYS(v_old) AS k UNION SELECT JSONB_OBJECT_KEYS(v_new_qty)) z ORDER BY 1
  LOOP
    v_o := COALESCE(v_old->(v_pid::TEXT), '{"q":0,"short":0,"unal":0,"allocs":[]}'::JSONB);
    v_old_q := (v_o->>'q')::INT;
    v_short := (v_o->>'short')::INT;
    v_unal := (v_o->>'unal')::INT;
    v_allocs := v_o->'allocs';
    SELECT COALESCE(SUM((a->>'quantity')::INT), 0) INTO v_alloc_sum FROM JSONB_ARRAY_ELEMENTS(v_allocs) a;
    v_untracked := GREATEST(v_old_q - v_short - v_unal - v_alloc_sum, 0);
    v_new_q := COALESCE((v_new_qty->>(v_pid::TEXT))::INT, 0);

    SELECT quantity INTO v_cur FROM products WHERE id = v_pid FOR UPDATE;

    IF v_new_q < v_old_q THEN
      v_r := v_old_q - v_new_q;
      v_back := 0;
      v_d := LEAST(v_r, v_short);     v_short := v_short - v_d;         v_r := v_r - v_d;
      v_d := LEAST(v_r, v_untracked); v_untracked := v_untracked - v_d; v_r := v_r - v_d; v_back := v_back + v_d;
      v_d := LEAST(v_r, v_unal);      v_unal := v_unal - v_d;           v_r := v_r - v_d; v_back := v_back + v_d;
      v_rest := '[]'::JSONB;
      FOR v_a IN SELECT * FROM JSONB_ARRAY_ELEMENTS(v_allocs) LOOP
        v_d := LEAST(v_r, (v_a->>'quantity')::INT);
        IF v_d > 0 THEN
          IF NULLIF(v_a->>'batch_id', '') IS NOT NULL THEN
            UPDATE product_batches SET quantity = quantity + v_d, updated_at = now() WHERE id = (v_a->>'batch_id')::UUID;
          END IF;
          v_back := v_back + v_d;
          v_r := v_r - v_d;
        END IF;
        IF (v_a->>'quantity')::INT - v_d > 0 THEN
          v_rest := v_rest || JSONB_BUILD_OBJECT('batch_id', v_a->'batch_id', 'quantity', (v_a->>'quantity')::INT - v_d);
        END IF;
      END LOOP;
      v_allocs := v_rest;
      IF v_back > 0 AND v_cur IS NOT NULL THEN
        UPDATE products SET quantity = quantity + v_back, updated_at = now() WHERE id = v_pid;
        INSERT INTO stock_movements(shop_id, product_id, type, quantity, reason, performed_by)
        VALUES (v_sale.shop_id, v_pid, 'in', v_back, 'Modification vente #' || v_sale.sale_number, p_edited_by);
      END IF;

    ELSIF v_new_q > v_old_q AND v_cur IS NOT NULL THEN
      v_i := v_new_q - v_old_q;
      v_as_of := NULL;
      IF EXISTS (SELECT 1 FROM product_batches WHERE product_id = v_pid AND quantity > 0 AND expiry_date IS NOT NULL) THEN
        v_as_of := shop_business_date(v_sale.shop_id, now());   -- date de la MODIFICATION
      END IF;
      SELECT * INTO v_st FROM sellable_stock(v_pid, v_as_of);
      IF v_cur < v_i THEN
        RAISE EXCEPTION 'Stock insuffisant pour le produit % (disponible: %, demandé: %)', v_pid, v_cur, v_i
          USING ERRCODE = 'P0001';
      END IF;
      IF v_i > v_st.sellable THEN
        RAISE EXCEPTION 'sellable_insufficient'
          USING ERRCODE = 'P0030',
                DETAIL = json_build_object('product_id', v_pid, 'sellable', v_st.sellable,
                                           'non_sellable', v_st.non_sellable, 'requested', v_i)::text;
      END IF;
      UPDATE products SET quantity = quantity - v_i, updated_at = now() WHERE id = v_pid;
      v_got := allocate_sale_batches(v_pid, v_i, v_as_of);
      SELECT COALESCE(SUM((a->>'quantity')::INT), 0) INTO v_got_sum FROM JSONB_ARRAY_ELEMENTS(v_got) a;
      v_allocs := v_allocs || v_got;
      -- reste couvert par le stock sans lot ; au-delà (impossible ici puisque i ≤ sellable) → écart explicite
      v_add_unal := GREATEST(v_i - v_got_sum - v_st.untracked, 0);
      IF v_add_unal > 0 THEN
        v_unal := v_unal + v_add_unal;
        v_flag := true;
      END IF;
      INSERT INTO stock_movements(shop_id, product_id, type, quantity, reason, performed_by)
      VALUES (v_sale.shop_id, v_pid, 'sale', v_i, 'Modification vente #' || v_sale.sale_number, p_edited_by);
    END IF;

    v_plan := v_plan || JSONB_BUILD_OBJECT(v_pid::TEXT, JSONB_BUILD_OBJECT('short', v_short, 'unal', v_unal, 'allocs', v_allocs));
  END LOOP;

  DELETE FROM sale_items WHERE sale_id = p_sale_id;   -- sale_item_batches suivent (ON DELETE CASCADE)

  -- Le stock a été ajusté ci-dessus : le déclencheur se tait
  PERFORM set_config('stockshop.stock_mode', 'skip', true);

  FOR v_elem IN SELECT * FROM JSONB_ARRAY_ELEMENTS(p_items) LOOP
    v_new_sub := v_new_sub + (v_elem->>'quantity')::INT * (v_elem->>'unit_price')::NUMERIC;
    v_prod_id := NULLIF(v_elem->>'product_id', '')::UUID;

    IF v_prod_id IS NOT NULL THEN
      IF v_old_prices ? v_prod_id::TEXT THEN
        v_buying_price := (v_old_prices->>(v_prod_id::TEXT))::NUMERIC;
      ELSE
        SELECT buying_price INTO v_buying_price FROM products WHERE id = v_prod_id;
      END IF;
    ELSE
      v_buying_price := 0;
    END IF;

    -- Composantes conservées de ce produit reportées sur ses lignes (dans l'ordre des lignes)
    v_line_short := 0; v_line_unal := 0; v_line_allocs := '[]'::JSONB;
    IF v_prod_id IS NOT NULL AND v_plan ? v_prod_id::TEXT THEN
      v_kept := v_plan->(v_prod_id::TEXT);
      v_cap := (v_elem->>'quantity')::INT;
      v_line_short := LEAST(v_cap, (v_kept->>'short')::INT); v_cap := v_cap - v_line_short;
      v_line_unal := LEAST(v_cap, (v_kept->>'unal')::INT);   v_cap := v_cap - v_line_unal;
      v_rest := '[]'::JSONB;
      FOR v_a IN SELECT * FROM JSONB_ARRAY_ELEMENTS(v_kept->'allocs') LOOP
        v_put := LEAST(v_cap, (v_a->>'quantity')::INT);
        IF v_put > 0 THEN
          v_line_allocs := v_line_allocs || JSONB_BUILD_OBJECT('batch_id', v_a->'batch_id', 'quantity', v_put);
          v_cap := v_cap - v_put;
        END IF;
        IF (v_a->>'quantity')::INT - v_put > 0 THEN
          v_rest := v_rest || JSONB_BUILD_OBJECT('batch_id', v_a->'batch_id', 'quantity', (v_a->>'quantity')::INT - v_put);
        END IF;
      END LOOP;
      v_plan := JSONB_SET(v_plan, ARRAY[v_prod_id::TEXT], JSONB_BUILD_OBJECT(
        'short', (v_kept->>'short')::INT - v_line_short, 'unal', (v_kept->>'unal')::INT - v_line_unal, 'allocs', v_rest));
    END IF;

    INSERT INTO sale_items(sale_id, product_id, product_name, quantity, unit_price, buying_price, stock_shortfall, batch_unallocated)
    VALUES (p_sale_id, v_prod_id, v_elem->>'product_name', (v_elem->>'quantity')::INT, (v_elem->>'unit_price')::NUMERIC,
            COALESCE(v_buying_price, 0), v_line_short, v_line_unal)
    RETURNING id INTO v_new_item_id;

    FOR v_a IN SELECT * FROM JSONB_ARRAY_ELEMENTS(v_line_allocs) LOOP
      INSERT INTO sale_item_batches (sale_item_id, batch_id, quantity)
      VALUES (v_new_item_id, NULLIF(v_a->>'batch_id', '')::UUID, (v_a->>'quantity')::INT);
    END LOOP;
  END LOOP;

  PERFORM set_config('stockshop.stock_mode', '', true);

  IF v_flag THEN
    UPDATE sales SET review_reason = concat_ws(',', NULLIF(review_reason, ''), 'expired_stock_unresolved')
      WHERE id = p_sale_id AND coalesce(review_reason, '') NOT LIKE '%expired_stock_unresolved%';
  END IF;

  v_new_total := v_new_sub - COALESCE(v_sale.discount, 0) + COALESCE(v_sale.tax, 0);
  IF v_new_total < 0 THEN v_new_total := 0; END IF;

  IF v_sale.amount_paid > v_new_total THEN
    RAISE EXCEPTION 'Le montant déjà encaissé (%) dépasse le nouveau total (%)', v_sale.amount_paid, v_new_total USING ERRCODE = 'P0005';
  END IF;

  v_new_bal := v_new_total - v_sale.amount_paid;
  IF v_new_bal <= 0 THEN
    v_new_status := 'paid'; v_new_bal := 0;
  ELSIF v_sale.amount_paid > 0 THEN
    v_new_status := 'partial';
  ELSE
    v_new_status := 'pending';
  END IF;

  UPDATE sales SET
    customer_id = p_customer_id, payment_method = p_payment_method, notes = p_notes,
    subtotal = v_new_sub, total = v_new_total, payment_status = v_new_status
  WHERE id = p_sale_id;

  IF p_customer_id IS NOT NULL AND v_new_bal > 0 THEN
    UPDATE customers SET total_debt = total_debt + v_new_bal WHERE id = p_customer_id;
  END IF;

  RETURN JSONB_BUILD_OBJECT('new_total', v_new_total, 'new_balance', v_new_bal, 'new_status', v_new_status);
END;
$function$;

-- ── 6. Exécution : serveur uniquement ────────────────────────────────────────────────────────────────────────
-- (REVOKE FROM PUBLIC seul est inopérant sur Supabase : anon et authenticated ont des droits explicites)
REVOKE EXECUTE ON FUNCTION public.deplete_product_batches(uuid, integer, uuid)   FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.restore_sale_item_batches(uuid)                FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.allocate_sale_batches(uuid, integer, date)     FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.sellable_stock(uuid, date)                     FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.shop_business_date(uuid, timestamptz)          FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.country_default_time_zone(text)                FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.country_time_zones(text)                       FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.is_iana_time_zone(text)                        FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.shops_timezone_guard()                         FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.edit_sale(uuid, uuid, uuid, text, text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.allocate_sale_batches(uuid, integer, date)     TO service_role;
GRANT  EXECUTE ON FUNCTION public.sellable_stock(uuid, date)                     TO service_role;
GRANT  EXECUTE ON FUNCTION public.shop_business_date(uuid, timestamptz)          TO service_role;
GRANT  EXECUTE ON FUNCTION public.country_default_time_zone(text)                TO service_role;
GRANT  EXECUTE ON FUNCTION public.country_time_zones(text)                       TO service_role;
GRANT  EXECUTE ON FUNCTION public.is_iana_time_zone(text)                        TO service_role;

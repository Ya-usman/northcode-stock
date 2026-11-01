-- ============================================================
-- 199 : numéros de série, lot C : les transferts (étape 11 du Stock, 1er nov. 2026)
-- ============================================================
-- Après 197 / 198. Un produit SUIVI se transfère avec ses numéros (un par unité) ; les fonctions de transfert de la
-- 188 ne sont PAS modifiées : de nouvelles fonctions les appellent puis traitent les numéros dans la MÊME transaction.
-- 1. product_serials.transfer_item_id : ligne de transfert d'un numéro en transit.
-- 2. send_transfer_with_serials : envoi (send_stock_transfer_draft) + numéros choisis « en transit » ; produit suivi =
--    autant de numéros que d'unités envoyées, chacun EN STOCK au départ pour ce produit, sinon tout est annulé.
-- 3. create_transfer_with_serials : création + envoi d'un coup (une transaction).
-- 4. receive_transfer_with_serials : numéros arrivés (un par unité reçue, parmi ceux en transit de la ligne) puis
--    réception (receive_stock_transfer_final) ; numéros arrivés → boutique d'arrivée, produit d'arrivée (suivi activé) ;
--    numéros non arrivés → « retiré », motif « manquant au transfert » (comme le manque de stock). Renvoi d'une
--    réception déjà faite (même clé) : rien de plus.
-- 5. Transfert annulé en transit : numéros remis en stock au départ (déclencheur).
-- Codes : P0041 nombre, P0044 doublon, P0046 pas en stock, P0048 numéro pas en transit sur cette ligne.
-- Additive, ré-exécutable. Retour arrière : supabase/rollbacks/199_transfer_serials_rollback.sql
-- ============================================================

SET LOCAL lock_timeout = '5s';

ALTER TABLE public.product_serials ADD COLUMN IF NOT EXISTS transfer_item_id uuid REFERENCES public.stock_transfer_items(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_product_serials_transfer ON public.product_serials(transfer_id) WHERE transfer_id IS NOT NULL;

-- Liste propre (espaces retirés, vides écartés) d'un tableau JSON de numéros ; doublon (casse ignorée) = refus
CREATE OR REPLACE FUNCTION public._clean_serial_list(p jsonb, p_label text) RETURNS text[]
LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE v text[];
BEGIN
  SELECT COALESCE(array_agg(btrim(x) ORDER BY o), '{}') INTO v
    FROM jsonb_array_elements_text(COALESCE(p, '[]'::jsonb)) WITH ORDINALITY AS t(x, o) WHERE btrim(x) <> '';
  IF (SELECT count(DISTINCT upper(s)) FROM unnest(v) s) <> COALESCE(array_length(v, 1), 0) THEN
    RAISE EXCEPTION 'serial_duplicate_input' USING ERRCODE = 'P0044', DETAIL = p_label;
  END IF;
  RETURN v;
END $$;

-- 2. Envoi avec numéros --------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.send_transfer_with_serials(p_transfer_id uuid, p_source uuid, p_user uuid, p_serials jsonb)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $$
DECLARE
  v_res  jsonb;
  v_it   record;
  v_list text[];
  v_s    text;
BEGIN
  v_res := send_stock_transfer_draft(p_transfer_id, p_source, p_user);
  IF COALESCE((v_res->>'already_sent')::boolean, false) THEN RETURN v_res; END IF;   -- renvoi : rien de plus
  FOR v_it IN
    SELECT i.id, i.source_product_id, i.quantity_sent, i.product_name
      FROM stock_transfer_items i JOIN products p ON p.id = i.source_product_id
      WHERE i.stock_transfer_id = p_transfer_id AND p.track_serials
  LOOP
    SELECT _clean_serial_list(e->'serials', v_it.product_name) INTO v_list
      FROM jsonb_array_elements(COALESCE(p_serials, '[]'::jsonb)) e
      WHERE NULLIF(e->>'product_id', '')::uuid = v_it.source_product_id LIMIT 1;
    IF COALESCE(array_length(v_list, 1), 0) <> v_it.quantity_sent THEN
      RAISE EXCEPTION 'serial_count_mismatch' USING ERRCODE = 'P0041', DETAIL = v_it.product_name;
    END IF;
    FOREACH v_s IN ARRAY v_list LOOP
      UPDATE product_serials SET status = 'in_transit', transfer_id = p_transfer_id, transfer_item_id = v_it.id, updated_at = now()
        WHERE shop_id = p_source AND product_id = v_it.source_product_id AND upper(serial) = upper(v_s) AND status = 'in_stock';
      IF NOT FOUND THEN RAISE EXCEPTION 'serial_not_in_stock' USING ERRCODE = 'P0046', DETAIL = v_s; END IF;
    END LOOP;
  END LOOP;
  RETURN v_res;
END $$;

-- 3. Création + envoi -----------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_transfer_with_serials(p_source uuid, p_dest uuid, p_user uuid, p_notes text, p_items jsonb, p_serials jsonb)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $$
DECLARE v_draft jsonb;
BEGIN
  v_draft := create_stock_transfer(p_source, p_dest, p_user, p_notes, p_items, false);
  RETURN send_transfer_with_serials((v_draft->>'id')::uuid, p_source, p_user, p_serials);
END $$;

-- 4. Réception avec numéros -------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.receive_transfer_with_serials(p_transfer_id uuid, p_dest uuid, p_user uuid, p_receipt_key uuid, p_lines jsonb)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $$
DECLARE
  v_status text;
  v_ref    text;
  v_dname  text;
  v_res    jsonb;
  v_it     record;
  v_line   jsonb;
  v_list   text[];
  v_recv   int;
  v_s      text;
  v_row    record;
  v_other  uuid;
  v_dest_pid uuid;
BEGIN
  SELECT status, reference INTO v_status, v_ref FROM stock_transfers WHERE id = p_transfer_id FOR UPDATE;
  -- Déjà reçu (renvoi ou seconde réception) ou pas en transit : la fonction de la 188 répond (rejeu ou refus)
  IF v_status IS DISTINCT FROM 'sent' THEN
    RETURN receive_stock_transfer_final(p_transfer_id, p_dest, p_user, p_receipt_key, p_lines);
  END IF;
  SELECT name INTO v_dname FROM shops WHERE id = p_dest;

  -- Contrôle AVANT la réception : un numéro arrivé par unité reçue, parmi ceux en transit de la ligne
  FOR v_it IN
    SELECT i.id, i.product_name FROM stock_transfer_items i
      WHERE i.stock_transfer_id = p_transfer_id AND EXISTS (SELECT 1 FROM product_serials ps WHERE ps.transfer_item_id = i.id AND ps.status = 'in_transit')
  LOOP
    SELECT l INTO v_line FROM jsonb_array_elements(COALESCE(p_lines, '[]'::jsonb)) l WHERE NULLIF(l->>'item_id', '')::uuid = v_it.id LIMIT 1;
    v_list := _clean_serial_list(v_line->'serials_received', v_it.product_name);
    v_recv := COALESCE(NULLIF(v_line->>'quantity_received', '')::int, -1);
    IF COALESCE(array_length(v_list, 1), 0) <> v_recv THEN
      RAISE EXCEPTION 'serial_count_mismatch' USING ERRCODE = 'P0041', DETAIL = v_it.product_name;
    END IF;
    FOREACH v_s IN ARRAY v_list LOOP
      PERFORM 1 FROM product_serials WHERE transfer_item_id = v_it.id AND status = 'in_transit' AND upper(serial) = upper(v_s);
      IF NOT FOUND THEN RAISE EXCEPTION 'serial_not_in_transit' USING ERRCODE = 'P0048', DETAIL = v_s; END IF;
    END LOOP;
  END LOOP;

  v_res := receive_stock_transfer_final(p_transfer_id, p_dest, p_user, p_receipt_key, p_lines);

  -- Numéros : arrivés → boutique d'arrivée ; non arrivés → retirés (manquant au transfert)
  FOR v_it IN
    SELECT i.id, i.destination_product_id, i.product_name FROM stock_transfer_items i
      WHERE i.stock_transfer_id = p_transfer_id AND EXISTS (SELECT 1 FROM product_serials ps WHERE ps.transfer_item_id = i.id AND ps.status = 'in_transit')
  LOOP
    SELECT l INTO v_line FROM jsonb_array_elements(COALESCE(p_lines, '[]'::jsonb)) l WHERE NULLIF(l->>'item_id', '')::uuid = v_it.id LIMIT 1;
    v_list := _clean_serial_list(v_line->'serials_received', v_it.product_name);
    v_dest_pid := v_it.destination_product_id;
    IF v_dest_pid IS NOT NULL AND COALESCE(array_length(v_list, 1), 0) > 0 THEN
      UPDATE products SET track_serials = true WHERE id = v_dest_pid AND NOT track_serials;
    END IF;
    FOR v_row IN SELECT id, serial FROM product_serials WHERE transfer_item_id = v_it.id AND status = 'in_transit' FOR UPDATE LOOP
      IF upper(v_row.serial) = ANY (SELECT upper(x) FROM unnest(v_list) x) AND v_dest_pid IS NOT NULL THEN
        SELECT id INTO v_other FROM product_serials WHERE shop_id = p_dest AND upper(serial) = upper(v_row.serial) FOR UPDATE;
        IF FOUND THEN
          -- Numéro déjà connu dans la boutique d'arrivée (ex. revenu) : sa ligne reprend, celle du départ est close
          UPDATE product_serials SET status = 'in_stock', product_id = v_dest_pid, source = 'transfer', transfer_id = p_transfer_id,
            transfer_item_id = v_it.id, sale_item_id = NULL, sold_at = NULL, removed_reason = NULL, batch_id = NULL,
            received_at = now(), updated_at = now() WHERE id = v_other;
          UPDATE product_serials SET status = 'removed', removed_reason = left('Transféré vers ' || coalesce(v_dname, '') || ' (' || v_ref || ')', 200),
            updated_at = now() WHERE id = v_row.id;
        ELSE
          UPDATE product_serials SET shop_id = p_dest, product_id = v_dest_pid, status = 'in_stock', source = 'transfer',
            batch_id = NULL, received_at = now(), updated_at = now() WHERE id = v_row.id;
        END IF;
      ELSE
        UPDATE product_serials SET status = 'removed', removed_reason = left('Manquant au transfert ' || v_ref, 200), updated_at = now()
          WHERE id = v_row.id;
      END IF;
    END LOOP;
  END LOOP;
  RETURN v_res;
END $$;

-- 5. Annulation d'un transfert en transit : numéros remis en stock au départ ----------------------------------------------
CREATE OR REPLACE FUNCTION public.release_serials_on_transfer_cancel() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF OLD.status IS DISTINCT FROM 'cancelled' AND NEW.status = 'cancelled' THEN
    UPDATE product_serials SET status = 'in_stock', transfer_id = NULL, transfer_item_id = NULL, updated_at = now()
      WHERE transfer_id = NEW.id AND status = 'in_transit';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_release_serials_on_transfer_cancel ON public.stock_transfers;
CREATE TRIGGER trg_release_serials_on_transfer_cancel AFTER UPDATE OF status ON public.stock_transfers
  FOR EACH ROW EXECUTE FUNCTION public.release_serials_on_transfer_cancel();

-- Fonctions réservées au serveur
REVOKE ALL ON FUNCTION public._clean_serial_list(jsonb, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.send_transfer_with_serials(uuid, uuid, uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.send_transfer_with_serials(uuid, uuid, uuid, jsonb) TO service_role;
REVOKE ALL ON FUNCTION public.create_transfer_with_serials(uuid, uuid, uuid, text, jsonb, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_transfer_with_serials(uuid, uuid, uuid, text, jsonb, jsonb) TO service_role;
REVOKE ALL ON FUNCTION public.receive_transfer_with_serials(uuid, uuid, uuid, uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.receive_transfer_with_serials(uuid, uuid, uuid, uuid, jsonb) TO service_role;
REVOKE ALL ON FUNCTION public.release_serials_on_transfer_cancel() FROM PUBLIC, anon, authenticated;

-- ════════════════════════════════════════════════════════════════════════════════════════════════════════════
-- Retour arrière de 179 — REFUSÉ dès qu'un historique existe (jamais de destruction silencieuse)
-- ════════════════════════════════════════════════════════════════════════════════════════════════════════════
-- Refus si : un traitement, une photo, un mouvement lié à un lot ou à un traitement, ou un fichier dans l'espace
-- batch-treatment-photos existe. Sinon : remet delete_product_batch dans son état de la 117 (même contenu qu'en
-- production, fins de ligne mises à part — empreinte md5 sans \r : 8ad155aae3901f1125b1ace5e138a0dd), rend
-- adjust_batch_quantity au serveur, remet sale_item_batches.batch_id en ON DELETE SET NULL, retire gardes,
-- fonctions, colonnes, tables et l'espace de stockage (vide).

DO $$
DECLARE n_t int; n_p int; n_m int; n_o int;
BEGIN
  SELECT count(*) INTO n_t FROM public.batch_treatments;
  SELECT count(*) INTO n_p FROM public.batch_treatment_photos;
  SELECT count(*) INTO n_m FROM public.stock_movements WHERE batch_id IS NOT NULL OR batch_treatment_id IS NOT NULL;
  SELECT count(*) INTO n_o FROM storage.objects WHERE bucket_id = 'batch-treatment-photos';
  IF n_t > 0 OR n_p > 0 OR n_m > 0 OR n_o > 0 THEN
    RAISE EXCEPTION 'Retour arrière 179 refusé : % traitement(s), % photo(s), % mouvement(s) lié(s), % fichier(s) — historique à conserver',
      n_t, n_p, n_m, n_o;
  END IF;
END $$;

-- adjust_batch_quantity : de nouveau exécutable par le serveur (état d'avant 179)
GRANT EXECUTE ON FUNCTION public.adjust_batch_quantity(uuid, uuid, integer, text, uuid) TO service_role;

-- delete_product_batch : corps de la 117
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

DROP TRIGGER IF EXISTS trg_product_batches_expiry_guard ON public.product_batches;
DROP FUNCTION IF EXISTS public.product_batches_expiry_guard();

DROP FUNCTION IF EXISTS public.treat_batch(uuid, uuid, text, int, int, date, text, text, text, uuid, uuid);
DROP FUNCTION IF EXISTS public.resolve_unallocated(uuid, uuid, uuid, uuid, int, text, text, uuid);
DROP FUNCTION IF EXISTS public.register_batch_treatment_photo(uuid, uuid, text, text, int, uuid);
DROP FUNCTION IF EXISTS public.unallocated_candidates(uuid);
DROP FUNCTION IF EXISTS public.remove_review_reason(text, text);

-- Allocation vente ↔ lot : retour au comportement d'avant 179 (ON DELETE SET NULL)
ALTER TABLE public.sale_item_batches DROP CONSTRAINT sale_item_batches_batch_id_fkey;
ALTER TABLE public.sale_item_batches ADD CONSTRAINT sale_item_batches_batch_id_fkey
  FOREIGN KEY (batch_id) REFERENCES public.product_batches(id) ON DELETE SET NULL;

ALTER TABLE public.stock_movements DROP COLUMN IF EXISTS batch_treatment_id;
ALTER TABLE public.stock_movements DROP COLUMN IF EXISTS batch_id;

DROP TABLE IF EXISTS public.batch_treatment_photos;
DROP TABLE IF EXISTS public.batch_treatments;
DROP FUNCTION IF EXISTS public.batch_history_immutable();
DROP FUNCTION IF EXISTS public.batch_treatment_photos_immutable();
DROP FUNCTION IF EXISTS public.batch_treatments_insert_guard();
DROP FUNCTION IF EXISTS public.batch_treatment_photos_insert_guard();

-- Espace de stockage (vide, vérifié ci-dessus) : suppression autorisée pour cette transaction seulement
SELECT set_config('storage.allow_delete_query', 'true', true);
DELETE FROM storage.buckets WHERE id = 'batch-treatment-photos';

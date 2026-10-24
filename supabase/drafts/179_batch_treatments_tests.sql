-- 179 — suite principale (base LOCALE jetable uniquement, après 179_batch_treatments_test_stub.sql + la migration)
-- Scénarios de la 179 sur la base LOCALE jetable (jamais la production). Chaque cas écrit son résultat.
SET client_min_messages = warning;
CREATE TABLE IF NOT EXISTS t_res (n serial, ok boolean, label text);
CREATE OR REPLACE FUNCTION t(c boolean, m text) RETURNS void LANGUAGE sql AS $$ INSERT INTO t_res(ok, label) VALUES (coalesce(c, false), m) $$;
-- Code d'erreur d'une instruction (NULL si elle réussit) ; l'instruction échouée est annulée
CREATE OR REPLACE FUNCTION err(q text) RETURNS text LANGUAGE plpgsql AS $$
BEGIN EXECUTE q; RETURN NULL; EXCEPTION WHEN others THEN RETURN SQLSTATE; END $$;
-- Date du jour DES BOUTIQUES DE TEST (Africa/Douala), jamais current_date : le serveur local peut être dans un
-- autre fuseau (Europe/Paris), et la 179 juge la péremption à la date de la boutique.
CREATE OR REPLACE FUNCTION d0() RETURNS date LANGUAGE sql STABLE AS $$ SELECT (now() AT TIME ZONE 'Africa/Douala')::date $$;
CREATE OR REPLACE FUNCTION tb(b uuid, a text, q int, nq int, d date, r text, note text, rid text, cor uuid DEFAULT NULL) RETURNS jsonb
LANGUAGE sql AS $$ SELECT treat_batch('11111111-1111-1111-1111-111111111111', b, a, q, nq, d, r, note, rid, 'aaaaaaaa-0000-0000-0000-000000000001', cor) $$;

-- ── Données ──
INSERT INTO shops (id, name, timezone) VALUES ('11111111-1111-1111-1111-111111111111', 'Alpha', 'Africa/Douala'), ('22222222-2222-2222-2222-222222222222', 'Autre', 'Africa/Douala');
INSERT INTO profiles VALUES ('aaaaaaaa-0000-0000-0000-000000000001', 'Gérant Test'), ('aaaaaaaa-0000-0000-0000-000000000002', 'Autre');
INSERT INTO suppliers (id, shop_id, name) VALUES ('5a5a5a5a-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Fournisseur X');
INSERT INTO products (id, shop_id, name, quantity) VALUES
  ('a0000000-0000-0000-0000-00000000000a', '11111111-1111-1111-1111-111111111111', 'A', 8),
  ('b0000000-0000-0000-0000-00000000000b', '11111111-1111-1111-1111-111111111111', 'B', 5),
  ('c0000000-0000-0000-0000-00000000000c', '11111111-1111-1111-1111-111111111111', 'C', 5),
  ('d0000000-0000-0000-0000-00000000000d', '11111111-1111-1111-1111-111111111111', 'D', 5),
  ('e0000000-0000-0000-0000-00000000000e', '11111111-1111-1111-1111-111111111111', 'E', 1);
-- Lots : LA périmé (fournisseur) créé AVANT la vente SA ; LB périmé candidat ; LC périmé créé APRÈS la vente SC ; LD sain ; LE
INSERT INTO product_batches (id, shop_id, product_id, supplier_id, quantity, initial_quantity, expiry_date, created_at) VALUES
  ('1a000000-0000-0000-0000-00000000001a', '11111111-1111-1111-1111-111111111111', 'a0000000-0000-0000-0000-00000000000a', '5a5a5a5a-0000-0000-0000-000000000001', 10, 10, d0() - 10, now() - interval '10 days'),
  ('1b000000-0000-0000-0000-00000000001b', '11111111-1111-1111-1111-111111111111', 'b0000000-0000-0000-0000-00000000000b', NULL, 5, 5, d0() - 10, now() - interval '10 days'),
  ('1c000000-0000-0000-0000-00000000001c', '11111111-1111-1111-1111-111111111111', 'c0000000-0000-0000-0000-00000000000c', NULL, 5, 5, d0() - 1, now() - interval '1 day'),
  ('1d000000-0000-0000-0000-00000000001d', '11111111-1111-1111-1111-111111111111', 'd0000000-0000-0000-0000-00000000000d', NULL, 5, 5, d0() + 30, now() - interval '10 days'),
  ('1e000000-0000-0000-0000-00000000001e', '11111111-1111-1111-1111-111111111111', 'e0000000-0000-0000-0000-00000000000e', NULL, 5, 5, d0() + 30, now() - interval '10 days');
INSERT INTO sales (id, shop_id, sale_number, created_at, review_reason, reviewed_at) VALUES
  ('5a000000-0000-0000-0000-0000000000aa', '11111111-1111-1111-1111-111111111111', 'BOU-1', now() - interval '5 days', 'other,expired_stock_unresolved', '2026-10-01T10:00:00Z'),
  ('5b000000-0000-0000-0000-0000000000bb', '11111111-1111-1111-1111-111111111111', 'BOU-2', now() - interval '5 days', 'expired_stock_unresolved', NULL),
  ('5c000000-0000-0000-0000-0000000000cc', '11111111-1111-1111-1111-111111111111', 'BOU-3', now() - interval '3 days', 'expired_stock_unresolved', NULL);
INSERT INTO sale_items (id, sale_id, product_id, quantity, batch_unallocated) VALUES
  ('a1000000-0000-0000-0000-0000000000a1', '5a000000-0000-0000-0000-0000000000aa', 'a0000000-0000-0000-0000-00000000000a', 2, 2),
  ('b1000000-0000-0000-0000-0000000000b1', '5b000000-0000-0000-0000-0000000000bb', 'b0000000-0000-0000-0000-00000000000b', 1, 1),
  ('c1000000-0000-0000-0000-0000000000c1', '5c000000-0000-0000-0000-0000000000cc', 'c0000000-0000-0000-0000-00000000000c', 1, 1);

-- ── D2 : lot candidat (LA) — diminutions refusées, augmentation et date acceptées ──
SELECT t(err($$SELECT tb('1a000000-0000-0000-0000-00000000001a', 'dispose', 1, NULL, NULL, NULL, NULL, 'req-d2-dispose')$$) = 'P0040', 'D2 lot candidat : dispose → P0040');
SELECT t(err($$SELECT tb('1a000000-0000-0000-0000-00000000001a', 'supplier_return', 1, NULL, NULL, NULL, NULL, 'req-d2-return')$$) = 'P0040', 'D2 lot candidat : supplier_return → P0040');
SELECT t(err($$SELECT tb('1a000000-0000-0000-0000-00000000001a', 'quantity_adjustment', NULL, 9, NULL, 'loss', NULL, 'req-d2-adjm')$$) = 'P0040', 'D2 lot candidat : ajustement −1 → P0040');
SELECT t(err($$SELECT tb('1b000000-0000-0000-0000-00000000001b', 'quantity_adjustment', NULL, 6, NULL, 'counting_error', NULL, 'req-d2-adjp')$$) IS NULL, 'D2 lot candidat : ajustement +1 → accepté');
SELECT t((SELECT quantity FROM product_batches WHERE id = '1b000000-0000-0000-0000-00000000001b') = 6 AND (SELECT quantity FROM products WHERE id = 'b0000000-0000-0000-0000-00000000000b') = 6, '… lot et produit +1 (6 / 6)');
SELECT t(err($$SELECT tb('1b000000-0000-0000-0000-00000000001b', 'date_correction', NULL, NULL, d0() - 8, NULL, 'date mal saisie', 'req-d2-date')$$) IS NULL, 'D2 lot candidat : correction de date → acceptée');
-- Lot NON candidat (LC créé après la vente SC) : destruction acceptée
SELECT t(err($$SELECT tb('1c000000-0000-0000-0000-00000000001c', 'dispose', 2, NULL, NULL, NULL, NULL, 'req-c-dispose')$$) IS NULL, 'lot non candidat (créé après la vente) : dispose accepté');
SELECT t((SELECT quantity FROM product_batches WHERE id = '1c000000-0000-0000-0000-00000000001c') = 3 AND (SELECT quantity FROM products WHERE id = 'c0000000-0000-0000-0000-00000000000c') = 3
  AND (SELECT count(*) FROM stock_movements WHERE batch_id = '1c000000-0000-0000-0000-00000000001c' AND type = 'out' AND quantity = 2 AND previous_qty = 5 AND new_qty = 3) = 1,
  '… lot 3, produit 3, un mouvement « out » 2 (avant / après = PRODUIT 5 → 3)');
SELECT t(err($$SELECT resolve_unallocated('11111111-1111-1111-1111-111111111111', '5c000000-0000-0000-0000-0000000000cc', 'c0000000-0000-0000-0000-00000000000c', '1c000000-0000-0000-0000-00000000001c', 1, 'note', 'req-c-res', 'aaaaaaaa-0000-0000-0000-000000000001')$$) = 'P0047',
  'résolution vers un lot créé APRÈS la vente → P0047');

-- ── Résolution 8 / 10 / 2 → 8 / 8 / 0 ──
SELECT t(err($$SELECT resolve_unallocated('11111111-1111-1111-1111-111111111111', '5a000000-0000-0000-0000-0000000000aa', 'a0000000-0000-0000-0000-00000000000a', '1a000000-0000-0000-0000-00000000001a', 1, NULL, 'req-res-nonote', 'aaaaaaaa-0000-0000-0000-000000000001')$$) = 'P0046', 'résolution sans note → P0046');
SELECT resolve_unallocated('11111111-1111-1111-1111-111111111111', '5a000000-0000-0000-0000-0000000000aa', 'a0000000-0000-0000-0000-00000000000a', '1a000000-0000-0000-0000-00000000001a', 1, 'carton du lot X', 'req-res-1', 'aaaaaaaa-0000-0000-0000-000000000001');
SELECT t((SELECT quantity FROM products WHERE id = 'a0000000-0000-0000-0000-00000000000a') = 8 AND (SELECT quantity FROM product_batches WHERE id = '1a000000-0000-0000-0000-00000000001a') = 9
  AND (SELECT batch_unallocated FROM sale_items WHERE id = 'a1000000-0000-0000-0000-0000000000a1') = 1 AND (SELECT review_reason FROM sales WHERE id = '5a000000-0000-0000-0000-0000000000aa') = 'other,expired_stock_unresolved',
  'résolution 2 → 1 : produit 8 (inchangé), lot 9, non attribué 1, motif expired_stock_unresolved conservé');
SELECT t((resolve_unallocated('11111111-1111-1111-1111-111111111111', '5a000000-0000-0000-0000-0000000000aa', 'a0000000-0000-0000-0000-00000000000a', '1a000000-0000-0000-0000-00000000001a', 1, 'carton du lot X', 'req-res-1', 'aaaaaaaa-0000-0000-0000-000000000001')->>'already')::boolean, 'même request_id, mêmes paramètres → même événement (already)');
SELECT t(err($$SELECT resolve_unallocated('11111111-1111-1111-1111-111111111111', '5a000000-0000-0000-0000-0000000000aa', 'a0000000-0000-0000-0000-00000000000a', '1a000000-0000-0000-0000-00000000001a', 2, 'x', 'req-res-1', 'aaaaaaaa-0000-0000-0000-000000000001')$$) = 'P0041', 'même request_id, paramètres différents → P0041');
SELECT resolve_unallocated('11111111-1111-1111-1111-111111111111', '5a000000-0000-0000-0000-0000000000aa', 'a0000000-0000-0000-0000-00000000000a', '1a000000-0000-0000-0000-00000000001a', 1, 'second carton', 'req-res-2', 'aaaaaaaa-0000-0000-0000-000000000001');
SELECT t((SELECT quantity FROM products WHERE id = 'a0000000-0000-0000-0000-00000000000a') = 8 AND (SELECT quantity FROM product_batches WHERE id = '1a000000-0000-0000-0000-00000000001a') = 8
  AND (SELECT batch_unallocated FROM sale_items WHERE id = 'a1000000-0000-0000-0000-0000000000a1') = 0, 'résolution complète : produit 8 (jamais 6), lot 8, non attribué 0');
SELECT t((SELECT review_reason FROM sales WHERE id = '5a000000-0000-0000-0000-0000000000aa') = 'other' AND (SELECT reviewed_at FROM sales WHERE id = '5a000000-0000-0000-0000-0000000000aa') = '2026-10-01T10:00:00Z',
  '2 → 0 : seul expired_stock_unresolved retiré (« other » gardé), reviewed_at inchangé');
SELECT t((SELECT sum(quantity) FROM sale_item_batches WHERE sale_item_id = 'a1000000-0000-0000-0000-0000000000a1' AND batch_id = '1a000000-0000-0000-0000-00000000001a') = 2
  AND (SELECT count(*) FROM sale_item_batches WHERE sale_item_id = 'a1000000-0000-0000-0000-0000000000a1') = 1, 'allocation créée puis AUGMENTÉE (une seule ligne, 2 unités)');
SELECT t((SELECT count(*) FROM stock_movements WHERE product_id = 'a0000000-0000-0000-0000-00000000000a') = 0, 'résolution : AUCUN mouvement de stock');
SELECT t((SELECT bool_and(product_qty_before = product_qty_after) FROM batch_treatments WHERE action = 'unallocated_resolution'), 'résolution : product_qty_before = product_qty_after');
SELECT t(err($$SELECT resolve_unallocated('11111111-1111-1111-1111-111111111111', '5a000000-0000-0000-0000-0000000000aa', 'a0000000-0000-0000-0000-00000000000a', '1a000000-0000-0000-0000-00000000001a', 1, 'x', 'req-res-3', 'aaaaaaaa-0000-0000-0000-000000000001')$$) = 'P0048', 'plus rien à attribuer → P0048 (et jamais de lot ni de non-attribué négatif)');
-- Plus de vente en attente : LA n'est plus candidat → retour fournisseur accepté, fournisseur relu en base
SELECT t(err($$SELECT tb('1a000000-0000-0000-0000-00000000001a', 'supplier_return', 3, NULL, NULL, NULL, NULL, 'req-return')$$) IS NULL, 'après résolution : retour fournisseur accepté');
SELECT t(true
  AND (SELECT supplier_name FROM batch_treatments WHERE request_id = 'req-return') = 'Fournisseur X', 'après résolution : retour fournisseur accepté, nom du fournisseur conservé');
SELECT t(err($$SELECT tb('1a000000-0000-0000-0000-00000000001a', 'dispose', 5, NULL, NULL, NULL, NULL, 'req-dispose-all')$$) IS NULL, 'destruction totale acceptée');
SELECT t(true
  AND (SELECT quantity FROM product_batches WHERE id = '1a000000-0000-0000-0000-00000000001a') = 0, 'destruction totale : lot à 0, CONSERVÉ en base');
SELECT t(err($$SELECT tb('1a000000-0000-0000-0000-00000000001a', 'dispose', 1, NULL, NULL, NULL, NULL, 'req-dispose-more')$$) = 'P0043', 'destruction au-delà du lot → P0043 (aucun ajustement automatique)');

-- ── Retour sans fournisseur, résultat négatif, lot non périmé ──
SELECT t(err($$SELECT tb('1b000000-0000-0000-0000-00000000001b', 'supplier_return', 1, NULL, NULL, NULL, NULL, 'req-nosup')$$) IN ('P0042', 'P0040'), 'retour fournisseur d’un lot sans fournisseur → refusé (P0042 ; LB est aussi candidat : P0040)');
SELECT t(err($$SELECT tb('1e000000-0000-0000-0000-00000000001e', 'quantity_adjustment', NULL, 0, NULL, 'loss', NULL, 'req-neg')$$) = 'P0043', 'ajustement qui rendrait le produit négatif → P0043');
SELECT t(err($$SELECT tb('1d000000-0000-0000-0000-00000000001d', 'dispose', 1, NULL, NULL, NULL, NULL, 'req-notexp')$$) = 'P0044', 'destruction d’un lot non périmé → P0044');
SELECT t(err($$SELECT tb('1d000000-0000-0000-0000-00000000001d', 'quantity_adjustment', NULL, 4, NULL, 'other', NULL, 'req-other-nonote')$$) = 'P0046', 'motif « other » sans note → P0046');

-- ── Dates (NULL compris) ──
SELECT t(err($$SELECT tb('1d000000-0000-0000-0000-00000000001d', 'date_correction', NULL, NULL, d0() + 40, NULL, 'note', 'req-date-1')$$) IS NULL, 'date A → date B : acceptée');
SELECT t(err($$SELECT tb('1d000000-0000-0000-0000-00000000001d', 'date_correction', NULL, NULL, d0() + 40, NULL, 'note', 'req-date-2')$$) = 'P0043', 'date A → même date A : refusée');
SELECT t(err($$SELECT tb('1d000000-0000-0000-0000-00000000001d', 'date_correction', NULL, NULL, NULL, NULL, 'note', 'req-date-3')$$) IS NULL, 'date A → NULL : acceptée');
SELECT t(err($$SELECT tb('1d000000-0000-0000-0000-00000000001d', 'date_correction', NULL, NULL, NULL, NULL, 'note', 'req-date-4')$$) = 'P0043', 'NULL → NULL : refusée');
SELECT t(err($$SELECT tb('1d000000-0000-0000-0000-00000000001d', 'date_correction', NULL, NULL, d0() + 50, NULL, 'note', 'req-date-5')$$) IS NULL, 'NULL → date A : acceptée');
SELECT t(err($$SELECT tb('1d000000-0000-0000-0000-00000000001d', 'date_correction', NULL, NULL, d0() + 60, NULL, NULL, 'req-date-6')$$) = 'P0046', 'correction de date sans note → P0046');
SELECT t(err($$UPDATE product_batches SET expiry_date = d0() + 99 WHERE id = '1d000000-0000-0000-0000-00000000001d'$$) = 'P0045', 'modification directe de la date → P0045 (un seul chemin)');
SELECT t((SELECT count(*) FROM stock_movements WHERE batch_id = '1d000000-0000-0000-0000-00000000001d') = 0, 'corrections de date : aucun mouvement de stock');

-- ── Idempotence de treat_batch, corrections ──
SELECT t((tb('1d000000-0000-0000-0000-00000000001d', 'date_correction', NULL, NULL, d0() + 40, NULL, 'note', 'req-date-1')->>'already')::boolean, 'treat_batch : même request_id, mêmes paramètres → already');
SELECT t(err($$SELECT tb('1d000000-0000-0000-0000-00000000001d', 'quantity_adjustment', NULL, 4, NULL, 'loss', NULL, 'req-date-1')$$) = 'P0041', 'treat_batch : même request_id, paramètres différents → P0041');
SELECT t(err(format($$SELECT tb('1d000000-0000-0000-0000-00000000001d', 'quantity_adjustment', NULL, 4, NULL, 'loss', 'corrige', 'req-cor-1', %L)$$, (SELECT id FROM batch_treatments WHERE request_id = 'req-c-dispose'))) = 'P0047', 'correction visant un événement d’un AUTRE lot → P0047');
SELECT t(err(format($$SELECT tb('1d000000-0000-0000-0000-00000000001d', 'quantity_adjustment', NULL, 4, NULL, 'loss', 'corrige', 'req-cor-2', %L)$$, (SELECT id FROM batch_treatments WHERE request_id = 'req-date-1'))) IS NULL, 'correction visant un événement du même lot → acceptée');

-- ── Immuabilité, suppressions protégées ──
SELECT t(err($$UPDATE batch_treatments SET note = 'x'$$) = '42501', 'modifier un événement → refusé (42501)');
SELECT t(err($$DELETE FROM batch_treatments WHERE request_id = 'req-return'$$) = '42501', 'supprimer un événement → refusé (42501)');
SELECT t(err($$SELECT delete_product_batch('1a000000-0000-0000-0000-00000000001a', '11111111-1111-1111-1111-111111111111', 'correction', 'aaaaaaaa-0000-0000-0000-000000000001')$$) IS NOT NULL, 'delete_product_batch d’un lot avec historique → refusé');
SELECT t(err($$DELETE FROM product_batches WHERE id = '1c000000-0000-0000-0000-00000000001c'$$) = '23503', 'suppression directe d’un lot avec historique → refusée (23503)');
SELECT t(err($$DELETE FROM products WHERE id = 'a0000000-0000-0000-0000-00000000000a'$$) = '23503', 'suppression directe d’un produit avec historique → refusée (23503)');
INSERT INTO product_batches (id, shop_id, product_id, quantity, initial_quantity) VALUES ('1f000000-0000-0000-0000-00000000001f', '11111111-1111-1111-1111-111111111111', 'e0000000-0000-0000-0000-00000000000e', 1, 1);
INSERT INTO sale_item_batches (sale_item_id, batch_id, quantity) VALUES ('c1000000-0000-0000-0000-0000000000c1', '1f000000-0000-0000-0000-00000000001f', 1);
SELECT t(err($$DELETE FROM product_batches WHERE id = '1f000000-0000-0000-0000-00000000001f'$$) = '23503', 'suppression directe d’un lot VENDU → refusée (allocation en NO ACTION)');
SELECT t((SELECT count(*) FROM product_batches WHERE id = '1a000000-0000-0000-0000-00000000001a' AND quantity = 0) = 1, 'lot à 0 avec historique toujours présent');

-- ── Photos ──
INSERT INTO storage.buckets VALUES ('x', 'x', false, NULL, NULL) ON CONFLICT DO NOTHING;
DO $$ DECLARE tr uuid := (SELECT id FROM batch_treatments WHERE request_id = 'req-dispose-all'); i int;
BEGIN
  FOR i IN 1..3 LOOP
    PERFORM register_batch_treatment_photo('11111111-1111-1111-1111-111111111111', tr, '11111111-1111-1111-1111-111111111111/1a000000-0000-0000-0000-00000000001a/' || tr || '/p' || i || '.jpg', 'image/jpeg', 1000, 'aaaaaaaa-0000-0000-0000-000000000001');
    INSERT INTO storage.objects (bucket_id, name) VALUES ('batch-treatment-photos', '11111111-1111-1111-1111-111111111111/1a000000-0000-0000-0000-00000000001a/' || tr || '/p' || i || '.jpg');
  END LOOP;
END $$;
SELECT t((SELECT count(*) FROM batch_treatment_photos) = 3, '3 photos enregistrées');
SELECT t(err(format($$SELECT register_batch_treatment_photo('11111111-1111-1111-1111-111111111111', %L, %L, 'image/jpeg', 1000, 'aaaaaaaa-0000-0000-0000-000000000001')$$,
  (SELECT id FROM batch_treatments WHERE request_id = 'req-dispose-all'), '11111111-1111-1111-1111-111111111111/1a000000-0000-0000-0000-00000000001a/' || (SELECT id FROM batch_treatments WHERE request_id = 'req-dispose-all') || '/p4.jpg')) = 'P0049', '4e photo → P0049');
SELECT t(err(format($$SELECT register_batch_treatment_photo('11111111-1111-1111-1111-111111111111', %L, %L, 'image/jpeg', 1000, 'aaaaaaaa-0000-0000-0000-000000000002')$$,
  (SELECT id FROM batch_treatments WHERE request_id = 'req-return'), '11111111-1111-1111-1111-111111111111/1a000000-0000-0000-0000-00000000001a/' || (SELECT id FROM batch_treatments WHERE request_id = 'req-return') || '/q.jpg')) = 'P0047', 'photo par un autre que l’auteur → P0047');
-- Fenêtre de 30 minutes : événement inséré directement avec une date ancienne (base de test seulement)
INSERT INTO batch_treatments (shop_id, batch_id, product_id, action, quantity, lot_qty_before, lot_qty_after, product_qty_before, product_qty_after, request_id, performed_by, created_at)
VALUES ('11111111-1111-1111-1111-111111111111', '1e000000-0000-0000-0000-00000000001e', 'e0000000-0000-0000-0000-00000000000e', 'quantity_adjustment', 1, 5, 6, 1, 2, 'req-old-31min', 'aaaaaaaa-0000-0000-0000-000000000001', now() - interval '31 minutes');
SELECT t(err(format($$SELECT register_batch_treatment_photo('11111111-1111-1111-1111-111111111111', %L, %L, 'image/jpeg', 1000, 'aaaaaaaa-0000-0000-0000-000000000001')$$,
  (SELECT id FROM batch_treatments WHERE request_id = 'req-old-31min'), '11111111-1111-1111-1111-111111111111/1e000000-0000-0000-0000-00000000001e/' || (SELECT id FROM batch_treatments WHERE request_id = 'req-old-31min') || '/o.jpg')) = 'P0049', 'photo après 30 minutes → P0049');
SELECT t(err($$UPDATE batch_treatment_photos SET size_bytes = 1$$) = '42501', 'modifier une photo → refusé');

-- ── Suppression complète de la boutique ──
-- Clés : seule l'allocation → lot est différable (contrôle immédiat par défaut) ; les 5 autres NO ACTION ne le sont pas
SELECT t((SELECT confdeltype = 'a' AND condeferrable AND NOT condeferred FROM pg_constraint WHERE conname = 'sale_item_batches_batch_id_fkey')
  AND (SELECT count(*) FROM pg_constraint WHERE contype = 'f' AND confdeltype = 'a' AND condeferrable) = 1
  AND (SELECT count(*) FROM pg_constraint WHERE contype = 'f' AND confdeltype = 'a' AND NOT condeferrable AND conname IN ('batch_treatments_batch_id_fkey',
       'batch_treatments_product_id_fkey', 'batch_treatments_corrects_treatment_id_fkey', 'stock_movements_batch_id_fkey', 'stock_movements_batch_treatment_id_fkey')) = 5,
  'clés : allocation → lot NO ACTION DEFERRABLE INITIALLY IMMEDIATE, les 5 autres NO ACTION non différables');
SELECT t(err($$SELECT delete_shops(ARRAY['11111111-1111-1111-1111-111111111111']::uuid[])$$) = 'P0049', 'boutique dont les fichiers photo existent encore → suppression REFUSÉE (garde de stockage)');
SELECT t((SELECT count(*) FROM batch_treatments) > 0 AND (SELECT count(*) FROM batch_treatment_photos) = 3, '… rien n’a été supprimé');
DELETE FROM storage.objects WHERE bucket_id = 'batch-treatment-photos';   -- = nettoyage par l'API Storage
SELECT t(err($$DELETE FROM shops WHERE id = '11111111-1111-1111-1111-111111111111'$$) = '23503', 'fichiers retirés, DELETE simple (sans delete_shops) d’une boutique avec lots vendus → refusé (23503)');
SELECT t((SELECT count(*) FROM shops WHERE id = '11111111-1111-1111-1111-111111111111') = 1 AND (SELECT count(*) FROM batch_treatments) > 0, '… rien n’a été supprimé');
SELECT t(err($$SELECT delete_shops(ARRAY['11111111-1111-1111-1111-111111111111']::uuid[])$$) IS NULL, 'fichiers retirés → delete_shops : suppression complète de la boutique RÉUSSIE');
SELECT t((SELECT count(*) FROM batch_treatments) = 0 AND (SELECT count(*) FROM batch_treatment_photos) = 0 AND (SELECT count(*) FROM stock_movements) = 0 AND (SELECT count(*) FROM product_batches) = 0,
  '… traitements, photos, mouvements et lots supprimés UNIQUEMENT dans ce cas');
SELECT t((SELECT count(*) FROM sales WHERE shop_id = '11111111-1111-1111-1111-111111111111') = 0 AND (SELECT count(*) FROM products WHERE shop_id = '11111111-1111-1111-1111-111111111111') = 0
  AND (SELECT count(*) FROM sale_item_batches) = 0 AND (SELECT count(*) FROM sale_items) = 0 AND (SELECT count(*) FROM shops WHERE id = '22222222-2222-2222-2222-222222222222') = 1,
  '… ventes, lignes, allocations et produits partis ; l’autre boutique intacte');

-- ── review_reason (cas A à F + sous-chaîne) ──
SELECT t(remove_review_reason('expired_stock_unresolved', 'expired_stock_unresolved') IS NULL, 'motif A : seul motif → NULL');
SELECT t(remove_review_reason('expired_stock_unresolved,other', 'expired_stock_unresolved') = 'other', 'motif B');
SELECT t(remove_review_reason('other,expired_stock_unresolved', 'expired_stock_unresolved') = 'other', 'motif C');
SELECT t(remove_review_reason('a,expired_stock_unresolved,b', 'expired_stock_unresolved') = 'a,b', 'motif D');
SELECT t(remove_review_reason(' a , expired_stock_unresolved ,b ', 'expired_stock_unresolved') = 'a,b', 'motif E : espaces');
SELECT t(remove_review_reason('stock_shortfall,other', 'expired_stock_unresolved') = 'stock_shortfall,other', 'motif F : autres motifs intacts');
SELECT t(remove_review_reason('not_expired_stock_unresolved,a,,', 'expired_stock_unresolved') = 'not_expired_stock_unresolved,a', 'sous-chaîne jamais retirée, virgules vides normalisées');

-- ── Droits ──
SELECT t(NOT has_function_privilege('anon', 'treat_batch(uuid,uuid,text,int,int,date,text,text,text,uuid,uuid)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'resolve_unallocated(uuid,uuid,uuid,uuid,int,text,text,uuid)', 'EXECUTE')
  AND has_function_privilege('service_role', 'treat_batch(uuid,uuid,text,int,int,date,text,text,text,uuid,uuid)', 'EXECUTE'), 'fonctions : serveur uniquement');
SELECT t(NOT has_function_privilege('service_role', 'adjust_batch_quantity(uuid,uuid,integer,text,uuid)', 'EXECUTE'), 'adjust_batch_quantity retirée au serveur');
SELECT t(has_function_privilege('service_role', 'delete_shops(uuid[])', 'EXECUTE') AND NOT has_function_privilege('authenticated', 'delete_shops(uuid[])', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'delete_shops(uuid[])', 'EXECUTE'), 'delete_shops : serveur uniquement');
SELECT t(NOT has_table_privilege('authenticated', 'batch_treatments', 'SELECT') AND NOT has_table_privilege('service_role', 'batch_treatments', 'INSERT')
  AND has_table_privilege('service_role', 'batch_treatments', 'SELECT') AND NOT has_table_privilege('service_role', 'batch_treatment_photos', 'DELETE'), 'tables : lecture serveur seulement');
SELECT t((SELECT public = false AND file_size_limit = 2097152 FROM storage.buckets WHERE id = 'batch-treatment-photos'), 'espace de stockage privé, 2 Mo');

SELECT CASE WHEN ok THEN 'ok   ' ELSE 'ÉCHEC' END || ' ' || label FROM t_res ORDER BY n;
SELECT count(*) FILTER (WHERE ok) || ' réussis, ' || count(*) FILTER (WHERE NOT ok) || ' échec(s)' FROM t_res;

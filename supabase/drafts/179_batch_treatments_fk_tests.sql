-- 179 — banc des clés lot / produit / boutique (base LOCALE jetable uniquement, après le schéma minimal + la migration)
-- A-D suppressions directes ; G0-G4 delete_shops (contrôle immédiat, report ciblé, atomicité) ; E1-E3 boutique ; F résidus.

-- ═════ pg179-fk-setup.sql ═════
-- Banc d'essai des clés « lot / produit » de la 179 — base LOCALE jetable uniquement.
-- Boutique TEST 3333 (à supprimer) + boutique TÉMOIN 4444 (doit rester intacte).
SET client_min_messages = warning;
CREATE TABLE t_res (n serial, ok boolean, label text);
CREATE FUNCTION t(c boolean, m text) RETURNS void LANGUAGE sql AS $$ INSERT INTO t_res(ok, label) VALUES (coalesce(c, false), m) $$;
CREATE FUNCTION err(q text) RETURNS text LANGUAGE plpgsql AS $$
BEGIN EXECUTE q; RETURN NULL; EXCEPTION WHEN others THEN RETURN SQLSTATE; END $$;
-- Date du jour DES BOUTIQUES DE TEST (Africa/Douala), jamais current_date : le serveur local peut être dans un
-- autre fuseau (Europe/Paris), et la 179 juge la péremption à la date de la boutique.
CREATE OR REPLACE FUNCTION d0() RETURNS date LANGUAGE sql STABLE AS $$ SELECT (now() AT TIME ZONE 'Africa/Douala')::date $$;

-- Journal de l'ordre réel des suppressions (déclencheurs de trace, base jetable seulement)
CREATE TABLE t_order (n bigserial, tbl text);
CREATE FUNCTION t_log() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN INSERT INTO t_order(tbl) VALUES (TG_TABLE_NAME); RETURN OLD; END $$;
DO $$ DECLARE r text; BEGIN
  FOREACH r IN ARRAY ARRAY['shops','products','product_batches','sales','sale_items','sale_item_batches','stock_movements','batch_treatments','batch_treatment_photos'] LOOP
    EXECUTE format('CREATE TRIGGER zz_t_log AFTER DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION t_log()', r);
  END LOOP; END $$;

INSERT INTO shops (id, name) VALUES ('33333333-3333-3333-3333-333333333333', 'TEST'), ('44444444-4444-4444-4444-444444444444', 'TÉMOIN');
INSERT INTO profiles VALUES ('aaaaaaaa-0000-0000-0000-000000000001', 'Gérant Test');
-- P1 : produit vendu (lot L1 vendu, lot L4 sans historique) ; P2 : produit traité (lot L2 traité, lot L3 avec
-- mouvement lié seulement) ; P3 : produit sans historique ; W : témoin dans l'autre boutique
INSERT INTO products (id, shop_id, name, quantity) VALUES
  ('a1000000-0000-0000-0000-000000000001', '33333333-3333-3333-3333-333333333333', 'P1', 9),
  ('a2000000-0000-0000-0000-000000000002', '33333333-3333-3333-3333-333333333333', 'P2', 10),
  ('a3000000-0000-0000-0000-000000000003', '33333333-3333-3333-3333-333333333333', 'P3', 1),
  ('a4000000-0000-0000-0000-000000000004', '44444444-4444-4444-4444-444444444444', 'W', 4);
INSERT INTO product_batches (id, shop_id, product_id, quantity, initial_quantity, created_at) VALUES
  ('b1000000-0000-0000-0000-000000000001', '33333333-3333-3333-3333-333333333333', 'a1000000-0000-0000-0000-000000000001', 4, 5, now() - interval '5 days'),
  ('b4000000-0000-0000-0000-000000000004', '33333333-3333-3333-3333-333333333333', 'a1000000-0000-0000-0000-000000000001', 5, 5, now() - interval '5 days'),
  ('b2000000-0000-0000-0000-000000000002', '33333333-3333-3333-3333-333333333333', 'a2000000-0000-0000-0000-000000000002', 5, 5, now() - interval '5 days'),
  ('b3000000-0000-0000-0000-000000000003', '33333333-3333-3333-3333-333333333333', 'a2000000-0000-0000-0000-000000000002', 5, 5, now() - interval '5 days'),
  ('b5000000-0000-0000-0000-000000000005', '33333333-3333-3333-3333-333333333333', 'a3000000-0000-0000-0000-000000000003', 1, 1, now() - interval '5 days'),
  ('b9000000-0000-0000-0000-000000000009', '44444444-4444-4444-4444-444444444444', 'a4000000-0000-0000-0000-000000000004', 4, 5, now() - interval '5 days');
INSERT INTO sales (id, shop_id, sale_number, created_at) VALUES
  ('c1000000-0000-0000-0000-000000000001', '33333333-3333-3333-3333-333333333333', 'TEST-1', now() - interval '1 day'),
  ('c9000000-0000-0000-0000-000000000009', '44444444-4444-4444-4444-444444444444', 'TEM-1', now() - interval '1 day');
INSERT INTO sale_items (id, sale_id, product_id, quantity) VALUES
  ('d1000000-0000-0000-0000-000000000001', 'c1000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000001', 1),
  ('d9000000-0000-0000-0000-000000000009', 'c9000000-0000-0000-0000-000000000009', 'a4000000-0000-0000-0000-000000000004', 1);
INSERT INTO sale_item_batches (id, sale_item_id, batch_id, quantity) VALUES
  ('e1000000-0000-0000-0000-000000000001', 'd1000000-0000-0000-0000-000000000001', 'b1000000-0000-0000-0000-000000000001', 1),
  ('e9000000-0000-0000-0000-000000000009', 'd9000000-0000-0000-0000-000000000009', 'b9000000-0000-0000-0000-000000000009', 1);
-- Traitement réel sur L2 (ajustement +1, écrit aussi le mouvement lié) ; puis une correction de date (2e événement)
SELECT treat_batch('33333333-3333-3333-3333-333333333333', 'b2000000-0000-0000-0000-000000000002', 'quantity_adjustment', NULL, 6, NULL,
  'counting_error', NULL, 'req-fk-adj-1', 'aaaaaaaa-0000-0000-0000-000000000001', NULL);
SELECT treat_batch('33333333-3333-3333-3333-333333333333', 'b2000000-0000-0000-0000-000000000002', 'date_correction', NULL, NULL, d0() + 60,
  NULL, 'étiquette relue', 'req-fk-date-1', 'aaaaaaaa-0000-0000-0000-000000000001', NULL);
-- L3 : mouvement lié au lot SANS traitement (cas C)
INSERT INTO stock_movements (shop_id, product_id, type, quantity, previous_qty, new_qty, reason, batch_id)
VALUES ('33333333-3333-3333-3333-333333333333', 'a2000000-0000-0000-0000-000000000002', 'adjustment', 0, 11, 11, 'test C', 'b3000000-0000-0000-0000-000000000003');
-- Photo sur le traitement de L2 + son fichier
INSERT INTO storage.buckets VALUES ('batch-treatment-photos', 'batch-treatment-photos', false, 2097152, NULL) ON CONFLICT DO NOTHING;
DO $$ DECLARE tr uuid := (SELECT id FROM batch_treatments WHERE request_id = 'req-fk-adj-1'); p text; BEGIN
  p := '33333333-3333-3333-3333-333333333333/b2000000-0000-0000-0000-000000000002/' || tr || '/p1.jpg';
  PERFORM register_batch_treatment_photo('33333333-3333-3333-3333-333333333333', tr, p, 'image/jpeg', 1000, 'aaaaaaaa-0000-0000-0000-000000000001');
  INSERT INTO storage.objects (bucket_id, name) VALUES ('batch-treatment-photos', p);
END $$;

SELECT t((SELECT count(*) FROM batch_treatments) = 2 AND (SELECT count(*) FROM batch_treatment_photos) = 1
  AND (SELECT count(*) FROM stock_movements WHERE batch_id IS NOT NULL) = 2, 'données : 2 traitements, 1 photo, 2 mouvements liés à un lot');

-- ═════ pg179-fk-direct.sql ═════
-- A à D : suppressions DIRECTES, fonctionnement normal (aucun SET CONSTRAINTS). Chaque refus annule l'instruction.
SET client_min_messages = warning;
-- A — lot vendu
SELECT t(err($$DELETE FROM product_batches WHERE id = 'b1000000-0000-0000-0000-000000000001'$$) = '23503', 'A : suppression directe du lot VENDU → refusée (23503)');
SELECT t((SELECT count(*) FROM sale_item_batches WHERE id = 'e1000000-0000-0000-0000-000000000001' AND batch_id = 'b1000000-0000-0000-0000-000000000001') = 1
  AND (SELECT count(*) FROM product_batches WHERE id = 'b1000000-0000-0000-0000-000000000001') = 1, 'A : allocation intacte (batch_id NON vidé), lot intact');
-- B — lot traité
SELECT t(err($$DELETE FROM product_batches WHERE id = 'b2000000-0000-0000-0000-000000000002'$$) = '23503', 'B : suppression directe du lot TRAITÉ → refusée (23503)');
SELECT t((SELECT count(*) FROM batch_treatments WHERE batch_id = 'b2000000-0000-0000-0000-000000000002') = 2, 'B : 2 traitements intacts');
-- C — lot avec mouvement lié seulement
SELECT t(err($$DELETE FROM product_batches WHERE id = 'b3000000-0000-0000-0000-000000000003'$$) = '23503', 'C : suppression directe du lot avec MOUVEMENT lié → refusée (23503)');
SELECT t((SELECT count(*) FROM stock_movements WHERE batch_id = 'b3000000-0000-0000-0000-000000000003') = 1, 'C : mouvement intact, batch_id conservé');
-- Témoin : un lot sans historique se supprime toujours
SELECT t(err($$DELETE FROM product_batches WHERE id = 'b4000000-0000-0000-0000-000000000004'$$) IS NULL, 'témoin : lot SANS historique → suppression acceptée');
-- D — produits
SELECT t(err($$DELETE FROM products WHERE id = 'a1000000-0000-0000-0000-000000000001'$$) = '23503', 'D : produit VENDU (lot vendu) → refusé (23503) — la route archive');
SELECT t(err($$DELETE FROM products WHERE id = 'a2000000-0000-0000-0000-000000000002'$$) = '23503', 'D : produit TRAITÉ → refusé (23503) — la route archive');
SELECT t((SELECT count(*) FROM products WHERE id IN ('a1000000-0000-0000-0000-000000000001', 'a2000000-0000-0000-0000-000000000002')) = 2
  AND (SELECT count(*) FROM product_batches WHERE product_id IN ('a1000000-0000-0000-0000-000000000001', 'a2000000-0000-0000-0000-000000000002')) = 3, 'D : produits et lots intacts');
SELECT t(err($$DELETE FROM products WHERE id = 'a3000000-0000-0000-0000-000000000003'$$) IS NULL, 'témoin : produit SANS historique → suppression acceptée');
-- Traitement : jamais supprimable tant que la boutique existe
SELECT t(err($$DELETE FROM batch_treatments WHERE request_id = 'req-fk-date-1'$$) = '42501', 'traitement : suppression directe refusée (42501)');
TRUNCATE t_order;

-- ═════ pg179-fk-shop.sql ═════
-- E / G — suppression de boutique par delete_shops (brouillon 179 tel quel). Base LOCALE jetable uniquement.
SET client_min_messages = warning;
-- G0 : dans la MÊME transaction, après delete_shops, la clé est de nouveau immédiate
CREATE FUNCTION t_g0() RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM delete_shops('{}'::uuid[]);
  DELETE FROM product_batches WHERE id = 'b9000000-0000-0000-0000-000000000009';
END $$;
SELECT t(err('SELECT t_g0()') = '23503', 'G0 : après delete_shops, même transaction : lot vendu → refusé immédiatement (23503)');
-- G1 : différer la clé ne laisse jamais passer une suppression de lot vendu (refus au retour immédiat)
CREATE FUNCTION t_g1() RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  SET CONSTRAINTS public.sale_item_batches_batch_id_fkey DEFERRED;
  DELETE FROM product_batches WHERE id = 'b1000000-0000-0000-0000-000000000001';
  SET CONSTRAINTS public.sale_item_batches_batch_id_fkey IMMEDIATE;
END $$;
SELECT t(err('SELECT t_g1()') = '23503', 'G1 : lot vendu supprimé sous report → refusé dans l’appel (23503)');
SELECT t((SELECT count(*) FROM sale_item_batches WHERE batch_id IN ('b1000000-0000-0000-0000-000000000001', 'b9000000-0000-0000-0000-000000000009')) = 2
  AND (SELECT count(*) FROM product_batches WHERE id IN ('b1000000-0000-0000-0000-000000000001', 'b9000000-0000-0000-0000-000000000009')) = 2, 'G0/G1 : lots et allocations intacts');
-- G2 : identifiant inconnu → 0 boutique, rien d'autre touché
SELECT t(delete_shops(ARRAY['99999999-9999-9999-9999-999999999999']::uuid[]) = 0 AND delete_shops(NULL) = 0 AND (SELECT count(*) FROM shops) = 2, 'G2 : identifiant inconnu ou vide → 0, rien supprimé');
-- G4 : ATOMICITÉ — une violation détectée au retour en contrôle immédiat annule TOUTE la fonction.
-- Boutique TEST-ATOM : son lot est référencé par une allocation dont la vente appartient à la boutique TÉMOIN
-- (incohérence volontaire, base jetable) : supprimer TEST-ATOM supprime le lot mais pas cette allocation.
INSERT INTO shops (id, name) VALUES ('66666666-6666-6666-6666-666666666666', 'TEST-ATOM');
INSERT INTO products (id, shop_id, name, quantity) VALUES ('a6000000-0000-0000-0000-000000000006', '66666666-6666-6666-6666-666666666666', 'P6', 1);
INSERT INTO product_batches (id, shop_id, product_id, quantity, initial_quantity) VALUES ('b6600000-0000-0000-0000-000000000006', '66666666-6666-6666-6666-666666666666', 'a6000000-0000-0000-0000-000000000006', 1, 2);
INSERT INTO sales (id, shop_id, sale_number) VALUES ('c6600000-0000-0000-0000-000000000006', '66666666-6666-6666-6666-666666666666', 'ATOM-1');
INSERT INTO sale_items (id, sale_id, product_id, quantity) VALUES ('d6600000-0000-0000-0000-000000000006', 'c6600000-0000-0000-0000-000000000006', 'a6000000-0000-0000-0000-000000000006', 1);
INSERT INTO sale_item_batches (id, sale_item_id, batch_id, quantity) VALUES ('e6600000-0000-0000-0000-000000000006', 'd6600000-0000-0000-0000-000000000006', 'b6600000-0000-0000-0000-000000000006', 1);
INSERT INTO sale_item_batches (id, sale_item_id, batch_id, quantity) VALUES ('e6700000-0000-0000-0000-000000000007', 'd9000000-0000-0000-0000-000000000009', 'b6600000-0000-0000-0000-000000000006', 1);
SELECT t(err($$SELECT delete_shops(ARRAY['66666666-6666-6666-6666-666666666666']::uuid[])$$) = '23503', 'G4 : violation au retour IMMEDIATE → delete_shops refusée (23503)');
SELECT t((SELECT count(*) FROM shops WHERE id = '66666666-6666-6666-6666-666666666666') = 1
  AND (SELECT count(*) FROM products WHERE id = 'a6000000-0000-0000-0000-000000000006') = 1
  AND (SELECT count(*) FROM product_batches WHERE id = 'b6600000-0000-0000-0000-000000000006') = 1
  AND (SELECT count(*) FROM sales WHERE id = 'c6600000-0000-0000-0000-000000000006') = 1
  AND (SELECT count(*) FROM sale_item_batches WHERE id IN ('e6600000-0000-0000-0000-000000000006', 'e6700000-0000-0000-0000-000000000007') AND batch_id IS NOT NULL) = 2,
  'G4 : annulation ATOMIQUE — boutique, produit, lot, vente et allocations tous intacts');
-- Nettoyage du cas G4 par identifiants (l'allocation incohérente d'abord, puis la boutique)
DELETE FROM sale_item_batches WHERE id = 'e6700000-0000-0000-0000-000000000007';
SELECT t(delete_shops(ARRAY['66666666-6666-6666-6666-666666666666']::uuid[]) = 1, 'G4 : incohérence retirée → delete_shops supprime TEST-ATOM');
-- E1 : fichier photo encore stocké → refus P0049, rien retiré
SELECT t(err($$SELECT delete_shops(ARRAY['33333333-3333-3333-3333-333333333333']::uuid[])$$) = 'P0049', 'E1 : delete_shops + fichier encore stocké → refus P0049');
SELECT t((SELECT count(*) FROM shops WHERE id = '33333333-3333-3333-3333-333333333333') = 1 AND (SELECT count(*) FROM batch_treatment_photos) = 1
  AND (SELECT count(*) FROM batch_treatments) = 2 AND (SELECT count(*) FROM sale_item_batches) = 2, 'E1 : rien retiré');
DELETE FROM storage.objects WHERE bucket_id = 'batch-treatment-photos';   -- = nettoyage par l'API Storage
-- E2 : DELETE simple (sans delete_shops) → toujours refusé
SELECT t(err($$DELETE FROM shops WHERE id = '33333333-3333-3333-3333-333333333333'$$) = '23503', 'E2 : DELETE simple d’une boutique avec lot vendu → refusé (23503)');
-- G3 : supprimer une VENTE ne demande aucun report (allocations parties, lot gardé)
INSERT INTO sales (id, shop_id, sale_number) VALUES ('c6000000-0000-0000-0000-000000000006', '44444444-4444-4444-4444-444444444444', 'TEM-2');
INSERT INTO sale_items (id, sale_id, product_id, quantity) VALUES ('d6000000-0000-0000-0000-000000000006', 'c6000000-0000-0000-0000-000000000006', 'a4000000-0000-0000-0000-000000000004', 1);
INSERT INTO sale_item_batches (sale_item_id, batch_id, quantity) VALUES ('d6000000-0000-0000-0000-000000000006', 'b9000000-0000-0000-0000-000000000009', 1);
SELECT t(err($$DELETE FROM sales WHERE id = 'c6000000-0000-0000-0000-000000000006'$$) IS NULL, 'G3 : supprimer une vente → acceptée sans report');
SELECT t((SELECT count(*) FROM product_batches WHERE id = 'b9000000-0000-0000-0000-000000000009') = 1
  AND (SELECT count(*) FROM sales WHERE id = 'c6000000-0000-0000-0000-000000000006') = 0
  AND (SELECT count(*) FROM sale_item_batches WHERE sale_item_id = 'd6000000-0000-0000-0000-000000000006') = 0, 'G3 : … allocations parties, lot gardé');
TRUNCATE t_order;
-- E3 : delete_shops → suppression complète
SELECT t(delete_shops(ARRAY['33333333-3333-3333-3333-333333333333']::uuid[]) = 1, 'E3 : delete_shops → 1 boutique supprimée');

-- Ordre réel des suppressions de la boutique (journal des déclencheurs de trace)
SELECT 'ordre réel des suppressions : ' || coalesce(string_agg(tbl, ' → ' ORDER BY m), '(rien)') FROM (SELECT tbl, min(n) m FROM t_order GROUP BY tbl) x;

-- ═════ résidus ═════
-- F — après la tentative de suppression de la boutique TEST : résidus et boutique témoin
SET client_min_messages = warning;
SELECT t((SELECT count(*) FROM shops WHERE id = '33333333-3333-3333-3333-333333333333') = 0, 'E : boutique TEST supprimée');
SELECT t((SELECT count(*) FROM sales WHERE shop_id = '33333333-3333-3333-3333-333333333333') = 0
  AND (SELECT count(*) FROM sale_items WHERE id IN ('d1000000-0000-0000-0000-000000000001')) = 0
  AND (SELECT count(*) FROM sale_item_batches WHERE id = 'e1000000-0000-0000-0000-000000000001') = 0
  AND (SELECT count(*) FROM product_batches WHERE shop_id = '33333333-3333-3333-3333-333333333333') = 0
  AND (SELECT count(*) FROM batch_treatments WHERE shop_id = '33333333-3333-3333-3333-333333333333') = 0
  AND (SELECT count(*) FROM batch_treatment_photos WHERE shop_id = '33333333-3333-3333-3333-333333333333') = 0
  AND (SELECT count(*) FROM stock_movements WHERE shop_id = '33333333-3333-3333-3333-333333333333') = 0
  AND (SELECT count(*) FROM products WHERE shop_id = '33333333-3333-3333-3333-333333333333') = 0, 'F : 0 ligne restante pour la boutique TEST (8 tables)');
SELECT t((SELECT count(*) FROM sale_item_batches WHERE batch_id IS NULL) = 0
  AND (SELECT count(*) FROM sale_item_batches sib WHERE NOT EXISTS (SELECT 1 FROM product_batches b WHERE b.id = sib.batch_id)) = 0
  AND (SELECT count(*) FROM stock_movements m WHERE m.batch_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM product_batches b WHERE b.id = m.batch_id)) = 0
  AND (SELECT count(*) FROM batch_treatments x WHERE NOT EXISTS (SELECT 1 FROM product_batches b WHERE b.id = x.batch_id)) = 0, 'F : aucune référence orpheline, aucune allocation vidée');
SELECT t((SELECT count(*) FROM shops WHERE id = '44444444-4444-4444-4444-444444444444') = 1
  AND (SELECT count(*) FROM sale_item_batches WHERE id = 'e9000000-0000-0000-0000-000000000009' AND batch_id = 'b9000000-0000-0000-0000-000000000009') = 1
  AND (SELECT count(*) FROM product_batches WHERE shop_id = '44444444-4444-4444-4444-444444444444') = 1, 'F : boutique TÉMOIN intacte (lot, vente, allocation)');
SELECT CASE WHEN ok THEN 'ok   ' ELSE 'ÉCHEC' END || ' ' || label FROM t_res ORDER BY n;
SELECT count(*) FILTER (WHERE ok) || ' réussis, ' || count(*) FILTER (WHERE NOT ok) || ' échec(s)' FROM t_res;

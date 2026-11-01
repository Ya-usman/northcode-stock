#!/bin/bash
# Validation LOCALE de 199 (numéros de série, lot C : transferts) — base PostgreSQL jetable UNIQUEMENT.
# Les fonctions de transfert de la 188 ne sont pas modifiées par la 199 : elles sont SIMULÉES ici (statuts, quantités,
# produit d'arrivée) ; l'enchaînement réel est vérifié par le test réel tests/e2e/rt-199-transfer-serials.js.
# Usage (racine du dépôt) : bash supabase/drafts/199_local_validation.sh
set -u
export PGCLIENTENCODING=UTF8
BIN="${PSQL_BIN:-/c/Program Files/PostgreSQL/18/bin}"; PORT="${PGPORT:-55432}"; HOST=localhost
P() { "$BIN/psql.exe" -h "$HOST" -p "$PORT" -U postgres -v ON_ERROR_STOP=1 -X -q -tA "$@"; }
DB=r199
Q() { P -d $DB -c "$1" 2>&1 | tail -1; }
ERR() { P -d $DB -c "$1" 2>&1 | grep -m1 -E '^(ERROR|ERREUR)' | grep -oE '(serial_[a-z_]+|permission denied)' | head -1; }
pass=0; fail=0
ok() { if [ "$1" = "$2" ]; then pass=$((pass+1)); echo "ok    $3"; else fail=$((fail+1)); echo "ÉCHEC $3"; echo "      attendu : $2"; echo "      obtenu  : $1"; fi; }

P -d postgres -c "drop database if exists $DB" -c "create database $DB" >/dev/null
P -d $DB <<'SQL' >/dev/null || { echo "schéma local impossible"; exit 2; }
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role; END IF;
END $$;
CREATE TABLE shops (id uuid primary key, name text);
CREATE TABLE products (id uuid primary key, shop_id uuid, name text, quantity int not null default 0, track_serials boolean not null default false);
CREATE TABLE stock_transfers (id uuid primary key default gen_random_uuid(), reference text, source_shop_id uuid, destination_shop_id uuid, status text);
CREATE TABLE stock_transfer_items (id uuid primary key default gen_random_uuid(), stock_transfer_id uuid, source_product_id uuid, product_name text,
  quantity_sent int, quantity_received int, destination_product_id uuid);
CREATE TABLE product_serials (id uuid primary key default gen_random_uuid(), shop_id uuid, product_id uuid, serial text, status text, source text,
  batch_id uuid, sale_item_id uuid, sold_at timestamptz, transfer_id uuid, removed_reason text, received_at timestamptz, updated_at timestamptz);
CREATE UNIQUE INDEX ON product_serials(shop_id, upper(serial));
-- Simulations de la 188 (effets utiles seulement)
CREATE FUNCTION create_stock_transfer(p_source uuid, p_dest uuid, p_user uuid, p_notes text, p_items jsonb, p_send boolean DEFAULT false) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE v uuid; BEGIN
  INSERT INTO stock_transfers (reference, source_shop_id, destination_shop_id, status) VALUES ('TR-T', p_source, p_dest, 'draft') RETURNING id INTO v;
  INSERT INTO stock_transfer_items (stock_transfer_id, source_product_id, product_name, quantity_sent)
    SELECT v, (e->>'product_id')::uuid, (SELECT name FROM products WHERE id = (e->>'product_id')::uuid), (e->>'quantity')::int FROM jsonb_array_elements(p_items) e;
  RETURN jsonb_build_object('id', v, 'status', 'draft'); END $$;
CREATE FUNCTION send_stock_transfer_draft(p_transfer_id uuid, p_source uuid, p_user uuid) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE s text; BEGIN
  SELECT status INTO s FROM stock_transfers WHERE id = p_transfer_id;
  IF s = 'sent' THEN RETURN jsonb_build_object('id', p_transfer_id, 'already_sent', true); END IF;
  UPDATE products p SET quantity = p.quantity - i.quantity_sent FROM stock_transfer_items i WHERE i.stock_transfer_id = p_transfer_id AND p.id = i.source_product_id;
  UPDATE stock_transfers SET status = 'sent' WHERE id = p_transfer_id;
  RETURN jsonb_build_object('id', p_transfer_id, 'status', 'sent', 'already_sent', false); END $$;
CREATE FUNCTION receive_stock_transfer_final(p_transfer_id uuid, p_dest uuid, p_user uuid, p_receipt_key uuid, p_lines jsonb) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE s text; it record; l jsonb; d uuid; BEGIN
  SELECT status INTO s FROM stock_transfers WHERE id = p_transfer_id;
  IF s = 'received' THEN RETURN jsonb_build_object('replayed', true); END IF;
  FOR it IN SELECT * FROM stock_transfer_items WHERE stock_transfer_id = p_transfer_id LOOP
    SELECT x INTO l FROM jsonb_array_elements(p_lines) x WHERE (x->>'item_id')::uuid = it.id;
    d := NULLIF(l->>'destination_product_id', '')::uuid;
    IF d IS NULL THEN INSERT INTO products (id, shop_id, name) VALUES (gen_random_uuid(), p_dest, it.product_name) RETURNING id INTO d; END IF;
    UPDATE products SET quantity = quantity + (l->>'quantity_received')::int WHERE id = d;
    UPDATE stock_transfer_items SET quantity_received = (l->>'quantity_received')::int, destination_product_id = d WHERE id = it.id;
  END LOOP;
  UPDATE stock_transfers SET status = 'received' WHERE id = p_transfer_id;
  RETURN jsonb_build_object('status', 'received', 'replayed', false); END $$;
SQL

A=11111111-1111-1111-1111-111111111111; B=11111111-1111-1111-1111-111111111112
PA=aaaaaaaa-0000-0000-0000-000000000001; PN=aaaaaaaa-0000-0000-0000-000000000002; PB=bbbbbbbb-0000-0000-0000-000000000001; U=99999999-0000-0000-0000-000000000001
P -d $DB -c "insert into shops values ('$A','Akwa'),('$B','Bastos');
  insert into products values ('$PA','$A','Telephone',4,true),('$PN','$A','Riz',10,false),('$PB','$B','Telephone',0,false);
  insert into product_serials (shop_id, product_id, serial, status) values ('$A','$PA','S1','in_stock'),('$A','$PA','S2','in_stock'),('$A','$PA','S3','in_stock'),('$A','$PA','S4','in_stock');
  insert into product_serials (shop_id, product_id, serial, status, removed_reason) values ('$B','$PB','S3','sold',null)" >/dev/null
for i in 1 2; do P -d $DB -1 -f supabase/migrations/199_transfer_serials.sql >/dev/null 2>&1 && echo "passage $i ok" || { echo "passage $i ÉCHEC"; P -d $DB -1 -f supabase/migrations/199_transfer_serials.sql; exit 1; }; done

ITEMS="[{\"product_id\":\"$PA\",\"quantity\":3},{\"product_id\":\"$PN\",\"quantity\":2}]"
ok "$(ERR "select create_transfer_with_serials('$A','$B','$U',null,'$ITEMS','[{\"product_id\":\"$PA\",\"serials\":[\"S1\",\"S2\"]}]')")" "serial_count_mismatch" "envoi : 2 numéros pour 3 unités refusé"
ok "$(Q "select count(*) from stock_transfers")|$(Q "select quantity from products where id='$PA'")" "0|4" "refus : aucun transfert, stock inchangé (tout annulé)"
ok "$(ERR "select create_transfer_with_serials('$A','$B','$U',null,'$ITEMS','[{\"product_id\":\"$PA\",\"serials\":[\"S1\",\"S2\",\"s1\"]}]')")" "serial_duplicate_input" "envoi : même numéro deux fois refusé"
ok "$(ERR "select create_transfer_with_serials('$A','$B','$U',null,'$ITEMS','[{\"product_id\":\"$PA\",\"serials\":[\"S1\",\"S2\",\"INCONNU\"]}]')")" "serial_not_in_stock" "envoi : numéro inconnu refusé"
TR=$(Q "select (create_transfer_with_serials('$A','$B','$U',null,'$ITEMS','[{\"product_id\":\"$PA\",\"serials\":[\"S1\",\"s2\",\"S3\"]}]'))->>'id'")
ok "$(Q "select string_agg(serial||':'||status, ',' order by serial) from product_serials where shop_id='$A'")" "S1:in_transit,S2:in_transit,S3:in_transit,S4:in_stock" "envoyé : S1, S2, S3 en transit, S4 reste en stock"
ok "$(Q "select count(*) from product_serials where transfer_id='$TR' and transfer_item_id is not null")" "3" "numéros rattachés au transfert et à sa ligne"
ok "$(Q "select (send_transfer_with_serials('$TR','$A','$U','[]'))->>'already_sent'")" "true" "renvoi de l'envoi : rien de plus"

IT=$(Q "select id from stock_transfer_items where stock_transfer_id='$TR' and source_product_id='$PA'"); IN=$(Q "select id from stock_transfer_items where stock_transfer_id='$TR' and source_product_id='$PN'")
LINES_BAD="[{\"item_id\":\"$IT\",\"quantity_received\":2,\"serials_received\":[\"S1\"]},{\"item_id\":\"$IN\",\"quantity_received\":2}]"
ok "$(ERR "select receive_transfer_with_serials('$TR','$B','$U',gen_random_uuid(),'$LINES_BAD')")" "serial_count_mismatch" "réception : 1 numéro pour 2 unités refusée"
ok "$(ERR "select receive_transfer_with_serials('$TR','$B','$U',gen_random_uuid(),'[{\"item_id\":\"$IT\",\"quantity_received\":1,\"serials_received\":[\"S4\"]},{\"item_id\":\"$IN\",\"quantity_received\":2}]')")" "serial_not_in_transit" "réception : numéro pas en transit (S4) refusé"
ok "$(Q "select status from stock_transfers where id='$TR'")" "sent" "refus : transfert toujours en transit"
# Réception : S1 et S3 arrivés (S3 déjà connu à Bastos, vendu), S2 manquant ; produit d'arrivée existant non suivi
LINES="[{\"item_id\":\"$IT\",\"quantity_received\":2,\"destination_product_id\":\"$PB\",\"serials_received\":[\"s1\",\"S3\"]},{\"item_id\":\"$IN\",\"quantity_received\":2}]"
P -d $DB -c "select receive_transfer_with_serials('$TR','$B','$U','00000000-0000-0000-0000-0000000000aa','$LINES')" >/dev/null
ok "$(Q "select track_serials from products where id='$PB'")" "t" "produit d'arrivée : suivi activé"
ok "$(Q "select string_agg(serial||':'||status, ',' order by serial) from product_serials where shop_id='$B'")" "S1:in_stock,S3:in_stock" "Bastos : S1 et S3 en stock (S1 déplacé, S3 ligne existante reprise)"
ok "$(Q "select count(*) from product_serials where shop_id='$B' and product_id='$PB' and status='in_stock'")" "2" "rattachés au produit d'arrivée"
ok "$(Q "select status||'|'||removed_reason from product_serials where shop_id='$A' and serial='S2'")" "removed|Manquant au transfert TR-T" "S2 non arrivé : retiré, « manquant au transfert »"
ok "$(Q "select status||'|'||left(removed_reason,21) from product_serials where shop_id='$A' and serial='S3'")" "removed|Transféré vers Bastos" "S3 du départ : ligne close (la ligne de Bastos reprend)"
ok "$(Q "select count(*) from product_serials where status='in_transit'")" "0" "plus aucun numéro en transit"
P -d $DB -c "select receive_transfer_with_serials('$TR','$B','$U','00000000-0000-0000-0000-0000000000aa','$LINES')" >/dev/null
ok "$(Q "select count(*) from product_serials where shop_id='$B' and status='in_stock'")" "2" "renvoi de la réception : rien de plus"

# Annulation d'un transfert en transit : numéros remis en stock au départ
TR2=$(Q "select (create_transfer_with_serials('$A','$B','$U',null,'[{\"product_id\":\"$PA\",\"quantity\":1}]','[{\"product_id\":\"$PA\",\"serials\":[\"S4\"]}]'))->>'id'")
ok "$(Q "select status from product_serials where serial='S4' and shop_id='$A'")" "in_transit" "S4 envoyé"
P -d $DB -c "update stock_transfers set status='cancelled' where id='$TR2'" >/dev/null
ok "$(Q "select status||'|'||(transfer_id is null) from product_serials where serial='S4' and shop_id='$A'")" "in_stock|true" "transfert annulé : S4 remis en stock au départ"
# Produit non suivi : rien ne change
TR3=$(Q "select (create_transfer_with_serials('$A','$B','$U',null,'[{\"product_id\":\"$PN\",\"quantity\":1}]','[]'))->>'id'")
ok "$(Q "select status from stock_transfers where id='$TR3'")" "sent" "produit non suivi : envoi sans numéro, comme avant"
ok "$(ERR "set role authenticated; select send_transfer_with_serials(null,null,null,'[]')")" "permission denied" "fonctions non exécutables par les connectés"

P -d $DB -1 -f supabase/rollbacks/199_transfer_serials_rollback.sql >/dev/null 2>&1 || echo "retour arrière ÉCHEC"
ok "$(Q "select count(*) from pg_proc where proname in ('send_transfer_with_serials','receive_transfer_with_serials','create_transfer_with_serials')")|$(Q "select count(*) from information_schema.columns where table_name='product_serials' and column_name='transfer_item_id'")" "0|0" "retour arrière : fonctions et colonne retirées"
P -d $DB -1 -f supabase/migrations/199_transfer_serials.sql >/dev/null 2>&1 && echo "ré-application ok" || echo "ré-application ÉCHEC"
echo; echo "$pass réussis, $fail échec(s)"
P -d postgres -c "drop database if exists $DB" >/dev/null
exit $fail

#!/bin/bash
# Validation LOCALE de 197 (numéros de série, lot A) — base PostgreSQL jetable UNIQUEMENT, jamais la production.
# Schéma minimal des tables touchées ; apply_purchase_order_receipt de PRODUCTION (drafts/197_prod) installée d'abord
# pour comparer : un produit NON suivi doit donner exactement le même résultat avant et après la 197.
# Usage (racine du dépôt) : bash supabase/drafts/197_local_validation.sh
set -u
export PGCLIENTENCODING=UTF8
BIN="${PSQL_BIN:-/c/Program Files/PostgreSQL/18/bin}"; PORT="${PGPORT:-55432}"; HOST=localhost
P() { "$BIN/psql.exe" -h "$HOST" -p "$PORT" -U postgres -v ON_ERROR_STOP=1 -X -q -tA "$@"; }
DB=r197
Q() { P -d $DB -c "$1" 2>&1 | tail -1; }
ERR() { P -d $DB -c "$1" 2>&1 | grep -m1 -E '^(ERROR|ERREUR)' | grep -oE '(serial_[a-z_]+|product_not_tracked|permission denied|violates [a-z ]+ constraint)' | head -1; }
pass=0; fail=0
ok() { if [ "$1" = "$2" ]; then pass=$((pass+1)); echo "ok    $3"; else fail=$((fail+1)); echo "ÉCHEC $3"; echo "      attendu : $2"; echo "      obtenu  : $1"; fi; }

P -d postgres -c "drop database if exists $DB" -c "create database $DB" >/dev/null
P -d $DB <<'SQL' >/dev/null || { echo "schéma local impossible"; exit 2; }
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role; END IF;
END $$;
CREATE SCHEMA auth; CREATE TABLE auth.users (id uuid primary key);
CREATE TABLE shops (id uuid primary key);
CREATE TABLE products (id uuid primary key, shop_id uuid, name text, quantity int not null default 0, buying_price numeric not null default 0, updated_at timestamptz);
CREATE TABLE sale_items (id uuid primary key);
CREATE TABLE stock_transfers (id uuid primary key);
CREATE TABLE stock_movements (id uuid primary key default gen_random_uuid(), shop_id uuid, product_id uuid, type text, quantity int,
  previous_qty int, new_qty int, reason text, notes text, performed_by uuid, transfer_id uuid, created_at timestamptz default now());
CREATE TABLE suppliers (id uuid primary key, total_owed numeric not null default 0);
CREATE TABLE purchase_orders (id uuid primary key, shop_id uuid, status text, reference text, supplier_id uuid, total_amount numeric,
  payment_status text, received_at timestamptz, received_by uuid, updated_at timestamptz);
CREATE TABLE purchase_order_items (id uuid primary key, purchase_order_id uuid, quantity_ordered int, quantity_received int, receipt_note text);
CREATE TABLE product_batches (id uuid primary key default gen_random_uuid(), shop_id uuid, product_id uuid, supplier_id uuid, quantity int,
  initial_quantity int, buying_price numeric, expiry_date date, source text, received_at timestamptz default now());
GRANT USAGE ON SCHEMA public TO authenticated, anon;
GRANT SELECT (id, shop_id, name, quantity) ON products TO authenticated;
SQL
P -d $DB -f supabase/drafts/197_prod/prod-apply_purchase_order_receipt.sql >/dev/null || { echo "définition de production impossible"; exit 2; }

S1=11111111-1111-1111-1111-111111111111; S2=11111111-1111-1111-1111-111111111112; U=99999999-0000-0000-0000-000000000001; SUP=55555555-0000-0000-0000-000000000001
PA=aaaaaaaa-0000-0000-0000-000000000001; PB=aaaaaaaa-0000-0000-0000-000000000002; PO=bbbbbbbb-0000-0000-0000-000000000001; PO2=bbbbbbbb-0000-0000-0000-000000000002; PO3=bbbbbbbb-0000-0000-0000-000000000003
I1=cccccccc-0000-0000-0000-000000000001; I2=cccccccc-0000-0000-0000-000000000002; I3=cccccccc-0000-0000-0000-000000000003; I4=cccccccc-0000-0000-0000-000000000004
P -d $DB -c "insert into auth.users values ('$U'); insert into shops values ('$S1'),('$S2'); insert into suppliers values ('$SUP', 0);
  insert into products values ('$PA','$S1','Telephone A',2,100,null),('$PB','$S1','Riz',10,50,null)" >/dev/null

# Référence AVANT la 197 : réception d'un produit NON suivi avec la fonction de production
P -d $DB -c "insert into purchase_orders values ('$PO','$S1','sent','BC-1','$SUP',0,'unpaid',null,null,null); insert into purchase_order_items values ('$I1','$PO',5,null,null)" >/dev/null
P -d $DB -c "select apply_purchase_order_receipt('$S1','$PO','$U','[{\"item_id\":\"$I1\",\"product_id\":\"$PB\",\"quantity_received\":5,\"unit_price\":60}]')" >/dev/null
REF="$(Q "select quantity||'/'||buying_price from products where id='$PB'")|$(Q "select count(*)||'/'||sum(quantity) from product_batches where product_id='$PB'")|$(Q "select total_owed from suppliers")"

for i in 1 2; do P -d $DB -1 -f supabase/migrations/197_product_serials.sql >/dev/null 2>&1 && echo "passage $i ok" || { echo "passage $i ÉCHEC"; P -d $DB -1 -f supabase/migrations/197_product_serials.sql; exit 1; }; done
ok "$(Q "select count(*) from products where track_serials")" "0" "aucun produit suivi par défaut"

# Produit NON suivi : même résultat qu'avant la 197 (remise à zéro puis même réception)
P -d $DB -c "update products set quantity=10, buying_price=50 where id='$PB'; delete from product_batches; update suppliers set total_owed=0;
  update purchase_orders set status='sent' where id='$PO'" >/dev/null
P -d $DB -c "select apply_purchase_order_receipt('$S1','$PO','$U','[{\"item_id\":\"$I1\",\"product_id\":\"$PB\",\"quantity_received\":5,\"unit_price\":60}]')" >/dev/null
AFTER="$(Q "select quantity||'/'||buying_price from products where id='$PB'")|$(Q "select count(*)||'/'||sum(quantity) from product_batches where product_id='$PB'")|$(Q "select total_owed from suppliers")"
ok "$AFTER" "$REF" "bon d'un produit non suivi : résultat identique à la production ($REF)"
ok "$(Q "select count(*) from product_serials")" "0" "aucun numéro créé pour un produit non suivi"

P -d $DB -c "update products set track_serials=true where id='$PA'" >/dev/null
# Réassort d'un produit suivi
ok "$(ERR "select restock_serial_units('$S1','$PB','$U',array['X1'])")" "product_not_tracked" "réassort avec numéros refusé pour un produit non suivi"
ok "$(ERR "select restock_serial_units('$S1','$PA','$U',array['IMEI-1','imei-1'])")" "serial_duplicate_input" "même numéro deux fois dans la saisie (casse ignorée)"
ok "$(ERR "select restock_serial_units('$S1','$PA','$U',array['   '])")" "serial_invalid" "numéro vide refusé"
ok "$(Q "select quantity from products where id='$PA'")|$(Q "select count(*) from stock_movements where product_id='$PA'")" "2|0" "refus : rien écrit (stock, mouvement)"
P -d $DB -c "select restock_serial_units('$S1','$PA','$U',array[' IMEI-1 ','IMEI-2','IMEI-3'], 120, null, '$SUP', 'note', 'Restock')" >/dev/null
ok "$(Q "select quantity||'/'||buying_price from products where id='$PA'")" "5/112.00" "réassort : stock 2 + 3 = 5, coût moyen (2×100 + 3×120) / 5 = 112"
ok "$(Q "select count(*)||'/'||min(quantity) from product_batches where product_id='$PA' and source='restock'")" "1/3" "un lot de 3 créé"
ok "$(Q "select string_agg(serial,',' order by serial) from product_serials where product_id='$PA' and status='in_stock' and batch_id is not null")" "IMEI-1,IMEI-2,IMEI-3" "3 numéros en stock, espaces retirés, rattachés au lot"
ok "$(Q "select previous_qty||'>'||new_qty from stock_movements where product_id='$PA'")" "2>5" "mouvement avec stock avant / après"
ok "$(ERR "select restock_serial_units('$S1','$PA','$U',array['IMEI-2'])")" "serial_taken" "numéro déjà en stock refusé"
ok "$(Q "select quantity from products where id='$PA'")" "5" "refus : stock inchangé"

# Même numéro dans une AUTRE boutique : permis ; numéro d'un autre produit : refusé
P -d $DB -c "insert into products values ('aaaaaaaa-0000-0000-0000-000000000009','$S2','Telephone A',0,0,null); update products set track_serials=true where id='aaaaaaaa-0000-0000-0000-000000000009'" >/dev/null
P -d $DB -c "select restock_serial_units('$S2','aaaaaaaa-0000-0000-0000-000000000009','$U',array['IMEI-1'])" >/dev/null
ok "$(Q "select count(*) from product_serials where upper(serial)='IMEI-1'")" "2" "même numéro permis dans une autre boutique"
P -d $DB -c "insert into products values ('aaaaaaaa-0000-0000-0000-000000000003','$S1','Tablette',0,0,null); update products set track_serials=true where id='aaaaaaaa-0000-0000-0000-000000000003'" >/dev/null
ok "$(ERR "select restock_serial_units('$S1','aaaaaaaa-0000-0000-0000-000000000003','$U',array['IMEI-3'])")" "serial_taken" "numéro d'un autre produit de la boutique refusé"

# Numéroter le stock déjà présent : jamais plus de numéros en stock que d'unités (5)
P -d $DB -c "select add_existing_serials('$S1','$PA','$U',array['OLD-1','OLD-2'])" >/dev/null
ok "$(Q "select count(*) from product_serials where product_id='$PA' and status='in_stock'")" "5" "stock existant numéroté : 5 numéros pour 5 unités"
ok "$(ERR "select add_existing_serials('$S1','$PA','$U',array['OLD-3'])")" "serial_exceeds_stock" "6e numéro pour 5 unités refusé"
ok "$(Q "select count(*) from product_serials where serial='OLD-3'")" "0" "refus : rien écrit"

# Numéro vendu du même produit qui revient (reprise) : remis en stock
P -d $DB -c "update product_serials set status='sold', sold_at=now() where serial='OLD-2'; update products set quantity=4 where id='$PA'" >/dev/null
P -d $DB -c "select restock_serial_units('$S1','$PA','$U',array['old-2'])" >/dev/null
ok "$(Q "select status||'/'||(sold_at is null)||'/'||source from product_serials where serial='OLD-2'")" "in_stock/true/restock" "numéro vendu repris : remis en stock (une seule ligne)"

# Correction d'une saisie
ID=$(Q "select id from product_serials where serial='OLD-1'")
P -d $DB -c "select correct_product_serial('$S1','$ID','OLD-1B','$U')" >/dev/null
ok "$(Q "select serial from product_serials where id='$ID'")" "OLD-1B" "numéro corrigé"
ok "$(ERR "select correct_product_serial('$S1','$ID','imei-2','$U')")" "serial_taken" "correction vers un numéro pris refusée"

# Réception d'un bon : produit suivi, numéros par ligne
P -d $DB -c "insert into purchase_orders values ('$PO2','$S1','sent','BC-2','$SUP',0,'unpaid',null,null,null); insert into purchase_order_items values ('$I2','$PO2',2,null,null),('$I3','$PO2',3,null,null)" >/dev/null
ok "$(ERR "select apply_purchase_order_receipt('$S1','$PO2','$U','[{\"item_id\":\"$I2\",\"product_id\":\"$PA\",\"quantity_received\":2,\"unit_price\":100,\"serials\":[\"N-1\"]},{\"item_id\":\"$I3\",\"product_id\":\"$PB\",\"quantity_received\":3}]')")" "serial_count_mismatch" "bon : 1 numéro pour 2 unités refusé"
ok "$(Q "select status from purchase_orders where id='$PO2'")|$(Q "select quantity from products where id='$PB'")" "sent|15" "refus : bon et stock du produit non suivi inchangés (tout annulé)"
P -d $DB -c "select apply_purchase_order_receipt('$S1','$PO2','$U','[{\"item_id\":\"$I2\",\"product_id\":\"$PA\",\"quantity_received\":2,\"unit_price\":100,\"serials\":[\"N-1\",\"N-2\"]},{\"item_id\":\"$I3\",\"product_id\":\"$PB\",\"quantity_received\":3}]')" >/dev/null
ok "$(Q "select status from purchase_orders where id='$PO2'")|$(Q "select quantity from products where id='$PA'")|$(Q "select quantity from products where id='$PB'")" "received|7|18" "bon reçu : téléphone 5 + 2, riz 15 + 3"
ok "$(Q "select count(*) from product_serials s join product_batches b on b.id=s.batch_id where s.serial in ('N-1','N-2') and b.source='purchase_order'")" "2" "2 numéros rattachés au lot du bon"
P -d $DB -c "insert into purchase_orders values ('$PO3','$S1','sent','BC-3','$SUP',0,'unpaid',null,null,null); insert into purchase_order_items values ('$I4','$PO3',1,null,null)" >/dev/null
ok "$(ERR "select apply_purchase_order_receipt('$S1','$PO3','$U','[{\"item_id\":\"$I4\",\"product_id\":\"$PA\",\"quantity_received\":1,\"serials\":[\"N-1\"]}]')")" "serial_taken" "bon : numéro déjà en stock refusé"

# Droits
ok "$(ERR "set role authenticated; select serial from product_serials")" "permission denied" "registre illisible pour les connectés (serveur seulement)"
ok "$(Q "set role authenticated; select track_serials from products where id='$PA'")" "t" "suivi lisible par les connectés"
ok "$(ERR "set role authenticated; select restock_serial_units('$S1','$PA','$U',array['Z'])")" "permission denied" "fonctions non exécutables par les connectés"

# Retour arrière puis ré-application
P -d $DB -1 -f supabase/rollbacks/197_product_serials_rollback.sql >/dev/null 2>&1 || { echo "retour arrière ÉCHEC"; P -d $DB -1 -f supabase/rollbacks/197_product_serials_rollback.sql; }
ok "$(Q "select count(*) from information_schema.tables where table_name='product_serials'")|$(Q "select count(*) from information_schema.columns where table_name='products' and column_name='track_serials'")" "0|0" "retour arrière : table et colonne retirées"
ok "$(Q "select position('track_serials' in pg_get_functiondef('apply_purchase_order_receipt(uuid,uuid,uuid,jsonb)'::regprocedure))")" "0" "retour arrière : réception de bon de production restaurée"
P -d $DB -1 -f supabase/migrations/197_product_serials.sql >/dev/null 2>&1 && echo "ré-application ok" || echo "ré-application ÉCHEC"

echo; echo "$pass réussis, $fail échec(s)"
P -d postgres -c "drop database if exists $DB" >/dev/null
exit $fail

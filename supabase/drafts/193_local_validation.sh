#!/bin/bash
# Validation LOCALE de 193 (stock avant / après des mouvements de la caisse + coût moyen à la réception d'un bon)
# Base PostgreSQL jetable UNIQUEMENT, jamais la production. Schéma minimal des tables touchées, fonctions de vente
# simulées dans l'ORDRE RÉEL des fonctions de production (mise à jour du produit PUIS écriture du mouvement), fichier
# EXACT 193 appliqué deux fois (ré-exécutable), puis retour arrière.
# Usage (racine du dépôt) : bash supabase/drafts/193_local_validation.sh
set -u
export PGCLIENTENCODING=UTF8
BIN="${PSQL_BIN:-/c/Program Files/PostgreSQL/18/bin}"; PORT="${PGPORT:-55432}"; HOST=localhost
P() { "$BIN/psql.exe" -h "$HOST" -p "$PORT" -U postgres -v ON_ERROR_STOP=1 -X -q -tA "$@"; }
DB=r193
Q() { P -d $DB -c "$1" 2>&1 | tail -1; }
pass=0; fail=0
ok() { if [ "$1" = "$2" ]; then pass=$((pass+1)); echo "ok    $3"; else fail=$((fail+1)); echo "ÉCHEC $3"; echo "      attendu : $2"; echo "      obtenu  : $1"; fi; }

P -d postgres -c "drop database if exists $DB" -c "create database $DB" >/dev/null
P -d $DB <<'SQL' || { echo "schéma local impossible"; exit 2; }
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role; END IF;
END $$;
CREATE TABLE products (id uuid primary key, shop_id uuid, name text, quantity int not null default 0, buying_price numeric not null default 0, updated_at timestamptz);
CREATE TABLE stock_movements (id uuid primary key default gen_random_uuid(), shop_id uuid, product_id uuid, type text, quantity int,
  previous_qty int, new_qty int, reason text, notes text, performed_by uuid, transfer_id uuid, created_at timestamptz default now());
CREATE TABLE suppliers (id uuid primary key, total_owed numeric not null default 0);
CREATE TABLE purchase_orders (id uuid primary key, shop_id uuid, status text, reference text, supplier_id uuid, total_amount numeric,
  payment_status text, received_at timestamptz, received_by uuid, updated_at timestamptz);
CREATE TABLE purchase_order_items (id uuid primary key, purchase_order_id uuid, quantity_ordered int, quantity_received int, receipt_note text);
CREATE TABLE product_batches (id uuid primary key default gen_random_uuid(), shop_id uuid, product_id uuid, supplier_id uuid, quantity int,
  initial_quantity int, buying_price numeric, expiry_date date, source text, received_at timestamptz);
-- Simulations des fonctions de vente : même ORDRE que la production (178 deduct_stock_on_sale, 159 cancel_sale,
-- 178 edit_sale) : UPDATE products PUIS INSERT stock_movements sans previous_qty / new_qty
CREATE FUNCTION sim_sale(p uuid, q int) RETURNS void LANGUAGE plpgsql AS $$ BEGIN
  UPDATE products SET quantity = quantity - q WHERE id = p;
  INSERT INTO stock_movements (shop_id, product_id, type, quantity, reason) SELECT shop_id, id, 'sale', q, 'Sale' FROM products WHERE id = p;
END $$;
CREATE FUNCTION sim_cancel(p uuid, q int) RETURNS void LANGUAGE plpgsql AS $$ BEGIN
  UPDATE products SET quantity = quantity + q WHERE id = p;
  INSERT INTO stock_movements (shop_id, product_id, type, quantity, reason, notes) SELECT shop_id, id, 'in', q, 'Annulation', 'x' FROM products WHERE id = p;
END $$;
SQL
S1=11111111-1111-1111-1111-111111111111
PA=aaaaaaaa-0000-0000-0000-000000000001; PB=aaaaaaaa-0000-0000-0000-000000000002; PC=aaaaaaaa-0000-0000-0000-000000000003; PD=aaaaaaaa-0000-0000-0000-000000000004
P -d $DB -c "insert into products values ('$PA','$S1','A',10,100),('$PB','$S1','B',10,0),('$PC','$S1','C',0,80),('$PD','$S1','D',-2,50)" >/dev/null

echo "── Avant la 193 : mouvements de vente sans avant / après"
P -d $DB -c "select sim_sale('$PA', 3)" >/dev/null
ok "$(Q "select coalesce(previous_qty::text,'-')||'/'||coalesce(new_qty::text,'-') from stock_movements order by created_at desc limit 1")" "-/-" "vente sans la 193 : colonnes vides (état actuel)"

echo "── Application de la 193 (deux fois)"
for i in 1 2; do P -d $DB -1 -f supabase/migrations/193_stock_valuation.sql >/dev/null 2>&1 && echo "passage $i ok" || { echo "passage $i ÉCHEC"; P -d $DB -1 -f supabase/migrations/193_stock_valuation.sql; exit 1; }; done

echo "── 1. Stock avant / après"
P -d $DB -c "select sim_sale('$PA', 2)" >/dev/null
ok "$(Q "select previous_qty||'/'||new_qty from stock_movements where product_id='$PA' order by created_at desc limit 1")" "7/5" "vente de 2 sur 7 : avant 7, après 5"
P -d $DB -c "select sim_cancel('$PA', 2)" >/dev/null
ok "$(Q "select previous_qty||'/'||new_qty from stock_movements where product_id='$PA' and type='in' order by created_at desc limit 1")" "5/7" "annulation (+2) : avant 5, après 7"
P -d $DB -c "begin; select sim_sale('$PA', 1); select sim_sale('$PA', 1); commit;" >/dev/null
ok "$(Q "select string_agg(previous_qty||'/'||new_qty, ' ' order by previous_qty desc) from (select * from stock_movements where product_id='$PA' and type='sale' order by created_at desc limit 2) x")" "7/6 6/5" "deux lignes du même produit dans une transaction (modification de vente) : 7→6 puis 6→5"
P -d $DB -c "insert into stock_movements (shop_id, product_id, type, quantity, previous_qty, new_qty, reason) values ('$S1','$PA','in',4,100,104,'reception')" >/dev/null
ok "$(Q "select previous_qty||'/'||new_qty from stock_movements where reason='reception'")" "100/104" "valeurs déjà fournies (réception, inventaire…) : jamais modifiées"
P -d $DB -c "insert into stock_movements (shop_id, product_id, type, quantity, reason) values ('$S1','$PA','transit_loss',1,'manque')" >/dev/null
ok "$(Q "select coalesce(previous_qty::text,'-')||'/'||coalesce(new_qty::text,'-') from stock_movements where reason='manque'")" "-/-" "perte en transit : laissée vide (voulu, 188)"
P -d $DB -c "insert into stock_movements (shop_id, product_id, type, quantity, reason) values ('$S1',null,'sale',1,'sans produit')" >/dev/null
ok "$(Q "select coalesce(previous_qty::text,'-') from stock_movements where reason='sans produit'")" "-" "mouvement sans produit : rien inventé"
ok "$(Q "select has_function_privilege('anon','public.fill_stock_movement_balances()','EXECUTE')::text || has_function_privilege('authenticated','public.fill_stock_movement_balances()','EXECUTE')::text")" "falsefalse" "fonction du déclencheur non exécutable par anon / authenticated"

echo "── 2. Coût moyen à la réception d'un bon"
PO=bbbbbbbb-0000-0000-0000-000000000001; SUP=cccccccc-0000-0000-0000-000000000001
I1=dddddddd-0000-0000-0000-000000000001; I2=dddddddd-0000-0000-0000-000000000002; I3=dddddddd-0000-0000-0000-000000000003; I4=dddddddd-0000-0000-0000-000000000004; I5=dddddddd-0000-0000-0000-000000000005
P -d $DB -c "insert into suppliers values ('$SUP',0); insert into purchase_orders (id, shop_id, status, reference, supplier_id) values ('$PO','$S1','sent','BC-1','$SUP');
  insert into purchase_order_items values ('$I1','$PO',10,0,null),('$I2','$PO',10,0,null),('$I3','$PO',5,0,null),('$I4','$PO',4,0,null),('$I5','$PO',3,0,null)" >/dev/null
# A : 7 à 100 + 10 à 200 → moyenne 158,82 ; B : coût inconnu 0 + 10 à 50 → 50 (avant 193 : 25) ;
# C : stock 0 à 80 + 5 à 90 → 90 ; D : stock −2 à 50 + 4 à 70 → 70 ; A ligne sans prix : coût inchangé
P -d $DB -c "update products set quantity = 7 where id = '$PA'" >/dev/null
OUT=$(Q "select apply_purchase_order_receipt('$S1','$PO',null,'[{\"item_id\":\"$I1\",\"product_id\":\"$PA\",\"quantity_received\":10,\"unit_price\":200},{\"item_id\":\"$I2\",\"product_id\":\"$PB\",\"quantity_received\":10,\"unit_price\":50},{\"item_id\":\"$I3\",\"product_id\":\"$PC\",\"quantity_received\":5,\"unit_price\":90},{\"item_id\":\"$I4\",\"product_id\":\"$PD\",\"quantity_received\":4,\"unit_price\":70}]'::jsonb)::text")
ok "$(Q "select buying_price from products where id='$PA'")" "158.82" "coût connu : moyenne pondérée inchangée (7 × 100 + 10 × 200) / 17"
ok "$(Q "select buying_price from products where id='$PB'")" "50" "coût précédent inconnu (0) : le prix reçu devient le coût (et non 25)"
ok "$(Q "select buying_price from products where id='$PC'")" "90" "stock précédent nul : le prix reçu devient le coût"
ok "$(Q "select buying_price from products where id='$PD'")" "70" "stock précédent négatif : le prix reçu devient le coût"
ok "$(Q "select quantity||'/'||(select previous_qty||'/'||new_qty from stock_movements where product_id='$PA' and reason like 'R_ception%') from products where id='$PA'")" "17/7/17" "quantité et mouvement de réception (avant / après fournis par la fonction) intacts"
ok "$(Q "select status||'/'||total_amount from purchase_orders where id='$PO'")" "received/3230" "statut et total du bon : calcul existant inchangé (lignes envoyées seulement, 10×200 + 10×50 + 5×90 + 4×70)"
ok "$(Q "select count(*) from product_batches where source='purchase_order'")" "4" "un lot par ligne reçue"
ok "$(Q "select has_function_privilege('authenticated','public.apply_purchase_order_receipt(uuid,uuid,uuid,jsonb)','EXECUTE')::text")" "false" "réception de bon réservée au serveur"

echo "── 3. Retour arrière"
P -d $DB -1 -f supabase/rollbacks/193_stock_valuation_rollback.sql >/dev/null 2>&1 && echo "retour arrière appliqué" || echo "retour arrière ÉCHEC"
ok "$(Q "select count(*) from pg_trigger where tgname='trg_stock_movements_fill_balances'")" "0" "retour arrière : déclencheur retiré"
ok "$(Q "select (position('v_previous_qty <= 0 THEN v_unit_price' in pg_get_functiondef('public.apply_purchase_order_receipt(uuid,uuid,uuid,jsonb)'::regprocedure)) = 0)::text")" "true" "retour arrière : réception de bon remise à l'identique"

echo; echo "$pass réussis, $fail échec(s)"
P -d postgres -c "drop database if exists $DB" >/dev/null
[ $fail -eq 0 ]

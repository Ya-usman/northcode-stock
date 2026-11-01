#!/bin/bash
# Validation LOCALE de 200 (kits assemblés) — base PostgreSQL jetable UNIQUEMENT. Fonctions de PRODUCTION chargées
# (drafts/200_prod : shop_business_date, sellable_stock, allocate_sale_batches) : l'assemblage puise les composants
# exactement comme une vente (FEFO, lots périmés exclus).
# Usage (racine du dépôt) : bash supabase/drafts/200_local_validation.sh
set -u
export PGCLIENTENCODING=UTF8
BIN="${PSQL_BIN:-/c/Program Files/PostgreSQL/18/bin}"; PORT="${PGPORT:-55432}"; HOST=localhost
P() { "$BIN/psql.exe" -h "$HOST" -p "$PORT" -U postgres -v ON_ERROR_STOP=1 -X -q -tA "$@"; }
DB=r200
Q() { P -d $DB -c "$1" 2>&1 | tail -1; }
ERR() { local l; l=$(P -d $DB -c "$1" 2>&1 | grep -m1 -E '^(ERROR|ERREUR)'); echo "$l" | grep -oE 'violates [a-z ]+ constraint|permission denied' | head -1 | grep . || echo "$l" | grep -oE 'kit_[a-z_]+' | head -1; }
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
CREATE TABLE shops (id uuid primary key, timezone text);
CREATE TABLE products (id uuid primary key, shop_id uuid, name text, quantity int not null default 0, buying_price numeric not null default 0,
  track_serials boolean not null default false, updated_at timestamptz);
CREATE TABLE product_batches (id uuid primary key default gen_random_uuid(), shop_id uuid, product_id uuid, supplier_id uuid, quantity int CHECK (quantity >= 0),
  initial_quantity int, buying_price numeric, expiry_date date, source text, received_at timestamptz default now(), updated_at timestamptz,
  CONSTRAINT product_batches_source_check CHECK (source = ANY (ARRAY['backfill','restock','purchase_order','adjustment','transfer','inventory'])));
CREATE TABLE stock_movements (id uuid primary key default gen_random_uuid(), shop_id uuid, product_id uuid, type text, quantity int,
  previous_qty int, new_qty int, reason text, notes text, performed_by uuid, created_at timestamptz default now());
GRANT USAGE ON SCHEMA public TO authenticated;
GRANT SELECT (id, name, quantity) ON products TO authenticated;
SQL
for f in shop_business_date sellable_stock allocate_sale_batches; do P -d $DB -f supabase/drafts/200_prod/prod-$f.sql >/dev/null || { echo "définition $f impossible"; exit 2; }; done

S=11111111-1111-1111-1111-111111111111; S2=11111111-1111-1111-1111-111111111112; U=99999999-0000-0000-0000-000000000001
K=aaaaaaaa-0000-0000-0000-00000000000a; SA=aaaaaaaa-0000-0000-0000-000000000001; PA=aaaaaaaa-0000-0000-0000-000000000002; X=aaaaaaaa-0000-0000-0000-000000000009
P -d $DB -c "insert into shops values ('$S','Africa/Douala'),('$S2','Africa/Douala'); insert into auth.users values ('$U');
  insert into products values ('$K','$S','Panier cadeau',0,0,false,null),('$SA','$S','Savon',10,200,false,null),('$PA','$S','Parfum',3,1500,false,null),('$X','$S2','Autre',5,10,false,null);
  insert into product_batches (shop_id, product_id, quantity, initial_quantity, buying_price, expiry_date, source, received_at) values
   ('$S','$SA',4,4,200,current_date - 1,'restock',now() - interval '3 days'),
   ('$S','$SA',6,6,200,current_date + 30,'restock',now() - interval '2 days'),
   ('$S','$PA',3,3,1500,null,'restock',now())" >/dev/null
for i in 1 2; do P -d $DB -1 -f supabase/migrations/200_product_kits.sql >/dev/null 2>&1 && echo "passage $i ok" || { echo "passage $i ÉCHEC"; P -d $DB -1 -f supabase/migrations/200_product_kits.sql; exit 1; }; done
ok "$(Q "select count(*) from products where is_kit")" "0" "aucun kit par défaut"
ok "$(ERR "select assemble_kit('$S','$K','$U',1)")" "kit_invalid" "pas encore un kit : refusé"
P -d $DB -c "update products set is_kit = true where id='$K'" >/dev/null
ok "$(ERR "select assemble_kit('$S','$K','$U',1)")" "kit_invalid" "kit sans composants : refusé"
P -d $DB -c "insert into product_kit_components (shop_id, kit_product_id, component_product_id, quantity) values ('$S','$K','$SA',2),('$S','$K','$PA',1)" >/dev/null
ok "$(ERR "insert into product_kit_components (shop_id, kit_product_id, component_product_id, quantity) values ('$S','$K','$K',1)")" "violates check constraint" "un kit ne se contient pas lui-même"
# Savon : 10 physiques dont 4 périmés → 6 vendables ; 4 kits = 8 savons → refus
ok "$(ERR "select assemble_kit('$S','$K','$U',4)")" "kit_component_short" "4 kits : 8 savons demandés, 6 vendables (4 périmés exclus) : refusé"
ok "$(Q "select string_agg(quantity::text, ',' order by id) from products where id in ('$K','$SA','$PA')")|$(Q "select count(*) from stock_movements")" "10,3,0|0" "refus : rien écrit (savon, parfum, kit)"
ok "$(ERR "select assemble_kit('$S','$K','$U',0)")" "kit_invalid_quantity" "quantité 0 refusée"
P -d $DB -c "select assemble_kit('$S','$K','$U',3,'TEST')" >/dev/null
ok "$(Q "select quantity from products where id='$K'")|$(Q "select quantity from products where id='$SA'")|$(Q "select quantity from products where id='$PA'")" "3|4|0" "3 kits assemblés : savon 10 → 4, parfum 3 → 0"
ok "$(Q "select quantity from product_batches where product_id='$SA' and expiry_date < current_date")|$(Q "select quantity from product_batches where product_id='$SA' and expiry_date >= current_date")" "4|0" "lot périmé de savon jamais pris, le bon lot vidé (FEFO)"
ok "$(Q "select buying_price from product_batches where product_id='$K' and source='assembly'")|$(Q "select buying_price from products where id='$K'")" "1900.00|1900.00" "coût du kit : 2 × 200 + 1500 = 1 900 (lot et produit)"
ok "$(Q "select count(*) filter (where type='out')||'/'||count(*) filter (where type='in') from stock_movements")" "2/1" "mouvements : 2 sorties de composants, 1 entrée du kit"
ok "$(Q "select previous_qty||'>'||new_qty from stock_movements where product_id='$SA'")" "10>4" "stock avant / après sur le composant"
# Désassemblage d'1 kit : composants rendus
P -d $DB -c "select disassemble_kit('$S','$K','$U',1)" >/dev/null
ok "$(Q "select quantity from products where id='$K'")|$(Q "select quantity from products where id='$SA'")|$(Q "select quantity from products where id='$PA'")" "2|6|1" "1 kit désassemblé : kit 3 → 2, savon 4 → 6, parfum 0 → 1"
ok "$(Q "select count(*) from product_batches where source='assembly' and product_id in ('$SA','$PA')")" "2" "composants rendus dans un lot chacun"
ok "$(ERR "select disassemble_kit('$S','$K','$U',5)")" "kit_component_short" "désassembler plus que le stock du kit : refusé"
# Composant d'une autre boutique ou suivi par numéro : refus
P -d $DB -c "update products set track_serials = true where id='$PA'" >/dev/null
ok "$(ERR "select assemble_kit('$S','$K','$U',1)")" "kit_invalid" "composant suivi par numéro de série : refusé"
P -d $DB -c "update products set track_serials = false where id='$PA'" >/dev/null
ok "$(ERR "set role authenticated; select assemble_kit('$S','$K','$U',1)")" "permission denied" "fonctions non exécutables par les connectés"
ok "$(ERR "set role authenticated; select * from product_kit_components")" "permission denied" "composition illisible pour les connectés"
ok "$(Q "set role authenticated; select is_kit from products where id='$K'")" "t" "« kit » lisible par les connectés"
# Retour arrière : lots 'assembly' présents → contrainte laissée ; table, fonctions, colonne retirées
P -d $DB -1 -f supabase/rollbacks/200_product_kits_rollback.sql >/dev/null 2>&1 || echo "retour arrière ÉCHEC"
ok "$(Q "select count(*) from information_schema.tables where table_name='product_kit_components'")|$(Q "select count(*) from pg_proc where proname in ('assemble_kit','disassemble_kit')")|$(Q "select count(*) from information_schema.columns where table_name='products' and column_name='is_kit'")" "0|0|0" "retour arrière : table, fonctions et colonne retirées"
ok "$(Q "select count(*) from product_batches where source='assembly'")" "3" "retour arrière : lots d'assemblage gardés (contrainte laissée)"
P -d $DB -1 -f supabase/migrations/200_product_kits.sql >/dev/null 2>&1 && echo "ré-application ok" || echo "ré-application ÉCHEC"
echo; echo "$pass réussis, $fail échec(s)"
P -d postgres -c "drop database if exists $DB" >/dev/null
exit $fail

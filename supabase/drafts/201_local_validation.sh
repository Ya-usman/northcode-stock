#!/bin/bash
# Validation LOCALE de 201 (prix de gros) — base PostgreSQL jetable UNIQUEMENT.
# Usage (racine du dépôt) : bash supabase/drafts/201_local_validation.sh
set -u
export PGCLIENTENCODING=UTF8
BIN="${PSQL_BIN:-/c/Program Files/PostgreSQL/18/bin}"; PORT="${PGPORT:-55432}"; HOST=localhost
P() { "$BIN/psql.exe" -h "$HOST" -p "$PORT" -U postgres -v ON_ERROR_STOP=1 -X -q -tA "$@"; }
DB=r201
Q() { P -d $DB -c "$1" 2>&1 | tail -1; }
ERR() { P -d $DB -c "$1" 2>&1 | grep -m1 -E '^(ERROR|ERREUR)' | grep -oE 'products_wholesale_check|permission denied' | head -1; }
pass=0; fail=0
ok() { if [ "$1" = "$2" ]; then pass=$((pass+1)); echo "ok    $3"; else fail=$((fail+1)); echo "ÉCHEC $3"; echo "      attendu : $2"; echo "      obtenu  : $1"; fi; }

P -d postgres -c "drop database if exists $DB" -c "create database $DB" >/dev/null
P -d $DB <<'SQL' >/dev/null || { echo "schéma local impossible"; exit 2; }
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
END $$;
CREATE TABLE products (id uuid primary key, shop_id uuid, name text, selling_price numeric(14,2) not null default 0, quantity int not null default 0);
GRANT USAGE ON SCHEMA public TO authenticated;
GRANT SELECT (id, name, selling_price, quantity) ON products TO authenticated;
INSERT INTO products VALUES ('aaaaaaaa-0000-0000-0000-000000000001', null, 'Riz', 500, 40), ('aaaaaaaa-0000-0000-0000-000000000002', null, 'Huile', 900, 10);
SQL
A=aaaaaaaa-0000-0000-0000-000000000001

echo "1. Application (deux fois : ré-exécutable)"
ok "$(P -d $DB -f supabase/migrations/201_product_wholesale.sql 2>&1 | grep -c -E 'ERROR|ERREUR')" "0" "première application"
ok "$(P -d $DB -f supabase/migrations/201_product_wholesale.sql 2>&1 | grep -c -E 'ERROR|ERREUR')" "0" "seconde application sans erreur"
ok "$(Q "select count(*) from pg_constraint where conname='products_wholesale_check'")" "1" "une seule contrainte"
ok "$(Q "select wholesale_price is null and wholesale_min_qty is null from products where id='$A'")" "t" "produits existants : sans prix de gros"

echo "2. Contrainte"
ok "$(Q "update products set wholesale_price=450, wholesale_min_qty=24 where id='$A' returning wholesale_price")" "450.00" "450 F dès 24 pièces accepté"
ok "$(ERR "update products set wholesale_price=450, wholesale_min_qty=null where id='$A'")" "products_wholesale_check" "prix sans quantité refusé"
ok "$(ERR "update products set wholesale_price=null, wholesale_min_qty=24 where id='$A'")" "products_wholesale_check" "quantité sans prix refusée"
ok "$(ERR "update products set wholesale_price=0, wholesale_min_qty=24 where id='$A'")" "products_wholesale_check" "prix 0 refusé"
ok "$(ERR "update products set wholesale_price=450, wholesale_min_qty=1 where id='$A'")" "products_wholesale_check" "quantité 1 refusée (au moins 2)"
ok "$(ERR "update products set wholesale_price=450, wholesale_min_qty=100001 where id='$A'")" "products_wholesale_check" "quantité 100 001 refusée"
ok "$(Q "update products set wholesale_price=null, wholesale_min_qty=null where id='$A' returning name")" "Riz" "retrait du prix de gros (les deux vides) accepté"

echo "3. Lecture par un membre (droits par colonne)"
ok "$(P -d $DB -c "set role authenticated; select count(wholesale_price) + count(wholesale_min_qty) >= 0 from products" 2>&1 | tail -1)" "t" "colonnes lisibles par authenticated"

echo "4. Retour arrière puis réapplication"
ok "$(P -d $DB -f supabase/rollbacks/201_product_wholesale_rollback.sql 2>&1 | grep -c -E 'ERROR|ERREUR')" "0" "retour arrière sans erreur"
ok "$(Q "select count(*) from information_schema.columns where table_name='products' and column_name like 'wholesale%'")" "0" "colonnes retirées"
ok "$(Q "select count(*) from products")" "2" "produits intacts"
ok "$(P -d $DB -f supabase/migrations/201_product_wholesale.sql 2>&1 | grep -c -E 'ERROR|ERREUR')" "0" "réapplication sans erreur"

P -d postgres -c "drop database if exists $DB" >/dev/null
echo; echo "$pass réussis, $fail échec(s)"; [ $fail -eq 0 ]

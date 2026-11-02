#!/bin/bash
# Validation LOCALE de 202 (paliers de prix de gros) — base PostgreSQL jetable UNIQUEMENT. Part d'une base où la 201
# est appliquée, avec un produit qui a un palier unique (conversion vérifiée).
# Usage (racine du dépôt) : bash supabase/drafts/202_local_validation.sh
set -u
export PGCLIENTENCODING=UTF8
BIN="${PSQL_BIN:-/c/Program Files/PostgreSQL/18/bin}"; PORT="${PGPORT:-55432}"; HOST=localhost
P() { "$BIN/psql.exe" -h "$HOST" -p "$PORT" -U postgres -v ON_ERROR_STOP=1 -X -q -tA "$@"; }
DB=r202
Q() { P -d $DB -c "$1" 2>&1 | tail -1; }
ERR() { P -d $DB -c "$1" 2>&1 | grep -m1 -E '^(ERROR|ERREUR)' | grep -oE 'products_price_tiers_check|permission denied' | head -1; }
pass=0; fail=0
ok() { if [ "$1" = "$2" ]; then pass=$((pass+1)); echo "ok    $3"; else fail=$((fail+1)); echo "ÉCHEC $3"; echo "      attendu : $2"; echo "      obtenu  : $1"; fi; }

P -d postgres -c "drop database if exists $DB" -c "create database $DB" >/dev/null
P -d $DB <<'SQL' >/dev/null || { echo "schéma local impossible"; exit 2; }
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF;
END $$;
CREATE TABLE products (id uuid primary key, shop_id uuid, name text, selling_price numeric(14,2) not null default 0, quantity int not null default 0);
GRANT USAGE ON SCHEMA public TO authenticated;
GRANT SELECT (id, name, selling_price, quantity) ON products TO authenticated;
INSERT INTO products VALUES ('aaaaaaaa-0000-0000-0000-000000000001', null, 'Riz', 500, 40), ('aaaaaaaa-0000-0000-0000-000000000002', null, 'Huile', 900, 10);
SQL
A=aaaaaaaa-0000-0000-0000-000000000001; B=aaaaaaaa-0000-0000-0000-000000000002
ok "$(P -d $DB -f supabase/migrations/201_product_wholesale.sql 2>&1 | grep -c -E 'ERROR|ERREUR')" "0" "base : 201 appliquée"
Q "update products set wholesale_price=450, wholesale_min_qty=24 where id='$B'" >/dev/null

echo "1. Application (deux fois : ré-exécutable) et conversion"
ok "$(P -d $DB -f supabase/migrations/202_product_price_tiers.sql 2>&1 | grep -c -E 'ERROR|ERREUR')" "0" "première application"
ok "$(Q "select price_tiers::text from products where id='$B'")" '[{"price": 450.00, "min_qty": 24}]' "palier unique de la 201 converti"
ok "$(Q "select count(*) from information_schema.columns where table_name='products' and column_name like 'wholesale%'")" "0" "colonnes de la 201 retirées"
ok "$(P -d $DB -f supabase/migrations/202_product_price_tiers.sql 2>&1 | grep -c -E 'ERROR|ERREUR')" "0" "seconde application sans erreur"
ok "$(Q "select count(*) from pg_constraint where conname='products_price_tiers_check'")" "1" "une seule contrainte"

echo "2. Paliers acceptés"
ok "$(Q "update products set price_tiers='[{\"min_qty\":12,\"price\":470}]' where id='$A' returning name")" "Riz" "1 palier"
ok "$(Q "update products set price_tiers='[{\"min_qty\":10,\"price\":480},{\"min_qty\":12,\"price\":470},{\"min_qty\":24,\"price\":450}]' where id='$A' returning name")" "Riz" "3 paliers (dizaine, douzaine, carton)"
ok "$(Q "update products set price_tiers=null where id='$A' returning name")" "Riz" "retrait (NULL)"

echo "3. Paliers refusés"
ok "$(ERR "update products set price_tiers='[]' where id='$A'")" "products_price_tiers_check" "liste vide"
ok "$(ERR "update products set price_tiers='[{\"min_qty\":2,\"price\":490},{\"min_qty\":3,\"price\":480},{\"min_qty\":4,\"price\":470},{\"min_qty\":5,\"price\":460}]' where id='$A'")" "products_price_tiers_check" "4 paliers"
ok "$(ERR "update products set price_tiers='[{\"min_qty\":1,\"price\":450}]' where id='$A'")" "products_price_tiers_check" "quantité 1"
ok "$(ERR "update products set price_tiers='[{\"min_qty\":12.5,\"price\":450}]' where id='$A'")" "products_price_tiers_check" "quantité 12,5"
ok "$(ERR "update products set price_tiers='[{\"min_qty\":100001,\"price\":450}]' where id='$A'")" "products_price_tiers_check" "quantité 100 001"
ok "$(ERR "update products set price_tiers='[{\"min_qty\":12,\"price\":0}]' where id='$A'")" "products_price_tiers_check" "prix 0"
ok "$(ERR "update products set price_tiers='[{\"min_qty\":24,\"price\":450},{\"min_qty\":12,\"price\":440}]' where id='$A'")" "products_price_tiers_check" "quantités non croissantes"
ok "$(ERR "update products set price_tiers='[{\"min_qty\":12,\"price\":450},{\"min_qty\":24,\"price\":460}]' where id='$A'")" "products_price_tiers_check" "prix non décroissants"
ok "$(ERR "update products set price_tiers='[{\"min_qty\":12,\"price\":450},{\"min_qty\":12,\"price\":440}]' where id='$A'")" "products_price_tiers_check" "même quantité deux fois"
ok "$(ERR "update products set price_tiers='[{\"min_qty\":\"12\",\"price\":450}]' where id='$A'")" "products_price_tiers_check" "quantité en texte"
ok "$(ERR "update products set price_tiers='{\"min_qty\":12,\"price\":450}' where id='$A'")" "products_price_tiers_check" "objet seul (pas une liste)"

echo "4. Droits"
ok "$(P -d $DB -c "set role authenticated; select count(price_tiers) >= 0 from products" 2>&1 | tail -1)" "t" "colonne lisible par authenticated"

echo "5. Retour arrière puis réapplication"
Q "update products set price_tiers='[{\"min_qty\":12,\"price\":470},{\"min_qty\":24,\"price\":450}]' where id='$A'" >/dev/null
ok "$(P -d $DB -f supabase/rollbacks/202_product_price_tiers_rollback.sql 2>&1 | grep -c -E 'ERROR|ERREUR')" "0" "retour arrière sans erreur"
ok "$(Q "select wholesale_price || '/' || wholesale_min_qty from products where id='$A'")" "470.00/12" "premier palier rétabli dans les colonnes de la 201"
ok "$(Q "select count(*) from information_schema.columns where table_name='products' and column_name='price_tiers'")" "0" "colonne price_tiers retirée"
ok "$(P -d $DB -f supabase/migrations/202_product_price_tiers.sql 2>&1 | grep -c -E 'ERROR|ERREUR')" "0" "réapplication sans erreur"
ok "$(Q "select count(*) from products")" "2" "produits intacts"

P -d postgres -c "drop database if exists $DB" >/dev/null
echo; echo "$pass réussis, $fail échec(s)"; [ $fail -eq 0 ]

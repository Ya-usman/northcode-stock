#!/bin/bash
# Validation LOCALE de 195 (conditionnements d'achat) — base PostgreSQL jetable UNIQUEMENT.
# Usage (racine du dépôt) : bash supabase/drafts/195_local_validation.sh
set -u
export PGCLIENTENCODING=UTF8
BIN="${PSQL_BIN:-/c/Program Files/PostgreSQL/18/bin}"; PORT="${PGPORT:-55432}"; HOST=localhost
P() { "$BIN/psql.exe" -h "$HOST" -p "$PORT" -U postgres -v ON_ERROR_STOP=1 -X -q -tA "$@"; }
DB=r195
Q() { P -d $DB -c "$1" 2>&1 | tail -1; }
ERR() { P -d $DB -c "$1" 2>&1 | grep -oE '(violates [a-z ]+ constraint|duplicate key)' | head -1; }
pass=0; fail=0
ok() { if [ "$1" = "$2" ]; then pass=$((pass+1)); echo "ok    $3"; else fail=$((fail+1)); echo "ÉCHEC $3"; echo "      attendu : $2"; echo "      obtenu  : $1"; fi; }
P -d postgres -c "drop database if exists $DB" -c "create database $DB" >/dev/null
P -d $DB <<'SQL' >/dev/null || { echo "schéma local impossible"; exit 2; }
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
END $$;
CREATE SCHEMA auth; CREATE TABLE auth.users (id uuid primary key);
CREATE TABLE public.shops (id uuid primary key);
CREATE TABLE public.products (id uuid primary key, shop_id uuid);
CREATE TABLE public.purchase_order_items (id uuid primary key default gen_random_uuid(), purchase_order_id uuid, product_id uuid,
  product_name text, unit text, quantity_ordered int not null check (quantity_ordered > 0), quantity_received int, unit_price numeric);
GRANT ALL ON ALL TABLES IN SCHEMA public TO anon, authenticated;
SQL
S1=11111111-0000-0000-0000-000000000001; S2=11111111-0000-0000-0000-000000000002
A=aaaaaaaa-0000-0000-0000-000000000001; B=aaaaaaaa-0000-0000-0000-000000000002
P -d $DB -c "insert into shops values ('$S1'),('$S2'); insert into products values ('$A','$S1'),('$B','$S2');
  insert into purchase_order_items (product_name, unit, quantity_ordered) values ('ancienne ligne','piece',12)" >/dev/null
for i in 1 2; do P -d $DB -1 -f supabase/migrations/195_product_packagings.sql >/dev/null 2>&1 && echo "passage $i ok" || { echo "passage $i ÉCHEC"; P -d $DB -1 -f supabase/migrations/195_product_packagings.sql; exit 1; }; done
ok "$(Q "select count(*) from purchase_order_items where pack_qty is null")" "1" "lignes existantes intactes (sans conditionnement)"
P -d $DB -c "insert into product_packagings (shop_id, product_id, unit, units_per_pack, barcode, is_default) values ('$S1','$A','carton',24,'12345678',true)" >/dev/null
ok "$(Q "select unit||'/'||units_per_pack from product_packagings")" "carton/24" "conditionnement créé"
ok "$(ERR "insert into product_packagings (shop_id, product_id, unit, units_per_pack, is_default) values ('$S1','$A','pack',6,true)")" "duplicate key" "un seul conditionnement par défaut par produit"
ok "$(ERR "insert into product_packagings (shop_id, product_id, unit, units_per_pack) values ('$S1','$A','carton',24)")" "duplicate key" "même conditionnement en double refusé"
ok "$(ERR "insert into product_packagings (shop_id, product_id, unit, units_per_pack) values ('$S1','$A','pack',1)")" "violates check constraint" "1 unité par colis refusé (au moins 2)"
ok "$(ERR "insert into product_packagings (shop_id, product_id, unit, units_per_pack, barcode) values ('$S1','$A','pack',6,'12345678')")" "duplicate key" "code-barres de colis unique dans la boutique"
P -d $DB -c "insert into product_packagings (shop_id, product_id, unit, units_per_pack, barcode) values ('$S2','$B','pack',6,'12345678')" >/dev/null
ok "$(Q "select count(*) from product_packagings where barcode='12345678'")" "2" "même code-barres permis dans une autre boutique"
P -d $DB -c "insert into purchase_order_items (product_name, unit, quantity_ordered, pack_unit, units_per_pack, pack_qty) values ('cartons','piece',72,'carton',24,3)" >/dev/null
ok "$(Q "select quantity_ordered||'='||pack_qty||'x'||units_per_pack from purchase_order_items where pack_qty is not null")" "72=3x24" "ligne de bon en cartons : quantité de base = colis × unités"
ok "$(ERR "insert into purchase_order_items (product_name, unit, quantity_ordered, pack_unit, units_per_pack, pack_qty) values ('faux','piece',70,'carton',24,3)")" "violates check constraint" "quantité incohérente avec le conditionnement refusée"
ok "$(ERR "insert into purchase_order_items (product_name, unit, quantity_ordered, pack_unit) values ('partiel','piece',24,'carton')")" "violates check constraint" "conditionnement incomplet refusé"
ok "$(Q "select has_table_privilege('authenticated','public.product_packagings','SELECT')::text||has_table_privilege('anon','public.product_packagings','INSERT')::text||has_table_privilege('authenticated','public.purchase_order_items','SELECT')::text")" "falsefalsefalse" "tables réservées au serveur"
ok "$(P -d $DB -1 -f supabase/rollbacks/195_product_packagings_rollback.sql 2>&1 | grep -c 'retour arrière refusé')" "1" "retour arrière refusé tant que des conditionnements existent"
P -d $DB -c "delete from product_packagings; delete from purchase_order_items where pack_qty is not null" >/dev/null
P -d $DB -1 -f supabase/rollbacks/195_product_packagings_rollback.sql >/dev/null 2>&1 && echo "retour arrière appliqué"
ok "$(Q "select count(*) from information_schema.tables where table_name='product_packagings'")" "0" "retour arrière : table retirée"
echo; echo "$pass réussis, $fail échec(s)"
P -d postgres -c "drop database if exists $DB" >/dev/null
[ $fail -eq 0 ]

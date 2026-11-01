#!/bin/bash
# Validation LOCALE de 196 (emplacement d'un produit) — base PostgreSQL jetable UNIQUEMENT.
# Usage (racine du dépôt) : bash supabase/drafts/196_local_validation.sh
set -u
export PGCLIENTENCODING=UTF8
BIN="${PSQL_BIN:-/c/Program Files/PostgreSQL/18/bin}"; PORT="${PGPORT:-55432}"; HOST=localhost
P() { "$BIN/psql.exe" -h "$HOST" -p "$PORT" -U postgres -v ON_ERROR_STOP=1 -X -q -tA "$@"; }
DB=r196
Q() { P -d $DB -c "$1" 2>&1 | tail -1; }
ERR() { P -d $DB -c "$1" 2>&1 | grep -oE '(violates [a-z ]+ constraint|permission denied)' | head -1; }
pass=0; fail=0
ok() { if [ "$1" = "$2" ]; then pass=$((pass+1)); echo "ok    $3"; else fail=$((fail+1)); echo "ÉCHEC $3"; echo "      attendu : $2"; echo "      obtenu  : $1"; fi; }
P -d postgres -c "drop database if exists $DB" -c "create database $DB" >/dev/null
# Schéma minimal fidèle à la prod : lecture par colonne pour « authenticated » (181), prix d'achat non lisible
P -d $DB <<'SQL' >/dev/null || { echo "schéma local impossible"; exit 2; }
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
END $$;
CREATE TABLE public.products (id uuid primary key, shop_id uuid, name text, quantity int, buying_price numeric);
GRANT USAGE ON SCHEMA public TO authenticated;
GRANT SELECT (id, shop_id, name, quantity) ON public.products TO authenticated;
GRANT UPDATE ON public.products TO authenticated;
SQL
A=aaaaaaaa-0000-0000-0000-000000000001
P -d $DB -c "insert into products values ('$A', null, 'Riz 5 kg', 12, 4000)" >/dev/null
for i in 1 2; do P -d $DB -1 -f supabase/migrations/196_product_location.sql >/dev/null 2>&1 && echo "passage $i ok" || { echo "passage $i ÉCHEC"; P -d $DB -1 -f supabase/migrations/196_product_location.sql; exit 1; }; done
ok "$(Q "select coalesce(location,'(vide)')||'/'||quantity from products")" "(vide)/12" "produit existant intact, emplacement vide"
ok "$(Q "select count(*) from pg_constraint where conname='products_location_check'")" "1" "contrainte posée une seule fois (2 passages)"
# Accents écrits en échappement Unicode SQL (psql.exe reçoit la ligne de commande dans l'encodage Windows)
P -d $DB -c "update products set location=U&'Rayon 3, \00E9tag\00E8re B'" >/dev/null
ok "$(Q "select location = U&'Rayon 3, \00E9tag\00E8re B' from products")" "t" "emplacement accentué enregistré (« Rayon 3, étagère B »)"
ok "$(ERR "update products set location='   '")" "violates check constraint" "emplacement fait d'espaces refusé"
ok "$(ERR "update products set location=repeat('x', 61)")" "violates check constraint" "plus de 60 caractères refusé"
P -d $DB -c "update products set location=repeat('x', 60)" >/dev/null
ok "$(Q "select char_length(location) from products")" "60" "60 caractères acceptés"
P -d $DB -c "update products set location=null" >/dev/null
ok "$(Q "select count(*) from products where location is null")" "1" "emplacement effaçable (null)"
ok "$(Q "set role authenticated; select coalesce(location,'(vide)') from products")" "(vide)" "« authenticated » lit l'emplacement"
ok "$(ERR "set role authenticated; select buying_price from products")" "permission denied" "le prix d'achat reste illisible"
ok "$(ERR "set role anon; select location from products")" "permission denied" "« anon » ne lit rien"
# Retour arrière puis ré-application
P -d $DB -1 -f supabase/rollbacks/196_product_location_rollback.sql >/dev/null 2>&1
ok "$(Q "select count(*) from information_schema.columns where table_name='products' and column_name='location'")" "0" "retour arrière : colonne retirée"
P -d $DB -1 -f supabase/migrations/196_product_location.sql >/dev/null 2>&1
ok "$(Q "select count(*) from information_schema.columns where table_name='products' and column_name='location'")" "1" "ré-application après retour arrière"
echo; echo "$pass réussis, $fail échec(s)"
P -d postgres -c "drop database if exists $DB" >/dev/null
exit $fail

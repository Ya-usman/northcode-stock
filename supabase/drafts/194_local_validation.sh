#!/bin/bash
# Validation LOCALE de 194 (inventaire tournant) — base PostgreSQL jetable UNIQUEMENT, jamais la production.
# Tables d'inventaire reprises de la 175 (texte exact du fichier), fonctions de PRODUCTION start_inventory_session /
# record_inventory_count (textes lus en production le 31 oct. 2026, copiés dans supabase/drafts/194_prod), puis fichier EXACT 194
# appliqué deux fois, contrôles, retour arrière.
# Usage (racine du dépôt) : supabase/drafts/194_local_validation.sh
set -u
export PGCLIENTENCODING=UTF8
BIN="${PSQL_BIN:-/c/Program Files/PostgreSQL/18/bin}"; PORT="${PGPORT:-55432}"; HOST=localhost
P() { "$BIN/psql.exe" -h "$HOST" -p "$PORT" -U postgres -v ON_ERROR_STOP=1 -X -q -tA "$@"; }
DB=r194
Q() { P -d $DB -c "$1" 2>&1 | tail -1; }
ERR() { P -d $DB -c "$1" 2>&1 | grep -oE 'ERROR: +[a-z_]+' | head -1 | sed -E 's/ERROR: +//'; }
pass=0; fail=0
ok() { if [ "$1" = "$2" ]; then pass=$((pass+1)); echo "ok    $3"; else fail=$((fail+1)); echo "ÉCHEC $3"; echo "      attendu : $2"; echo "      obtenu  : $1"; fi; }
PROD_DIR="${PROD_DIR:-supabase/drafts/194_prod}"   # définitions lues en production le 31 oct. 2026

P -d postgres -c "drop database if exists $DB" -c "create database $DB" >/dev/null
P -d $DB <<'SQL' >/dev/null || { echo "schéma local impossible"; exit 2; }
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role; END IF;
END $$;
CREATE SCHEMA auth; CREATE TABLE auth.users (id uuid primary key);
CREATE TABLE public.shops (id uuid primary key);
CREATE TABLE public.products (id uuid primary key, shop_id uuid, name text, unit text, quantity int not null default 0, is_active boolean not null default true);
CREATE TABLE public.stock_movements (id uuid primary key default gen_random_uuid());
CREATE FUNCTION public._inventory_audit(p_shop_id uuid, p_user uuid, p_action text, p_session_id uuid, p_meta jsonb) RETURNS void LANGUAGE sql AS $$ select $$;
SQL
# Tables de la 175 (texte exact, sans BEGIN)
sed -n '/^create table public.inventory_sessions/,/^create index inventory_counts_movement/p' supabase/migrations/175_inventory_sessions.sql | P -d $DB >/dev/null || { echo "tables 175 impossibles"; exit 2; }
P -d $DB -f "$PROD_DIR/prod-start_inventory_session.sql" >/dev/null && P -d $DB -f "$PROD_DIR/prod-record_inventory_count.sql" >/dev/null || { echo "fonctions de production impossibles"; exit 2; }

S1=11111111-0000-0000-0000-000000000001; S2=11111111-0000-0000-0000-000000000002; U=22222222-0000-0000-0000-000000000001
A=aaaaaaaa-0000-0000-0000-000000000001; B=aaaaaaaa-0000-0000-0000-000000000002; C=aaaaaaaa-0000-0000-0000-000000000003
D=aaaaaaaa-0000-0000-0000-000000000004; X=aaaaaaaa-0000-0000-0000-000000000009
P -d $DB -c "insert into shops values ('$S1'),('$S2'); insert into auth.users values ('$U');
  insert into products values ('$A','$S1','A','u',10,true),('$B','$S1','B','u',5,true),('$C','$S1','C','u',7,true),('$D','$S1','D','u',3,false),('$X','$S2','X','u',9,true)" >/dev/null

echo "── Application de la 194 (deux fois)"
for i in 1 2; do P -d $DB -1 -f supabase/migrations/194_cycle_inventory.sql >/dev/null 2>&1 && echo "passage $i ok" || { echo "passage $i ÉCHEC"; P -d $DB -1 -f supabase/migrations/194_cycle_inventory.sql; exit 1; }; done

echo "── Inventaire complet : inchangé"
FULL=$(Q "select start_inventory_session('$S1','$U')->>'id'")
ok "$(Q "select scope||'/'||products_total||'/'||coalesce(cardinality(scope_product_ids)::text,'null') from inventory_sessions where id='$FULL'")" "full/3/null" "démarrage complet : périmètre full, 3 produits actifs (le 4e est inactif), comme avant"
ok "$(Q "select (record_inventory_count('$FULL','$S1','$C',6,'$U',null)->>'delta')")" "-1" "inventaire complet : n'importe quel produit se compte"
P -d $DB -c "update inventory_sessions set status='cancelled', cancelled_at=now() where id='$FULL'" >/dev/null

echo "── Inventaire tournant"
CY=$(Q "select start_cycle_inventory_session('$S1','$U', array['$B','$A','$B','$X','$D']::uuid[])->>'id'")
ok "$(Q "select scope||'/'||products_total||'/'||array_to_string(scope_product_ids, ',') from inventory_sessions where id='$CY'")" "cycle/2/$B,$A" "doublon, produit d'une autre boutique et produit inactif écartés ; ordre gardé"
ok "$(Q "select start_cycle_inventory_session('$S1','$U', array['$C']::uuid[])->>'resumed'")" "true" "une session déjà en cours est reprise (une seule par boutique)"
ok "$(Q "select start_inventory_session('$S1','$U')->>'id'")" "$CY" "un inventaire complet demandé pendant le tournant reprend le tournant"
ok "$(Q "select (record_inventory_count('$CY','$S1','$A',8,'$U',null)->>'delta')")" "-2" "produit du périmètre : compté"
ok "$(ERR "select record_inventory_count('$CY','$S1','$C',7,'$U',null)")" "product_out_of_scope" "produit hors périmètre : refusé"
ok "$(Q "select count(*) from inventory_counts where session_id='$CY' and product_id='$C'")" "0" "rien écrit pour le produit hors périmètre"
ok "$(ERR "select start_cycle_inventory_session('$S2','$U', array['$A']::uuid[])")" "nothing_to_count" "aucun produit valide : refusé"
ok "$(ERR "insert into inventory_sessions (shop_id, reference, scope) values ('$S2','INV-x','cycle')")" "new" "contrainte : tournant sans produits refusé"

echo "── Dernier comptage"
P -d $DB -c "update inventory_sessions set status='completed', completed_at='2026-10-30 10:00+00' where id='$CY'" >/dev/null
ok "$(Q "select product_id||'@'||to_char(last_counted_at at time zone 'UTC','YYYY-MM-DD') from product_last_counted('$S1')")" "$A@2026-10-30" "date du dernier comptage (sessions terminées seulement, la session abandonnée ne compte pas)"

echo "── Droits"
ok "$(Q "select has_function_privilege('authenticated','public.start_cycle_inventory_session(uuid,uuid,uuid[])','EXECUTE')::text||has_function_privilege('anon','public.product_last_counted(uuid)','EXECUTE')::text||has_function_privilege('authenticated','public.record_inventory_count(uuid,uuid,uuid,integer,uuid,uuid)','EXECUTE')::text")" "falsefalsefalse" "fonctions réservées au serveur"

echo "── Retour arrière"
ok "$(P -d $DB -1 -f supabase/rollbacks/194_cycle_inventory_rollback.sql 2>&1 | grep -c 'retour arrière refusé')" "1" "retour arrière refusé tant qu'un inventaire tournant existe"
P -d $DB -c "delete from inventory_sessions where scope='cycle'" >/dev/null
P -d $DB -1 -f supabase/rollbacks/194_cycle_inventory_rollback.sql >/dev/null 2>&1 && echo "retour arrière appliqué"
ok "$(Q "select count(*) from information_schema.columns where table_name='inventory_sessions' and column_name in ('scope','scope_product_ids')")" "0" "retour arrière : colonnes retirées"
ok "$(Q "select (position('product_out_of_scope' in pg_get_functiondef('public.record_inventory_count(uuid,uuid,uuid,integer,uuid,uuid)'::regprocedure)) = 0)::text")" "true" "retour arrière : comptage remis à l'identique de la production"

echo; echo "$pass réussis, $fail échec(s)"
P -d postgres -c "drop database if exists $DB" >/dev/null
[ $fail -eq 0 ]
